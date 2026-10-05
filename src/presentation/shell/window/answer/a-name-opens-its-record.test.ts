// The answer window's half of a linked name (ADR-0010, PLAN decisions 47 and 48): the glue reads
// the fragment's runs, the window builds each anchor itself, and a plain press asks the desk for
// the record. What the desk does with that ask is in the address folder's desk test.

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { CAPABILITY_ID_PATTERN, recordAddress } from "#shell/core/routes.js";
import { OPEN_THE_RECORD_EVENT } from "#shell/desk/desk-address.js";
import { PROMPT_BAR_MESSAGE_EVENT } from "#shell/desk/prompt-bar.js";
import {
  ANSWER_RECORD_ATTRIBUTE,
  type AnswerRun,
  answerRuns,
} from "#shell/desk/window/answer-runs.js";
import { ANSWER_BODY_SELECTOR, RECORD_NOT_THERE } from "#shell/desk/window/desk-answer-window.js";
import { SQL_NAME_PATTERN } from "../../../../registry/spec/spec-text.ts";
import { Template } from "../../../../server/dom-double/dom-double.test-support.ts";
import {
  ANSWER_WINDOW_SAYING_ATTRIBUTE,
  type AnswerRecordLink,
  NOT_FOUND_NOTICE,
  renderAnswerWindowSaying,
  ANSWER_RECORD_ATTRIBUTE as SERVER_ANSWER_RECORD_ATTRIBUTE,
} from "../../../../server/http/index.ts";
import { startedOn } from "../../../controls/double/started-module.test-support.ts";
import { type El, type StandingDesk, standingDesk } from "../standing-desk.test-support.ts";

type AnswerWindowModule = typeof import("#shell/desk/window/desk-answer-window.js");

const RECORD = randomUUID();
const SAYING = "Your best is Iron Goddess.\nThe rest are fine.";
const NAME = "Iron Goddess";

/** The saying as the glue hands it on: parsed, inert, out of the fragment the server sent. */
function said(markup: string) {
  const template = new Template();
  template.innerHTML = markup;
  return template.content.querySelector(`[${ANSWER_WINDOW_SAYING_ATTRIBUTE}]`) as Template;
}

/** A link over the first occurrence of `words`. */
function over(saying: string, words: string, record = RECORD): AnswerRecordLink {
  const from = saying.indexOf(words);
  return { from, to: from + words.length, capability: "teas", record };
}

describe("the glue reads runs, not markup", () => {
  test("the mark it reads is the one the server writes, and the ids the spec gate admits", () => {
    expect(ANSWER_RECORD_ATTRIBUTE).toBe(SERVER_ANSWER_RECORD_ATTRIBUTE);
    expect(`^${CAPABILITY_ID_PATTERN}$`).toBe(SQL_NAME_PATTERN.source);
  });

  test("a vouched name is a name, and every other word is words, line breaks and all", () => {
    const runs = answerRuns(said(renderAnswerWindowSaying(SAYING, [over(SAYING, NAME)])));
    expect(runs).toEqual([
      { text: SAYING.slice(0, SAYING.indexOf(NAME)) },
      { name: NAME, capability: "teas", record: RECORD },
      { text: SAYING.slice(SAYING.indexOf(NAME) + NAME.length) },
    ]);
  });

  test("a saying with no links is one run of words", () => {
    expect(answerRuns(said(renderAnswerWindowSaying(SAYING)))).toEqual([{ text: SAYING }]);
  });

  test("an id in upper case names the record the address compares", () => {
    const upper = `<div ${ANSWER_WINDOW_SAYING_ATTRIBUTE}>See <a ${ANSWER_RECORD_ATTRIBUTE} href="/capability/teas/${RECORD.toUpperCase()}">${NAME}</a></div>`;
    expect(answerRuns(said(upper))[1]).toEqual({ name: NAME, capability: "teas", record: RECORD });
  });

  const address = `/capability/teas/${RECORD}`;
  const anchors: Record<string, string> = {
    "a foreign address": `<a ${ANSWER_RECORD_ATTRIBUTE} href="https://elsewhere.example${address}">`,
    "a protocol-relative address": `<a ${ANSWER_RECORD_ATTRIBUTE} href="//elsewhere.example${address}">`,
    "a script": `<a ${ANSWER_RECORD_ATTRIBUTE} href="javascript:alert(1)">`,
    "a record id that is not one": `<a ${ANSWER_RECORD_ATTRIBUTE} href="/capability/teas/not-a-record">`,
    "a capability id the gate refuses": `<a ${ANSWER_RECORD_ATTRIBUTE} href="/capability/Teas/${RECORD}">`,
    "an escaped capability id": `<a ${ANSWER_RECORD_ATTRIBUTE} href="/capability/..%2Fteas/${RECORD}">`,
    "a path past the record": `<a ${ANSWER_RECORD_ATTRIBUTE} href="${address}/edit">`,
    "a query string": `<a ${ANSWER_RECORD_ATTRIBUTE} href="${address}?x=1">`,
    "a fragment": `<a ${ANSWER_RECORD_ATTRIBUTE} href="${address}#top">`,
    "no address": `<a ${ANSWER_RECORD_ATTRIBUTE}>`,
    "no mark": `<a href="${address}">`,
    "a mark with a value": `<a ${ANSWER_RECORD_ATTRIBUTE}="x" href="${address}">`,
    "a handler beside its two": `<a ${ANSWER_RECORD_ATTRIBUTE} href="${address}" onclick="alert(1)">`,
    "a target beside its two": `<a ${ANSWER_RECORD_ATTRIBUTE} href="${address}" target="_blank">`,
    "another element's mark": `<span ${ANSWER_RECORD_ATTRIBUTE} href="${address}">`,
  };
  for (const [what, open] of Object.entries(anchors)) {
    test(`an anchor carrying ${what} is read as its words`, () => {
      const close = open.startsWith("<span") ? "</span>" : "</a>";
      const markup = `<div ${ANSWER_WINDOW_SAYING_ATTRIBUTE}>Your best is ${open}${NAME}${close}.</div>`;
      expect(answerRuns(said(markup))).toEqual([{ text: `Your best is ${NAME}.` }]);
    });
  }

  test("an anchor holding anything but words is read as its words", () => {
    const markup = `<div ${ANSWER_WINDOW_SAYING_ATTRIBUTE}>Your best is <a ${ANSWER_RECORD_ATTRIBUTE} href="${address}"><b>Iron</b> Goddess</a>.</div>`;
    expect(answerRuns(said(markup))).toEqual([{ text: `Your best is ${NAME}.` }]);
  });

  test("a break is a line's end, and a node no parser makes is passed over", () => {
    const markup = `<div ${ANSWER_WINDOW_SAYING_ATTRIBUTE}>one<br>two</div>`;
    expect(answerRuns(said(markup))).toEqual([{ text: "one\ntwo" }]);
    const odd = [null, 7, "words", { nodeType: "1" }, { nodeType: 3, textContent: null }];
    expect(answerRuns({ childNodes: odd as never })).toEqual([]);
  });

  test("an anchor showing nothing links nothing", () => {
    const markup = `<div ${ANSWER_WINDOW_SAYING_ATTRIBUTE}>Gone: <a ${ANSWER_RECORD_ATTRIBUTE} href="${address}"> </a>.</div>`;
    expect(answerRuns(said(markup))).toEqual([{ text: "Gone:  ." }]);
  });
});

let standing: StandingDesk | undefined;
let answer: AnswerWindowModule | undefined;
afterEach(() => {
  answer?.dismissAnswerWindow();
  standing?.restore();
  standing = undefined;
  answer = undefined;
});

/** The answer window started on a standing desk, saying `runs`, with every ask for a record heard. */
async function saying(runs: AnswerRun[] | Record<string, unknown>[]) {
  standing = standingDesk();
  answer = await startedOn<AnswerWindowModule>("desk/window/desk-answer-window.js", standing.doc);
  const opened = answer.openAnswerWindow(standing.doc, "which teas did I rate five?", "");
  answer.sayInAnswerWindow(runs as AnswerRun[]);
  const asked: unknown[] = [];
  standing.doc.addEventListener(OPEN_THE_RECORD_EVENT, (event: { detail?: unknown }) =>
    asked.push(event.detail),
  );
  const body = opened.el.querySelector(ANSWER_BODY_SELECTOR) as unknown as El;
  const links = () => body.descendants().filter((el) => el.tagName === "a");
  return { body, links, asked };
}

describe("the window builds anchors itself", () => {
  test("a name is a link to its record address, inside the sentence it stands in", async () => {
    const window_ = await saying([
      { text: SAYING.slice(0, SAYING.indexOf(NAME)) },
      { name: NAME, capability: "teas", record: RECORD },
      { text: SAYING.slice(SAYING.indexOf(NAME) + NAME.length) },
    ]);
    expect(window_.body.textContent).toBe(SAYING);
    const [link] = window_.links();
    expect(window_.links()).toHaveLength(1);
    expect(link?.textContent).toBe(NAME);
    expect((link as unknown as { href: string }).href).toBe(recordAddress("teas", RECORD));
  });

  test("a run that names no record it can address is drawn as its words", async () => {
    const window_ = await saying([
      { name: NAME, capability: "../teas", record: RECORD },
      { name: " and ", capability: "teas", record: "not-a-record" },
      { name: "Dragon Well", capability: "teas", record: RECORD, href: "javascript:alert(1)" },
      { name: 7, capability: "teas", record: RECORD },
      { text: 7 },
    ]);
    expect(window_.body.textContent).toBe(`${NAME} and Dragon Well`);
    const [link] = window_.links();
    expect(window_.links()).toHaveLength(1);
    expect((link as unknown as { href: string }).href).toBe(recordAddress("teas", RECORD));
  });

  test("whatever runs it is handed, it shows words and links to record addresses alone", async () => {
    // The policy reads the source; this runs it. A seeded walk over hostile runs, so a failure
    // replays exactly.
    let seed = 7;
    const pick = <T>(from: readonly T[]): T => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return from[seed % from.length] as T;
    };
    const words = [NAME, "<img src=x onerror=alert(1)>", "", " ", "\n", "a\u202Eb", 7, null];
    const capabilities = ["teas", "../teas", "Teas", "teas/x", "", 7, undefined, "javascript:"];
    const records = [RECORD, RECORD.toUpperCase(), `${RECORD}/x`, "nope", 7, undefined];
    const extras = [{}, { href: "javascript:alert(1)" }, { src: "x" }, { nodes: ["<b>"] }];
    const runs = Array.from({ length: 400 }, () =>
      pick([true, false])
        ? { text: pick(words) }
        : {
            name: pick(words),
            capability: pick(capabilities),
            record: pick(records),
            ...pick(extras),
          },
    );
    const window_ = await saying(runs);
    for (const node of window_.body.descendants()) {
      if (node.tagName === "#text") continue;
      expect(node.tagName).toBe("a");
      expect([...node.attrs.keys()]).toEqual(["href"]);
      const href = (node as unknown as { href: string }).href;
      expect([
        recordAddress("teas", RECORD),
        recordAddress("teas", RECORD.toUpperCase()),
      ]).toContain(href);
      expect(node.children.every((child) => child.tagName === "#text")).toBe(true);
    }
    expect(window_.links().length).toBeGreaterThan(0);
  });

  test("the next thing she says takes the links with it", async () => {
    const window_ = await saying([{ name: NAME, capability: "teas", record: RECORD }]);
    answer?.sayInAnswerWindow("Let me look again.");
    expect(window_.links()).toEqual([]);
  });
});

describe("a press asks the desk for the record", () => {
  test("a plain press asks for it by its ids, and the browser follows nothing", async () => {
    const window_ = await saying([{ name: NAME, capability: "teas", record: RECORD }]);
    const link = window_.links()[0] as El;
    const allowed = link.dispatchEvent({ type: "click", target: link, button: 0 } as never);
    expect(allowed).toBe(false);
    expect(window_.asked).toEqual([
      expect.objectContaining({ capability: "teas", record: RECORD }),
    ]);
  });

  for (const [what, more] of Object.entries({
    "a Cmd-press": { metaKey: true },
    "a Ctrl-press": { ctrlKey: true },
    "a Shift-press": { shiftKey: true },
    "an Alt-press": { altKey: true },
    "a middle press": { button: 1 },
    "a secondary button": { button: 2 },
  })) {
    test(`${what} asks nothing and is left to the browser`, async () => {
      const window_ = await saying([{ name: NAME, capability: "teas", record: RECORD }]);
      const link = window_.links()[0] as El;
      const press = { type: "click", target: link, button: 0, ...more };
      expect(link.dispatchEvent(press as never)).toBe(true);
      expect(window_.asked).toEqual([]);
    });
  }

  test("a name the desk says is gone stops being a link, and keeps its words", async () => {
    const window_ = await saying([
      { text: "Your best is " },
      { name: NAME, capability: "teas", record: RECORD },
    ]);
    standing?.doc.addEventListener(OPEN_THE_RECORD_EVENT, (event: { detail: object }) => {
      Object.assign(event.detail, { outcome: "gone" });
    });
    const said: unknown[] = [];
    standing?.doc.addEventListener(PROMPT_BAR_MESSAGE_EVENT, (event: { detail?: unknown }) =>
      said.push(event.detail),
    );
    const link = window_.links()[0] as El;
    link.dispatchEvent({ type: "click", target: link, button: 0 } as never);
    expect(window_.links()).toEqual([]);
    expect(window_.body.textContent).toBe(`Your best is ${NAME}`);
    // What the bar says of any record that is not there, the server's own sentence.
    expect(RECORD_NOT_THERE).toBe(NOT_FOUND_NOTICE);
    expect(said).toEqual([{ sentence: RECORD_NOT_THERE, refused: true }]);
  });

  test("a press on the words around a name asks nothing", async () => {
    const window_ = await saying([
      { text: "Your best is " },
      { name: NAME, capability: "teas", record: RECORD },
    ]);
    const pressed = window_.body.dispatchEvent({
      type: "click",
      target: window_.body,
      button: 0,
    } as never);
    expect(pressed).toBe(true);
    expect(window_.asked).toEqual([]);
  });
});
