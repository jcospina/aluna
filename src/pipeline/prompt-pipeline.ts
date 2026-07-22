// The production `/prompt` build pipeline — what a queued build job runs (Epic 2.5).
//
// Given a job's prompt it classifies intent (with a duplicate-detection short
// circuit), then either deflects an unsupported intent with a warm line, or runs the
// full spec → migration → units → gate → commit build for a `new_capability`. The
// `/build/:id/stream` route drives this; the POST `/prompt` path only admits the job.

import type { BuildPipeline, BuildPipelineCompletion } from "../build-jobs.ts";
import { type CommitCapabilityResult, createCapabilityIncarnationId } from "../builder/index.ts";
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
import {
  DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
  deliverActivatedPresentation,
  deliverActivatedRecoveryPresentation,
  deliverFailedPresentation,
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
  readonly signal?: AbortSignal;
  readonly mutationCoordinator: MutationCoordinator;
}

/** Record the deflection metrics row and narrate the warm "not yet" line. */
async function streamDeflection({
  generationId,
  intent,
  usage,
  recordMetrics,
  send,
  isAborted,
  signal,
  mutationCoordinator,
}: DeflectionPipelineInput): Promise<void> {
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
  if (!isAborted()) {
    await send("narration", deflectionNarration(intent));
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
  readonly terminalPresenterTimeoutMs: number;
}

async function deliverActivatedBuild(
  commit: CommitCapabilityResult,
  send: Send,
  timeoutMs: number,
): Promise<void> {
  try {
    await deliverActivatedPresentation(
      send,
      JSON.stringify(buildCommitPreview(commit)),
      renderCachedCapabilityCommitSwap(commit.row),
      timeoutMs,
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
  terminalPresenterTimeoutMs,
}: NewCapabilityPipelineInput): Promise<BuildPipelineCompletion> {
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
  } catch {
    recordMetrics.fail({
      buildId: generationId,
      incarnationId,
      outcome: "cancelled",
      stages: lifecycleStages(acc, "cancelled"),
      measurement: lifecycleMeasurement(acc, builtAt),
    });
    return;
  }
  let commit: CommitCapabilityResult | undefined;
  try {
    commit = await runSpecBuildStages(
      send,
      isAborted,
      provider,
      prompt,
      intent,
      generationId,
      incarnationId,
      acc,
      buildDatabases,
      artifactsRoot,
      (capabilityId) => recordMetrics.identify(generationId, incarnationId, capabilityId),
      () =>
        recordMetrics.succeed({
          buildId: generationId,
          incarnationId,
          outcome: "activated",
          stages: lifecycleStages(acc, "activated"),
          measurement: lifecycleMeasurement(acc, builtAt),
        }),
    );
  } catch (error) {
    if (error instanceof AbortedBuildError || isAborted()) {
      recordMetrics.fail({
        buildId: generationId,
        incarnationId,
        outcome: "cancelled",
        stages: lifecycleStages(acc, "cancelled"),
        measurement: lifecycleMeasurement(acc, builtAt),
      });
      return;
    }
    const failure = classifyBuildFailure(error, acc);
    recordMetrics.fail({
      buildId: generationId,
      incarnationId,
      outcome: lifecycleFailureOutcome(failure),
      stages: lifecycleStages(acc, "failed"),
      measurement: lifecycleMeasurement(acc, builtAt, failure),
    });
    await send("metrics-preview", JSON.stringify(recordMetrics.get(generationId, incarnationId)));
    await deliverFailedPresentation(send, error, terminalPresenterTimeoutMs);
    return "terminal-sent";
  }

  if (commit === undefined) {
    recordMetrics.fail({
      buildId: generationId,
      incarnationId,
      outcome: "cancelled",
      stages: lifecycleStages(acc, "cancelled"),
      measurement: lifecycleMeasurement(acc, builtAt),
    });
    return;
  }

  await send("metrics-preview", JSON.stringify(recordMetrics.get(generationId, incarnationId)));
  await deliverActivatedBuild(commit, send, terminalPresenterTimeoutMs);
  return "terminal-sent";
}

/**
 * The build-job pipeline: classify the job's prompt (short-circuiting on a detected
 * duplicate before any provider call), then deflect an unsupported intent or build a
 * `new_capability`. Returned as a {@link BuildPipeline} the queue invokes per job.
 */
export function createPromptBuildPipeline({
  getProvider,
  recordMetrics,
  buildDatabases,
  artifactsRoot,
  mutationCoordinator,
  terminalPresenterTimeoutMs = DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
}: PromptBuildPipelineDeps): BuildPipeline {
  return async ({ job, send, isAborted, signal }) => {
    const builtAt = performance.now();
    const capabilities = listCapabilities(buildDatabases.readonly);
    const duplicateIntent = duplicateIntentForPrompt(job.prompt, capabilities);
    if (duplicateIntent) {
      await streamDeflection({
        generationId: job.id,
        intent: duplicateIntent,
        usage: NO_TOKEN_USAGE,
        recordMetrics,
        send,
        isAborted,
        signal,
        mutationCoordinator,
      });
      return;
    }

    const provider = abortableProvider(getProvider(), signal);
    const classification = await classifyIntentWithUsage({
      provider,
      prompt: job.prompt,
      database: buildDatabases.readonly,
      send,
    });
    const intent = deflectDuplicateNewCapability(classification.intent, job.prompt, capabilities);
    const { usage, durationMs: resolverDurationMs } = classification;

    if (intent.type !== "new_capability") {
      await streamDeflection({
        generationId: job.id,
        intent,
        usage,
        recordMetrics,
        send,
        isAborted,
        signal,
        mutationCoordinator,
      });
      return;
    }

    const reservation = mutationCoordinator.reserveBuild();
    return mutationCoordinator.withBuildLease(
      reservation,
      () =>
        streamNewCapabilityBuild({
          generationId: job.id,
          prompt: job.prompt,
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
          terminalPresenterTimeoutMs,
        }),
      signal ? { signal } : {},
    );
  };
}
