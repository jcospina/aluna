// The answer window: the third window, and the second exception to there being one.
//
// What is run here is everything that would turn the exception into a window manager or into a
// fourth kind of thing — a second answer window, a stored box, a logo, an address — plus the
// property the whole module exists for: opening one displaces nothing. What the module may never
// reach for is swept in `desk-answer-window.policy.ts`. The capability being asked
// about is still open, still showing what it showed, and still called what it was called.
//
// 6.5/02 is where "it remembers nothing" is proved end to end, storage sweep included. What is
// here is only what this module had to build to make that possible.

import { describe, expect, test } from "bun:test";
import { PROMPT_CLEARANCE, refreshGeometry } from "#design/desk/desk-geometry.js";
import { buildRunIn } from "#shell/desk/leaving-a-run.js";
import {
  ANSWER_DISMISS_LABEL,
  ANSWER_WINDOW_SELECTOR,
  answerDefaultBox,
  dismissAnswerWindow,
  OPEN_THE_ANSWER_WINDOW_EVENT,
  openAnswerWindow,
  refuseInAnswerWindow,
  SAY_IN_THE_ANSWER_WINDOW_EVENT,
  sayInAnswerWindow,
  syncAnswerForm,
} from "#shell/desk/window/desk-answer-window.js";
import { joinStack, leaveStack, raise } from "#shell/desk/window/desk-stack.js";
import { fitBox, openingGeometry, openWindow, putAway } from "#shell/desk/window/desk-window.js";
import { REJECT_DEFLECTION } from "../../../../pipeline/build/admission/deflection.ts";
import { questionLabelNarration } from "../../../../runtime/query/index.ts";
import {
  ANSWER_WINDOW_OPENING,
  renderAnswerWindowOpening,
  renderAnswerWindowSaying,
} from "../../../../server/http/index.ts";
import { elementsOf, moduleSources } from "../../../../server/http/served-page.test-support.ts";
import {
  eventAt,
  openStream,
  desk as shellDesk,
} from "../../../../server/shell-glue/app.shell-double.test-support.ts";
import { startedOn } from "../../../controls/double/started-module.test-support.ts";
import { readSource as read } from "../../../safety/source.test-support.ts";
import { desk, fakeEl, stackMember } from "../desk-window.test-support.ts";
import { El, pressLamp, standingDesk } from "../standing-desk.test-support.ts";

const SHELL = read("public/index.html");

/** A frame arriving on this run's stream, and whether the glue kept it off the page. */
function frameArrives(scene: ReturnType<typeof shellDesk>, data: string): boolean {
  const event = eventAt("htmx:sseBeforeMessage", scene.surface, { data });
  scene.fire("htmx:sseBeforeMessage", event);
  return event.defaultPrevented;
}

/** Whether the answer window carries every class the capability window's frame carries. */
function framesShareClasses(): boolean {
  const desk = standingDesk();
  try {
    openWindow("Notes", desk.doc as never);
    const answer = openAnswerWindow(desk.doc, "how many notes?", "You have 22 notes.");
    const [capability] = desk.windows().filter((el) => el !== (answer.el as unknown as El));
    const frame = (capability?.names() ?? []).filter((name) => !name.startsWith("is-"));
    return frame.length > 0 && frame.every((name) => answer.el.classList.contains(name));
  } finally {
    dismissAnswerWindow();
    putAway();
    desk.restore();
  }
}

/** A window, as much of one as `syncAnswerForm` touches — lamp, bar, and the gestures. */
function fakeWindow() {
  const el = fakeEl();
  const lamp = fakeEl();
  const bar = fakeEl();
  const asked: string[] = [];
  el.querySelector = ((selector: string) => {
    asked.push(selector);
    return selector === '.lamp[data-action="maximise"]' ? lamp : null;
  }) as never;
  return { entry: { el, win: { bar }, gestures: false }, lamp, bar, asked };
}

/**
 * As much of a browser as start-up touches: the breakpoint it asks about, and the observer it
 * watches the desk with. Put back exactly as found, because these are globals a shell module reads.
 */
async function withBrowser<T>(run: () => Promise<T>): Promise<T> {
  const before = Reflect.getOwnPropertyDescriptor(globalThis, "window");
  const observer = Reflect.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  const put = (name: string, value: unknown) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const styles = Reflect.getOwnPropertyDescriptor(globalThis, "getComputedStyle");
  const doc = Reflect.getOwnPropertyDescriptor(globalThis, "document");
  put("window", {
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    addEventListener: () => {},
  });
  put("document", { documentElement: {}, createElement: () => fakeEl() });
  put("getComputedStyle", () => ({ getPropertyValue: () => "" }));
  put(
    "ResizeObserver",
    class {
      observe() {}
    },
  );
  try {
    return await run();
  } finally {
    for (const [name, had] of [
      ["window", before],
      ["ResizeObserver", observer],
      ["getComputedStyle", styles],
      ["document", doc],
    ] as const) {
      if (had) Object.defineProperty(globalThis, name, had);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

/** Every rule a fresh instance registers when it starts itself, by the event it listens for. */
async function wiring(layer: unknown) {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  await withBrowser(() =>
    startedOn("desk/window/desk-answer-window.js", {
      querySelector: () => layer,
      addEventListener: (type: string, fn: (event: unknown) => void) =>
        listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    }),
  );
  return listeners;
}

/** `addWindowGrip` builds its handle with `document`, which Bun does not have. */
function withDocument<T>(run: () => T): T {
  const before = Reflect.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    value: { createElement: () => fakeEl() },
    configurable: true,
    writable: true,
  });
  try {
    return run();
  } finally {
    if (before) Object.defineProperty(globalThis, "document", before);
    else Reflect.deleteProperty(globalThis, "document");
  }
}

describe("it is the third window, and there is no fourth", () => {
  test("one answer window is built, and a second question never builds another", () => {
    // The standing one is handed the new question rather than replaced, so the frame is never
    // closed and reopened. The other two windows keep the same promise in their own suites.
    const desk = standingDesk();
    try {
      const first = openAnswerWindow(desk.doc, "how many notes?", "You have 22 notes.");
      const second = openAnswerWindow(desk.doc, "and in August?", ANSWER_WINDOW_OPENING);
      expect(second.el).toBe(first.el);
      expect(desk.doc.querySelectorAll(ANSWER_WINDOW_SELECTOR)).toHaveLength(1);
      expect(second.win.titleEl.textContent).toBe("and in August?");
    } finally {
      dismissAnswerWindow();
      desk.restore();
    }
  });
});

describe("it shows words and nothing else", () => {
  test("markup in what she says arrives as text, so no image, link or address is drawn", () => {
    // Module 7 decision 37: escaped on the server, and no sink the window reaches parses markup.
    expect(renderAnswerWindowSaying('<img src="/files/x"><a href="/files/x">x</a>')).not.toMatch(
      /<(img|a)\b/,
    );
  });
});

describe("it displaces nothing", () => {
  test("a refusal opens no window, and a desk holding none is told so", () => {
    // Still true of a refusal that nothing opens for it: this mounts no window and reaches for
    // nothing that would. What it answers is whether there was one — a desk with no answer on it
    // says no, and the glue puts the sentence on the prompt bar instead (PLAN decision 31).
    const desk = standingDesk();
    try {
      expect(refuseInAnswerWindow("delete everything", REJECT_DEFLECTION)).toBe(false);
      expect(desk.windows()).toEqual([]);
    } finally {
      desk.restore();
    }
  });

  test("and it comes forward, because on this desk nothing else is saying it", () => {
    // Behind a capability window a refusal is invisible, and the prompt bar stayed silent for it
    // precisely because there was a window to put it in — so a refusal that does not come forward
    // is the desk answering with nothing at all. The long-question rule `sayInAnswerWindow` keeps
    // does not reach this: the person typed these words a beat ago.
    const desk = standingDesk();
    const other = stackMember();
    try {
      const answer = openAnswerWindow(desk.doc, "how many notes?", "You have 22 notes.");
      joinStack(other);
      raise(other);
      expect(answer.el.classList.contains("is-focused")).toBe(false);

      refuseInAnswerWindow("delete everything", REJECT_DEFLECTION);

      expect(answer.el.classList.contains("is-focused")).toBe(true);
    } finally {
      leaveStack(other);
      dismissAnswerWindow();
      desk.restore();
    }
  });

  test("a refusal takes the answer window already standing, under the words it refused", () => {
    // The window held an answer to a question this sentence is not, and leaving it there leaves
    // the desk answering something nobody asked. So the refusal takes the frame over the way a
    // second question does — re-titled and in front, never a second window (PLAN decisions 25, 31).
    const desk = standingDesk();
    try {
      const answer = openAnswerWindow(desk.doc, "how many notes?", "You have 22 notes.");
      expect(refuseInAnswerWindow("delete everything", REJECT_DEFLECTION)).toBe(true);
      expect(answer.body.textContent).toBe(REJECT_DEFLECTION);
      expect(answer.win.titleEl.textContent).toBe("delete everything");
      expect(desk.doc.querySelectorAll(ANSWER_WINDOW_SELECTOR)).toHaveLength(1);
    } finally {
      dismissAnswerWindow();
      desk.restore();
    }
  });
});

describe("dismissing it leaves no route back", () => {
  test("the clay lamp says what it does, and what it does is destroy the answer", () => {
    const desk = standingDesk();
    try {
      const answer = openAnswerWindow(desk.doc, "how many notes?", "You have 22 notes.");
      const lamp = answer.el.querySelector('.lamp[data-action="putaway"]') as El;
      expect(lamp.dataset.lampLabel).toBe(ANSWER_DISMISS_LABEL);
      expect(lamp.getAttribute("aria-label")).toContain(ANSWER_DISMISS_LABEL);
      pressLamp(answer.el as unknown as El, "putaway");
      // And the frame goes with it: there is no route left to what it held.
      expect(answer.el.isConnected).toBe(false);
      expect(desk.doc.querySelectorAll(ANSWER_WINDOW_SELECTOR)).toEqual([]);
      expect(dismissAnswerWindow()).toBe(false);
    } finally {
      desk.restore();
    }
  });

  test("there is nothing to dismiss until a question opens one", () => {
    // Called by the lamp of a window that is standing, and by 6.5/04's cancel path, which has to
    // be able to ask without knowing. A desk with no answer on it answers `false` and is unmoved.
    expect(dismissAnswerWindow()).toBe(false);
  });

  test("focus goes back to whichever of the bar's controls can take it", () => {
    // `focus()` on a disabled control is a no-op, so a question dismissed while a build has the
    // bar would otherwise land on `<body>`. The enabled field is run next door, in
    // `answer-window-remembers-nothing.test.ts`.
    const desk = standingDesk();
    try {
      const field = desk.bar.querySelector("input") as El;
      field.disabled = true;
      const send = new El("button");
      desk.bar.append(send);
      openAnswerWindow(desk.doc, "how many notes?", "You have 22 notes.");
      dismissAnswerWindow();
      expect(field.focused).toBe(false);
      expect(send.focused).toBe(true);
    } finally {
      desk.restore();
    }
  });
});

describe("it obeys the desk", () => {
  test("its first box stops on the prompt bar's floor, like everything else on the desk", () => {
    const bounds = desk(1440, 900);
    const box = answerDefaultBox(bounds);
    expect(box.y + box.h).toBeLessThanOrEqual(900 - PROMPT_CLEARANCE);
    // Centred on the room above that floor, on both axes.
    expect(box.x).toBe(Math.round((1440 - box.w) / 2));
    expect(Math.abs(box.x + box.w / 2 - 720)).toBeLessThanOrEqual(1);
    // And smaller than the capability window's own fill, so it opens inside what it is about.
    expect(box.w).toBeLessThan(Math.round(1440 * 0.62));
  });

  test("the floor is the one the token layer declares, read when the box is asked for", () => {
    const host = globalThis as unknown as Record<string, unknown>;
    const saved = ["window", "document", "getComputedStyle"].map(
      (name) => [name, Reflect.getOwnPropertyDescriptor(host, name)] as const,
    );
    const underClearance = (clearance: string) => {
      host.getComputedStyle = () => ({
        getPropertyValue: (name: string) => (name === "--prompt-clearance" ? clearance : ""),
      });
      return { box: answerDefaultBox(desk(1440, 900)), floor: 900 - PROMPT_CLEARANCE };
    };
    Object.assign(host, { window: host, document: { documentElement: {} } });
    try {
      const floors = new Set<number>();
      for (const clearance of ["40px", "300px"]) {
        const { box, floor } = underClearance(clearance);
        floors.add(floor);
        expect(floor).toBe(900 - Number.parseFloat(clearance));
        expect(Math.abs(box.y + box.h / 2 - floor / 2)).toBeLessThanOrEqual(1);
      }
      expect(floors.size).toBe(2);
    } finally {
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(host, name, descriptor);
        else Reflect.deleteProperty(host, name);
      }
      refreshGeometry();
    }
  });

  test("a desk too small for it still gets a clamped box, never a negative one", () => {
    const box = answerDefaultBox(desk(320, 240));
    expect(box.w).toBeGreaterThan(0);
    expect(box.h).toBeGreaterThan(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
  });

  test("a box the user authored survives a resize tick that does not have to move it", () => {
    // The promise the whole frame rests on: nothing recomputes a box that already fits, so a
    // window dragged somewhere is still there after a resize, a maximise and the next question.
    const placed = { x: 120, y: 90, w: 640, h: 300 };
    const state = { box: { ...placed }, maximised: false, sized: true, first: answerDefaultBox };
    expect(fitBox(state, desk(1440, 900), false)).toBe(true);
    expect(state.box).toEqual(placed);
  });

  test("the box it opens on is computed here, and the record it is computed from is untouched", () => {
    // Frozen and shared by every mount, so a geometry that wrote to it would throw on the second
    // question rather than quietly hand the next answer the last one's box.
    const stored = Object.freeze({ box: null, max: false });
    const el = fakeEl();
    expect(() =>
      openingGeometry(el as never, stored, desk(1440, 900), false, answerDefaultBox),
    ).not.toThrow();
    expect(stored).toEqual({ box: null, max: false });
  });

  test("below the breakpoint it is the screen, and no phone behaviour is invented for it", () => {
    // It carries every class the capability window's frame does, so every phone rule the other
    // two obey already governs it: the window is the screen, the grip is gone, and only the
    // frontmost is in the page.
    expect(framesShareClasses()).toBe(true);

    const { entry, lamp, bar } = fakeWindow();
    withDocument(() => syncAnswerForm(entry as never, true));
    expect(entry.gestures).toBe(false);
    expect(lamp.attrs.has("hidden")).toBe(true);
    expect(bar.classList.contains("window__bar--draggable")).toBe(false);

    withDocument(() => syncAnswerForm(entry as never, false));
    expect(entry.gestures).toBe(true);
    expect(lamp.attrs.has("hidden")).toBe(false);
    expect(bar.classList.contains("window__bar--draggable")).toBe(true);
  });
});

describe("the seam a classic script reaches the answer window across", () => {
  test("an opening on the stream opens the window with her words, and lands nowhere else", () => {
    const scene = shellDesk();
    scene.startShell();
    openStream(scene);
    expect(frameArrives(scene, renderAnswerWindowOpening("how many notes?"))).toBe(true);
    expect(scene.dispatched).toContainEqual({
      type: OPEN_THE_ANSWER_WINDOW_EVENT,
      detail: { question: "how many notes?", saying: ANSWER_WINDOW_OPENING },
    });
    // The borrowed frame is given back: the run no longer counts as using the window.
    expect(buildRunIn(scene.region as never)).toBeNull();
  });

  test("a later sentence on the stream goes to the window, and lands nowhere else", () => {
    const scene = shellDesk();
    scene.startShell();
    openStream(scene);
    const counting = questionLabelNarration("counting");
    expect(frameArrives(scene, renderAnswerWindowSaying(counting))).toBe(true);
    const said = scene.dispatched.filter(({ type }) => type === SAY_IN_THE_ANSWER_WINDOW_EVENT);
    expect(said).toHaveLength(1);
    // Handed on parsed, for `answer-runs.js` to read, rather than flattened to its text.
    const { said: fragment } = said[0]?.detail as { said: { textContent: string } };
    expect(fragment.textContent).toBe(counting);
    expect(scene.region.textContent).not.toContain(counting);
  });

  test("a sentence for a window nobody is holding open goes nowhere at all", async () => {
    // Dismissing destroys the answer, and a question still running says the rest of what it had
    // to say into a desk that is no longer listening. Nothing reopens (ADR-0008).
    expect(sayInAnswerWindow(questionLabelNarration("counting"))).toBe(false);
    const say = (await wiring({})).get(SAY_IN_THE_ANSWER_WINDOW_EVENT)?.[0];
    expect(say).toBeDefined();
    for (const detail of [undefined, null, {}, { said: 7 }, { question: "how many?" }]) {
      expect(() => say?.({ detail })).not.toThrow();
    }
    // And a real sentence reaches the same dead end rather than building a window to hold it.
    const said = { childNodes: [{ nodeType: 3, textContent: "I'm adding everything up." }] };
    expect(() => say?.({ detail: { said } })).not.toThrow();
  });

  test("each sentence replaces the last: the window is one utterance, never a log", () => {
    // A build narration is the log; an answer window holds one thing at a time (PLAN decision 24).
    // Appending instead would make it a history of every step, which is decision 3's "no answer
    // history" by another route.
    const desk = standingDesk();
    try {
      const answer = openAnswerWindow(desk.doc, "how many notes?", ANSWER_WINDOW_OPENING);
      const naming = questionLabelNarration("naming");
      const counting = questionLabelNarration("counting");
      sayInAnswerWindow(naming);
      sayInAnswerWindow(counting);
      expect(answer.body.textContent).toBe(counting);
    } finally {
      dismissAnswerWindow();
      desk.restore();
    }
  });

  test("a sentence that overtook the opening line keeps the window", async () => {
    // The opening is written in a later task, so the first step's sentence can land before it.
    // Without a guard the timer puts `Let me look…` back and it stays there for good — the window
    // then claims she never looked, on the first question of the page and no other.
    const desk = standingDesk();
    try {
      const answer = openAnswerWindow(desk.doc, "how many notes?", ANSWER_WINDOW_OPENING);
      const counting = questionLabelNarration("counting");
      expect(sayInAnswerWindow(counting)).toBe(true);
      await new Promise((wake) => setTimeout(wake, 1));
      expect(answer.body.textContent).toBe(counting);
    } finally {
      dismissAnswerWindow();
      desk.restore();
    }
  });

  test("the layer is demanded at start-up, not at the first question", async () => {
    // A shell shipped without one would otherwise look entirely normal until the first thing the
    // user asked, which is the confusion the throw prevents — the same promise the window keeps.
    await expect(wiring(null)).rejects.toThrow("The desk's window layer is missing.");
  });

  test("a detail that names no question opens nothing", async () => {
    // The event carries what the server said. Anything else reaching it is not a question, and a
    // window opened for one would be a frame with nothing in it and no way to know what it was.
    const open = (await wiring({})).get(OPEN_THE_ANSWER_WINDOW_EVENT)?.[0];
    expect(open).toBeDefined();
    for (const detail of [undefined, null, {}, { question: 7 }, { saying: "hello" }]) {
      expect(() => open?.({ detail })).not.toThrow();
    }
    // And it is a guard rather than a listener that does nothing: a detail that does name a
    // question reaches the mount, which is what has no browser to build a window in here.
    expect(() => open?.({ detail: { question: "how many notes?" } })).toThrow();
  });

  test("the page loads it, and it starts itself on the document it finds", async () => {
    expect(moduleSources(await elementsOf(SHELL))).toContain(
      "/static/desk/window/desk-answer-window.js",
    );
    const desk = standingDesk();
    const started = await startedOn<typeof import("#shell/desk/window/desk-answer-window.js")>(
      "desk/window/desk-answer-window.js",
      desk.doc,
    );
    try {
      desk.root.dispatchEvent({ type: OPEN_THE_ANSWER_WINDOW_EVENT, detail: { question: "how?" } });
      expect(desk.doc.querySelectorAll(ANSWER_WINDOW_SELECTOR)).toHaveLength(1);
    } finally {
      started.dismissAnswerWindow();
      desk.restore();
    }
  });
});
