import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  applyLeavingQuestion,
  askBeforeLeaving,
  backOutOfLeaving,
  buildCancelUrl,
  buildJobIdIn,
  endTheRun,
  goAheadAndLeave,
  LEAVING_BACK_SELECTOR,
  LEAVING_GO_SELECTOR,
  LEAVING_WARNING_SELECTOR,
  leavingIsBeingAsked,
  PROMPT_FIELD_ID,
  standDownWith,
  startLeavingGuard,
} from "#shell/leaving-a-run.js";
import {
  LEAVING_A_RUN_BACK_OUT,
  LEAVING_A_RUN_GO_AHEAD,
  LEAVING_A_RUN_QUESTION,
  RUN_LEAVING_ATTRIBUTE,
  RUN_LEAVING_BACK_ATTRIBUTE,
  RUN_LEAVING_GO_ATTRIBUTE,
  renderBuildSubscriber,
} from "../web/fragments.ts";
import { code as stripComments } from "./source.test-support.ts";

// Leaving a live build or evolution warns first, and confirming ends it once (PLAN
// decision 17, amending design D3). Every rule here is written against the DOM facts it
// actually needs, so the whole subject runs in Bun against plain objects — which is what
// lets the order an ending owes, and the question's effect on the region, be *proved*
// rather than read off the source.

const ROOT = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const code = (path: string) => stripComments(read(path));

const MODULE = code("public/leaving-a-run.js");
const WINDOW = code("public/desk-window.js");

/** One control or answer, as much of one as the rules under test actually touch. */
function node(name: string, focused: string[]) {
  return { name, hidden: false, focus: () => focused.push(name) };
}

/**
 * A window holding one run: its subscriber, the run's own control, the question that
 * ships hidden beside it, and its two answers.
 */
function windowWithRun(
  focused: string[],
  { ending = false, question = true, committed = false } = {},
) {
  const back = node("keep going", focused);
  const warning = {
    ...node("question", focused),
    hidden: true,
    querySelector: (selector: string) => (selector === LEAVING_BACK_SELECTOR ? back : null),
  };
  const control = node("cancel", focused);
  const inside: Record<string, (ReturnType<typeof node> & { childNodes?: unknown[] }) | null> = {
    "[data-build-ending]": ending ? node("ending", focused) : null,
    ".build-stream__commit": { ...node("commit", focused), childNodes: committed ? [{}] : [] },
    ".build-stream__cancel": control,
    [LEAVING_WARNING_SELECTOR]: question ? warning : null,
  };
  const run = {
    getAttribute: () => "build-7",
    querySelector: (selector: string) => inside[selector] ?? null,
  };
  return {
    el: {
      querySelector: (selector: string) => (selector === "[data-build-job-id]" ? run : null),
    },
    run,
    control,
    warning,
    back,
  };
}

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
    // A run that already ended and is only waiting to be read is not being narrated.
    // Cancelling it would post to a job the queue deleted, and the question would ask
    // about losing a build that finished minutes ago.
    expect(buildJobIdIn(windowWithRun(focused, { ending: true }).el)).toBeNull();
  });

  test("the ending owes three things, in one order", () => {
    // The cancel first, so the server stops. The release while the story is still
    // connected, because that is the only moment a request under it can be aborted. The
    // detach last, through htmx, because that is what closes the stream — and a stream
    // still open is a restoration still able to land in a window the person has left.
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
    // No way to take the story down stops the whole thing *before* the cancel. Ending a
    // run halfway — stopped on the server, still narrating on screen — is the worst of the
    // three outcomes, and the one that would send a navigation on top of a run still
    // standing there to be asked about again.
    expect(endTheRun({ ...ending, detach: null })).toBe(false);
    expect(order).toEqual([]);
  });

  test("the story is taken down through htmx, never detached in silence", () => {
    // `remove` is `removeChild` and runs no cleanup at all, so the SSE extension would
    // be left holding an open `EventSource` for a run that is nowhere — and the
    // `htmx:sseClose` that unlocks the prompt bar and takes the build's tile down would
    // never reach the document.
    expect(MODULE).toContain('swapStyle: "outerHTML"');
    expect(MODULE).not.toMatch(/\.remove\(\)/);
    expect(MODULE).toContain('fetch(url, { method: "POST", keepalive: true })');
    // One cancel route, reached one way. A second `fetch` here would be a second way a
    // run ends, which is the whole thing this module exists to prevent.
    expect(MODULE.match(/fetch\(/g)).toHaveLength(1);
    expect(MODULE.match(/buildCancelUrl\(/g)).toHaveLength(1);
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
    // The load-bearing property, and proved rather than grepped for: a question fetched
    // into the content region, or one that replaced the run's surface, would fire the very
    // cleanup it exists to ask about — the region rule releases whatever a region's content
    // started the moment that content is replaced (`region-scope.js`), so *asking* would
    // cancel the run. So the complete set of things asking does is recorded, and it has to
    // be two `hidden` writes and one focus.
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
    // Asking is not stopping. Nothing about the run is touched — the stream stays open,
    // the story keeps arriving, and the work goes on — so a question the person leaves
    // standing, or backs out of, costs them nothing at all.
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
    // The commit lands one event before the stream closes, and the stylesheet has already
    // taken the question out of the page with the rest of the story by then. A question
    // raised in that gap is one nobody can see, holding a navigation nobody can answer.
    const focused: string[] = [];
    const held = windowWithRun(focused, { committed: true });
    expect(buildJobIdIn(held.el)).toBeNull();
    expect(askBeforeLeaving(held.el, () => focused.push("navigated"))).toBe(false);
  });

  test("no draft persistence and no dirty-form tracker came with it", () => {
    // 5.6/03's contract is explicit: search, record subviews and half-typed forms are
    // DOM-only and die with the window. The question is scoped to a running build or an
    // evolution and to nothing else.
    for (const path of ["public/leaving-a-run.js", "public/desk-address.js"]) {
      const source = code(path);
      for (const store of ["localStorage", "sessionStorage", "beforeunload", "onbeforeunload"]) {
        expect(source, `${path} must not reach for ${store}`).not.toContain(store);
      }
    }
    // The one thing the desk does write down is still the one thing it wrote down before.
    expect(code("public/desk-window-store.js")).toContain(
      'export const WINDOW_STORAGE_KEY = "aluna.desk.window.v1";',
    );
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
    // There is nothing left to lose, and the person never said they were leaving — so
    // the navigation is dropped and they are left where they are, with whatever the run
    // has to tell them.
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

  test("one press answers one question", () => {
    // A run covers the collection without removing it, so a record view with a standing
    // delete confirmation can be sitting behind the question a navigation is asking. That
    // one is on screen and is the one Escape means; answering both with a single press
    // would close a question the person never saw.
    const mutations = code("public/record-mutations.js");
    expect(mutations).toContain('if (event.key !== "Escape") return;');
    expect(mutations).toMatch(
      /if \(event\.key !== "Escape"\) return;\s*if \(leavingIsBeingAsked\(\)\) return;/,
    );
  });
});

describe("the shell and the server agree on the question", () => {
  const subscriber = renderBuildSubscriber("build-7");

  test("the row ships with the run, hidden, inside the run's own surface", () => {
    // It cannot be fetched when it is wanted: the swap that delivered it would be the
    // teardown it exists to ask about. So it is already there, and the desk stops hiding
    // it — the shape the record form's deletion confirmation has, for the same reason.
    expect(subscriber).toContain(`${RUN_LEAVING_ATTRIBUTE} hidden>`);
    expect(subscriber).toContain('<div class="build-stream__leaving-panel">');
    expect(subscriber.indexOf(RUN_LEAVING_ATTRIBUTE)).toBeGreaterThan(
      subscriber.indexOf("build-stream__cancel"),
    );
    expect(subscriber.indexOf(RUN_LEAVING_ATTRIBUTE)).toBeLessThan(
      subscriber.indexOf("</section>"),
    );
  });

  test("it says the cost and the reassurance, and names both answers from the person's side", () => {
    expect(LEAVING_A_RUN_QUESTION).toBe(
      "If you leave now, I’ll stop making this. Nothing you already have will change.",
    );
    // Design D3 still holds: nothing that is true changes. And no internals leak —
    // no "build", no "job", no "cancel" (ARCH §9.7).
    for (const leak of ["build", "job", "cancel", "stream", "server"]) {
      expect(LEAVING_A_RUN_QUESTION.toLowerCase(), `"${leak}" leaks`).not.toContain(leak);
    }
    // Both answers name their object. "Keep going" alone reads as *yes, go on with what I
    // asked* — the destructive reading, on the answer focus lands on.
    expect(LEAVING_A_RUN_BACK_OUT).toBe("Keep making it");
    expect(LEAVING_A_RUN_GO_AHEAD).toBe("Stop and leave");
    // The safe answer stands first and is the one focus lands on.
    expect(subscriber.indexOf(RUN_LEAVING_BACK_ATTRIBUTE)).toBeLessThan(
      subscriber.indexOf(RUN_LEAVING_GO_ATTRIBUTE),
    );
    // Signal is reserved for destructive confirmation, and leaving destroys nothing.
    expect(subscriber).not.toContain("btn--danger");
  });

  test("the question and both answers are described by the copy that explains them", () => {
    const questionId = "build-stream-leaving-build-7";
    expect(subscriber).toContain(`<p id="${questionId}">`);
    // On the two answers and nowhere else. A `group` with no accessible name is ignored by
    // assistive technology, so a description hung on the panel would be read by nobody.
    expect(subscriber.match(new RegExp(`aria-describedby="${questionId}"`, "g"))).toHaveLength(2);
    expect(subscriber).not.toContain('class="build-stream__leaving-panel" role=');
    // Keyed by the run, like the control beside it: two ids the same would let one run's
    // question describe the other's.
    expect(renderBuildSubscriber("build-9")).toContain("build-stream-leaving-build-9");
  });

  test("the shell finds it by the marks the server writes", () => {
    expect(LEAVING_WARNING_SELECTOR).toBe(`[${RUN_LEAVING_ATTRIBUTE}]`);
    expect(LEAVING_BACK_SELECTOR).toBe(`[${RUN_LEAVING_BACK_ATTRIBUTE}]`);
    expect(LEAVING_GO_SELECTOR).toBe(`[${RUN_LEAVING_GO_ATTRIBUTE}]`);
    // And on where a confirmed navigation puts a person it has nowhere better to put.
    expect(read("public/index.html")).toContain(`id="${PROMPT_FIELD_ID}"`);
    expect(code("public/app.js")).toContain(`const PROMPT_FIELD_ID = "${PROMPT_FIELD_ID}";`);
  });

  test("it is read over the window it is about, and no further", () => {
    const css = read("public/css/demo.css");
    // The ground it covers is the window's own body — already positioned, and outside the
    // scroller, so the veil fills the window to its own edges and holds still while the
    // narration behind it goes on. Nothing here reaches past the window.
    expect(css).toMatch(/\.build-stream__leaving \{[^}]*position: absolute;[^}]*inset: 0;/);
    expect(read("design/styles/components/window.css")).toMatch(
      /\.window__body \{[^}]*position: relative;/,
    );
    // A veil is ink over the surface, not surface over the surface.
    expect(css).toMatch(
      /\.build-stream__leaving \{[\s\S]*?background: color-mix\(in srgb, var\(--ink\) \d+%, transparent\);/,
    );
    for (const desk of [".shell", ".desk__logos", ".prompt", "position: fixed"]) {
      const scoped = /\.build-stream__leaving[\s\S]*?\n\}/.exec(css)?.[0] ?? "";
      expect(scoped, `the question must not reach ${desk}`).not.toContain(desk);
    }
    // The state boundary is the `hidden` attribute, and it has to be stated: `.btn`'s own
    // `inline-flex` would otherwise keep the control on beside the question it replaced.
    expect(css).toMatch(
      /\.build-stream > \.build-stream__cancel\[hidden\],\s*\.build-stream > \.build-stream__leaving\[hidden\] \{\s*display: none;/,
    );
    // And it goes with the story once a capability's own surface lands.
    expect(css).toContain(
      ".build-stream:has(.build-stream__commit:not(:empty)) .build-stream__leaving",
    );
  });

  test("the box it is read in is drawn, like every other box in the window", () => {
    // It declares its border and the ink system takes it over, and it hands its shadow
    // over rather than declaring one — a true rectangle of shadow beside a drawn edge is
    // the one part that would show (`design/styles/components/ink.css`).
    expect(code("public/ink.js")).toContain('".build-stream__leaving-panel"');
    const css = read("public/css/demo.css");
    expect(css).toMatch(
      /\.build-stream__leaving-panel \{[\s\S]*?--ink-shadow: var\(--shadow-window\);/,
    );
    expect(css).toMatch(
      /\.build-stream__leaving-panel \{[\s\S]*?border: var\(--line\) solid var\(--ink-hair\);/,
    );
    // Tokens only — no invented values in a sheet the design system owns the scale for.
    const panel = /\.build-stream__leaving-panel \{[\s\S]*?\n\}/.exec(css)?.[0] ?? "";
    expect(panel).not.toMatch(/:\s*#[0-9a-f]{3,8}/i);
    expect(panel).not.toMatch(/:\s*\d+px/);
  });

  test("it is read over the run's own window and takes nothing else away", () => {
    // It is a confirmation read over the window it is about, which is a treatment the
    // desk had no precedent for and the product owner asked for directly. What keeps it
    // from being the modal PLAN 17 and design D2 rule out is what it does *not* do:
    // nothing is opened over the desk, nothing outside the window is covered or made
    // inert, focus is not trapped, and the whole of it is markup the run already carries.
    const subscriber = renderBuildSubscriber("build-7");
    expect(subscriber).not.toContain("<dialog");
    expect(subscriber).not.toContain("aria-modal");
    expect(MODULE).not.toContain("showModal");
    expect(MODULE).not.toContain("inert");
    // The desk stays reachable and the lamps stay pressable: the veil is inside the
    // window's body, which begins below the title bar.
    const css = read("public/css/demo.css");
    const veil = /\.build-stream__leaving \{[\s\S]*?\n\}/.exec(css)?.[0] ?? "";
    expect(veil, "no `.build-stream__leaving` rule").not.toBe("");
    expect(veil).not.toContain("position: fixed");
    for (const beyond of [".shell", ".desk__logos", ".prompt", ".window__bar", "body"]) {
      expect(veil, `the question must not reach ${beyond}`).not.toContain(beyond);
    }
    // And it is the run's own markup: nothing is fetched, and nothing new is mounted.
    expect(MODULE).not.toContain("createElement");
    expect(MODULE).not.toContain("insertAdjacentHTML");
  });
});

describe("the three navigations that ask", () => {
  test("the clay lamp asks, and does exactly the same thing on a yes", () => {
    expect(WINDOW).toMatch(/if \(!askBeforeLeaving\(entry\.el,\s*away\)\)\s*away\(\);/);
  });

  test("a logo switch asks, and a yes is the press the person already made", () => {
    // Replaying the click is what makes a confirmed switch and an ordinary press
    // literally the same press: the desk stands the window up and writes the address,
    // and htmx turns the same click into the request that fills it.
    expect(WINDOW).toMatch(
      /if \(askBeforeLeaving\(mounted\?\.el \?\? null,\s*\(\) => pressAgain\(logo\)\)\)\s*return;/,
    );
    expect(WINDOW).toMatch(
      /function pressAgain\(logo\) \{\s*if \(logo instanceof HTMLElement\) logo\.click\(\);/,
    );
    // A confirmed switch onto the capability the run displaced — an evolution's own logo,
    // the ordinary case — replays as a press that opens nothing, because the collection is
    // already uncovered. Nothing swaps, so nothing else would put the title back.
    expect(WINDOW).toMatch(/releaseWindowName\(\);\s*if \(mounted\) raise\(mounted\);/);
    // htmx's own half of the press is declined for as long as the question stands.
    expect(WINDOW).toContain(
      "if (!pressWouldOpen(elt, settledCapabilityInWindow(mounted)) || leavingIsBeingAsked()) {",
    );
  });

  test("Back and Forward ask, through the same one question", () => {
    expect(WINDOW).toMatch(/hold: \(go\) => askBeforeLeaving\(mounted\?\.el \?\? null, go\),/);
  });

  test("putting the window away ends its run the one way a run ends", () => {
    // The backstop, and the same ending every other way out of a run uses rather than a
    // second sequence assembled in the window's own module. Nothing reaches it with a run
    // still going any more — every navigation asks first — but a window that somehow goes
    // away over one may never leave the server making something nobody can see.
    expect(WINDOW).toMatch(/export function putAway\(\) \{[\s\S]*?endRunIn\(entry\.el\);/);
    expect(WINDOW).not.toContain("cancelBuildIn");
    expect(WINDOW).not.toContain("fetch(");
  });

  test("confirming navigates only where the run actually ended", () => {
    // A detach that could not run leaves the run standing with its job id intact, and
    // continuing would re-enter the question with the same continuation: one more cancel
    // posted and one more question asked, for as long as the person kept saying yes.
    const focused: string[] = [];
    const went: string[] = [];
    const held = windowWithRun(focused);
    askBeforeLeaving(held.el, () => went.push("left"));
    expect(
      goAheadAndLeave(
        { activeElement: {}, body: null },
        { post: () => {}, release: () => {}, api: {} },
      ),
    ).toBe(false);
    expect(went).toEqual([]);
    expect(leavingIsBeingAsked()).toBe(false);
  });

  test("the provisional tile is not one of them", () => {
    // Pressing the tile of the build that is running only brings its narration back into
    // view (`desk-logos.js`); it takes nothing away, so it is owed no question. It
    // carries none of the capability-logo marking the press rule keys off, which is what
    // keeps it out of this by construction (PLAN decision 3).
    const tile = /function renderProvisionalLogo\([\s\S]*?\n\}/.exec(read("src/web/fragments.ts"));
    expect(tile?.[0], "no `renderProvisionalLogo`").toBeDefined();
    expect(tile?.[0]).not.toContain("data-capability-logo");
    expect(code("public/desk-logos.js")).toContain("revealBuildNarration(root, buildId)");
  });

  test("delete is a refusal, not this question", () => {
    // A desk action that would take the window while a run is using it is refused on the
    // prompt bar and the run stays mounted (5.8/03, and 5.9/02's preflight). Opening a
    // capability is the one exemption, because it is a navigation — and what a
    // navigation owes the run it walks away from is this question, not a refusal.
    const glue = code("public/app.js");
    expect(glue).toContain("if (takingTheWindow && !openingACapability && runIsUsingTheWindow())");
    expect(glue).toContain("tellThePromptBar(DESK_ACTION_REFUSAL, true, true)");
    // And nothing in the glue reaches for the question: the two are separate answers to
    // two different asks.
    expect(glue).not.toContain("askBeforeLeaving");
    expect(glue).not.toContain(RUN_LEAVING_ATTRIBUTE);
  });
});
