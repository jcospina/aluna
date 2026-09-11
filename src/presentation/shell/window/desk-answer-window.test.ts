// The answer window: the third window, and the second exception to there being one.
//
// What is pinned here is everything that would turn the exception into a window manager or into
// a fourth kind of thing — a second answer window, a stored box, a logo, an address — plus the
// property the whole module exists for: opening one displaces nothing. The capability being asked
// about is still open, still showing what it showed, and still called what it was called.
//
// 6.5/02 is where "it remembers nothing" is proved end to end, storage sweep included. What is
// here is only what this module had to build to make that possible.

import { describe, expect, test } from "bun:test";
import { PROMPT_CLEARANCE } from "#design/desk-geometry.js";
import {
  ANSWER_BODY_SELECTOR,
  ANSWER_DISMISS_LABEL,
  ANSWER_WINDOW_SELECTOR,
  answerDefaultBox,
  dismissAnswerWindow,
  OPEN_THE_ANSWER_WINDOW_EVENT,
  openAnswerWindow,
  SAY_IN_THE_ANSWER_WINDOW_EVENT,
  sayInAnswerWindow,
  startDeskAnswerWindow,
  syncAnswerForm,
} from "#shell/desk-answer-window.js";
import {
  fitBox,
  openingGeometry,
  WINDOW_CONTENT_ID,
  WINDOW_STORAGE_KEY,
} from "#shell/desk-window.js";
import { questionLabelNarration } from "../../../runtime/query/index.ts";
import { ANSWER_WINDOW_OPENING } from "../../../server/http/index.ts";
import { codeOf as code, readSource as read, rules } from "../../safety/source.test-support.ts";
import { desk, fakeEl } from "./desk-window.test-support.ts";
import { standingDesk } from "./standing-desk.test-support.ts";

const ANSWER = code("public/desk-answer-window.js");
const WINDOW = code("public/desk-window.js");
const PANEL = code("public/desk-dev-panel.js");
const GLUE = code("public/app.js");
const SHELL = read("public/index.html");
const FRAGMENTS = read("src/server/http/fragments.ts");
const PIPELINE = code("src/pipeline/build/prompt-pipeline.ts");
const DEFLECTION = code("src/pipeline/build/admission/deflection-pipeline.ts");
const QUESTION = code("src/pipeline/query/question-pipeline.ts");
const SHELL_CSS = rules("public/css/shell.css");

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
function withBrowser<T>(run: () => T): T {
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
    return run();
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

/** Every rule `startDeskAnswerWindow` registers, by the event it listens for. */
function wiring(layer: unknown) {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  withBrowser(() =>
    startDeskAnswerWindow({
      querySelector: () => layer,
      addEventListener: (type: string, fn: (event: unknown) => void) =>
        listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    } as never),
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
    // One `<section>` per window module, the way the other two each build exactly one.
    expect(ANSWER.match(/document\.createElement\("section"\)/g)).toHaveLength(1);
    expect(WINDOW.match(/document\.createElement\("section"\)/g)).toHaveLength(1);
    expect(PANEL.match(/document\.createElement\("section"\)/g)).toHaveLength(1);
    // And the standing one is handed the new question rather than replaced: `??=` mounts only
    // when there is nothing standing, so the frame is never closed and reopened.
    expect(ANSWER).toMatch(/mounted \?\?= mount\(root\);\s*const entry = mounted;/);
  });

  test("no answer window is ever the window that may not be covered", () => {
    // It stacks like the other two. `desk-stack.test.ts` holds the slots themselves.
    expect(ANSWER).not.toContain("top: true");
  });
});

describe("it displaces nothing", () => {
  test("it never reaches for the capability window's own open, name or put-away", () => {
    // The whole point of the third window: opening an answer must not put away, displace,
    // re-title or restore the window the user was already looking at.
    for (const name of [
      "openWindow",
      "putAway",
      "dismissWindow",
      "nameWindow",
      "releaseWindowName",
      "putAwayUnfilled",
    ]) {
      expect(ANSWER, `the answer window calls \`${name}\``).not.toContain(name);
    }
    // Nor for the developer panel's.
    expect(ANSWER).not.toContain("openPanel");
    expect(ANSWER).not.toContain("closePanel");
    // And it never writes into the capability window's content region.
    expect(ANSWER).not.toContain(WINDOW_CONTENT_ID);
  });

  test("a question gives the borrowed frame back rather than restoring over it", () => {
    // The submit borrowed the capability window and called it `Thinking…`. A question restores
    // nothing — a restoration would put the *canonical collection* back, which replaces a record
    // the user had open. The glue marks the run instead, so at close only the run's own subscriber
    // goes and whatever the region was holding is still exactly what it was holding.
    expect(PIPELINE).toMatch(/if \(intent\.type === "data_query"\) \{\s*return streamQuestion\(/);
    // The question path has no restoration to render, and no way to reach for one: a deflection
    // is the only non-build outcome that puts anything back, and it no longer knows what a
    // question is.
    expect(QUESTION).not.toContain("renderRestorationFragment");
    expect(QUESTION).not.toContain("restoration");
    expect(DEFLECTION).not.toContain("question");
    expect(GLUE).toContain('subscriber.dataset.preserveActiveView = "true";');
    expect(GLUE).toMatch(
      /preserveActiveView = "true";\s*if \(!outputHasOnlyDormantSubscriber\(output, subscriber\)\)\s*nameTheWindow\(null\);/,
    );
  });

  test("a refusal opens no window, and the prompt bar keeps every sentence it carries", () => {
    // `#prompt-notice` is written by the restoration's own notice, and a question is the one
    // outcome that sends none — every other sentence the bar carries goes on being carried.
    expect(DEFLECTION).toContain("narration ?? deflectionNarration(resolution.intent),");
    expect(FRAGMENTS).toContain('export const ANSWER_WINDOW_ATTRIBUTE = "data-answer-window";');
  });
});

describe("nothing writes down where it is, or that it was", () => {
  test("no store, no key, no record", () => {
    for (const name of [
      "localStorage",
      "localStore",
      "savePresentation",
      "loadPresentation",
      "forgetPresentation",
      "forgetOnDismissal",
      "sessionStorage",
      WINDOW_STORAGE_KEY,
    ]) {
      expect(ANSWER, `the answer window reaches for \`${name}\``).not.toContain(name);
    }
    // It opens on the box this desk computes, never on one that was written down.
    expect(ANSWER).toContain(
      "const NOTHING_REMEMBERED = Object.freeze({ box: null, max: false });",
    );
  });

  test("a finished drag is not remembered, because there is nowhere to remember it", () => {
    // The gesture host the other two windows build carries an `onEnd` that writes the box. This
    // one has none: where the window is left is simply where it still is.
    const host = /const host = \{([\s\S]*?)\};/.exec(ANSWER)?.[1] ?? "";
    expect(host, "no gesture host in the answer window").not.toBe("");
    expect(host).not.toContain("onEnd");
    expect(PANEL, "the panel stopped remembering its box").toContain("onEnd: () => remember()");
  });

  test("nothing on the desk names it — no logo, no tile, no address", () => {
    // Comments stripped: the shell describes the window in prose, and prose is not a tile.
    const markup = SHELL.replace(/<!--[\s\S]*?-->/g, "");
    expect(markup).not.toContain("data-answer");
    expect(markup).not.toContain("answer-tile");
    for (const name of ["pushAddress", "replaceAddress", "capabilityAddress", "deskHistory"]) {
      expect(ANSWER, `the answer window writes the address through \`${name}\``).not.toContain(
        name,
      );
    }
  });
});

describe("dismissing it leaves no route back", () => {
  test("the clay lamp says what it does, and what it does is destroy the answer", () => {
    expect(ANSWER_DISMISS_LABEL).toBe("Dismiss");
    expect(ANSWER).toMatch(/if \(action === "putaway"\) dismissAnswerWindow\(\);/);
    expect(ANSWER).toContain("lamp.dataset.lampLabel = ANSWER_DISMISS_LABEL;");
    // And the frame goes with it: there is no route left to what it held.
    expect(ANSWER).toMatch(/mounted = null;\s*leaveStack\(entry\);/);
    // The frame's own observer goes with it, or every dismissed answer leaves one watching a
    // window that is not on the page.
    expect(ANSWER).toContain("entry.win.destroy();");
    expect(ANSWER).toContain("entry.el.remove();");
  });

  test("there is nothing to dismiss until a question opens one", () => {
    // Called by the lamp of a window that is standing, and by 6.5/04's cancel path, which has to
    // be able to ask without knowing. A desk with no answer on it answers `false` and is unmoved.
    expect(dismissAnswerWindow()).toBe(false);
  });

  test("focus goes back to the bar rather than to the body", () => {
    // A keyboard user who presses the clay lamp otherwise loses focus to `<body>` and tabs the
    // whole desk again — the same promise the capability window's `focusOpener` keeps.
    expect(ANSWER).toContain("document.getElementById(PROMPT_FORM_ID)");
    // And whichever of the bar's controls can actually take it: `focus()` on a disabled one is a
    // no-op, so a question dismissed while a build has the bar would otherwise land on `<body>`.
    expect(ANSWER).toContain('"input:not(:disabled), button:not(:disabled)"');
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

  test("a desk too small for it still gets a clamped box, never a negative one", () => {
    const box = answerDefaultBox(desk(320, 240));
    expect(box.w).toBeGreaterThan(0);
    expect(box.h).toBeGreaterThan(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
  });

  test("the clearance is read from the token layer rather than restated", () => {
    expect(ANSWER).toContain("bounds.height - PROMPT_CLEARANCE");
    expect(ANSWER).not.toMatch(/4\.875rem|78px/);
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
    // It carries `window--desk`, so every phone rule the other two obey already governs it:
    // the window is the screen, the grip is gone, and only the frontmost is in the page.
    expect(ANSWER).toMatch(/el\.className = `window window--desk \$\{ANSWER_WINDOW_CLASS\}`;/);

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

  test("a long answer's tail is not left under the prompt bar on a phone", () => {
    // The geometry that stops a window above the bar is overridden below the breakpoint, so the
    // strip is reserved as content — the same rule the capability window's region keeps.
    const literal = (selector: string) => selector.replaceAll(".", "\\.");
    expect(SHELL_CSS).toMatch(
      new RegExp(
        `@media \\(max-width: 720px\\) \\{[^@]*?${literal(ANSWER_WINDOW_SELECTOR)} ${literal(ANSWER_BODY_SELECTOR)}::after \\{[^}]*height: var\\(--prompt-clearance\\);`,
      ),
    );
    // And the class is a hook the stylesheet actually uses, not a name on an element nothing reads.
    expect(SHELL_CSS).toContain(`${ANSWER_WINDOW_SELECTOR} ${ANSWER_BODY_SELECTOR} {`);
  });
});

describe("the seam a classic script reaches the answer window across", () => {
  test("both ends agree on the event, and on what rides it", () => {
    expect(OPEN_THE_ANSWER_WINDOW_EVENT).toBe("aluna:open-the-answer-window");
    expect(GLUE).toContain(`OPEN_THE_ANSWER_WINDOW_EVENT = "${OPEN_THE_ANSWER_WINDOW_EVENT}"`);
    expect(GLUE).toContain('ANSWER_WINDOW_ATTRIBUTE = "data-answer-window"');
    // It lands nowhere, like the window's name: the desk owns its windows (ARCH §6.1).
    expect(GLUE).toMatch(/openTheAnswerWindowFrom\(listener, message\.data\) \|\|/);
  });

  test("both ends agree on the mark a later sentence rides, and on where it lands", () => {
    expect(SAY_IN_THE_ANSWER_WINDOW_EVENT).toBe("aluna:say-in-the-answer-window");
    expect(GLUE).toContain(`SAY_IN_THE_ANSWER_WINDOW_EVENT = "${SAY_IN_THE_ANSWER_WINDOW_EVENT}"`);
    expect(GLUE).toContain('ANSWER_WINDOW_SAYING_ATTRIBUTE = "data-answer-saying"');
    expect(FRAGMENTS).toContain(
      'export const ANSWER_WINDOW_SAYING_ATTRIBUTE = "data-answer-saying";',
    );
    // It lands nowhere either, and it is asked before the parked restoration is.
    expect(GLUE).toMatch(/sayInTheAnswerWindowFrom\(listener, message\.data\) \|\|/);
  });

  test("a sentence for a window nobody is holding open goes nowhere at all", () => {
    // Dismissing destroys the answer, and a question still running says the rest of what it had
    // to say into a desk that is no longer listening. Nothing reopens (ADR-0008).
    expect(sayInAnswerWindow("I'm counting how many you have.")).toBe(false);
    const say = wiring({})?.get(SAY_IN_THE_ANSWER_WINDOW_EVENT)?.[0];
    expect(say).toBeDefined();
    for (const detail of [undefined, null, {}, { saying: 7 }, { question: "how many?" }]) {
      expect(() => say?.({ detail })).not.toThrow();
    }
    // And a real sentence reaches the same dead end rather than building a window to hold it.
    expect(() => say?.({ detail: { saying: "I'm adding everything up." } })).not.toThrow();
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

  test("a list in an answer is read as a list rather than run into one line", () => {
    // An answer that is a list runs over lines exactly as she wrote it, so the breaks have to
    // survive to the desk — `textContent` alone would collapse them (PLAN decision 3).
    expect(SHELL_CSS).toMatch(
      new RegExp(
        `${ANSWER_WINDOW_SELECTOR.replaceAll(".", "\\.")} ${ANSWER_BODY_SELECTOR.replaceAll(".", "\\.")} \\{[^}]*white-space: pre-wrap;`,
      ),
    );
  });

  test("one prompt bar and no way to pre-classify a sentence", () => {
    // PLAN decision 1: no mode switch, no slash command, no ask-versus-build control. The composer
    // is where such a control would have to live, and it carries one field and one submit.
    const composer = SHELL.slice(SHELL.indexOf("prompt__composer"));
    const bar = composer.slice(0, composer.indexOf("</form>"));
    for (const control of ["<select", "<option", 'type="radio"', 'type="checkbox"', 'role="tab"']) {
      expect({ control, present: bar.includes(control) }).toEqual({ control, present: false });
    }
    expect(bar.match(/<input\b/g) ?? []).toHaveLength(1);
  });

  test("the layer is demanded at start-up, not at the first question", () => {
    // A shell shipped without one would otherwise look entirely normal until the first thing the
    // user asked, which is the confusion the throw prevents — the same promise the window keeps.
    expect(() => wiring(null)).toThrow("The desk's window layer is missing.");
  });

  test("a detail that names no question opens nothing", () => {
    // The event carries what the server said. Anything else reaching it is not a question, and a
    // window opened for one would be a frame with nothing in it and no way to know what it was.
    const open = wiring({})?.get(OPEN_THE_ANSWER_WINDOW_EVENT)?.[0];
    expect(open).toBeDefined();
    for (const detail of [undefined, null, {}, { question: 7 }, { saying: "hello" }]) {
      expect(() => open?.({ detail })).not.toThrow();
    }
    // And it is a guard rather than a listener that does nothing: a detail that does name a
    // question reaches the mount, which is what has no browser to build a window in here.
    expect(() => open?.({ detail: { question: "how many notes?" } })).toThrow();
  });

  test("the page loads it, and it starts itself the way every other shell module does", () => {
    expect(SHELL).toContain('<script type="module" src="/static/desk-answer-window.js"></script>');
    expect(ANSWER).toContain('if (typeof document !== "undefined")');
    expect(ANSWER).toContain("startDeskAnswerWindow(document)");
  });
});
