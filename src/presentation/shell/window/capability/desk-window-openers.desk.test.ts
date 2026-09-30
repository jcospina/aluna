// Who may open the capability window, run on a started desk: a logo, a doorway on the ground, the
// prompt bar's own submission and an address — and nothing else. Beside them, the two ways a window
// opened for a request that never came back is taken down, and what a window keeps across being
// opened again: its frame, and the way back to whatever opened it last (design D1, D2, D10).

import { afterEach, describe, expect, test } from "bun:test";

import { capabilityAddress, THINKING_WINDOW_TITLE } from "#shell/desk/window/desk-window.js";
import { dragBy, type El } from "../standing-desk.test-support.ts";
import {
  deskNodes,
  serverLogo,
  type ViewportDesk,
  type ViewportOptions,
  viewportDesk,
} from "../viewport-desk.test-support.ts";

let screen: ViewportDesk | undefined;
afterEach(() => {
  screen?.restore();
  screen = undefined;
});

/** A started desk with Notes and Recipes on the ground. */
async function started(options: ViewportOptions = {}) {
  screen = await viewportDesk({
    logos: [serverLogo("notes", "Notes"), serverLogo("recipes", "Recipes")],
    ...options,
  });
  const desk = screen;
  return {
    desk,
    logo: (name: string) => desk.desk.root.querySelector(`[aria-label="Open ${name}"]`) as El,
    windows: () => desk.desk.windows(),
    title: () => desk.desk.windows()[0]?.querySelector("h2")?.textContent,
    /** A form submitted the way the browser submits one: at the form, bubbling to the document. */
    submit: (form: El, already: { defaultPrevented?: boolean } = {}) =>
      form.dispatchEvent({ type: "submit", target: form, ...already }),
  };
}

describe("what may open the window", () => {
  test("a doorway on the ground opens the window its request is about to fill", async () => {
    const desk = await started();
    const doorway = desk.desk.desk.root.querySelector("[data-window-doorway]") as El;
    doorway.click();
    expect(desk.windows()).toHaveLength(1);
    expect(desk.title()).toBe("Notes");
  });

  test("a form that is not the prompt bar opens nothing, and renames nothing", async () => {
    const desk = await started();
    const other = deskNodes('<form id="notes-search"><input name="q"></form>')[0] as El;
    desk.desk.ground.append(other);
    desk.submit(other);
    expect(desk.windows()).toEqual([]);

    desk.desk.module.openWindow("Notes", desk.desk.desk.doc as never);
    desk.submit(other);
    expect(desk.title()).toBe("Notes");
  });

  test("a submission over a standing window takes it over in plain sight", async () => {
    // Only a frame stood up for the run waits out of sight; one already showing a capability is
    // what the person is looking at, and hiding it until the run speaks would blank the desk.
    const desk = await started();
    desk.desk.module.openWindow("Notes", desk.desk.desk.doc as never);
    const [el] = desk.windows();
    const classes = el?.names();
    desk.submit(desk.desk.desk.bar);
    expect(el?.names()).toEqual(classes);
    expect(desk.title()).toBe(THINKING_WINDOW_TITLE);
  });

  test("a submission the bar already turned down opens no window", async () => {
    const desk = await started();
    desk.submit(desk.desk.desk.bar, { defaultPrevented: true });
    expect(desk.windows()).toEqual([]);
    // And the same submission, not turned down, is what stands one up.
    desk.submit(desk.desk.desk.bar);
    expect(desk.title()).toBe(THINKING_WINDOW_TITLE);
  });
});

describe("a window opened for a request that never came back", () => {
  for (const failed of ["htmx:sendError", "htmx:responseError"]) {
    test(`goes on ${failed}, rather than standing there empty`, async () => {
      const desk = await started();
      // A failure with no window standing has nothing to take down, and says nothing about it.
      desk.desk.desk.doc.dispatchEvent({ type: failed });
      desk.submit(desk.desk.desk.bar);
      expect(desk.windows()).toHaveLength(1);
      desk.desk.desk.doc.dispatchEvent({ type: failed });
      expect(desk.windows()).toEqual([]);
    });
  }
});

describe("a cold load on a phone", () => {
  test("opens the addressed window in the phone's form from the first frame", async () => {
    // The screen is asked before any opener runs: a window mounted first would be built with a
    // grip nothing can take back, and a lamp and a drag the phone has no use for.
    const desk = await started({
      phone: true,
      pathname: capabilityAddress("notes"),
      answer: () => new Promise(() => {}),
    });
    const [el] = desk.windows();
    expect(desk.windows()).toHaveLength(1);
    const grips = el?.children.filter((child) => child.getAttribute("aria-hidden") === "true");
    expect(grips?.filter((child) => child.tagName === "div")).toEqual([]);
    expect(el?.querySelector('.lamp[data-action="maximise"]')?.hasAttribute("hidden")).toBe(true);
    expect(el?.querySelector("header")?.classList.contains("window__bar--draggable")).toBe(false);
  });
});

describe("a window opened again", () => {
  test("keeps its frame: the same hand, the same box", async () => {
    const desk = await started();
    desk.desk.module.openWindow("Notes", desk.desk.desk.doc as never, desk.logo("Notes"));
    const [el] = desk.windows() as El[];
    dragBy(el?.querySelector("header") as El, 40, 30);
    const seed = el?.dataset.seed;
    const box = [...(el?.props.entries() ?? [])];

    desk.desk.module.openWindow("Recipes", desk.desk.desk.doc as never, desk.logo("Recipes"));
    expect(desk.windows()).toEqual([el as El]);
    expect(el?.dataset.seed).toBe(seed);
    expect([...(el?.props.entries() ?? [])]).toEqual(box);
  });

  test("gives focus back to whatever opened it last, and an opening from nowhere keeps it", async () => {
    const desk = await started();
    const doc = desk.desk.desk.doc as never;
    desk.desk.module.openWindow("Notes", doc, desk.logo("Notes"));
    desk.desk.module.openWindow("Recipes", doc, desk.logo("Recipes"));
    desk.desk.module.openWindow(THINKING_WINDOW_TITLE, doc);
    desk.desk.module.putAway();
    expect(desk.logo("Recipes").focused).toBe(true);
  });
});
