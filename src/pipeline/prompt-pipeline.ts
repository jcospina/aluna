// The production `/prompt` build pipeline — what a queued build job runs (Epic 2.5).
//
// Given a job's prompt it classifies intent (with a duplicate-detection short
// circuit), then either deflects an unsupported intent with a warm line, or runs the
// full spec → migration → units → gate → commit build for a `new_capability`. The
// `/build/:id/stream` route drives this; the POST `/prompt` path only admits the job.

import type { BuildPipeline } from "../build-jobs.ts";
import type { CommitCapabilityResult } from "../builder/index.ts";
import type { PlatformDatabase } from "../db.ts";
import { classifyIntentWithUsage, type IntentClassification } from "../intent-resolver/index.ts";
import type { Provider, TokenUsage } from "../provider/index.ts";
import { listCapabilities } from "../registry/index.ts";
import type { Send } from "../sse/index.ts";
import { renderSpecBuiltConfirmation } from "../web/index.ts";
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

/** What {@link createPromptBuildPipeline} needs to run a build against the real db/disk. */
export interface PromptBuildPipelineDeps {
  readonly getProvider: () => Provider;
  readonly recordMetrics: RecordMetrics;
  readonly buildDatabases: PlatformDatabase;
  readonly artifactsRoot: string;
}

interface DeflectionPipelineInput {
  readonly generationId: string;
  readonly intent: IntentClassification;
  readonly usage: TokenUsage;
  readonly recordMetrics: RecordMetrics;
  readonly send: Send;
  readonly isAborted: () => boolean;
}

/** Record the deflection metrics row and narrate the warm "not yet" line. */
async function streamDeflection({
  generationId,
  intent,
  usage,
  recordMetrics,
  send,
  isAborted,
}: DeflectionPipelineInput): Promise<void> {
  writeDeflectionMetrics(recordMetrics, generationId, intent, usage);
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
}

/**
 * Run the full build for a `new_capability` intent, then announce the committed
 * capability (developer commit preview + warm confirmation). On failure it records
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
}: NewCapabilityPipelineInput): Promise<void> {
  const acc: DemoBuildAccumulator = { usages: [usage], timings: {} };
  let commit: CommitCapabilityResult | undefined;
  try {
    commit = await runSpecBuildStages(
      send,
      isAborted,
      provider,
      prompt,
      intent,
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
    }
    throw error;
  }

  if (commit === undefined) return;

  writeBuildMetrics(recordMetrics, generationId, intent, acc, builtAt, "success");
  await send("commit-preview", JSON.stringify(buildCommitPreview(commit)));
  await send("fragment", renderSpecBuiltConfirmation(commit.row.label));
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
}: PromptBuildPipelineDeps): BuildPipeline {
  return async ({ job, send, isAborted }) => {
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
      });
      return;
    }

    const provider = getProvider();
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
      });
      return;
    }

    await streamNewCapabilityBuild({
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
    });
  };
}
