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

/** Post one sentence the way the desk does, and drain the job's stream. */
export async function askInTheWindow(
  app: ReturnType<typeof createApp>,
  sentence: string,
): Promise<AskedQuestion> {
  const jobId = buildJobIdFromSubscriber(await responseText(await postPrompt(app, sentence)));
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
