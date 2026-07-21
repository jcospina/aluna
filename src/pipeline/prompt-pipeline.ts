// The production `/prompt` build pipeline — what a queued build job runs (Epic 2.5).
//
// Given a job's prompt it classifies intent (with a duplicate-detection short
// circuit), then either deflects an unsupported intent with a warm line, or runs the
// full spec → migration → units → gate → commit build for a `new_capability`. The
// `/build/:id/stream` route drives this; the POST `/prompt` path only admits the job.

import type { BuildPipeline, BuildPipelineCompletion } from "../build-jobs.ts";
import type { CommitCapabilityResult } from "../builder/index.ts";
import type { PlatformDatabase } from "../db.ts";
import { classifyIntentWithUsage, type IntentClassification } from "../intent-resolver/index.ts";
import type { MutationCoordinator } from "../mutation-coordinator/index.ts";
import { abortableProvider, type Provider, type TokenUsage } from "../provider/index.ts";
import { listCapabilities } from "../registry/index.ts";
import type { Send } from "../sse/index.ts";
import { renderCachedCapabilityCommitSwap } from "../web/index.ts";
import { runSpecBuildStages } from "./build-run.ts";
import {
  deflectDuplicateNewCapability,
  deflectionNarration,
  duplicateIntentForPrompt,
  NO_TOKEN_USAGE,
} from "./deflection.ts";
import {
  classifyBuildFailure,
  type DemoBuildAccumulator,
  type RecordMetrics,
  writeBuildMetrics,
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
 * (commit `undefined`) records nothing — the transaction rolled back.
 */
async function streamNewCapabilityBuild({
  generationId,
  prompt,
  provider,
  intent,
  usage,
  builtAt,
  recordMetrics,
  buildDatabases,
  artifactsRoot,
  send,
  isAborted,
  terminalPresenterTimeoutMs,
}: NewCapabilityPipelineInput): Promise<BuildPipelineCompletion> {
  const acc: DemoBuildAccumulator = { usages: [usage], timings: {} };
  let commit: CommitCapabilityResult | undefined;
  try {
    commit = await runSpecBuildStages(
      send,
      isAborted,
      provider,
      prompt,
      intent,
      generationId,
      acc,
      buildDatabases,
      artifactsRoot,
    );
  } catch (error) {
    if (!isAborted()) {
      writeBuildMetrics(
        recordMetrics,
        generationId,
        intent,
        acc,
        builtAt,
        "failure",
        classifyBuildFailure(error, acc),
      );
      await deliverFailedPresentation(send, error, terminalPresenterTimeoutMs);
      return "terminal-sent";
    }
    return;
  }

  if (commit === undefined) return;

  writeBuildMetrics(recordMetrics, generationId, intent, acc, builtAt, "success");
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
    const { usage } = classification;

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
