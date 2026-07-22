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
import {
  DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
  runBoundedTerminalPresentation,
} from "./terminal-presentation.ts";

/** The default prompt the bare demo button builds when none is typed. */
export const DEMO_SPEC_PROMPT = "I want to keep track of my notes";

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
  const intent = hardcodedNewCapabilityIntent(prompt);
  const reservation = mutationCoordinator.reserveBuild();

  try {
    await mutationCoordinator.withBuildLease(
      reservation,
      async () => {
        const buildId = `demo-${crypto.randomUUID()}`;
        const incarnationId = createCapabilityIncarnationId();
        const builtAt = performance.now();
        const acc: DemoBuildAccumulator = { usages: [], timings: {} };
        // Admission is durable before provider construction/calls. This call is
        // intentionally not guarded: a failed insert aborts the build at the lease head.
        recordMetrics.start({ buildId, incarnationId, resolver: null, stages: [] });
        try {
          await send("metrics-preview", JSON.stringify(recordMetrics.get(buildId, incarnationId)));
        } catch {
          recordMetrics.fail({
            buildId,
            incarnationId,
            outcome: "cancelled",
            stages: lifecycleStages(acc, "cancelled"),
            measurement: lifecycleMeasurement(acc, builtAt),
          });
          return;
        }

        let commit: CommitCapabilityResult | undefined;
        try {
          const provider: Provider = abortableProvider(getProvider(), signal);
          commit = await runSpecBuildStages(
            send,
            isAborted,
            provider,
            prompt,
            intent,
            buildId,
            incarnationId,
            acc,
            buildDatabases,
            artifactsRoot,
            (capabilityId) => recordMetrics.identify(buildId, incarnationId, capabilityId),
            () =>
              recordMetrics.succeed({
                buildId,
                incarnationId,
                outcome: "activated",
                stages: lifecycleStages(acc, "activated"),
                measurement: lifecycleMeasurement(acc, builtAt),
              }),
          );
        } catch (error) {
          if (error instanceof AbortedBuildError || isAborted()) {
            recordMetrics.fail({
              buildId,
              incarnationId,
              outcome: "cancelled",
              stages: lifecycleStages(acc, "cancelled"),
              measurement: lifecycleMeasurement(acc, builtAt),
            });
            return;
          }
          const failure = classifyBuildFailure(error, acc);
          recordMetrics.fail({
            buildId,
            incarnationId,
            outcome: lifecycleFailureOutcome(failure),
            stages: lifecycleStages(acc, "failed"),
            measurement: lifecycleMeasurement(acc, builtAt, failure),
          });
          await send("metrics-preview", JSON.stringify(recordMetrics.get(buildId, incarnationId)));
          await runBoundedTerminalPresentation(
            () => handleSpecBuildError(send, isAborted, error),
            terminalPresenterTimeoutMs,
          );
          return;
        }

        // A client abort is still an admitted measured build. Product work has
        // rolled back; close it durably rather than leaving a false crash marker.
        if (commit === undefined) {
          recordMetrics.fail({
            buildId,
            incarnationId,
            outcome: "cancelled",
            stages: lifecycleStages(acc, "cancelled"),
            measurement: lifecycleMeasurement(acc, builtAt),
          });
          return;
        }

        await send("metrics-preview", JSON.stringify(recordMetrics.get(buildId, incarnationId)));
        await runBoundedTerminalPresentation(async () => {
          await send("commit-preview", JSON.stringify(buildCommitPreview(commit)));
          await send("commit", renderCachedCapabilityCommitSwap(commit.row));
          await send("done", "ok");
        }, terminalPresenterTimeoutMs);
      },
      signal ? { signal } : {},
    );
  } catch (error) {
    if (!isAborted()) await handleSpecBuildError(send, isAborted, error);
  }
}

/**
 * Surface a demo build failure: precise in the server log, warm and jargon-free in
 * the UI (the build-failure voice). A non-conforming model output (the spec-gen gate
 * throwing) or a missing key both reach here.
 */
export async function handleSpecBuildError(send: Send, isAborted: () => boolean, err: unknown) {
  console.error("Aluna spec-build demo failed:", err instanceof Error ? err.message : err);
  if (isAborted()) return;
  await send("build-error-preview", JSON.stringify(buildDemoErrorPreview(err)));
  await send("narration", "Hmm, that didn't work. Mind trying again?");
  await send("done", "error");
}
