// The other half of `leaving-a-run.test.ts`: the copies the shell and the server keep of
// each other's marks, and the three navigations that ask before they take a run away.
// Split out when the one file grew past what a file should hold.

import { afterEach, describe, expect, test } from "bun:test";

import { DESK_HISTORY_STATE } from "#shell/desk-address.js";
import {
  CAPABILITY_LOGO_SELECTOR,
  capabilityAddress,
  DESK_ADDRESS,
  THINKING_WINDOW_TITLE,
} from "#shell/desk-window.js";

import {
  askBeforeLeaving,
  backOutOfLeaving,
  buildCancelUrl,
  goAheadAndLeave,
  leavingIsBeingAsked,
  PROMPT_FIELD_ID,
} from "#shell/leaving-a-run.js";
import { CONTENT_REGION_SELECTOR } from "#shell/region-scope.js";
import {
  LEAVING_A_RUN_BACK_OUT,
  LEAVING_A_RUN_GO_AHEAD,
  LEAVING_A_RUN_QUESTION,
  RUN_LEAVING_ATTRIBUTE,
  RUN_LEAVING_BACK_ATTRIBUTE,
  RUN_LEAVING_GO_ATTRIBUTE,
  renderBuildSubscriber,
  renderCapabilitySurface,
  renderProvisionalLogo,
} from "../../server/http/fragments.ts";
import { byId, elementsOf } from "../../server/http/served-page.test-support.ts";
import { El, parseHtml } from "../controls/choice-picker.test-support.ts";
import { readSource as read } from "../safety/source.test-support.ts";
import { type El as DeskEl, pressLamp } from "../shell/window/standing-desk.test-support.ts";
import { deskNodes, serverLogo, viewportDesk } from "../shell/window/viewport-desk.test-support.ts";
import { windowWithRun } from "./leaving-a-run.test-support.ts";

// The wiring behind leaving a live build or evolution (PLAN decision 17, amending design D3):
// the markup the run already carries, the desk's press rules, and the one backstop ending.

/** One run's surface as the server streams it, parsed, with the parts the question is made of. */
function subscriberParts(jobId = "build-7") {
  const win = parseHtml(renderBuildSubscriber(jobId), new El("div"));
  const part = (attribute: string) => win.querySelector(`[${attribute}]`) as El;
  return {
    win,
    section: win.querySelector("section") as El,
    warning: part(RUN_LEAVING_ATTRIBUTE),
    back: part(RUN_LEAVING_BACK_ATTRIBUTE),
    go: part(RUN_LEAVING_GO_ATTRIBUTE),
    cancel: win.querySelectorAll("button").find((b) => b.textContent.trim() === "Cancel") as El,
  };
}

/** Whether `first` stands before `second` in document order under `root`. */
const inOrder = (root: El, first: El, second: El) => {
  const all = [...root.descendants()];
  return all.indexOf(first) < all.indexOf(second);
};

describe("the shell and the server agree on the question", () => {
  const subscriber = renderBuildSubscriber("build-7");

  test("the row ships with the run, hidden, inside the run's own surface", () => {
    // It cannot be fetched when it is wanted: the swap delivering it would be the teardown it
    // exists to ask about. So it is already there and the desk stops hiding it.
    const { section, warning, cancel } = subscriberParts();
    expect(warning.hidden).toBe(true);
    expect(section.contains(warning)).toBe(true);
    expect(inOrder(section, cancel, warning)).toBe(true);
  });

  test("it says the cost and the reassurance, and names both answers from the person's side", () => {
    // Design D3 still holds: nothing that is true changes. And no internals leak —
    // no "build", no "job", no "cancel" (ARCH §9.7).
    for (const leak of ["build", "job", "cancel", "stream", "server"]) {
      expect(LEAVING_A_RUN_QUESTION.toLowerCase(), `"${leak}" leaks`).not.toContain(leak);
    }
    // The safe answer stands first and is the one focus lands on, and both are said as written.
    const { warning, back, go } = subscriberParts();
    expect(warning.querySelector("p")?.textContent).toBe(LEAVING_A_RUN_QUESTION);
    expect(back.textContent.trim()).toBe(LEAVING_A_RUN_BACK_OUT);
    expect(go.textContent.trim()).toBe(LEAVING_A_RUN_GO_AHEAD);
    expect(inOrder(warning, back, go)).toBe(true);
    // Signal is reserved for destructive confirmation, and leaving destroys nothing.
    expect(subscriber).not.toContain("btn--danger");
  });

  test("the question and both answers stand on one drawn panel that claims no role", () => {
    // The panel is what the ink draws around and what the window's shadow falls from.
    const { warning, back, go } = subscriberParts();
    const panel = warning.querySelector(".build-stream__leaving-panel") as El;
    const question = warning.querySelector("p") as El;
    expect([question, back, go].map((part) => panel.contains(part))).toEqual([true, true, true]);
    expect(panel.hasAttribute("role")).toBe(false);
  });

  test("the question and both answers are described by the copy that explains them", () => {
    const { warning, back, go } = subscriberParts();
    const question = warning.querySelector("p") as El;
    // On the two answers and nowhere else. A `group` with no accessible name is ignored by
    // assistive technology, so a description hung on the panel would be read by nobody.
    const described = [...warning.descendants()].filter((node) =>
      node.hasAttribute("aria-describedby"),
    );
    expect(described).toEqual([back, go]);
    for (const answer of described)
      expect(answer.getAttribute("aria-describedby")).toBe(question.id);
    // Keyed by the run, like the control beside it: two ids the same would let one run's
    // question describe the other's.
    expect(subscriberParts("build-9").warning.querySelector("p")?.id).not.toBe(question.id);
  });

  test("the shell finds it by the marks the server writes", async () => {
    // Asked over the server's own markup: the desk shows the row, hides the control, and
    // lands the keyboard on the answer that keeps the run.
    const { section, warning, back, cancel } = subscriberParts();
    const focused: El[] = [];
    for (const node of [back, cancel]) node.focus = () => void focused.push(node);
    const went: string[] = [];
    expect(askBeforeLeaving(section.parent as never, () => went.push("gone"))).toBe(true);
    expect(warning.hidden).toBe(false);
    expect(cancel.hidden).toBe(true);
    expect(focused).toEqual([back]);
    expect(backOutOfLeaving()).toBe(true);
    expect(warning.hidden).toBe(true);
    expect(focused).toEqual([back, cancel]);
    expect(went).toEqual([]);
    // And where a confirmed navigation puts a person it has nowhere better to put is on the page.
    expect(byId(await elementsOf(read("public/index.html")), PROMPT_FIELD_ID).tag).toBe("input");
  });

  test("it is read over the run's own window and takes nothing else away", () => {
    // A confirmation read over the window it is about. What keeps it from being the modal PLAN 17
    // rules out: nothing outside the window is covered or made inert, and focus is not trapped.
    const subscriber = renderBuildSubscriber("build-7");
    expect(subscriber).not.toContain("<dialog");
    expect(subscriber).not.toContain("aria-modal");
  });
});

/**
 * A desk with Notes open and a run standing in its window, started the way the page starts. A run
 * `displacing` Notes was submitted over it, and narrates beside the collection it took the name of.
 */
async function runningDesk({ displacing = false } = {}) {
  const screen = await viewportDesk({
    logos: [serverLogo("notes", "Notes"), serverLogo("recipes", "Recipes")],
  });
  const logo = (name: string) =>
    screen.desk.root.querySelector(`[aria-label="Open ${name}"]`) as DeskEl;
  logo("Notes").click();
  const [frame] = screen.desk.windows();
  const region = frame?.querySelector(CONTENT_REGION_SELECTOR);
  if (displacing) {
    region?.append(
      ...deskNodes(renderCapabilitySurface({ id: "notes", incarnation_id: "i", version: 1 }, "")),
    );
    screen.desk.bar.dispatchEvent({ type: "submit", target: screen.desk.bar });
  }
  region?.append(...deskNodes(renderBuildSubscriber("build-7")));
  const part = (attribute: string) => frame?.querySelector(`[${attribute}]`) as DeskEl;
  const history = (
    (globalThis as unknown as { window: unknown }).window as {
      history: { go?: (by: number) => void };
    }
  ).history;
  history.go = (by) => void screen.desk.address.written.push(`go ${by}`);
  return {
    screen,
    frame: frame as DeskEl,
    logo,
    title: () => frame?.querySelector("h2")?.textContent,
    asked: () => (part(RUN_LEAVING_ATTRIBUTE) as unknown as { hidden?: boolean }).hidden === false,
    back: () => part(RUN_LEAVING_BACK_ATTRIBUTE).click(),
    /** A press on the yes: the button takes focus as the pointer lands, then clicks. */
    go: () => {
      const yes = part(RUN_LEAVING_GO_ATTRIBUTE);
      yes.focus();
      expect(yes.focused).toBe(true);
      yes.click();
    },
    /** Where the keyboard is now. */
    focus: () => screen.desk.doc.activeElement,
    /** Whether the run was stopped on the server and its story taken off the page. */
    ended: () =>
      screen.desk.sent.includes(`fetch ${buildCancelUrl("build-7")}`) &&
      screen.htmx.swaps.some(({ style }) => style === "outerHTML"),
  };
}

describe("the three navigations that ask", () => {
  let desk: Awaited<ReturnType<typeof runningDesk>> | undefined;
  afterEach(() => {
    backOutOfLeaving();
    desk?.screen.restore();
    desk = undefined;
  });

  test("the clay lamp asks, and does exactly the same thing on a yes", async () => {
    desk = await runningDesk();
    pressLamp(desk.frame, "putaway");
    expect(desk.asked()).toBe(true);
    expect(desk.screen.desk.windows()).toEqual([desk.frame]);

    desk.go();
    expect(desk.ended()).toBe(true);
    expect(desk.screen.desk.windows()).toEqual([]);
    expect(desk.screen.desk.address.written.at(-1)).toBe(`push ${DESK_ADDRESS}`);
    // Putting the window away hands focus back to what opened it, which the yes leaves alone.
    expect(desk.focus()).toBe(desk.logo("Notes"));
  });

  test("a logo switch asks, and a yes is the press the person already made", async () => {
    desk = await runningDesk();
    desk.logo("Recipes").click();
    expect(desk.asked()).toBe(true);
    expect(desk.title()).toBe("Notes");
    // htmx's own half of the press is declined for as long as the question stands.
    let declined = false;
    desk.screen.desk.doc.dispatchEvent({
      type: "htmx:beforeRequest",
      detail: { elt: desk.logo("Recipes") },
      preventDefault: () => {
        declined = true;
      },
    } as never);
    expect(declined).toBe(true);

    desk.go();
    expect(desk.ended()).toBe(true);
    expect(desk.title()).toBe("Recipes");
    expect(desk.screen.desk.address.written.at(-1)).toBe(`push ${capabilityAddress("recipes")}`);
    // The yes went with the run, and a switch places no focus of its own: the bar takes it.
    expect(desk.focus()).toBe(desk.screen.desk.bar.querySelector("input") as DeskEl);
  });

  test("a switch onto the capability the run displaced gives the window its name back", async () => {
    // A yes ends the run, and the press it replays finds Notes already standing: it opens nothing,
    // so nothing else would stop the window going on saying what the run called it.
    desk = await runningDesk({ displacing: true });
    expect(desk.title()).toBe(THINKING_WINDOW_TITLE);
    desk.logo("Notes").click();
    expect(desk.asked()).toBe(true);

    desk.go();
    expect(desk.ended()).toBe(true);
    expect(desk.title()).toBe("Notes");
    expect(desk.screen.htmx.requests).toEqual([]);
  });

  test("keeping the run leaves the window exactly where it was", async () => {
    desk = await runningDesk();
    desk.logo("Recipes").click();
    desk.back();
    expect(desk.asked()).toBe(false);
    expect(desk.ended()).toBe(false);
    expect(desk.title()).toBe("Notes");
  });

  test("Back and Forward ask, through the same one question", async () => {
    desk = await runningDesk();
    const written = desk.screen.desk.address.written.length;
    const popstate = (
      (globalThis as unknown as { window: unknown }).window as {
        onpopstate: (event: unknown) => void;
      }
    ).onpopstate;
    // An entry behind every one the desk has written: a Back, however far along the desk is.
    popstate({ state: { ...DESK_HISTORY_STATE, index: -1 } });
    expect(desk.asked()).toBe(true);
    expect(desk.screen.desk.address.written.slice(written)).toEqual([
      expect.stringMatching(/^go \d+$/),
    ]);
    expect(desk.screen.desk.windows()).toEqual([desk.frame]);
  });

  test("putting the window away ends its run the one way a run ends", async () => {
    // The backstop, and the same ending every other way out of a run uses. A window that somehow
    // goes away over a run may never leave the server making something nobody can see.
    desk = await runningDesk();
    desk.screen.module.putAway();
    expect(desk.ended()).toBe(true);
    expect(desk.screen.desk.windows()).toEqual([]);
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
    // owed no question. It carries none of the marking the press rule keys off (PLAN decision 3);
    // what a press on it does is run in `desk-logos.test.ts` ("pressing the tile brings…").
    const tile = parseHtml(renderProvisionalLogo("build-7"), new El("div"));
    expect(tile.querySelectorAll(CAPABILITY_LOGO_SELECTOR)).toEqual([]);
  });
});
