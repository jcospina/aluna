// The other half of `leaving-a-run.test.ts`: the copies the shell and the server keep of
// each other's marks, and the three navigations that ask before they take a run away.
// Split out when the one file grew past what a file should hold.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  askBeforeLeaving,
  goAheadAndLeave,
  LEAVING_BACK_SELECTOR,
  LEAVING_GO_SELECTOR,
  LEAVING_WARNING_SELECTOR,
  leavingIsBeingAsked,
  PROMPT_FIELD_ID,
} from "#shell/leaving-a-run.js";
import {
  LEAVING_A_RUN_BACK_OUT,
  LEAVING_A_RUN_GO_AHEAD,
  LEAVING_A_RUN_QUESTION,
  RUN_LEAVING_ATTRIBUTE,
  RUN_LEAVING_BACK_ATTRIBUTE,
  RUN_LEAVING_GO_ATTRIBUTE,
  renderBuildSubscriber,
} from "../../server/http/fragments.ts";
import { code as stripComments } from "../safety/source.test-support.ts";

// The wiring behind leaving a live build or evolution (PLAN decision 17, amending design D3):
// the markup the run already carries, the desk's press rules, and the one backstop ending.

const ROOT = resolve(import.meta.dir, "../../..");
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

describe("the shell and the server agree on the question", () => {
  const subscriber = renderBuildSubscriber("build-7");

  test("the row ships with the run, hidden, inside the run's own surface", () => {
    // It cannot be fetched when it is wanted: the swap delivering it would be the teardown it
    // exists to ask about. So it is already there and the desk stops hiding it.
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
    // The ground it covers is the window's own body, already positioned and outside the scroller,
    // so the veil fills the window to its edges and nothing here reaches past it.
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
    // It declares its border and the ink system takes it over, and hands its shadow over too: a
    // true rectangle of shadow beside a drawn edge is the one part that would show.
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
    // A confirmation read over the window it is about. What keeps it from being the modal PLAN 17
    // rules out: nothing outside the window is covered or made inert, and focus is not trapped.
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
    // Replaying the click is what makes a confirmed switch and an ordinary press the same press:
    // the desk stands the window up and htmx turns the same click into the request.
    expect(WINDOW).toMatch(
      /if \(askBeforeLeaving\(mounted\?\.el \?\? null,\s*\(\) => pressAgain\(logo\)\)\)\s*return;/,
    );
    expect(WINDOW).toMatch(
      /function pressAgain\(logo\) \{\s*if \(logo instanceof HTMLElement\) logo\.click\(\);/,
    );
    // A confirmed switch onto the capability the run displaced replays as a press that opens
    // nothing, because the collection is already uncovered and nothing swaps.
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
    // The backstop, and the same ending every other way out of a run uses. A window that somehow
    // goes away over a run may never leave the server making something nobody can see.
    expect(WINDOW).toMatch(/export function putAway\(\) \{[\s\S]*?endRunIn\(entry\.el\);/);
    expect(WINDOW).not.toContain("cancelBuildIn");
    expect(WINDOW).not.toContain("fetch(");
  });

  test("confirming navigates only where the run actually ended", () => {
    // A detach that could not run leaves the run standing with its job id intact, and continuing
    // would re-enter the question: one more cancel posted for as long as they said yes.
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
    // Pressing the tile of the running build only brings its narration back into view, so it is
    // owed no question. It carries none of the marking the press rule keys off (PLAN decision 3).
    const tile = /function renderProvisionalLogo\([\s\S]*?\n\}/.exec(
      read("src/server/http/fragments.ts"),
    );
    expect(tile?.[0], "no `renderProvisionalLogo`").toBeDefined();
    expect(tile?.[0]).not.toContain("data-capability-logo");
    expect(code("public/desk-logos.js")).toContain("revealBuildNarration(root, buildId)");
  });

  test("delete is a refusal, not this question", () => {
    // A desk action that would take the window while a run is using it is refused on the prompt
    // bar (5.8/03). Opening a capability is exempt: a navigation owes the question, not a refusal.
    const glue = code("public/app.js");
    expect(glue).toContain("if (takingTheWindow && !openingACapability && runIsUsingTheWindow())");
    expect(glue).toContain("tellThePromptBar(DESK_ACTION_REFUSAL, true, true)");
    // And nothing in the glue reaches for the question: the two are separate answers to
    // two different asks.
    expect(glue).not.toContain("askBeforeLeaving");
    expect(glue).not.toContain(RUN_LEAVING_ATTRIBUTE);
  });
});
