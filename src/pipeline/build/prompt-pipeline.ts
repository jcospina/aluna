// The production `/prompt` build pipeline — what a queued build job runs (Epic 2.5).
//
// Given a job's prompt it classifies intent (with a duplicate-detection short
// circuit), then either deflects an unsupported intent with a warm line, or runs the
// full spec → migration → units → gate → commit build for a `new_capability`. The
// `/build/:id/stream` route drives this; the POST `/prompt` path only admits the job.

import {
  type CommitCapabilityResult,
  createCapabilityIncarnationId,
  reconcileCapabilityArtifacts,
} from "../../builder/index.ts";
import { classifyIntentWithUsage, type IntentClassification } from "../../intent-resolver/index.ts";
import type { MutationCoordinator } from "../../mutation-coordinator/index.ts";
import type { PlatformDatabase } from "../../persistence/db.ts";
import { abortableProvider, type Provider } from "../../provider/index.ts";
import { type ActiveRegistryCatalog, readActiveRegistryCatalog } from "../../registry/index.ts";
import type { Send } from "../../sse/index.ts";
import { renderCachedCapabilityCommitSwap } from "../../web/index.ts";
import type {
  BuildPipeline,
  BuildPipelineCompletion,
  BuildPipelineContext,
} from "../jobs/build-jobs.ts";
import { type RestorationDescriptor, renderRestorationFragment } from "../jobs/restoration.ts";
import {
  carriedResolverMeasurement,
  classifyBuildFailure,
  type DemoBuildAccumulator,
  lifecycleFailureOutcome,
  lifecycleMeasurement,
  lifecycleStages,
  type RecordMetrics,
} from "../metrics-recorder.ts";
import { buildCommitPreview } from "../streaming/previews.ts";
import {
  DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
  deliverActivatedPresentation,
  deliverActivatedRecoveryPresentation,
  deliverFailedPresentation,
  deliverRestoredPresentation,
} from "../streaming/terminal-presentation.ts";
import { AbortedBuildError, runSpecBuildStages } from "./build-run.ts";
import {
  deflectDuplicateNewCapability,
  duplicateIntentForPrompt,
  existingCapabilityNarration,
  NO_TOKEN_USAGE,
} from "./deflection.ts";
import { streamDeflection } from "./deflection-pipeline.ts";
import { streamResolvedEvolution } from "./evolution-pipeline.ts";
import { validateProposedOverlapIdentity } from "./overlap-identity.ts";
import {
  type PromptResolutionMemory,
  type ResolvedBuildRequest,
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

interface NewCapabilityPipelineInput {
  readonly generationId: string;
  readonly provider: Provider;
  readonly resolvedRequest: ResolvedBuildRequest;
  readonly builtAt: number;
  readonly recordMetrics: RecordMetrics;
  readonly buildDatabases: PlatformDatabase;
  readonly artifactsRoot: string;
  readonly send: Send;
  readonly isAborted: () => boolean;
  readonly canPresent: () => boolean;
  readonly terminalPresenterTimeoutMs: number;
  readonly restoration: RestorationDescriptor;
}

interface AdmittedBuildInput extends NewCapabilityPipelineInput {
  readonly incarnationId: string;
  readonly acc: DemoBuildAccumulator;
}

function restorationFor(input: NewCapabilityPipelineInput): string {
  return renderRestorationFragment(input.restoration, input.buildDatabases.readonly);
}

async function cancelAdmittedBuild(input: AdmittedBuildInput): Promise<BuildPipelineCompletion> {
  input.recordMetrics.fail({
    buildId: input.generationId,
    incarnationId: input.incarnationId,
    outcome: "cancelled",
    stages: lifecycleStages(input.acc, "cancelled"),
    measurement: lifecycleMeasurement(input.acc, input.builtAt),
  });
  if (!input.canPresent()) return;
  const metricsPreview = JSON.stringify(
    input.recordMetrics.get(input.generationId, input.incarnationId),
  );
  await deliverRestoredPresentation(
    input.send,
    restorationFor(input),
    "cancelled",
    input.terminalPresenterTimeoutMs,
    { metricsPreview },
  );
  return "terminal-sent";
}

async function failAdmittedBuild(
  input: AdmittedBuildInput,
  error: unknown,
): Promise<BuildPipelineCompletion> {
  const failure = classifyBuildFailure(error, input.acc);
  input.recordMetrics.fail({
    buildId: input.generationId,
    incarnationId: input.incarnationId,
    outcome: lifecycleFailureOutcome(failure),
    stages: lifecycleStages(input.acc, "failed", failure),
    measurement: lifecycleMeasurement(input.acc, input.builtAt, failure),
  });
  const metricsPreview = JSON.stringify(
    input.recordMetrics.get(input.generationId, input.incarnationId),
  );
  await deliverFailedPresentation(
    input.send,
    error,
    restorationFor(input),
    input.terminalPresenterTimeoutMs,
    metricsPreview,
  );
  return "terminal-sent";
}

async function runAdmittedBuildStages(input: AdmittedBuildInput): Promise<BuildPipelineCompletion> {
  let commit: CommitCapabilityResult | undefined;
  try {
    commit = await runSpecBuildStages(
      input.send,
      input.isAborted,
      input.provider,
      input.resolvedRequest.prompt,
      input.resolvedRequest.intent,
      input.generationId,
      input.incarnationId,
      input.acc,
      input.buildDatabases,
      input.artifactsRoot,
      (capabilityId) =>
        input.recordMetrics.identify(input.generationId, input.incarnationId, capabilityId),
      () =>
        input.recordMetrics.succeed({
          buildId: input.generationId,
          incarnationId: input.incarnationId,
          outcome: "activated",
          stages: lifecycleStages(input.acc, "activated"),
          measurement: lifecycleMeasurement(input.acc, input.builtAt),
        }),
      input.resolvedRequest.targetExpectation,
    );
  } catch (error) {
    return error instanceof AbortedBuildError || input.isAborted()
      ? cancelAdmittedBuild(input)
      : failAdmittedBuild(input, error);
  }

  if (commit === undefined) return cancelAdmittedBuild(input);
  await deliverActivatedBuild(commit, input.send, input.terminalPresenterTimeoutMs, () =>
    JSON.stringify(input.recordMetrics.get(input.generationId, input.incarnationId)),
  );
  return "terminal-sent";
}

async function deliverActivatedBuild(
  commit: CommitCapabilityResult,
  send: Send,
  timeoutMs: number,
  getMetricsPreview: () => string,
): Promise<void> {
  try {
    await deliverActivatedPresentation(
      send,
      JSON.stringify(buildCommitPreview(commit)),
      renderCachedCapabilityCommitSwap(commit.row, commit.previousLabel),
      timeoutMs,
      getMetricsPreview(),
    );
  } catch (error) {
    console.error(
      "Aluna activated presentation could not be prepared:",
      error instanceof Error ? error.message : error,
    );
    await deliverActivatedRecoveryPresentation(send, timeoutMs);
  }
}

/**
 * Run the full build for a `new_capability` intent, then announce the committed
 * capability (developer commit preview + product commit swap). On failure it records
 * the failure metrics row and rethrows for the queue's apology; an abort mid-build
 * rolls product work back and durably finalizes the admitted row as cancelled.
 */
async function streamNewCapabilityBuild({
  generationId,
  provider,
  resolvedRequest,
  builtAt,
  recordMetrics,
  buildDatabases,
  artifactsRoot,
  send,
  isAborted,
  canPresent,
  terminalPresenterTimeoutMs,
  restoration,
}: NewCapabilityPipelineInput): Promise<BuildPipelineCompletion> {
  // Lease-head recovery cannot race this process's next publication. It validates
  // every committed version before removing any proven never-activated candidate.
  reconcileCapabilityArtifacts({ database: buildDatabases.readwrite, artifactsRoot });
  const incarnationId = createCapabilityIncarnationId();
  const acc: DemoBuildAccumulator = { usages: [resolvedRequest.resolver.usage], timings: {} };
  recordMetrics.start({
    buildId: generationId,
    incarnationId,
    resolver: resolvedRequest.resolver,
    stages: [],
  });
  try {
    await send("metrics-preview", JSON.stringify(recordMetrics.get(generationId, incarnationId)));
  } catch (error) {
    recordMetrics.fail({
      buildId: generationId,
      incarnationId,
      outcome: "cancelled",
      stages: lifecycleStages(acc, "cancelled"),
      measurement: lifecycleMeasurement(acc, builtAt),
    });
    if (canPresent()) {
      await deliverRestoredPresentation(
        send,
        renderRestorationFragment(restoration, buildDatabases.readonly),
        "cancelled",
        terminalPresenterTimeoutMs,
      );
      return "terminal-sent";
    }
    console.error(
      "Aluna initial build presentation did not complete:",
      error instanceof Error ? error.message : error,
    );
    return;
  }
  return runAdmittedBuildStages({
    generationId,
    provider,
    resolvedRequest,
    builtAt,
    recordMetrics,
    buildDatabases,
    artifactsRoot,
    send,
    isAborted,
    canPresent,
    terminalPresenterTimeoutMs,
    restoration,
    incarnationId,
    acc,
  });
}

interface ResolvedPromptPipelineDeps extends PromptBuildPipelineDeps {
  readonly terminalPresenterTimeoutMs: number;
}

type ResolverMeasurement = ReturnType<typeof carriedResolverMeasurement>;

async function runExistingCapabilityIntent(
  context: BuildPipelineContext,
  deps: ResolvedPromptPipelineDeps,
  catalog: ActiveRegistryCatalog,
  provider: Provider,
  intent: IntentClassification & { readonly type: "extend_capability" | "ui_change" },
  resolver: ResolverMeasurement,
): Promise<BuildPipelineCompletion> {
  const active = catalog.capabilities.find(
    (capability) => capability.id === intent.target_capability,
  );
  if (!active) {
    throw new Error("The resolved capability is not present in the resolver catalog.");
  }
  context.job.resolution = {
    intent,
    outcome: "build",
    catalogFingerprint: catalog.fingerprint,
    resolver,
  };
  return streamResolvedEvolution({
    ...context,
    active,
    intent,
    resolver,
    provider,
    recordMetrics: deps.recordMetrics,
    buildDatabases: deps.buildDatabases,
    artifactsRoot: deps.artifactsRoot,
    mutationCoordinator: deps.mutationCoordinator,
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
  const { job, send, isAborted, canPresent, signal } = context;
  const resolvedRequest = resolvedNewCapabilityRequest({
    prompt: job.prompt,
    intent,
    catalogFingerprint,
    resolver,
  });
  job.resolution = {
    intent,
    outcome: "build",
    catalogFingerprint,
    resolver,
    buildRequest: resolvedRequest,
  };
  const reservation = deps.mutationCoordinator.reserveBuild();
  return deps.mutationCoordinator.withBuildLease(
    reservation,
    async () => {
      try {
        return await streamNewCapabilityBuild({
          generationId: job.id,
          provider,
          resolvedRequest,
          builtAt,
          recordMetrics: deps.recordMetrics,
          buildDatabases: deps.buildDatabases,
          artifactsRoot: deps.artifactsRoot,
          send,
          isAborted,
          canPresent,
          terminalPresenterTimeoutMs: deps.terminalPresenterTimeoutMs,
          restoration: job.restoration,
        });
      } catch (error) {
        await deliverFailedPresentation(
          send,
          error,
          renderRestorationFragment(job.restoration, deps.buildDatabases.readonly),
          deps.terminalPresenterTimeoutMs,
        );
        return "terminal-sent";
      }
    },
    signal ? { signal } : {},
  );
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

/** Classify one prompt job, then deflect or run the admitted build under its lease. */
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
