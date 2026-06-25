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
// GET EventSource directly, announcing the commit with a developer preview +
// confirmation rather than the content/toolbar oob swap (Epic 2.6). Everything
// *upstream* of that swap is the real thing.

import { type CommitCapabilityResult, hardcodedNewCapabilityIntent } from "../builder/index.ts";
import type { PlatformDatabase } from "../db.ts";
import type { Provider } from "../provider/index.ts";
import type { Send } from "../sse/index.ts";
import { renderSpecBuiltConfirmation } from "../web/index.ts";
import { runSpecBuildStages } from "./build-run.ts";
import {
  classifyBuildFailure,
  type DemoBuildAccumulator,
  type RecordMetrics,
  writeBuildMetrics,
} from "./metrics-recorder.ts";
import { buildCommitPreview, buildDemoErrorPreview } from "./previews.ts";

/** The default prompt the bare demo button builds when none is typed. */
export const DEMO_SPEC_PROMPT = "I want to keep track of my notes";

/**
 * Run the full build demo for `prompt`: build the capability through commit, record
 * the one metrics row (success, failure, or — on abort — nothing), then announce the
 * committed capability with a developer commit preview and a warm confirmation. A
 * build failure records the failure row and rethrows for {@link handleSpecBuildError};
 * an abort mid-build rolls the transaction back and records nothing.
 */
export async function streamSpecBuildDemo(
  send: Send,
  isAborted: () => boolean,
  provider: Provider,
  prompt: string,
  recordMetrics: RecordMetrics,
  buildDatabases: PlatformDatabase,
  artifactsRoot: string,
) {
  const intent = hardcodedNewCapabilityIntent(prompt);
  const builtAt = performance.now();
  const acc: DemoBuildAccumulator = { usages: [], timings: {} };

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
    // An aborted stream is not a build failure — and the transaction already rolled
    // back, so nothing committed. Don't record a failure row for it.
    if (!isAborted()) {
      writeBuildMetrics(
        recordMetrics,
        `demo-${crypto.randomUUID()}`,
        intent,
        acc,
        builtAt,
        "failure",
        classifyBuildFailure(error, acc),
      );
    }
    throw error;
  }

  // Aborted mid-build (commit undefined): the transaction rolled back, nothing
  // committed, nothing recorded.
  if (commit === undefined) return;

  // The row lands before the build's `done` — PLAN flow step 8 ("written before the
  // job ends"). The build genuinely committed (registry row + artifacts + cap_<id>
  // table), so this records a success.
  writeBuildMetrics(recordMetrics, `demo-${crypto.randomUUID()}`, intent, acc, builtAt, "success");
  // Announce the committed capability: the developer-facing commit preview, then the
  // warm product-voice confirmation. The client-side content/toolbar swap is Epic
  // 2.6's; this issue produces the committed capability and the events announcing it.
  await send("commit-preview", JSON.stringify(buildCommitPreview(commit)));
  await send("fragment", renderSpecBuiltConfirmation(commit.row.label));
  await send("done", "ok");
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
