// An answer that names records, over the path a person asks on (7.5/04, ADR-0010): the last
// fragment carries the platform's links, nothing streamed shows an id outside an `href`, and the
// one row the question leaves holds none.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { recordAddress } from "#shell/core/routes.js";
import type { PlatformDatabase } from "../../../../platform/persistence/db.ts";
import {
  catalogueWithRecords,
  NOTES_CAPABILITY,
  NOTES_TABLE,
} from "../../../../runtime/query/question.test-support.ts";
import {
  createScratchDbEnv,
  DATA_QUERY_INTENT,
  makeMetricsRecorder,
  makeScratchApp,
  teardownScratchDbEnv,
} from "../../../app.test-support.ts";
import { escapeHtml } from "../../../http/html.ts";
import { ANSWER_RECORD_ATTRIBUTE, ANSWER_WINDOW_SAYING_ATTRIBUTE } from "../../../http/index.ts";
import { askInTheWindow, saidInTheAnswerWindow } from "./answer-window.test-support.ts";
import { makeQuestionProvider } from "./staged-question.test-support.ts";

let dir: string;
let conns: PlatformDatabase;
let artifactsRoot: string;

const OOLONG = { id: randomUUID(), text: "Iron Goddess" };
const GREEN = { id: randomUUID(), text: "Dragon Well" };
const LISTING = {
  sql: `SELECT id AS id, text AS tea FROM ${NOTES_TABLE} WHERE text IN (?, ?)`,
  label: "listing",
  parameters: [OOLONG.text, GREEN.text],
} as const;
const QUESTION = "which ones did I rate five?";

beforeEach(() => {
  ({ dir, conns, artifactsRoot } = createScratchDbEnv("aluna-answer-records-"));
  catalogueWithRecords(conns.readwrite);
  const insert = conns.readwrite.prepare(
    `INSERT INTO ${NOTES_TABLE} (id, created_at, extra, text) VALUES (?, '2026-09-01 09:00:00', '{}', ?)`,
  );
  for (const { id, text } of [OOLONG, GREEN]) insert.run(id, text);
  insert.finalize();
});

afterEach(() => {
  teardownScratchDbEnv({ dir, conns, artifactsRoot });
});

async function asked(answer: string, records: readonly { says: string; id: string }[]) {
  const recorder = makeMetricsRecorder();
  const { provider } = makeQuestionProvider({
    intent: DATA_QUERY_INTENT,
    reads: [LISTING],
    answer: { answer, records: [...records] },
  });
  const app = makeScratchApp({ dir, conns, artifactsRoot }, provider, recorder.recordMetrics);
  const run = await askInTheWindow(app, QUESTION);
  for (let tries = 0; tries < 400 && recorder.resolutionRows.length === 0; tries += 1) {
    await new Promise((wake) => setTimeout(wake, 5));
  }
  return { ...run, resolutionRows: recorder.resolutionRows };
}

/** The anchor the platform writes round one name. */
function anchor(record: { id: string; text: string }): string {
  const href = escapeHtml(recordAddress(NOTES_CAPABILITY.id, record.id));
  return `<a ${ANSWER_RECORD_ATTRIBUTE} href="${href}">${escapeHtml(record.text)}</a>`;
}

describe("an answer that names records, asked through the prompt bar", () => {
  test("the last fragment links each name it vouched for, and reads the same as before", async () => {
    const answer = `Two of them: ${OOLONG.text} and ${GREEN.text}.`;
    const { fragments } = await asked(answer, [
      { says: OOLONG.text, id: OOLONG.id },
      { says: GREEN.text, id: GREEN.id },
    ]);

    expect(fragments).toContain(`Two of them: ${anchor(OOLONG)} and ${anchor(GREEN)}.`);
    // Every `<` she wrote arrives escaped, so the only tags left are the platform's own anchors,
    // and without them the window's text is what she said, as a reader before 7.5/05 sees it.
    const last = fragments.slice(fragments.lastIndexOf(`<div ${ANSWER_WINDOW_SAYING_ATTRIBUTE}`));
    expect(saidInTheAnswerWindow(last.replace(/<a [^>]*>|<\/a>/g, ""))).toEqual([answer]);
  });

  test("nothing streamed shows an id outside an href, though she wrote both into her answer", async () => {
    const { events } = await asked(`${OOLONG.text} (${OOLONG.id}) and ${GREEN.id.toUpperCase()}.`, [
      { says: OOLONG.text, id: OOLONG.id },
    ]);
    const streamed = events.map((event) => event.data).join("\n");
    const shown = streamed.replace(/ href="[^"]*"/g, "");

    expect(streamed).toContain(anchor(OOLONG));
    for (const { id } of [OOLONG, GREEN]) expect(shown.toLowerCase()).not.toContain(id);
  });

  test("an anchor she wrote reaches the window as text", async () => {
    const hostile = `<a href="javascript:alert(1)">${OOLONG.text}</a>`;
    const { fragments } = await asked(`Try ${hostile}.`, []);

    expect(fragments).toContain(escapeHtml(hostile));
    expect(fragments).not.toContain(`<a href=`);
  });

  test("the row the question leaves holds no record id", async () => {
    const { resolutionRows } = await asked(`${OOLONG.text} and ${GREEN.text}.`, [
      { says: OOLONG.text, id: OOLONG.id },
      { says: GREEN.text, id: GREEN.id },
    ]);
    const row = JSON.stringify(resolutionRows);

    expect(resolutionRows).toHaveLength(1);
    for (const { id } of [OOLONG, GREEN]) expect(row).not.toContain(id);
  });
});
