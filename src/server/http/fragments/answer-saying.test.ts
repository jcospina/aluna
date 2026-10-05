// What the answer window is sent (7.5/04, ADR-0010): escaped text runs, and the platform's own
// anchor around each name it vouched for. Nothing the model wrote becomes markup.

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { recordAddress } from "#shell/core/routes.js";
import { escapeHtml } from "../html.ts";
import {
  ANSWER_RECORD_ATTRIBUTE,
  ANSWER_WINDOW_SAYING_ATTRIBUTE,
  type AnswerRecordLink,
  renderAnswerWindowSaying,
} from "./fragments.ts";

const RECORD = randomUUID();
const CAPABILITY = "teas";

/** A link over the first occurrence of `words` in `saying`. */
function over(saying: string, words: string, record = RECORD): AnswerRecordLink {
  const from = saying.indexOf(words);
  return { from, to: from + words.length, capability: CAPABILITY, record };
}

/** The markup with every `href` taken out, leaving what a reader is shown. */
const withoutHrefs = (markup: string) => markup.replace(/ href="[^"]*"/g, "");

describe("the answer's fragment", () => {
  test("a name is wrapped in the platform's anchor, and every other word is text", () => {
    const saying = "Your best is Iron Goddess.\nThe rest are fine.";
    const markup = renderAnswerWindowSaying(saying, [over(saying, "Iron Goddess")]);
    const href = escapeHtml(recordAddress(CAPABILITY, RECORD));

    expect(markup).toBe(
      `<div ${ANSWER_WINDOW_SAYING_ATTRIBUTE}>Your best is <a ${ANSWER_RECORD_ATTRIBUTE} href="${href}">Iron Goddess</a>.\nThe rest are fine.</div>`,
    );
  });

  test("with no links it is the sentence alone, as every platform ending is", () => {
    expect(renderAnswerWindowSaying("Nothing matched.")).toBe(
      `<div ${ANSWER_WINDOW_SAYING_ATTRIBUTE}>Nothing matched.</div>`,
    );
  });

  test("an anchor the model wrote reaches the window as text", () => {
    const hostile = `See <a href="javascript:alert(1)">this</a> & <a ${ANSWER_RECORD_ATTRIBUTE} href="/capability/x/${RECORD}">that</a>.`;
    const markup = renderAnswerWindowSaying(hostile);

    expect(markup).toBe(`<div ${ANSWER_WINDOW_SAYING_ATTRIBUTE}>${escapeHtml(hostile)}</div>`);
    expect(markup).not.toContain("<a");
  });

  test("a linked name is escaped inside its anchor too", () => {
    const saying = `Your <b>"best"</b> tea.`;
    const markup = renderAnswerWindowSaying(saying, [over(saying, `<b>"best"</b>`)]);

    expect(markup).toContain(`>${escapeHtml(`<b>"best"</b>`)}</a>`);
    expect(markup).not.toContain("<b>");
  });

  test("the id is in the href and nowhere else", () => {
    const other = randomUUID();
    const saying = "Iron Goddess and Dragon Well.";
    const markup = renderAnswerWindowSaying(saying, [
      over(saying, "Iron Goddess"),
      over(saying, "Dragon Well", other),
    ]);

    expect(markup).toContain(RECORD);
    expect(markup).toContain(other);
    expect(withoutHrefs(markup)).not.toContain(RECORD);
    expect(withoutHrefs(markup)).not.toContain(other);
  });

  test("a link out of order or out of range is left out, so no word is said twice", () => {
    const saying = "abcdef";
    const link = (from: number, to: number) => ({
      from,
      to,
      capability: CAPABILITY,
      record: RECORD,
    });
    const markup = renderAnswerWindowSaying(saying, [
      link(3, 5),
      link(1, 4),
      link(5, 9),
      link(5, 5),
    ]);
    const href = escapeHtml(recordAddress(CAPABILITY, RECORD));

    expect(markup).toBe(
      `<div ${ANSWER_WINDOW_SAYING_ATTRIBUTE}>abc<a ${ANSWER_RECORD_ATTRIBUTE} href="${href}">de</a>f</div>`,
    );
  });

  test("a link off a whole offset is left out, so no word is said twice", () => {
    const saying = "abcdef";
    const link = (from: number, to: number) => ({
      from,
      to,
      capability: CAPABILITY,
      record: RECORD,
    });
    for (const [from, to] of [
      [Number.NaN, 2],
      [1, Number.NaN],
      [0.5, 2],
      [1, Number.POSITIVE_INFINITY],
    ] as const) {
      expect(renderAnswerWindowSaying(saying, [link(from, to)])).toBe(
        renderAnswerWindowSaying(saying),
      );
    }
  });
});
