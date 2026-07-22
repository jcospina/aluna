// The build demo (Module 2 §2.5; the running build surface behind `/demo/spec-build`).
//
// This is where Module 2's whole build pipeline runs against the configured provider,
// end to end: from a hardcoded `new_capability` intent it generates the spec, derives
// + applies the migration, generates the units, runs the fail-closed gate, and commits
// the result to the real registry + disk (or rolls the whole build back on any
// failure). Product-voice narration streams to the shell; developer previews surface
// the internals as a liveness view (ARCH §9.7 keeps internals out of the *product*
// copy, not the dev previews).
//
// It is still demo-shaped vs. the production POST `/prompt` → queue → `/build/:id/stream`
// flow: the intent is hardcoded `new_capability` rather than resolved, and it drives a
// GET EventSource directly. The terminal commit event is shared with the production
// prompt flow so the homepage demo exercises the real content/toolbar swap.

import {
  type CommitCapabilityResult,
  createCapabilityIncarnationId,
  hardcodedNewCapabilityIntent,
  reconcileCapabilityArtifacts,
} from "../builder/index.ts";
import type { PlatformDatabase } from "../db.ts";
import type { MutationCoordinator } from "../mutation-coordinator/index.ts";
import { abortableProvider, type Provider } from "../provider/index.ts";
import type { Send } from "../sse/index.ts";
import { renderCachedCapabilityCommitSwap } from "../web/index.ts";
import { AbortedBuildError, runSpecBuildStages } from "./build-run.ts";
import {
  classifyBuildFailure,
  type DemoBuildAccumulator,
  lifecycleFailureOutcome,
  lifecycleMeasurement,
  lifecycleStages,
  type RecordMetrics,
} from "./metrics-recorder.ts";
import { buildCommitPreview, buildDemoErrorPreview } from "./previews.ts";
import { renderRestorationFragment } from "./restoration.ts";
import {
  DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
  deliverActivatedPresentation,
  deliverActivatedRecoveryPresentation,
  deliverFailedPresentation,
} from "./terminal-presentation.ts";

/** The default prompt the bare demo button builds when none is typed. */
export const DEMO_SPEC_PROMPT = "I want to keep track of my notes";

interface DemoLeaseInput {
  readonly send: Send;
  readonly isAborted: () => boolean;
  readonly getProvider: () => Provider;
  readonly prompt: string;
  readonly recordMetrics: RecordMetrics;
  readonly buildDatabases: PlatformDatabase;
  readonly artifactsRoot: string;
  readonly signal?: AbortSignal;
  readonly terminalPresenterTimeoutMs: number;
}

function neutralRestoration(input: DemoLeaseInput): string {
  return renderRestorationFragment({ kind: "neutral" }, input.buildDatabases.readonly);
}

async function presentDemoFailure(
  input: DemoLeaseInput,
  error: unknown,
  metricsPreview?: string,
): Promise<void> {
  console.error("Aluna spec-build demo failed:", error instanceof Error ? error.message : error);
  await deliverFailedPresentation(
    input.send,
    error,
    neutralRestoration(input),
    input.terminalPresenterTimeoutMs,
    metricsPreview,
  );
}

interface AdmittedDemoInput extends DemoLeaseInput {
  readonly buildId: string;
  readonly incarnationId: string;
  readonly builtAt: number;
  readonly acc: DemoBuildAccumulator;
  readonly intent: ReturnType<typeof hardcodedNewCapabilityIntent>;
}

async function runDemoStages(
  input: AdmittedDemoInput,
): Promise<CommitCapabilityResult | "terminal-sent" | undefined> {
  try {
    const provider = abortableProvider(input.getProvider(), input.signal);
    return await runSpecBuildStages(
      input.send,
      input.isAborted,
      provider,
      input.prompt,
      input.intent,
      input.buildId,
      input.incarnationId,
      input.acc,
      input.buildDatabases,
      input.artifactsRoot,
      (capabilityId) =>
        input.recordMetrics.identify(input.buildId, input.incarnationId, capabilityId),
      () =>
        input.recordMetrics.succeed({
          buildId: input.buildId,
          incarnationId: input.incarnationId,
          outcome: "activated",
          stages: lifecycleStages(input.acc, "activated"),
          measurement: lifecycleMeasurement(input.acc, input.builtAt),
        }),
    );
  } catch (error) {
    const cancelled = error instanceof AbortedBuildError || input.isAborted();
    input.recordMetrics.fail({
      buildId: input.buildId,
      incarnationId: input.incarnationId,
      outcome: cancelled
        ? "cancelled"
        : lifecycleFailureOutcome(classifyBuildFailure(error, input.acc)),
      stages: lifecycleStages(input.acc, cancelled ? "cancelled" : "failed"),
      measurement: lifecycleMeasurement(
        input.acc,
        input.builtAt,
        cancelled ? undefined : classifyBuildFailure(error, input.acc),
      ),
    });
    if (cancelled) return "terminal-sent";
    await presentDemoFailure(
      input,
      error,
      JSON.stringify(input.recordMetrics.get(input.buildId, input.incarnationId)),
    );
    return "terminal-sent";
  }
}

async function runDemoUnderLease(input: DemoLeaseInput): Promise<void> {
  try {
    reconcileCapabilityArtifacts({
      database: input.buildDatabases.readwrite,
      artifactsRoot: input.artifactsRoot,
    });
    const buildId = `demo-${crypto.randomUUID()}`;
    const incarnationId = createCapabilityIncarnationId();
    const builtAt = performance.now();
    const acc: DemoBuildAccumulator = { usages: [], timings: {} };
    input.recordMetrics.start({ buildId, incarnationId, resolver: null, stages: [] });
    try {
      await input.send(
        "metrics-preview",
        JSON.stringify(input.recordMetrics.get(buildId, incarnationId)),
      );
    } catch {
      input.recordMetrics.fail({
        buildId,
        incarnationId,
        outcome: "cancelled",
        stages: lifecycleStages(acc, "cancelled"),
        measurement: lifecycleMeasurement(acc, builtAt),
      });
      return;
    }

    const commit = await runDemoStages({
      ...input,
      buildId,
      incarnationId,
      builtAt,
      acc,
      intent: hardcodedNewCapabilityIntent(input.prompt),
    });
    if (commit === "terminal-sent") return;
    if (commit === undefined) {
      input.recordMetrics.fail({
        buildId,
        incarnationId,
        outcome: "cancelled",
        stages: lifecycleStages(acc, "cancelled"),
        measurement: lifecycleMeasurement(acc, builtAt),
      });
      return;
    }

    try {
      await deliverActivatedPresentation(
        input.send,
        JSON.stringify(buildCommitPreview(commit)),
        renderCachedCapabilityCommitSwap(commit.row, commit.previousLabel),
        input.terminalPresenterTimeoutMs,
        JSON.stringify(input.recordMetrics.get(buildId, incarnationId)),
      );
    } catch {
      await deliverActivatedRecoveryPresentation(input.send, input.terminalPresenterTimeoutMs);
    }
  } catch (error) {
    await presentDemoFailure(input, error);
  }
}

/**
 * Run the full build demo for `prompt`: build the capability through commit, record
 * one admitted lifecycle row, then announce the
 * committed capability with a developer commit preview and the product commit swap.
 * The resolved demo intent reserves the shared coordinator before provider work. A
 * failure records its row and presents the bounded warm terminal branch while the
 * lease is still owned; an abort rolls product work back and finalizes as cancelled.
 */
export async function streamSpecBuildDemo(
  send: Send,
  isAborted: () => boolean,
  getProvider: () => Provider,
  prompt: string,
  recordMetrics: RecordMetrics,
  buildDatabases: PlatformDatabase,
  artifactsRoot: string,
  mutationCoordinator: MutationCoordinator,
  signal?: AbortSignal,
  terminalPresenterTimeoutMs = DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
) {
  const reservation = mutationCoordinator.reserveBuild();
  const input: DemoLeaseInput = {
    send,
    isAborted,
    getProvider,
    prompt,
    recordMetrics,
    buildDatabases,
    artifactsRoot,
    signal,
    terminalPresenterTimeoutMs,
  };

  try {
    await mutationCoordinator.withBuildLease(
      reservation,
      () => runDemoUnderLease(input),
      signal ? { signal } : {},
    );
  } catch (error) {
    if (!isAborted()) await presentDemoFailure(input, error);
  }
}

/**
 * Surface a demo build failure: precise in the server log, warm and jargon-free in
 * the UI (the build-failure voice). A non-conforming model output (the spec-gen gate
 * throwing) or a missing key both reach here.
 */
export async function handleSpecBuildError(
  send: Send,
  isAborted: () => boolean,
  err: unknown,
  restorationFragment?: string,
) {
  console.error("Aluna spec-build demo failed:", err instanceof Error ? err.message : err);
  if (isAborted()) return;
  await send("build-error-preview", JSON.stringify(buildDemoErrorPreview(err)));
  await send("narration", "Hmm, that didn't work. Mind trying again?");
  if (restorationFragment !== undefined) await send("fragment", restorationFragment);
  await send("done", "error");
}
