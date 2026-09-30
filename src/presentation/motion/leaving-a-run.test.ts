import { describe, expect, test } from "bun:test";

import {
  applyLeavingQuestion,
  askBeforeLeaving,
  backOutOfLeaving,
  buildCancelUrl,
  buildJobIdIn,
  endRunIn,
  endTheRun,
  goAheadAndLeave,
  LEAVING_A_RUN_UNAVAILABLE,
  LEAVING_BACK_SELECTOR,
  leavingIsBeingAsked,
  standDownWith,
  startLeavingGuard,
} from "#shell/desk/leaving-a-run.js";
import { renderBuildSubscriber } from "../../server/http/fragments/fragments.ts";
import { El, parseHtml } from "../controls/double/choice-picker.test-support.ts";
import {
  itemElementIdForTemplate,
  renderCollection,
  renderItemWrapper,
} from "../records/collection/list-container.ts";
import { CAPABILITY, RECORD, recordDesk } from "../records/record-view/record-view.test-support.ts";
import { renderRecordViewTemplate } from "../records/record-view/record-view.ts";
import { node, windowWithRun } from "./leaving-a-run.test-support.ts";

// Leaving a live build or evolution warns first, and confirming ends it once (PLAN decision 17,
// amending design D3). Written against plain objects, so the order an ending owes is proved.

/** A desk with nothing running: the window holds no subscriber at all. */
const bareWindow = { querySelector: () => null };

describe("what a run is, and where it is cancelled", () => {
  test("a run that has ended is not one leaving can cost you", () => {
    // The window is the only way back to a run's narration, so leaving the server
    // building something nobody can see is the worse half of a half-done teardown.
    const focused: string[] = [];
    expect(buildJobIdIn(windowWithRun(focused).el)).toBe("build-7");
    expect(buildCancelUrl("build 7/8")).toBe("/build/build%207%2F8/cancel");
    expect(buildJobIdIn(bareWindow)).toBeNull();
    // A run that already ended and is only waiting to be read is not being narrated. Cancelling
    // it would post to a job the queue deleted, and ask about losing a finished build.
    expect(buildJobIdIn(windowWithRun(focused, { ending: true }).el)).toBeNull();
  });

  test("a run that has handed the window back is not one leaving can cost you either", () => {
    // A question stands in the window while its sentence is classified and then gives the frame
    // straight back rather than filling it (`public/desk/window/desk-answer-window.js`). Asking whether to
    // stop making something is wrong twice over: it is making nothing, and leaving costs nothing.
    const focused: string[] = [];
    expect(buildJobIdIn(windowWithRun(focused, { givenBack: true }).el)).toBeNull();
    expect(buildJobIdIn(windowWithRun(focused).el)).toBe("build-7");
  });

  test("the ending owes three things, in one order", () => {
    // The cancel first, so the server stops; the release while the story is still connected, the
    // only moment a request under it aborts; the detach last, because that closes the stream.
    const order: string[] = [];
    const run = { name: "the run" };
    expect(
      endTheRun({
        run,
        cancel: () => {
          order.push("cancel");
          return "build-7";
        },
        release: (it) => order.push(`release:${it.name}`),
        detach: (it) => order.push(`detach:${it.name}`),
      }),
    ).toBe(true);
    expect(order).toEqual(["cancel", "release:the run", "detach:the run"]);
  });

  test("nothing is torn down for a run that was not going, or that could not come down", () => {
    const order: string[] = [];
    const ending = {
      run: { name: "the run" },
      cancel: () => {
        order.push("cancel");
        return "build-7";
      },
      release: () => order.push("release"),
      detach: () => order.push("detach"),
    };
    expect(endTheRun({ ...ending, cancel: () => null })).toBe(false);
    expect(endTheRun({ ...ending, run: null })).toBe(false);
    // No way to take the story down stops the whole thing before the cancel: a run stopped on the
    // server but still narrating on screen is the worst of the three outcomes.
    expect(endTheRun({ ...ending, detach: null })).toBe(false);
    expect(order).toEqual([]);
  });

  test("the story is taken down through htmx, never detached in silence", () => {
    // `remove` is `removeChild` and runs no cleanup, so the SSE extension would hold an open
    // `EventSource` and `htmx:sseClose` would never reach the document.
    const win = parseHtml(renderBuildSubscriber("build-7"), new El("div"));
    const run = win.querySelector("section") as El;
    const posted: [unknown, unknown][] = [];
    const swapped: [El, unknown][] = [];
    const fetchBefore = globalThis.fetch;
    globalThis.fetch = ((url: unknown, init: unknown) => {
      posted.push([url, init]);
      return Promise.resolve(new Response(null));
    }) as typeof fetch;
    try {
      const api = {
        swap: (target: unknown, _: string, spec: { swapStyle: string }) =>
          void swapped.push([target as El, spec.swapStyle]),
      };
      expect(endRunIn(win as never, { api, release: () => {} })).toBe(true);
    } finally {
      globalThis.fetch = fetchBefore;
    }
    // The page may be on its way out behind the press, so the cancel outlives it.
    expect(posted).toEqual([[buildCancelUrl("build-7"), { method: "POST", keepalive: true }]]);
    expect(swapped).toEqual([[run, "outerHTML"]]);
    expect(run.isConnected || run.parent === win).toBe(true);
  });
});

describe("the question stands inside the run, and swaps nothing", () => {
  test("it takes the run's control's place, and focus enters on the safe answer", () => {
    const focused: string[] = [];
    const control = node("cancel", focused);
    const warning = { ...node("question", focused), hidden: true };
    const back = node("keep going", focused);
    const row = { control, warning, backOut: back, focus: (it: typeof back) => it.focus() };

    applyLeavingQuestion({ ...row, asking: true });
    expect(control.hidden).toBe(true);
    expect(warning.hidden).toBe(false);
    expect(focused).toEqual(["keep going"]);

    // And backing out puts both back, with focus on the control the question replaced —
    // a predictable landing rather than `<body>`.
    applyLeavingQuestion({ ...row, asking: false });
    expect(control.hidden).toBe(false);
    expect(warning.hidden).toBe(true);
    expect(focused).toEqual(["keep going", "cancel"]);
  });

  test("a run served without the row is not a person trapped in the window", () => {
    // A shell that shipped a run with no question has a bug worth finding, and
    // swallowing the navigation would hide it behind a control that looks broken.
    const focused: string[] = [];
    const { el } = windowWithRun(focused, { question: false });
    expect(askBeforeLeaving(el, () => focused.push("went"))).toBe(false);
    expect(leavingIsBeingAsked()).toBe(false);
  });

  test("showing it neither swaps the content target nor fires the run's cleanup", () => {
    // A question fetched into the content region would fire the cleanup it exists to ask about,
    // since the region rule releases whatever that content started: asking would cancel the run.
    const done: string[] = [];
    const watched = <T extends object>(name: string, node: T) =>
      new Proxy(node, {
        get: (target, key) => {
          if (key !== "querySelector" && key !== "childNodes")
            done.push(`read:${name}.${String(key)}`);
          return Reflect.get(target, key);
        },
        set: (target, key, value) => {
          done.push(`write:${name}.${String(key)}=${String(value)}`);
          return Reflect.set(target, key, value);
        },
      }) as T;

    const focused: string[] = [];
    const held = windowWithRun(focused);
    const run = {
      getAttribute: () => "build-7",
      querySelector: (selector: string) => {
        const found = held.run.querySelector(selector);
        return found === null ? null : watched(selector, found);
      },
    };
    expect(askBeforeLeaving({ querySelector: () => run }, () => done.push("navigated"))).toBe(true);
    expect(done).toEqual([
      "write:.build-stream__cancel.hidden=true",
      "write:[data-run-leaving].hidden=false",
    ]);
    // And backing out is the same two writes the other way, plus the focus the control
    // takes back. Nothing in either direction reaches the region, the run or the wire.
    done.length = 0;
    backOutOfLeaving();
    expect(done).toEqual([
      "write:.build-stream__cancel.hidden=false",
      "write:[data-run-leaving].hidden=true",
      "read:.build-stream__cancel.focus",
    ]);
  });

  test("the run itself is left running while the question stands", () => {
    // Asking is not stopping: the stream stays open and the work goes on, so a question left
    // standing, or backed out of, costs nothing at all.
    const focused: string[] = [];
    const posted: string[] = [];
    const held = windowWithRun(focused);
    askBeforeLeaving(held.el, () => focused.push("navigated"));
    // The run is still the run the window is narrating, by the same test every other rule
    // in the desk asks.
    expect(buildJobIdIn(held.el)).toBe("build-7");
    expect(posted).toEqual([]);
    expect(focused).toEqual(["keep going"]);
    backOutOfLeaving();
    expect(buildJobIdIn(held.el)).toBe("build-7");
  });

  test("a run that has committed is not asked about either", () => {
    // The commit lands one event before the stream closes, and the stylesheet has taken the
    // question off the page by then, so one raised in that gap holds a navigation invisibly.
    const focused: string[] = [];
    const held = windowWithRun(focused, { committed: true });
    expect(buildJobIdIn(held.el)).toBeNull();
    expect(askBeforeLeaving(held.el, () => focused.push("navigated"))).toBe(false);
  });
});

describe("either answer, and what it leaves standing", () => {
  test("a desk with nothing running is not asked anything at all", () => {
    const focused: string[] = [];
    expect(askBeforeLeaving(bareWindow, () => focused.push("went"))).toBe(false);
    expect(askBeforeLeaving(null, () => focused.push("went"))).toBe(false);
    // The caller goes ahead itself, so putting an idle window away is still silent.
    expect(focused).toEqual([]);
    expect(leavingIsBeingAsked()).toBe(false);
  });

  test("backing out leaves the run running and the navigation undone", () => {
    const focused: string[] = [];
    const went: string[] = [];
    const held = windowWithRun(focused);

    expect(askBeforeLeaving(held.el, () => went.push("left"))).toBe(true);
    expect(leavingIsBeingAsked()).toBe(true);
    expect(held.warning.hidden).toBe(false);
    expect(held.control.hidden).toBe(true);
    expect(focused).toEqual(["keep going"]);

    expect(backOutOfLeaving()).toBe(true);
    // Nothing was cancelled and nothing was navigated.
    expect(went).toEqual([]);
    expect(held.warning.hidden).toBe(true);
    expect(held.control.hidden).toBe(false);
    expect(focused).toEqual(["keep going", "cancel"]);
    expect(leavingIsBeingAsked()).toBe(false);
    expect(backOutOfLeaving()).toBe(false);
  });

  test("confirming ends the run once, and only then does what was asked", () => {
    const focused: string[] = [];
    const order: string[] = [];
    const held = windowWithRun(focused);
    expect(askBeforeLeaving(held.el, () => order.push("navigated"))).toBe(true);

    const promptField = node("the prompt bar", focused);
    expect(
      goAheadAndLeave(
        { activeElement: null, body: null, getElementById: () => promptField },
        {
          post: (url) => order.push(`cancel:${url}`),
          release: () => order.push("release"),
          api: { swap: () => order.push("detach") },
        },
      ),
    ).toBe(true);
    // The run is over before the navigation happens, so the restoration a cancelled run
    // streams back can never be painted into the window the person has left.
    expect(order).toEqual(["cancel:/build/build-7/cancel", "release", "detach", "navigated"]);
    expect(leavingIsBeingAsked()).toBe(false);
    // A confirmed navigation usually takes its own focus with it; where it did not, the
    // answer the person pressed has gone with the run, so focus lands on the prompt bar.
    expect(focused).toEqual(["keep going", "the prompt bar"]);
    expect(goAheadAndLeave({ activeElement: null, body: null })).toBe(false);
  });

  // A run whose story cannot be detached cannot be ended, so the confirmed navigation must not
  // happen — and must not leave the question standing with both answers inert either.
  test("a leave that cannot be carried out takes the question down and says so", () => {
    const focused: string[] = [];
    const went: string[] = [];
    const said: string[] = [];
    const held = windowWithRun(focused);
    expect(askBeforeLeaving(held.el, () => went.push("navigated"))).toBe(true);

    // No `api.swap`, so the story cannot be detached and the run cannot end.
    expect(
      goAheadAndLeave(
        { activeElement: null, body: null },
        {
          post: () => {},
          release: () => {},
          // An `api` with no `swap`: htmx is there, and the story still cannot be detached.
          api: {},
          say: (sentence) => said.push(sentence),
        },
      ),
    ).toBe(false);

    expect(went).toEqual([]);
    // Nothing is being asked any more, so nothing is left on screen asking it.
    expect(held.warning.hidden).toBe(true);
    expect(held.control.hidden).toBe(false);
    expect(leavingIsBeingAsked()).toBe(false);
    expect(said).toEqual([LEAVING_A_RUN_UNAVAILABLE]);
  });

  test("a navigation whose continuation kept focus is left alone", () => {
    const focused: string[] = [];
    const held = windowWithRun(focused);
    askBeforeLeaving(held.el, () => {});
    const logo = { name: "the logo" };
    goAheadAndLeave(
      { activeElement: logo, body: null, getElementById: () => node("the prompt bar", focused) },
      { post: () => {}, release: () => {}, api: { swap: () => {} } },
    );
    expect(focused).toEqual(["keep going"]);
  });

  test("one question at a time, and a second navigation is dropped rather than queued", () => {
    const focused: string[] = [];
    const went: string[] = [];
    const held = windowWithRun(focused);
    expect(askBeforeLeaving(held.el, () => went.push("first"))).toBe(true);
    // Held, and the second is not what confirming takes: the person is being asked one
    // thing, and answering it is what moves.
    expect(askBeforeLeaving(held.el, () => went.push("second"))).toBe(true);
    goAheadAndLeave(
      { activeElement: {}, body: null },
      { post: () => {}, release: () => {}, api: { swap: () => {} } },
    );
    expect(went).toEqual(["first"]);
  });

  test("a run that ends on its own takes the question with it", () => {
    // There is nothing left to lose and the person never said they were leaving, so the
    // navigation is dropped and they stay where they are.
    const focused: string[] = [];
    const went: string[] = [];
    const held = windowWithRun(focused);
    askBeforeLeaving(held.el, () => went.push("left"));

    expect(standDownWith({ some: "other run" })).toBe(false);
    expect(leavingIsBeingAsked()).toBe(true);
    expect(standDownWith(held.run)).toBe(true);
    expect(went).toEqual([]);
    expect(held.warning.hidden).toBe(true);
    expect(held.control.hidden).toBe(false);
    expect(leavingIsBeingAsked()).toBe(false);
  });
});

describe("what answers the question", () => {
  /** A document, as much of one as the wiring under test actually touches. */
  function guardedRoot(focused: string[]) {
    const listeners = new Map<string, (event: unknown) => void>();
    const root = {
      addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
      activeElement: {},
      body: null,
      getElementById: () => node("the prompt bar", focused),
    };
    startLeavingGuard(root as never);
    return { root, listeners };
  }

  test("a press on either answer, Escape, and the run ending are all wired", () => {
    // Every primitive above is reachable only through these four listeners, so without
    // this the whole subject is a set of functions nothing calls.
    const focused: string[] = [];
    const { listeners } = guardedRoot(focused);
    expect([...listeners.keys()].sort()).toEqual(["click", "htmx:sseClose", "keydown"]);

    const held = windowWithRun(focused);
    /** A press that landed on one of the question's answers, and on nothing else. */
    const pressOn = (answer: string | null) => ({
      target: { closest: (selector: string) => (selector === answer ? {} : null) },
    });

    // Escape backs out.
    askBeforeLeaving(held.el, () => focused.push("navigated"));
    listeners.get("keydown")?.({ key: "Escape" });
    expect(leavingIsBeingAsked()).toBe(false);
    expect(focused).toEqual(["keep going", "cancel"]);
    // And any other key is not an answer to anything.
    askBeforeLeaving(held.el, () => focused.push("navigated"));
    listeners.get("keydown")?.({ key: "Enter" });
    expect(leavingIsBeingAsked()).toBe(true);

    // The back-out answer.
    listeners.get("click")?.(pressOn(LEAVING_BACK_SELECTOR));
    expect(leavingIsBeingAsked()).toBe(false);
    // A press on neither answer is not an answer either.
    askBeforeLeaving(held.el, () => focused.push("navigated"));
    listeners.get("click")?.(pressOn(".capability-item"));
    expect(leavingIsBeingAsked()).toBe(true);
    backOutOfLeaving();

    // The run ending underneath the question voids it, matched by the run the question is
    // about and by no other.
    askBeforeLeaving(held.el, () => focused.push("navigated"));
    listeners.get("htmx:sseClose")?.({ target: { closest: () => ({ some: "other run" }) } });
    expect(leavingIsBeingAsked()).toBe(true);
    listeners.get("htmx:sseClose")?.({ target: { closest: () => held.run } });
    expect(leavingIsBeingAsked()).toBe(false);
    expect(focused).not.toContain("navigated");
  });

  test("a second start puts no second answer behind a press", () => {
    // The listeners are fresh closures that `addEventListener` cannot dedupe, and the
    // question they answer is module state shared by every root.
    const focused: string[] = [];
    const first = guardedRoot(focused);
    const wired: string[] = [];
    const again = { ...first.root, addEventListener: (type: string) => wired.push(type) };
    startLeavingGuard(again as never);
    expect(wired.length).toBe(3);
    // The same root again wires nothing more.
    startLeavingGuard(again as never);
    startLeavingGuard(first.root as never);
    expect(wired.length).toBe(3);
  });

  test("one press answers one question", async () => {
    // A run covers the collection without removing it, so a standing delete confirmation can sit
    // behind the leaving question. Escape means the one on screen, not both.
    const templateId = "record-notes-note-1";
    const desk = await recordDesk(
      renderCollection({
        capability: CAPABILITY,
        items:
          renderItemWrapper("<span>note</span>", RECORD, { templateId }) +
          renderRecordViewTemplate(templateId, CAPABILITY, RECORD),
      }),
      {
        capabilityId: CAPABILITY.id,
        modules: ["records/record-view.js", "records/record-mutations.js"],
      },
    );
    try {
      desk.press(desk.doc.getElementById(itemElementIdForTemplate(templateId)) as El);
      await desk.settled();
      const asks = desk.doc.querySelectorAll("button").find((b) => b.textContent === "Delete");
      desk.press(asks as El);
      const question = desk.doc.querySelector("form[data-record-delete-form]") as El;
      expect(askBeforeLeaving(windowWithRun([]).el, () => {})).toBe(true);
      desk.doc.fire("keydown", desk.doc, { key: "Escape" });
      expect(question.hidden).toBe(false);
      backOutOfLeaving();
      desk.doc.fire("keydown", desk.doc, { key: "Escape" });
      expect(question.hidden).toBe(true);
    } finally {
      backOutOfLeaving();
      desk.restore();
    }
  });
});
