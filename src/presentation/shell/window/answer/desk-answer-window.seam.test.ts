// The answer window at the end of the seam the shell reaches it across, run from both ends: the
// real `public/app.js` on the shell double turning stream frames into the desk's events, and a
// fresh instance of the real module on a standing desk answering them. The two documents are one
// in the browser, so every event the glue sends is handed on as it was sent, and a refusal the
// window takes is reported back the way the browser reports it: as `preventDefault`.
//
// Beside it, what dismissing the window gives back to the rest of the desk.

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { recordAddress } from "#shell/core/routes.js";
import {
  BAND_CLASS,
  DROPPED_CLASS,
  LOOKING_WORD,
  RULE_CLASS,
  SPENT_CLASS,
  SQUARE_CLASS,
} from "#shell/desk/window/answer-band.js";
import {
  ANSWER_BODY_SELECTOR,
  ANSWER_ENDING_CLASS,
  ANSWER_LEAVING_SELECTOR,
  ANSWER_UTTERANCE_SELECTOR,
  ANSWER_WINDOW_SELECTOR,
  LANDED_CLASS,
  LIST_SAYING_CLASS,
  LONG_SAYING_CLASS,
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
  renderAnswerWindowEnding,
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
    desk.frame(renderAnswerWindowEnding(saying, [link]));
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

/** The band, its rule and the line in the window standing, as far as a person can see them. */
function lookingIn(desk: Awaited<ReturnType<typeof answerDesk>>) {
  const frame = () => desk.windows()[0] as El;
  const band = () => frame().querySelector(`.${BAND_CLASS}`) as El;
  const rule = () => frame().querySelector(`.${RULE_CLASS}`) as El;
  const line = () => frame().querySelector(ANSWER_BODY_SELECTOR)?.parent as El;
  const spoken = () => (frame().querySelector(ANSWER_BODY_SELECTOR) as El).children[0] as El;
  return {
    band,
    rule,
    line,
    spoken,
    utterance: () =>
      frame().querySelector(ANSWER_UTTERANCE_SELECTOR) as El & { scrollTop?: number },
    /** The sentence standing finishes arriving, as the browser reports the end of its animation. */
    arrived: () => spoken().dispatchEvent({ type: "animationend", bubbles: true }),
    dropped: () => rule().classList.contains(DROPPED_CLASS),
    /** Whether the sentence standing is the one she ends on, landing in place. */
    ending: () => spoken().classList.contains(ANSWER_ENDING_CLASS),
    leaving: () => frame().querySelector(ANSWER_LEAVING_SELECTOR) as El,
    squares: () =>
      band()
        .querySelectorAll(`.${SQUARE_CLASS}`)
        .map((square) => square.getAttribute("data-state")),
    spent: () => [band(), rule()].map((part) => part.classList.contains(SPENT_CLASS)),
    fill: () => rule().props.get("--narration-fill"),
    pace: () => Number.parseFloat(rule().props.get("--narration-eta") ?? ""),
    bands: () => frame().querySelectorAll(`.${BAND_CLASS}`).length,
    /** Whether the window holds the band, the line and the rule, in that order and nothing else. */
    inPlace: () => {
      const parts = (frame().querySelector(ANSWER_UTTERANCE_SELECTOR) as El).children;
      const expected = [band(), line(), rule()];
      return parts.length === expected.length && parts.every((part, at) => part === expected[at]);
    },
  };
}

/** Wait, a little at a time, for what the window lets go of on its own clock. */
async function until(done: () => boolean) {
  for (let waited = 0; !done() && waited < 2000; waited += 20) {
    await new Promise((wake) => setTimeout(wake, 20));
  }
  return done();
}

describe("the band she looks under", () => {
  test("each step adds a square in sun over the ones before, and none of it is her words", async () => {
    const desk = await seam();
    desk.frame(renderAnswerWindowOpening(QUESTION));
    await aTaskLater();
    const looking = lookingIn(desk);
    expect([looking.band().textContent, looking.squares()]).toEqual([LOOKING_WORD, []]);
    expect(LOOKING_WORD.trim()).not.toBe("");

    // The rule creeps from the moment she starts, further with each step, and never to the end.
    const fill = () => Number.parseFloat(looking.fill() ?? "0");
    expect(await until(() => fill() > 0)).toBe(true);
    const fills = [fill()];
    desk.frame(renderAnswerWindowSaying(questionLabelNarration("naming")));
    fills.push(fill());
    desk.frame(renderAnswerWindowSaying(questionLabelNarration("counting")));
    fills.push(fill());
    expect(fills.every((each, at) => at === 0 || each > (fills[at - 1] ?? 0))).toBe(true);
    expect(fills.every((each) => each < 100)).toBe(true);

    expect(looking.squares()).toEqual(["done", "now"]);
    expect(looking.spent()).toEqual([false, false]);
    // Shown and never read out: the live words are her sentence alone.
    expect(desk.body()).toBe(questionLabelNarration("counting"));
    for (const part of [looking.band(), looking.rule()]) {
      expect(part.getAttribute("aria-hidden")).toBe("true");
    }
  });

  test("the sentence she ends on puts the band away where it stands, its rule run out", async () => {
    const desk = await seam();
    desk.frame(renderAnswerWindowOpening(QUESTION));
    await aTaskLater();
    desk.frame(renderAnswerWindowSaying(questionLabelNarration("counting")));
    const looking = lookingIn(desk);
    expect(looking.ending()).toBe(false);
    looking.arrived();

    const creeping = looking.pace();
    const answer = "You added 4 notes last week.";
    desk.frame(renderAnswerWindowEnding(answer));
    // Run out at once rather than crept toward: she is done, and the rule says so.
    expect(looking.pace()).toBeLessThan(creeping);
    expect(desk.body()).toBe(answer);
    expect(looking.squares()).toEqual(["done"]);
    expect(looking.spent()).toEqual([true, true]);
    expect(looking.fill()).toBe("100%");
    // Still run out once a fresh rule's first creep would have come: she finished before it did.
    await new Promise((wake) => setTimeout(wake, 250));
    expect(looking.fill()).toBe("100%");
    // It lands where her last sentence stood rather than rising into it, and that sentence fades
    // out in place for it rather than lifting away.
    expect(looking.ending()).toBe(true);
    expect(looking.leaving().children[0]?.classList.contains(ANSWER_ENDING_CLASS)).toBe(true);
    // Kept rather than taken away: the room they hold is what keeps the answer where it lands.
    expect(looking.inPlace()).toBe(true);
    expect(looking.dropped()).toBe(false);
  });

  test("an ending she stopped short of lets the rule go rather than running it out", async () => {
    const desk = await seam();
    desk.frame(renderAnswerWindowOpening(QUESTION));
    await aTaskLater();
    desk.frame(renderAnswerWindowSaying(questionLabelNarration("counting")));
    desk.frame(renderAnswerWindowEnding("I stopped.", [], { finished: false }));
    const looking = lookingIn(desk);
    expect(looking.spent()).toEqual([true, true]);
    expect(looking.fill()).not.toBe("100%");
    expect(desk.body()).toBe("I stopped.");
  });

  test("a sentence she would not take puts the band away without running the rule out", async () => {
    const desk = await seam();
    desk.frame(renderAnswerWindowOpening(QUESTION));
    await aTaskLater();
    desk.frame(renderAnswerWindowSaying(questionLabelNarration("counting")));
    const looking = lookingIn(desk);
    looking.utterance().scrollTop = 300;
    desk.frame(renderRefusedPrompt(TYPED, REJECT_DEFLECTION));
    expect(looking.utterance().scrollTop).toBe(0);
    expect(looking.spent()).toEqual([true, true]);
    expect(looking.fill()).not.toBe("100%");
    // Said where her last sentence stood, the way an ending is.
    expect(looking.ending()).toBe(true);
  });

  test("the next question looks under a fresh band, carrying nothing of the last", async () => {
    const desk = await seam();
    desk.frame(renderAnswerWindowOpening(QUESTION));
    await aTaskLater();
    desk.frame(renderAnswerWindowSaying(questionLabelNarration("counting")));
    desk.frame(renderAnswerWindowEnding("You added 4 notes last week."));
    // Read from the top again, wherever the last answer was scrolled to.
    lookingIn(desk).utterance().scrollTop = 300;

    desk.frame(renderAnswerWindowOpening("how many teas do I have?"));
    const looking = lookingIn(desk);
    expect(looking.utterance().scrollTop).toBe(0);
    expect([looking.squares(), looking.spent(), looking.bands()]).toEqual([[], [false, false], 1]);
    expect(looking.fill()).not.toBe("100%");
    expect(looking.ending()).toBe(false);
    expect(looking.inPlace()).toBe(true);

    // A step before the fresh rule's first creep is the creep: the rule moves once, not twice.
    desk.frame(renderAnswerWindowSaying(questionLabelNarration("counting")));
    const stepped = looking.fill();
    await new Promise((wake) => setTimeout(wake, 250));
    expect(looking.fill()).toBe(stepped);
  });

  test("an answer before the rule's first creep keeps it run out", async () => {
    const desk = await seam();
    desk.frame(renderAnswerWindowOpening(QUESTION));
    await aTaskLater();
    desk.frame(renderAnswerWindowEnding("You added 4 notes last week."));
    await new Promise((wake) => setTimeout(wake, 250));
    expect(lookingIn(desk).fill()).toBe("100%");
  });
});

describe("the line she says it on", () => {
  test("a sentence already leaving keeps the way it set out", async () => {
    // An ending right behind a step must not turn the step before it, already lifting away, into
    // one fading in place: changing how it leaves would play its leaving again from the start.
    const desk = await seam();
    desk.frame(renderAnswerWindowOpening(QUESTION));
    await aTaskLater();
    const looking = lookingIn(desk);
    looking.arrived();
    desk.frame(renderAnswerWindowSaying(questionLabelNarration("counting")));
    desk.frame(renderAnswerWindowEnding("I stopped.", [], { finished: false }));
    const [leaving] = looking.leaving().children;
    expect(leaving?.textContent).toBe(ANSWER_WINDOW_OPENING);
    expect(leaving?.classList.contains(ANSWER_ENDING_CLASS)).toBe(false);
  });

  test("the sentence she moves on from leaves hidden, outside her words, and is let go", async () => {
    const desk = await seam();
    desk.frame(renderAnswerWindowOpening(QUESTION));
    await aTaskLater();
    const looking = lookingIn(desk);
    looking.arrived();
    expect(looking.spoken().classList.contains(LANDED_CLASS)).toBe(true);
    desk.frame(renderAnswerWindowSaying(questionLabelNarration("counting")));
    // Inert: nothing in it is read out, reached by the keyboard or pressed while it fades.
    expect((looking.leaving() as unknown as { inert?: boolean }).inert).toBe(true);
    expect(looking.leaving().textContent).toBe(ANSWER_WINDOW_OPENING);
    // What she says now is what is read out, politely, and the sentence leaving is not.
    const words = looking.line().querySelector(ANSWER_BODY_SELECTOR) as El;
    expect(words.getAttribute("aria-live")).toBe("polite");
    expect(await until(() => looking.leaving().textContent === "")).toBe(true);
    expect(desk.body()).toBe(questionLabelNarration("counting"));

    // One that had not finished arriving simply goes, rather than flashing in as it leaves.
    desk.frame(renderAnswerWindowSaying(questionLabelNarration("totalling")));
    expect(looking.leaving().textContent).toBe("");
    expect(desk.body()).toBe(questionLabelNarration("totalling"));
  });

  test("an ending too long for the line's room takes the rule away before it can be pushed", async () => {
    const desk = await seam();
    desk.frame(renderAnswerWindowOpening(QUESTION));
    await aTaskLater();
    desk.frame(renderAnswerWindowSaying(questionLabelNarration("counting")));
    const looking = lookingIn(desk);
    // The double lays nothing out, so the line's height is read off how much it holds.
    Object.defineProperty(looking.line(), "offsetHeight", {
      get: () => ((desk.body() ?? "").length > 60 ? 120 : 60),
    });
    desk.frame(renderAnswerWindowEnding(`You added ${"a great many notes, ".repeat(4)}last week.`));
    expect(looking.dropped()).toBe(true);
    expect(looking.fill()).not.toBe("100%");
  });

  test("a long answer is set below the voice, and a list below it again", async () => {
    const desk = await seam();
    desk.frame(renderAnswerWindowOpening(QUESTION));
    await aTaskLater();
    const spoken = () =>
      (lookingIn(desk).line().querySelector(ANSWER_BODY_SELECTOR) as El).children[0] as El;
    const sizes = () =>
      [LONG_SAYING_CLASS, LIST_SAYING_CLASS].map((size) => spoken().classList.contains(size));
    desk.frame(renderAnswerWindowSaying(questionLabelNarration("counting")));
    expect(sizes()).toEqual([false, false]);
    desk.frame(
      renderAnswerWindowEnding(`You added ${"a great many notes, ".repeat(12)}last week.`),
    );
    expect(sizes()).toEqual([true, false]);
    desk.frame(renderAnswerWindowEnding("Your notes:\nTuesday\nFriday"));
    expect(sizes()).toEqual([false, true]);
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
