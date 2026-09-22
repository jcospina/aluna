// The production `/prompt` pipeline — resolution, then admission (Epics 2.5, 4.8).
//
// The explicit loop's *route* half and no more: it reads one active registry catalog, classifies
// the typed prompt against it (with a deterministic duplicate short circuit), and turns a
// build-shaped classification into a `ResolvedBuildRequest` bound to its target expectation and
// that catalog's fingerprint. It then hands the request to the core Builder with the explicit
// foreground presenter. The lease, lease-head revalidation, the admission row, mutation, Gate
// and activation all live in `core-builder.ts`, which Module 7 drives with another presenter.
//
// Neither `reject` nor `data_query` reaches the Builder. A refusal deflects with a warm line; a
// question runs and is answered in the answer window (6.5/03). Both leave the same best-effort
// resolver-only metrics row and nothing else.

import type { PlatformDatabase } from "../../platform/persistence/db.ts";
import { abortableProvider, type Provider } from "../../platform/provider/index.ts";
import { NO_TOKEN_USAGE } from "../../platform/provider/usage.ts";
import {
  type ActiveRegistryCatalog,
  CapabilityIdReservedError,
  canonicalCapabilityLabel,
  isCapabilityIdReservedByDeletion,
  readActiveRegistryCatalog,
} from "../../registry/index.ts";
import type { MutationCoordinator } from "../../runtime/concurrency/mutation-coordinator.ts";
import type { ReadGateCoordinator } from "../../runtime/concurrency/read-gates.ts";
import {
  BUILDING_WINDOW_TITLE,
  renderBuildWindowTitle,
  renderProvisionalLogo,
} from "../../server/http/index.ts";
import { classifyIntentWithUsage, type IntentClassification } from "../intent/index.ts";
import type {
  BuildPipeline,
  BuildPipelineCompletion,
  BuildPipelineContext,
} from "../jobs/build-jobs.ts";
import { renderRestorationFragment, standingCapabilityId } from "../jobs/restoration.ts";
import { carriedResolverMeasurement, type RecordMetrics } from "../metrics-recorder.ts";
import { streamQuestion } from "../query/question-pipeline.ts";
import {
  DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
  deliverFailedPresentation,
  deliverRestoredPresentation,
} from "../streaming/terminal-presentation.ts";
import { duplicateIntentForPrompt, existingCapabilityNarration } from "./admission/deflection.ts";
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
  /** A question opens a whole-catalog read scope through these (ADR-0008). */
  readonly readGates: ReadGateCoordinator;
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
  // The window has said `Thinking…` since the prompt was sent. An evolution keeps the name the
  // capability already has, so no later moment makes the title truer than this one.
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
  /** Already bound to this job's signal, so cancelling a question actually stops one. */
  provider: Provider,
  /** When this run started, which is what a question's measured wall-clock runs from (6.6/04). */
  askedAt: number,
): Promise<BuildPipelineCompletion> {
  const resolution: PromptResolutionMemory = {
    intent,
    outcome: "non_build",
    catalogFingerprint,
    resolver,
  };
  context.job.resolution = resolution;
  const shared = {
    resolution,
    recordMetrics: deps.recordMetrics,
    send: context.send,
    isAborted: context.isAborted,
    canPresent: context.canPresent,
    mutationCoordinator: deps.mutationCoordinator,
    terminalPresenterTimeoutMs: deps.terminalPresenterTimeoutMs,
  };
  // A question is not a deflection: it runs, and it is answered in a window that opens beside
  // whatever is standing. The frame the submit borrowed is given back untouched — the capability
  // being asked about is still open, still itself (PLAN decisions 21, 23).
  if (intent.type === "data_query") {
    return streamQuestion({
      ...shared,
      promptJobId: context.job.id,
      askedAt,
      databases: deps.buildDatabases,
      question: context.job.prompt,
      provider,
      readGates: deps.readGates,
      // The same fact the resolver was classified against, and the reason it is sent twice rather
      // than read off the intent: what the model returns is its reading of the sentence, and what
      // is on screen is the desk's. A question resolves loose words against the second.
      standing: standingCapabilityId(context.job.restoration),
      // What the person's own two triggers arrive on (PLAN decisions 27, 10). A build reaches the
      // same signal through `runCoreBuild`; a question needs it to reach the read scope, whose
      // worker is the only thing a cancel can actually stop.
      signal: context.signal,
    });
  }
  return streamDeflection({
    ...shared,
    generationId: context.job.id,
    prompt: context.job.prompt,
    buildDatabases: deps.buildDatabases,
    restoration: context.job.restoration,
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
  // The moment resolution admitted a *new* capability, which an evolution and a deflection never
  // reach — so the ground announces it here and the window stops saying `Thinking…`.
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
  const catalogIds = catalog.capabilities.map((capability) => capability.id);
  if (duplicateIntent) {
    const resolution: PromptResolutionMemory = {
      intent: duplicateIntent,
      outcome: "non_build",
      catalogFingerprint: catalog.fingerprint,
      resolver: carriedResolverMeasurement(
        duplicateIntent,
        NO_TOKEN_USAGE,
        0,
        catalog.fingerprint,
        catalogIds,
      ),
    };
    job.resolution = resolution;
    return streamDeflection({
      generationId: job.id,
      prompt: job.prompt,
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
    activeCapabilityId: standingCapabilityId(job.restoration),
    send,
  });
  const { intent, usage, durationMs: resolverDurationMs } = classification;
  const resolver = carriedResolverMeasurement(
    intent,
    usage,
    resolverDurationMs,
    classification.catalogFingerprint,
    catalogIds,
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
    return runNonBuildIntent(
      context,
      deps,
      classification.catalogFingerprint,
      intent,
      resolver,
      provider,
      builtAt,
    );
  }
  if (intent.resolution === "namespace" && intent.proposed_identity) {
    validateProposedOverlapIdentity({
      proposed: intent.proposed_identity,
      targetCapabilityId: intent.target_capability ?? "",
      capabilities: catalog.capabilities,
    });
    // The catalog holds only active rows, so a tombstone reserving the id passes the check above
    // and would reach the lease head as a stale refusal claiming the desk changed after the ask.
    if (
      isCapabilityIdReservedByDeletion(intent.proposed_identity.id, deps.buildDatabases.readonly)
    ) {
      throw new CapabilityIdReservedError(intent.proposed_identity.id);
    }
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
      // The empty notice, on both: the bar is holding what Aluna said while she worked out what
      // the sentence was, and a run that ended without getting there has to take it with it.
      if (context.isAborted()) {
        await deliverRestoredPresentation(
          context.send,
          renderRestorationFragment(context.job.restoration, deps.buildDatabases.readonly, ""),
          "cancelled",
          deps.terminalPresenterTimeoutMs,
        );
        return "terminal-sent";
      }
      await deliverFailedPresentation(
        context.send,
        context.job.id,
        error,
        renderRestorationFragment(context.job.restoration, deps.buildDatabases.readonly, ""),
        deps.terminalPresenterTimeoutMs,
      );
      return "terminal-sent";
    }
  };
}
