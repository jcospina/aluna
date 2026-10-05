// The answer window at the end of the seam the shell reaches it across, run from both ends: the
// real `public/app.js` on the shell double turning stream frames into the desk's events, and a
// fresh instance of the real module on a standing desk answering them. The two documents are one
// in the browser, so every event the glue sends is handed on as it was sent, and a refusal the
// window takes is reported back the way the browser reports it: as `preventDefault`.
//
// Beside it, what dismissing the window gives back to the rest of the desk (6.5/01).

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { recordAddress } from "#shell/core/routes.js";
import {
  ANSWER_BODY_SELECTOR,
  ANSWER_WINDOW_SELECTOR,
  OPEN_THE_ANSWER_WINDOW_EVENT,
  REFUSE_IN_THE_ANSWER_WINDOW_EVENT,
  SAY_IN_THE_ANSWER_WINDOW_EVENT,
} from "#shell/desk/window/desk-answer-window.js";
import { standingCount } from "#shell/desk/window/desk-stack.js";
import { openWindow, putAway } from "#shell/desk/window/desk-window.js";
import { REJECT_DEFLECTION } from "../../../../pipeline/build/admission/deflection.ts";
import { questionLabelNarration } from "../../../../runtime/query/index.ts";
import {
  ANSWER_RECORD_ATTRIBUTE,
  ANSWER_WINDOW_OPENING,
  ANSWER_WINDOW_SAYING_ATTRIBUTE,
  renderAnswerWindowOpening,
  renderAnswerWindowSaying,
  renderRefusedPrompt,
} from "../../../../server/http/index.ts";
import {
  eventAt,
  openStream,
  desk as shellDesk,
} from "../../../../server/shell-glue/app.shell-double.test-support.ts";
import { startedOn } from "../../../controls/double/started-module.test-support.ts";
import {
  dragBy,
  type El,
  pressLamp,
  type StandingDesk,
  standingDesk,
} from "../standing-desk.test-support.ts";

type AnswerWindowModule = typeof import("#shell/desk/window/desk-answer-window.js");

const QUESTION = "how many notes did I add last week?";
const TYPED = "delete everything.";
const NAME = "Iron Goddess";
const SEAM = [
  OPEN_THE_ANSWER_WINDOW_EVENT,
  SAY_IN_THE_ANSWER_WINDOW_EVENT,
  REFUSE_IN_THE_ANSWER_WINDOW_EVENT,
];

let standing: StandingDesk | undefined;
let answer: AnswerWindowModule | undefined;
afterEach(() => {
  answer?.dismissAnswerWindow();
  putAway();
  standing?.restore();
  standing = undefined;
  answer = undefined;
});

/** A desk with the answer window's module started on it the way the page starts it. */
async function answerDesk() {
  standing = standingDesk();
  answer = await startedOn<AnswerWindowModule>("desk/window/desk-answer-window.js", standing.doc);
  const desk = standing;
  const windows = () => desk.windows().filter((el) => el.matches(ANSWER_WINDOW_SELECTOR));
  return {
    desk,
    module: answer,
    windows,
    body: () => windows()[0]?.querySelector(ANSWER_BODY_SELECTOR)?.textContent,
    links: () =>
      (windows()[0]?.querySelector(ANSWER_BODY_SELECTOR) as El | null)
        ?.descendants()
        .filter((el) => el.tagName === "a") ?? [],
    title: () => windows()[0]?.querySelector("h2")?.textContent,
    /** One of the desk's own events, and whether a listener took it. */
    send: (type: string, detail?: unknown) =>
      !desk.doc.dispatchEvent(new CustomEvent(type, { detail, cancelable: true }) as never),
  };
}

/** The shell on its double, a run's stream open, and the answer window listening beside it. */
async function seam() {
  const scene = shellDesk();
  scene.startShell();
  openStream(scene);
  scene.promptField.value = TYPED;
  const desk = await answerDesk();
  for (const type of SEAM) {
    scene.root.addEventListener(type, (event: Event) => {
      const { detail, cancelable } = event as CustomEvent;
      const handed = new CustomEvent(type, { detail, cancelable });
      if (!desk.desk.doc.dispatchEvent(handed as never)) event.preventDefault();
    });
  }
  /** A frame on the run's stream, as the server writes it. */
  const frame = (data: string) =>
    scene.fire("htmx:sseBeforeMessage", eventAt("htmx:sseBeforeMessage", scene.surface, { data }));
  return { scene, ...desk, frame };
}

/** The task the window's first words are written in, run. */
const aTaskLater = () => new Promise((wake) => setTimeout(wake, 1));

describe("what the stream says reaches the window", () => {
  test("an opening opens it under the question, holding her first words", async () => {
    const desk = await seam();
    desk.frame(renderAnswerWindowOpening(QUESTION));
    await aTaskLater();
    expect(desk.windows()).toHaveLength(1);
    expect(desk.title()).toBe(QUESTION);
    expect(desk.body()).toBe(ANSWER_WINDOW_OPENING);
  });

  test("a later sentence replaces what the window says", async () => {
    const desk = await seam();
    desk.frame(renderAnswerWindowOpening(QUESTION));
    await aTaskLater();
    const counting = questionLabelNarration("counting");
    desk.frame(renderAnswerWindowSaying(counting));
    expect(desk.body()).toBe(counting);
  });

  test("an answer's names arrive as links to their records, and nothing else does", async () => {
    const desk = await seam();
    desk.frame(renderAnswerWindowOpening(QUESTION));
    await aTaskLater();
    const record = randomUUID();
    const saying = `Your best is ${NAME}.\nAnd <a href="javascript:alert(1)">this</a>.`;
    const from = saying.indexOf(NAME);
    const link = { from, to: from + NAME.length, capability: "teas", record };
    desk.frame(renderAnswerWindowSaying(saying, [link]));
    expect(desk.body()).toBe(saying);
    const anchors = desk.links();
    expect(anchors.map((anchor) => anchor.textContent)).toEqual([NAME]);
    expect((anchors[0] as unknown as { href: string }).href).toBe(recordAddress("teas", record));
  });

  test("an anchor the platform did not write arrives as its words", async () => {
    const desk = await seam();
    desk.frame(renderAnswerWindowOpening(QUESTION));
    await aTaskLater();
    const forged = `<div ${ANSWER_WINDOW_SAYING_ATTRIBUTE}>See <a ${ANSWER_RECORD_ATTRIBUTE} href="javascript:alert(1)">${NAME}</a>.</div>`;
    desk.frame(forged);
    expect(desk.body()).toBe(`See ${NAME}.`);
    expect(desk.links()).toEqual([]);
  });

  test("a refusal is taken by the window standing, and the bar says nothing", async () => {
    const desk = await seam();
    desk.frame(renderAnswerWindowOpening(QUESTION));
    await aTaskLater();
    desk.frame(renderRefusedPrompt(TYPED, REJECT_DEFLECTION));
    expect(desk.body()).toBe(REJECT_DEFLECTION);
    expect(desk.title()).toBe(TYPED);
    expect(desk.scene.notice.textContent).toBe("");
  });

  test("a refusal on a desk standing no answer is left to the bar, and opens nothing", async () => {
    const desk = await seam();
    desk.frame(renderRefusedPrompt(TYPED, REJECT_DEFLECTION));
    expect(desk.windows()).toEqual([]);
    expect(desk.scene.notice.textContent).toBe(REJECT_DEFLECTION);
  });
});

describe("the three events carry only what they say", () => {
  test("an opening that names no question opens nothing, and one saying nothing says nothing", async () => {
    const desk = await answerDesk();
    for (const detail of [undefined, null, {}, { question: 7 }, { saying: "hello" }]) {
      desk.send(OPEN_THE_ANSWER_WINDOW_EVENT, detail);
    }
    expect(desk.windows()).toEqual([]);
    desk.send(OPEN_THE_ANSWER_WINDOW_EVENT, { question: QUESTION });
    await aTaskLater();
    expect(desk.body()).toBe("");
  });

  test("a saying that is not a parsed fragment leaves the window's words alone", async () => {
    const desk = await answerDesk();
    desk.module.openAnswerWindow(desk.desk.doc, QUESTION, ANSWER_WINDOW_OPENING);
    await aTaskLater();
    const throwing = {
      get childNodes() {
        throw new Error("not a node");
      },
    };
    const details = [undefined, null, {}, { said: 7 }, { said: { childNodes: 7 } }];
    for (const detail of [...details, { said: "text" }, { saying: "text" }, { said: throwing }]) {
      desk.send(SAY_IN_THE_ANSWER_WINDOW_EVENT, detail);
    }
    expect(desk.body()).toBe(ANSWER_WINDOW_OPENING);
  });

  test("a refusal naming no sentence is not taken, and one saying nothing is taken blank", async () => {
    const desk = await answerDesk();
    desk.module.openAnswerWindow(desk.desk.doc, QUESTION, ANSWER_WINDOW_OPENING);
    await aTaskLater();
    for (const detail of [undefined, null, {}, { refused: 7, saying: REJECT_DEFLECTION }]) {
      expect(desk.send(REFUSE_IN_THE_ANSWER_WINDOW_EVENT, detail)).toBe(false);
    }
    expect(desk.title()).toBe(QUESTION);
    expect(desk.body()).toBe(ANSWER_WINDOW_OPENING);

    expect(desk.send(REFUSE_IN_THE_ANSWER_WINDOW_EVENT, { refused: TYPED })).toBe(true);
    expect(desk.body()).toBe("");
  });
});

describe("its gestures are the shared ones, with nothing to remember at the end", () => {
  test("its bar drags it and its grip resizes it, and neither ending writes anything", async () => {
    const desk = await answerDesk();
    const opened = desk.module.openAnswerWindow(desk.desk.doc, QUESTION, ANSWER_WINDOW_OPENING);
    const frame = opened.el as unknown as El;
    const grip = frame.children.find(
      (child) => child.getAttribute("aria-hidden") === "true" && child.tagName === "div",
    ) as El;
    const start = { ...opened.box };
    dragBy(opened.win.bar as unknown as El, 30, 20);
    dragBy(grip, 40, 30);
    expect(opened.box).toMatchObject({
      x: start.x + 30,
      y: start.y + 20,
      w: start.w + 40,
      h: start.h + 30,
    });
    expect(desk.desk.store.writes).toEqual([]);
  });
});

describe("dismissing it gives the desk back", () => {
  test("the capability window behind is in front again, and the stack is what it was", async () => {
    const desk = await answerDesk();
    const region = openWindow("Notes", desk.desk.doc as never);
    const capability = region.closest(".window--desk") as unknown as El;
    const before = standingCount();
    const opened = desk.module.openAnswerWindow(desk.desk.doc, QUESTION, ANSWER_WINDOW_OPENING);
    expect(capability.classList.contains("is-focused")).toBe(false);
    expect(standingCount()).toBe(before + 1);

    pressLamp(opened.el as unknown as El, "putaway");
    expect(capability.classList.contains("is-focused")).toBe(true);
    expect(standingCount()).toBe(before);
  });

  test("and its frame stops watching its own size", async () => {
    const desk = await answerDesk();
    const opened = desk.module.openAnswerWindow(desk.desk.doc, QUESTION, ANSWER_WINDOW_OPENING);
    const frame = opened.el as unknown as El;
    expect(desk.desk.observed()).toContain(frame);
    pressLamp(frame, "putaway");
    expect(desk.desk.observed()).not.toContain(frame);
  });
});
