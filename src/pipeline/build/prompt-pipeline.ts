// The production `/prompt` pipeline — resolution, then admission (Epics 2.5, 4.8).
//
// This is the explicit loop's *route* half, and after 4.8/03 that is all it is. It reads
// one active registry catalog, classifies the typed prompt against it (with a
// deterministic duplicate short circuit), and turns a build-shaped classification into a
// `ResolvedBuildRequest` bound to its target expectation and that catalog's fingerprint.
// From there it hands the request to the core Builder together with the explicit
// foreground presenter, and owns nothing else: the lease, the lease-head stale
// revalidation, the durable admission row, mutation, Gate, and activation all live in
// `core-builder.ts`, which Module 7 will drive with a different presenter.
//
// `reject` and `data_query` never reach the Builder — they deflect with a warm line and a
// best-effort resolver-only metrics row.

import { classifyIntentWithUsage, type IntentClassification } from "../../intent-resolver/index.ts";
import type { MutationCoordinator } from "../../mutation-coordinator/index.ts";
import type { PlatformDatabase } from "../../persistence/db.ts";
import { abortableProvider, type Provider } from "../../provider/index.ts";
import { type ActiveRegistryCatalog, readActiveRegistryCatalog } from "../../registry/index.ts";
import type {
  BuildPipeline,
  BuildPipelineCompletion,
  BuildPipelineContext,
} from "../jobs/build-jobs.ts";
import { renderRestorationFragment } from "../jobs/restoration.ts";
import { carriedResolverMeasurement, type RecordMetrics } from "../metrics-recorder.ts";
import {
  DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
  deliverFailedPresentation,
  deliverRestoredPresentation,
} from "../streaming/terminal-presentation.ts";
import { runCoreBuild } from "./core-builder.ts";
import {
  deflectDuplicateNewCapability,
  duplicateIntentForPrompt,
  existingCapabilityNarration,
  NO_TOKEN_USAGE,
} from "./deflection.ts";
import { streamDeflection } from "./deflection-pipeline.ts";
import { createExplicitEvolutionPresenter, createExplicitPresenter } from "./explicit-presenter.ts";
import { validateProposedOverlapIdentity } from "./overlap-identity.ts";
import {
  type PromptResolutionMemory,
  resolvedExistingCapabilityRequest,
  resolvedNewCapabilityRequest,
} from "./resolved-request.ts";

/** What {@link createPromptBuildPipeline} needs to run a build against the real db/disk. */
export interface PromptBuildPipelineDeps {
  readonly getProvider: () => Provider;
  readonly recordMetrics: RecordMetrics;
  readonly buildDatabases: PlatformDatabase;
  readonly artifactsRoot: string;
  readonly mutationCoordinator: MutationCoordinator;
  readonly terminalPresenterTimeoutMs?: number;
}

interface ResolvedPromptPipelineDeps extends PromptBuildPipelineDeps {
  readonly terminalPresenterTimeoutMs: number;
}

type ResolverMeasurement = ReturnType<typeof carriedResolverMeasurement>;

/** The presentation wiring both build paths share, minus the terminal shapes themselves. */
function presenterInput(context: BuildPipelineContext, deps: ResolvedPromptPipelineDeps) {
  return {
    job: context.job,
    send: context.send,
    canPresent: context.canPresent,
    isAborted: context.isAborted,
    buildDatabases: deps.buildDatabases,
    recordMetrics: deps.recordMetrics,
    terminalPresenterTimeoutMs: deps.terminalPresenterTimeoutMs,
  };
}

async function runExistingCapabilityIntent(
  context: BuildPipelineContext,
  deps: ResolvedPromptPipelineDeps,
  catalog: ActiveRegistryCatalog,
  provider: Provider,
  intent: IntentClassification & { readonly type: "extend_capability" | "ui_change" },
  resolver: ResolverMeasurement,
  builtAt: number,
): Promise<BuildPipelineCompletion> {
  const active = catalog.capabilities.find(
    (capability) => capability.id === intent.target_capability,
  );
  if (!active) {
    throw new Error("The resolved capability is not present in the resolver catalog.");
  }
  // The exact target this classification was made about: id, incarnation, and the version
  // that was live when it was read. All three are revalidated at the head of the lease.
  const request = resolvedExistingCapabilityRequest({
    prompt: context.job.prompt,
    intent,
    target: {
      capabilityId: active.id,
      incarnationId: active.incarnation_id,
      version: active.version,
    },
    catalogFingerprint: catalog.fingerprint,
    resolver,
  });
  context.job.resolution = {
    intent,
    outcome: "build",
    catalogFingerprint: catalog.fingerprint,
    resolver,
    buildRequest: request,
  };
  return runCoreBuild({
    buildId: context.job.id,
    request,
    presenter: createExplicitEvolutionPresenter({ ...presenterInput(context, deps), active }),
    provider,
    recordMetrics: deps.recordMetrics,
    buildDatabases: deps.buildDatabases,
    artifactsRoot: deps.artifactsRoot,
    mutationCoordinator: deps.mutationCoordinator,
    builtAt,
    ...(context.signal ? { signal: context.signal } : {}),
  });
}

function runNonBuildIntent(
  context: BuildPipelineContext,
  deps: ResolvedPromptPipelineDeps,
  catalogFingerprint: string,
  intent: IntentClassification,
  resolver: ResolverMeasurement,
): Promise<BuildPipelineCompletion> {
  const resolution: PromptResolutionMemory = {
    intent,
    outcome: "non_build",
    catalogFingerprint,
    resolver,
  };
  context.job.resolution = resolution;
  return streamDeflection({
    generationId: context.job.id,
    resolution,
    recordMetrics: deps.recordMetrics,
    send: context.send,
    isAborted: context.isAborted,
    canPresent: context.canPresent,
    mutationCoordinator: deps.mutationCoordinator,
    restoration: context.job.restoration,
    buildDatabases: deps.buildDatabases,
    terminalPresenterTimeoutMs: deps.terminalPresenterTimeoutMs,
  });
}

function runNewCapabilityIntent(
  context: BuildPipelineContext,
  deps: ResolvedPromptPipelineDeps,
  provider: Provider,
  intent: IntentClassification & { readonly type: "new_capability" },
  resolver: ResolverMeasurement,
  catalogFingerprint: string,
  builtAt: number,
): Promise<BuildPipelineCompletion> {
  const request = resolvedNewCapabilityRequest({
    prompt: context.job.prompt,
    intent,
    catalogFingerprint,
    resolver,
  });
  context.job.resolution = {
    intent,
    outcome: "build",
    catalogFingerprint,
    resolver,
    buildRequest: request,
  };
  return runCoreBuild({
    buildId: context.job.id,
    request,
    presenter: createExplicitPresenter(presenterInput(context, deps)),
    provider,
    recordMetrics: deps.recordMetrics,
    buildDatabases: deps.buildDatabases,
    artifactsRoot: deps.artifactsRoot,
    mutationCoordinator: deps.mutationCoordinator,
    builtAt,
    ...(context.signal ? { signal: context.signal } : {}),
  });
}

async function runPromptJob(
  context: BuildPipelineContext,
  deps: ResolvedPromptPipelineDeps,
): Promise<BuildPipelineCompletion> {
  const { job, send, signal } = context;
  const builtAt = performance.now();
  const catalog = readActiveRegistryCatalog(deps.buildDatabases.readonly);
  const duplicateIntent = duplicateIntentForPrompt(job.prompt, catalog.capabilities);
  if (duplicateIntent) {
    const resolution: PromptResolutionMemory = {
      intent: duplicateIntent,
      outcome: "non_build",
      catalogFingerprint: catalog.fingerprint,
      resolver: carriedResolverMeasurement(duplicateIntent, NO_TOKEN_USAGE, 0, catalog.fingerprint),
    };
    job.resolution = resolution;
    return streamDeflection({
      generationId: job.id,
      resolution,
      recordMetrics: deps.recordMetrics,
      send,
      isAborted: context.isAborted,
      canPresent: context.canPresent,
      mutationCoordinator: deps.mutationCoordinator,
      restoration: job.restoration,
      buildDatabases: deps.buildDatabases,
      terminalPresenterTimeoutMs: deps.terminalPresenterTimeoutMs,
      narration: existingCapabilityNarration(duplicateIntent, catalog.capabilities),
      preserveActiveView: true,
    });
  }

  const provider = abortableProvider(deps.getProvider(), signal);
  const classification = await classifyIntentWithUsage({
    provider,
    prompt: job.prompt,
    catalog,
    activeCapabilityId: job.restoration.kind === "capability" ? job.restoration.capabilityId : null,
    send,
  });
  const intent = deflectDuplicateNewCapability(
    classification.intent,
    job.prompt,
    catalog.capabilities,
  );
  const { usage, durationMs: resolverDurationMs } = classification;
  const resolver = carriedResolverMeasurement(
    intent,
    usage,
    resolverDurationMs,
    classification.catalogFingerprint,
  );
  if (intent.type === "extend_capability" || intent.type === "ui_change") {
    return runExistingCapabilityIntent(
      context,
      deps,
      catalog,
      provider,
      { ...intent, type: intent.type },
      resolver,
      builtAt,
    );
  }
  if (intent.type !== "new_capability") {
    return runNonBuildIntent(context, deps, classification.catalogFingerprint, intent, resolver);
  }
  if (intent.resolution === "namespace" && intent.proposed_identity) {
    validateProposedOverlapIdentity({
      proposed: intent.proposed_identity,
      targetCapabilityId: intent.target_capability ?? "",
      capabilities: catalog.capabilities,
    });
  }
  return runNewCapabilityIntent(
    context,
    deps,
    provider,
    { ...intent, type: "new_capability" },
    resolver,
    classification.catalogFingerprint,
    builtAt,
  );
}

/** Classify one prompt job, then deflect or hand the resolved request to the Builder. */
export function createPromptBuildPipeline(input: PromptBuildPipelineDeps): BuildPipeline {
  const deps: ResolvedPromptPipelineDeps = {
    ...input,
    terminalPresenterTimeoutMs:
      input.terminalPresenterTimeoutMs ?? DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
  };
  return async (context) => {
    try {
      return await runPromptJob(context, deps);
    } catch (error) {
      // Resolution itself failed — before any request existed, and so before any lease.
      if (context.isAborted() && !context.canPresent()) return;
      if (context.isAborted()) {
        await deliverRestoredPresentation(
          context.send,
          renderRestorationFragment(context.job.restoration, deps.buildDatabases.readonly),
          "cancelled",
          deps.terminalPresenterTimeoutMs,
        );
        return "terminal-sent";
      }
      await deliverFailedPresentation(
        context.send,
        error,
        renderRestorationFragment(context.job.restoration, deps.buildDatabases.readonly),
        deps.terminalPresenterTimeoutMs,
      );
      return "terminal-sent";
    }
  };
}
