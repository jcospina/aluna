// Asking a question through the real path, and reading back what was said in the answer window.
//
// Two suites driving the real prompt path read the same two things — the fragments one question
// streamed, and the sentences inside them in the order a person sees them — so the readers live
// here rather than once per file. The opening frame is matched beside the sayings because it carries the first
// thing said (`renderAnswerWindowOpening`), and a reader that skipped it would report a question
// as having said nothing until its first read came back.
//
// Not a test file (no `*.test.ts`), so bun never runs it.

import {
  RESTORATION_CAPABILITY_ID_FIELD,
  RESTORATION_INCARNATION_ID_FIELD,
} from "../../../pipeline/jobs/restoration.ts";
import {
  buildJobIdFromSubscriber,
  collectSseEvents,
  eventData,
  postPrompt,
  readSse,
  responseText,
  type SseEvent,
} from "../../app.test-support.ts";
import type { createApp } from "../../app.ts";
import { unescapeHtml } from "../../http/html.ts";
import { ANSWER_WINDOW_ATTRIBUTE, ANSWER_WINDOW_SAYING_ATTRIBUTE } from "../../http/index.ts";

export interface AskedQuestion {
  readonly jobId: string;
  readonly events: SseEvent[];
  readonly fragments: string;
}

/** What `app.js` puts in the body when a capability's surface is standing in the window. */
export interface StandingCapability {
  readonly capabilityId: string;
  readonly incarnationId: string;
}

/**
 * Post one sentence the way the desk does, and drain the job's stream. `standing` is the window
 * the sentence was asked in front of, which the shell sends as two ordinary body fields.
 */
export async function askInTheWindow(
  app: ReturnType<typeof createApp>,
  sentence: string,
  standing?: StandingCapability,
): Promise<AskedQuestion> {
  // Through `postPrompt` either way, so a window's question is submitted exactly as a bare
  // desk's is: one shape for what the bar sends, and one place it changes.
  const submitted = await postPrompt(
    app,
    sentence,
    standing
      ? {
          [RESTORATION_CAPABILITY_ID_FIELD]: standing.capabilityId,
          [RESTORATION_INCARNATION_ID_FIELD]: standing.incarnationId,
        }
      : {},
  );
  const jobId = buildJobIdFromSubscriber(await responseText(submitted));
  const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));
  return { jobId, events, fragments: eventData(events, "fragment") };
}

/** Everything said in the answer window, in order, as a person reads it rather than encoded. */
export function saidInTheAnswerWindow(fragments: string): readonly string[] {
  const said = fragments.matchAll(
    new RegExp(
      `<div (?:${ANSWER_WINDOW_ATTRIBUTE}="[^"]*"|${ANSWER_WINDOW_SAYING_ATTRIBUTE})>(.*?)</div>`,
      "gs",
    ),
  );
  return [...said].map((match) => unescapeHtml(match[1] ?? ""));
}
