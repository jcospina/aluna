// The production `/prompt` build pipeline — what a queued build job runs (Epic 2.5).
//
// Given a job's prompt it classifies intent (with a duplicate-detection short
// circuit), then either deflects an unsupported intent with a warm line, or runs the
// full spec → migration → units → gate → commit build for a `new_capability`. The
// `/build/:id/stream` route drives this; the POST `/prompt` path only admits the job.

import type {
  BuildPipeline,
  BuildPipelineCompletion,
  BuildPipelineContext,
} from "../build-jobs.ts";
import {
  type CommitCapabilityResult,
  createCapabilityIncarnationId,
  reconcileCapabilityArtifacts,
} from "../builder/index.ts";
import type { PlatformDatabase } from "../db.ts";
import { classifyIntentWithUsage, type IntentClassification } from "../intent-resolver/index.ts";
import type { MutationCoordinator } from "../mutation-coordinator/index.ts";
import { abortableProvider, type Provider, type TokenUsage } from "../provider/index.ts";
import { listCapabilities } from "../registry/index.ts";
import type { Send } from "../sse/index.ts";
import { renderCachedCapabilityCommitSwap } from "../web/index.ts";
import { AbortedBuildError, runSpecBuildStages } from "./build-run.ts";
import {
  deflectDuplicateNewCapability,
  deflectionNarration,
  duplicateIntentForPrompt,
  existingCapabilityNarration,
  NO_TOKEN_USAGE,
} from "./deflection.ts";
import {
  carriedResolverMeasurement,
  classifyBuildFailure,
  type DemoBuildAccumulator,
  lifecycleFailureOutcome,
  lifecycleMeasurement,
  lifecycleStages,
  type RecordMetrics,
  writeDeflectionMetrics,
} from "./metrics-recorder.ts";
import { buildCommitPreview } from "./previews.ts";
import { type RestorationDescriptor, renderRestorationFragment } from "./restoration.ts";
import {
  DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
  deliverActivatedPresentation,
  deliverActivatedRecoveryPresentation,
  deliverFailedPresentation,
  deliverRestoredPresentation,
} from "./terminal-presentation.ts";

/** What {@link createPromptBuildPipeline} needs to run a build against the real db/disk. */
export interface PromptBuildPipelineDeps {
  readonly getProvider: () => Provider;
  readonly recordMetrics: RecordMetrics;
  readonly buildDatabases: PlatformDatabase;
  readonly artifactsRoot: string;
  readonly mutationCoordinator: MutationCoordinator;
  readonly terminalPresenterTimeoutMs?: number;
}

interface DeflectionPipelineInput {
  readonly generationId: string;
  readonly intent: IntentClassification;
  readonly usage: TokenUsage;
  readonly recordMetrics: RecordMetrics;
  readonly send: Send;
  readonly isAborted: () => boolean;
  readonly canPresent: () => boolean;
  readonly signal?: AbortSignal;
  readonly mutationCoordinator: MutationCoordinator;
  readonly restoration: RestorationDescriptor;
  readonly buildDatabases: PlatformDatabase;
  readonly terminalPresenterTimeoutMs: number;
  readonly narration?: string;
  readonly preserveActiveView?: boolean;
}

/** Record the deflection metrics row and narrate the warm "not yet" line. */
async function streamDeflection({
  generationId,
  intent,
  usage,
  recordMetrics,
  send,
  isAborted,
  canPresent,
  signal,
  mutationCoordinator,
  restoration,
  buildDatabases,
  terminalPresenterTimeoutMs,
  narration,
  preserveActiveView,
}: DeflectionPipelineInput): Promise<BuildPipelineCompletion> {
  // Non-build resolver metrics are best-effort: the write still queues behind any
  // build reservation, but the user-visible deflection never waits for experiment data.
  void mutationCoordinator
    .withPlatformWrite(
      () => writeDeflectionMetrics(recordMetrics, generationId, intent, usage),
      signal ? { signal } : {},
    )
    .catch((error) => {
      console.error(
        "Aluna resolver metrics write did not complete:",
        error instanceof Error ? error.message : error,
      );
    });
  if (canPresent()) {
    const explanation = narration ?? deflectionNarration(intent);
    await deliverRestoredPresentation(
      send,
      renderRestorationFragment(
        restoration,
        buildDatabases.readonly,
        explanation,
        preserveActiveView ? "preserve" : "replace",
      ),
      isAborted() ? "cancelled" : "ok",
      terminalPresenterTimeoutMs,
    );
    return "terminal-sent";
  }
}

interface NewCapabilityPipelineInput {
  readonly generationId: string;
  readonly prompt: string;
  readonly provider: Provider;
  readonly intent: IntentClassification;
  readonly usage: TokenUsage;
  readonly resolverDurationMs: number;
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
    stages: lifecycleStages(input.acc, "failed"),
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
      input.prompt,
      input.intent,
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
  prompt,
  provider,
  intent,
  usage,
  resolverDurationMs,
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
  const acc: DemoBuildAccumulator = { usages: [usage], timings: {} };
  recordMetrics.start({
    buildId: generationId,
    incarnationId,
    resolver: carriedResolverMeasurement(intent, usage, resolverDurationMs),
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
    prompt,
    provider,
    intent,
    usage,
    resolverDurationMs,
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

async function runPromptJob(
  { job, send, isAborted, canPresent, signal }: BuildPipelineContext,
  deps: ResolvedPromptPipelineDeps,
): Promise<BuildPipelineCompletion> {
  const builtAt = performance.now();
  const capabilities = listCapabilities(deps.buildDatabases.readonly);
  const duplicateIntent = duplicateIntentForPrompt(job.prompt, capabilities);
  if (duplicateIntent) {
    return streamDeflection({
      generationId: job.id,
      intent: duplicateIntent,
      usage: NO_TOKEN_USAGE,
      recordMetrics: deps.recordMetrics,
      send,
      isAborted,
      canPresent,
      signal,
      mutationCoordinator: deps.mutationCoordinator,
      restoration: job.restoration,
      buildDatabases: deps.buildDatabases,
      terminalPresenterTimeoutMs: deps.terminalPresenterTimeoutMs,
      narration: existingCapabilityNarration(duplicateIntent, capabilities),
      preserveActiveView: true,
    });
  }

  const provider = abortableProvider(deps.getProvider(), signal);
  const classification = await classifyIntentWithUsage({
    provider,
    prompt: job.prompt,
    database: deps.buildDatabases.readonly,
    send,
  });
  const intent = deflectDuplicateNewCapability(classification.intent, job.prompt, capabilities);
  const { usage, durationMs: resolverDurationMs } = classification;
  if (intent.type !== "new_capability") {
    return streamDeflection({
      generationId: job.id,
      intent,
      usage,
      recordMetrics: deps.recordMetrics,
      send,
      isAborted,
      canPresent,
      signal,
      mutationCoordinator: deps.mutationCoordinator,
      restoration: job.restoration,
      buildDatabases: deps.buildDatabases,
      terminalPresenterTimeoutMs: deps.terminalPresenterTimeoutMs,
    });
  }

  const reservation = deps.mutationCoordinator.reserveBuild();
  return deps.mutationCoordinator.withBuildLease(
    reservation,
    async () => {
      try {
        return await streamNewCapabilityBuild({
          generationId: job.id,
          prompt: job.prompt,
          provider,
          intent,
          usage,
          resolverDurationMs,
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
