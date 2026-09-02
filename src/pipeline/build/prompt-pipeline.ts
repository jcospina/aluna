// The production `/prompt` pipeline — resolution, then admission (Epics 2.5, 4.8).
//
// This is the explicit loop's *route* half, and that is all it is. It reads
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

import type { PlatformDatabase } from "../../platform/persistence/db.ts";
import { abortableProvider, type Provider } from "../../platform/provider/index.ts";
import {
  type ActiveRegistryCatalog,
  canonicalCapabilityLabel,
  readActiveRegistryCatalog,
} from "../../registry/index.ts";
import type { MutationCoordinator } from "../../runtime/concurrency/mutation-coordinator.ts";
import {
  BUILDING_WINDOW_TITLE,
  renderBuildWindowTitle,
  renderProvisionalLogo,
} from "../../web/index.ts";
import { classifyIntentWithUsage, type IntentClassification } from "../intent/index.ts";
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
import {
  deflectDuplicateNewCapability,
  duplicateIntentForPrompt,
  existingCapabilityNarration,
  NO_TOKEN_USAGE,
} from "./admission/deflection.ts";
import { streamDeflection } from "./admission/deflection-pipeline.ts";
import { validateProposedOverlapIdentity } from "./admission/overlap-identity.ts";
import {
  type PromptResolutionMemory,
  resolvedExistingCapabilityRequest,
  resolvedNewCapabilityRequest,
} from "./admission/resolved-request.ts";
import { runCoreBuild } from "./core-builder.ts";
import {
  createExplicitEvolutionPresenter,
  createExplicitPresenter,
} from "./presenter/explicit-presenter.ts";

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
  // The window has been saying `Thinking…` since the prompt was sent. It is an evolution
  // of a capability that already exists, so the name it will keep is the one it already
  // has — there is no moment later when it becomes truer.
  if (context.canPresent()) {
    await context.send("fragment", renderBuildWindowTitle(canonicalCapabilityLabel(active)));
  }
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

async function runNewCapabilityIntent(
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
  // The one place a new capability is announced on the ground, and it is here on purpose:
  // this is the moment resolution admitted a *new* capability, which an evolution and a
  // deflection never reach. It is also the moment the window can stop saying `Thinking…`
  // and say what it is doing, which is the same fact told to the other surface.
  if (context.canPresent()) {
    await context.send("fragment", renderProvisionalLogo(context.job.id));
    await context.send("fragment", renderBuildWindowTitle(BUILDING_WINDOW_TITLE));
  }
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
        context.job.id,
        error,
        renderRestorationFragment(context.job.restoration, deps.buildDatabases.readonly),
        deps.terminalPresenterTimeoutMs,
      );
      return "terminal-sent";
    }
  };
}
