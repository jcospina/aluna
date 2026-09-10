// The answer window remembers nothing, proved by running one rather than by reading it.
//
// 6.5/01 pinned the shape of the module in source; this is the claim the issue is named for, and a
// claim about writes that never happen cannot be settled by a file not containing a word. So a real
// desk is stood up, all three windows mount on it for real, and every way off the page is watched:
// the store, the address, the server, cookies. The load-bearing test is the last kind — the desk
// before the question and the desk after the answer is dismissed, node for node and attribute for
// attribute, because that is what "no route back, by any surface" actually means (ADR-0008,
// PLAN decision 26). Each silence has a control beside it that proves the watcher is wired.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ANSWER_DISMISS_LABEL,
  ANSWER_WINDOW_SELECTOR,
  dismissAnswerWindow,
  OPEN_THE_ANSWER_WINDOW_EVENT,
  openAnswerWindow,
  startDeskAnswerWindow,
} from "#shell/desk-answer-window.js";
import { closePanel, DEV_STORAGE_KEY, openPanel } from "#shell/desk-dev-panel.js";
import { openWindow, putAway, WINDOW_STORAGE_KEY } from "#shell/desk-window.js";
import {
  deskTrace,
  dragBy,
  type El,
  everythingSaid,
  pressLamp,
  type StandingDesk,
  standingDesk,
} from "./standing-desk.test-support.ts";

/** The two keyed records, as the browser already holds them when the question is asked. */
const KEPT = {
  [WINDOW_STORAGE_KEY]: '{"x":80,"y":60,"w":900,"h":640,"max":false}',
  [DEV_STORAGE_KEY]: '{"x":20,"y":20,"w":520,"h":420,"max":false,"open":true}',
};

const QUESTION = "how many notes did I write in July?";
const SAYING = "Let me look at what you've saved.";

let desk: StandingDesk;

beforeEach(() => {
  desk = standingDesk(KEPT);
});

afterEach(() => {
  dismissAnswerWindow();
  putAway();
  closePanel();
  desk.restore();
});

/**
 * The whole life of one answer: it opens, it is dragged and maximised, a second question lands,
 * and it is dismissed. What it did is handed back, so no test rests on a gesture that missed.
 */
function liveAndDie() {
  const answer = openAnswerWindow(desk.doc, QUESTION, SAYING);
  const opened = { ...answer.box };
  dragBy(answer.win.bar as unknown as El, 220, 140);
  const dragged = { ...answer.box };
  pressLamp(answer.el as unknown as El, "maximise");
  const maximised = answer.maximised;
  pressLamp(answer.el as unknown as El, "maximise");
  const second = openAnswerWindow(desk.doc, "and in August?", SAYING);
  const frame = second.el === answer.el;
  pressLamp(answer.el as unknown as El, "putaway");
  return {
    opened,
    dragged,
    maximised,
    frame,
    standing: desk.root.querySelector(ANSWER_WINDOW_SELECTOR),
  };
}

describe("the life the rest of this file rests on", () => {
  test("is one the window actually lived, by the controls a person uses", () => {
    // Every claim below is that a gesture wrote nothing. A gesture that never landed would prove
    // the same thing and mean nothing — and the dismissal starts at the lamp, not at the handler.
    const lived = liveAndDie();

    expect(lived.dragged).not.toEqual(lived.opened);
    expect(lived.maximised).toBe(true);
    expect(lived.frame).toBe(true);
    expect(lived.standing).toBeNull();
  });
});

describe("the desk it leaves is the desk it found", () => {
  test("node for node and attribute for attribute, once the answer is dismissed", () => {
    // The whole claim in one assertion. A logo, a tile, a reopen control anywhere on the desk, a
    // question parked in an attribute — none of them survive this, wherever they were put.
    openPanel(desk.doc);
    openWindow("Notes", desk.doc);
    const before = deskTrace(desk.root);

    liveAndDie();

    expect(deskTrace(desk.root)).toBe(before);
  });

  test("and the trace would have said so, because a node put anywhere is caught", () => {
    const before = deskTrace(desk.root);
    const smuggled = desk.doc.createElement("button");
    smuggled.textContent = "Reopen";
    desk.root.append(smuggled);
    expect(deskTrace(desk.root)).not.toBe(before);

    smuggled.remove();
    desk.root.setAttribute("data-last-question", QUESTION);
    expect(deskTrace(desk.root)).not.toBe(before);
  });

  test("nothing anywhere on the desk still says what was asked", () => {
    liveAndDie();

    expect(everythingSaid(desk.root)).not.toContain(QUESTION);
    expect(everythingSaid(desk.root)).not.toContain("and in August?");
  });

  test("and the sweep reads marks a trace leaves out, so neither hides the other", () => {
    const answer = openAnswerWindow(desk.doc, QUESTION, SAYING);

    expect(everythingSaid(desk.root)).toContain(QUESTION);
    answer.el.remove();
    expect(everythingSaid(desk.root)).not.toContain(QUESTION);
  });
});

describe("nothing about an answer is written down", () => {
  test("the store it found is the store it leaves", () => {
    liveAndDie();

    expect(desk.store.writes).toEqual([]);
    expect(desk.store.contents()).toEqual(KEPT);
  });

  test("and the store would have said so, because the window that does write is caught", () => {
    // The control. Same harness, same gesture, same store — the capability window's finished drag
    // is remembered, which is what makes the silence above evidence rather than an absent wiring.
    const region = openWindow("Notes", desk.doc);
    const capability = region.closest(".window--desk") as unknown as El;
    dragBy(capability.querySelector(".window__bar") as El, 200, 120);

    expect(desk.store.writes).toEqual([`set ${WINDOW_STORAGE_KEY}`]);
  });

  test("no third key is added, and the two that were there are unchanged", () => {
    openPanel(desk.doc);
    openWindow("Notes", desk.doc);
    liveAndDie();

    expect(desk.store.keys()).toEqual([DEV_STORAGE_KEY, WINDOW_STORAGE_KEY].sort());
    expect(desk.store.contents()).toEqual(KEPT);
  });

  test("the question is never asked of the store either", () => {
    // A read is not a write, but a key read for an answer is a key something meant to write: the
    // window must not so much as look for a record of its own.
    liveAndDie();

    expect(desk.store.reads).toEqual([]);
  });

  test("no session store, and no cookie — the two quiet ways a page remembers", () => {
    liveAndDie();

    expect(desk.session.writes).toEqual([]);
    expect(desk.cookies).toEqual([]);
  });
});

describe("nothing about an answer leaves the page", () => {
  test("no request of any kind is made for it", () => {
    // The third surface the issue names. The server proof is that `/prompt` writes nothing; this is
    // the other half — that the window never sends the question, the answer or its box anywhere.
    liveAndDie();

    expect(desk.sent).toEqual([]);
  });

  test("and a request would have been seen, by whichever transport made it", async () => {
    const page = globalThis as unknown as {
      fetch: (input: string) => Promise<unknown>;
      EventSource: new (url: string) => unknown;
    };
    await page.fetch("/answers");
    new page.EventSource("/answers/live");

    expect(desk.sent).toEqual(["fetch /answers", "eventsource /answers/live"]);
  });

  test("no address is written for it, and the one the desk was at is left alone", () => {
    const stood = { ...desk.address };
    liveAndDie();

    expect(desk.address.written).toEqual([]);
    expect(desk.address.pathname).toBe(stood.pathname);
  });

  test("and an address would have been seen, because the window that writes one is caught", () => {
    // The capability window's own clay lamp is a navigation: it pushes the bare desk. Same desk,
    // same gesture, same recorder — which is what makes the answer's silence above mean something.
    const region = openWindow("Notes", desk.doc);
    pressLamp(region.closest(".window--desk") as unknown as El, "putaway");

    expect(desk.address.written).toEqual(["push /"]);
  });
});

/** Start the desk's windows the way the page does, so the records really are read back. */
function reload(): void {
  openPanel(desk.doc);
  startDeskAnswerWindow(desk.doc as never);
}

describe("a reload restores nothing of it", () => {
  test("a desk starting up brings back the window that has a record, and no answer", () => {
    liveAndDie();
    desk.restore();
    desk = standingDesk(KEPT);
    reload();

    expect(desk.store.reads).not.toEqual([]);
    expect(desk.windows()).toHaveLength(1);
    expect(desk.root.querySelector(ANSWER_WINDOW_SELECTOR)).toBeNull();
    expect(everythingSaid(desk.root)).not.toContain(QUESTION);
  });

  test("a record shaped like an answer's is not read back into one", () => {
    // Nothing writes this key, so nothing should ever find it — but a desk that grew one from an
    // older build, a second tab or a hand-edited store must still come back with no answer on it.
    desk.restore();
    desk = standingDesk({ ...KEPT, "aluna.desk.answer.v1": `{"question":"${QUESTION}"}` });
    reload();

    expect(desk.root.querySelector(ANSWER_WINDOW_SELECTOR)).toBeNull();
    expect(desk.store.reads).not.toContain("aluna.desk.answer.v1");
    expect(everythingSaid(desk.root)).not.toContain(QUESTION);
  });
});

describe("the other two windows are untouched by it", () => {
  test("opening a capability leaves the answer exactly where and as it was", () => {
    const answer = openAnswerWindow(desk.doc, QUESTION, SAYING);
    dragBy(answer.win.bar as unknown as El, 180, 90);
    const stood = { ...answer.box };

    openWindow("Notes", desk.doc);

    expect(desk.layer.children).toContain(answer.el as unknown as El);
    expect(answer.box).toEqual(stood);
    expect(answer.win.titleEl.textContent).toBe(QUESTION);
  });

  test("putting that capability away leaves the answer standing", () => {
    const answer = openAnswerWindow(desk.doc, QUESTION, SAYING);
    openWindow("Notes", desk.doc);

    expect(putAway()).toBe(true);
    expect(desk.layer.children).toContain(answer.el as unknown as El);
    expect(desk.store.writes).toEqual([]);
  });

  test("its clay lamp says Dismiss where the capability window's says Put away", () => {
    // The vocabulary is the promise: put away means the logo brings it back, and this lamp ends
    // the answer. A screen reader hears the difference, so the names are read off both windows.
    const region = openWindow("Notes", desk.doc);
    const capability = region.closest(".window--desk") as unknown as El;
    const answer = openAnswerWindow(desk.doc, QUESTION, SAYING);
    const clay = (el: El) =>
      el.querySelector('.lamp[data-action="putaway"]')?.getAttribute("aria-label");

    expect(clay(answer.el as unknown as El)).toBe(`${ANSWER_DISMISS_LABEL} — ${QUESTION}`);
    expect(clay(capability)).toContain("Put away");
  });

  test("dismissing the answer puts neither of them away, and forgets neither record", () => {
    openPanel(desk.doc);
    const region = openWindow("Notes", desk.doc);
    const answer = openAnswerWindow(desk.doc, QUESTION, SAYING);

    pressLamp(answer.el as unknown as El, "putaway");

    expect(desk.layer.children).not.toContain(answer.el as unknown as El);
    expect(desk.layer.children).toHaveLength(2);
    expect(region.isConnected).toBe(true);
    expect(desk.store.contents()).toEqual(KEPT);
  });

  test("focus goes back to the prompt bar, which is a control that exists on this desk", () => {
    openAnswerWindow(desk.doc, QUESTION, SAYING);
    dismissAnswerWindow();

    expect((desk.bar.querySelector("input") as El).focused).toBe(true);
  });
});

describe("the question reaches the window and lands nowhere else", () => {
  test("the desk's own event opens it, and every way off the page stays shut", () => {
    startDeskAnswerWindow(desk.doc as never);
    desk.root.dispatchEvent({
      type: OPEN_THE_ANSWER_WINDOW_EVENT,
      detail: { question: QUESTION },
    });

    expect(desk.layer.children).toHaveLength(1);
    expect(desk.store.writes).toEqual([]);
    expect(desk.address.written).toEqual([]);
    expect(desk.sent).toEqual([]);
    expect(desk.cookies).toEqual([]);
  });
});
