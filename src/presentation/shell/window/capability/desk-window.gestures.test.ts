// The other half of `desk-window.test.ts`: the pointer gestures a window answers, who owns
// the way back out of it, and what the address names.
// Split out when the one file grew past what a file should hold.

import { afterEach, describe, expect, test } from "bun:test";

import { MIN_SIZE, PROMPT_CLEARANCE } from "#design/desk/desk-geometry.js";
import { DRAG_ENDINGS, trackPointer } from "#design/window/window-gestures.js";
import { CONTENT_REGION_SELECTOR } from "#shell/core/region-scope.js";
import {
  capabilityIdFromAddress,
  logoFor,
  logoTitle,
  PROMPT_FORM_ID,
  WINDOW_STORAGE_KEY,
} from "#shell/desk/window/desk-window.js";
import { byId, elementsOf } from "../../../../server/http/served-page.test-support.ts";
import { readSource as read } from "../../../safety/source.test-support.ts";
import { dragBy, type El, pressLamp } from "../standing-desk.test-support.ts";
import { type ViewportDesk, viewportDesk } from "../viewport-desk.test-support.ts";

// The window's gestures, checked where they are written down: one drag and one grip, shared by
// the product and the design's own desk (PLAN decisions 1 and 2; design D1, D3, D12).

const SHELL = read("public/index.html");

let screen: ViewportDesk | undefined;
afterEach(() => {
  screen?.restore();
  screen = undefined;
});

/** A started desk with the developer panel's module on it and one capability window standing. */
async function standing() {
  screen = await viewportDesk({ panel: true });
  const started = screen;
  started.module.openWindow("Notes", started.desk.doc as never);
  const el = started.desk.windows()[0] as El;
  return {
    screen: started,
    el,
    bar: el.querySelector("header") as El,
    region: el.querySelector(CONTENT_REGION_SELECTOR) as El,
    grip: () =>
      el.children.find(
        (child) => child.tagName === "div" && child.getAttribute("aria-hidden") === "true",
      ) as El,
    place: () => ["--win-x", "--win-y", "--win-w", "--win-h"].map((name) => el.props.get(name)),
    box: () =>
      ["--win-x", "--win-y", "--win-w", "--win-h"].map((name) =>
        Number.parseFloat(el.props.get(name) ?? ""),
      ),
  };
}

/** A whole gesture from `on`: the press, one move, and letting go. */
function press(on: El, dx: number, dy: number) {
  dragBy(on, dx, dy);
}

describe("dragging and resizing", () => {
  test("the window drags by its title bar and by nothing else", async () => {
    const window = await standing();
    const moved = window.place();
    press(window.region, 120, 80);
    expect(window.place()).toEqual(moved);
    // A press on a lamp is not the start of a drag.
    press(window.el.querySelector(".lamp") as El, 120, 80);
    expect(window.place()).toEqual(moved);
    press(window.bar, 120, 80);
    expect(window.place()).not.toEqual(moved);
  });

  // A device reporting both touch and mouse delivers two `pointerdown`s with different ids, and
  // every listener answered both: two drags over one box, each writing over the other.
  test("one gesture answers one pointer, and nothing a second one sends", () => {
    const bound = new Map<string, (event: unknown) => void>();
    const handle = {
      setPointerCapture: () => {},
      addEventListener: (type: string, listener: (event: unknown) => void) =>
        bound.set(type, listener),
      removeEventListener: (type: string) => bound.delete(type),
    };
    const moved: number[] = [];
    let ended = 0;
    trackPointer(
      handle as never,
      { pointerId: 7 },
      (move) => moved.push(move.clientX),
      () => (ended += 1),
    );

    bound.get("pointermove")?.({ pointerId: 9, clientX: 100 });
    bound.get("pointerup")?.({ pointerId: 9 });
    expect(moved, "a second pointer moved the window").toEqual([]);
    expect(ended, "a second pointer ended the gesture").toBe(0);
    expect(bound.has("pointermove")).toBe(true);

    bound.get("pointermove")?.({ pointerId: 7, clientX: 40 });
    bound.get("pointerup")?.({ pointerId: 7 });
    expect(moved).toEqual([40]);
    expect(ended).toBe(1);
    expect(bound.size).toBe(0);
  });

  // The grip is inside the window, so the press starting a resize also reaches the raise listener,
  // and stopping it there left the window being resized behind the one that was not.
  test("a press on the grip brings its window forward", async () => {
    const window = await standing();
    window.screen.devPanel?.openPanel(window.screen.desk.doc as never);
    expect(window.el.classList.contains("is-focused")).toBe(false);
    press(window.grip(), 20, 20);
    expect(window.el.classList.contains("is-focused")).toBe(true);
  });

  test("a maximised window is neither dragged nor resized", async () => {
    const window = await standing();
    pressLamp(window.el, "maximise");
    const full = window.place();
    press(window.bar, 120, 80);
    press(window.grip(), -120, -80);
    expect(window.place()).toEqual(full);
  });
});

describe("a gesture measures exactly, and lets go completely", () => {
  test("a drag moves the window by exactly how far the pointer went", async () => {
    const window = await standing();
    const [x = 0, y = 0, w = 0, h = 0] = window.box();
    press(window.bar, 40, 30);
    expect(window.box()).toEqual([x + 40, y + 30, w, h]);
  });

  test("the grip grows the window by exactly how far the pointer went, and remembers it", async () => {
    // Pressed away from the origin, since a gesture measured from zero hides which way it counts.
    const window = await standing();
    const [x = 0, y = 0, w = 0, h = 0] = window.box();
    const grip = window.grip();
    const at = (type: string, clientX: number, clientY: number) =>
      grip.dispatchEvent({ type, target: grip, pointerId: 1, clientX, clientY });
    const reached: string[] = [];
    window.screen.desk.doc.addEventListener("pointerdown", () => reached.push("document"));
    expect(at("pointerdown", 300, 200)).toBe(false);
    // The press is the grip's: it neither starts a selection nor reaches anything else.
    expect(reached).toEqual([]);
    at("pointermove", 340, 230);
    at("pointerup", 340, 230);
    expect(window.box()).toEqual([x, y, w + 40, h + 30]);
    expect(JSON.parse(window.screen.desk.store.contents()[WINDOW_STORAGE_KEY] ?? "null")).toEqual({
      x,
      y,
      w: w + 40,
      h: h + 30,
      max: false,
    });
  });

  test("a window says it is being dragged for exactly as long as it is", async () => {
    const window = await standing();
    const bar = window.bar;
    bar.dispatchEvent({ type: "pointerdown", target: bar, pointerId: 1, clientX: 0, clientY: 0 });
    expect(window.el.classList.contains("is-dragging")).toBe(true);
    // And holds the pointer while it is, or a move off the bar would leave the window behind.
    expect(bar.hasPointerCapture(1)).toBe(true);
    bar.dispatchEvent({ type: "pointerup", pointerId: 1, clientX: 0, clientY: 0 });
    expect(window.el.classList.contains("is-dragging")).toBe(false);
  });

  test("the grip stops at the desk's edge and the prompt bar's floor, and at the smallest window", async () => {
    const window = await standing();
    const bounds = window.screen.desk.layer.getBoundingClientRect();
    press(window.grip(), 5000, 5000);
    const [x = 0, y = 0, w = 0, h = 0] = window.box();
    expect(x + w).toBe(bounds.width);
    expect(y + h).toBe(bounds.height - PROMPT_CLEARANCE);
    press(window.grip(), -5000, -5000);
    expect(window.box().slice(2)).toEqual([MIN_SIZE.w, MIN_SIZE.h]);
  });

  // A cancelled pointer and a lost capture are endings too: a gesture left listening would take
  // the next time the pointer passes over the bar as a drag nobody began. The browser's three,
  // named here as the Pointer Events spec names them, since the module's own list is the claim.
  for (const ending of ["pointerup", "pointercancel", "lostpointercapture"]) {
    for (const handle of ["bar", "grip"] as const) {
      test(`the ${handle} lets go on ${ending}, and nothing moves the window after`, async () => {
        const window = await standing();
        const on = handle === "bar" ? window.bar : window.grip();
        const at = (type: string, x: number) =>
          on.dispatchEvent({ type, target: on, pointerId: 1, clientX: x, clientY: x });
        at("pointerdown", 0);
        at("pointermove", 10);
        at(ending, 10);
        const ended = window.box();
        at("pointermove", 60);
        expect(window.box()).toEqual(ended);
        const held = ["pointermove", ...DRAG_ENDINGS].filter((type) => on.listeners.count(type));
        expect(held).toEqual([]);
      });
    }
  }

  test("the grip is a thing the desk's stylesheet draws", async () => {
    const sheet = read("design/styles/components/desk.css");
    const names = (await standing()).grip().names();
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(sheet).toMatch(new RegExp(`\\.${name}\\s*\\{`));
  });
});

describe("who opens the window", () => {
  test("the bar the submit opener answers is the one the shell serves", async () => {
    // Which listener runs first is the capture phase's to order, run in `desk-window.test.ts`
    // ("both openers listen in the capture phase"); the form it answers is found by its id.
    expect(byId(await elementsOf(SHELL), PROMPT_FORM_ID).tag).toBe("form");
  });
});

describe("the address names the capability, and the desk says what exists", () => {
  test("an address is a capability or nothing at all", () => {
    expect(capabilityIdFromAddress("/capability/notes")).toBe("notes");
    expect(capabilityIdFromAddress("/capability/notes/")).toBe("notes");
    expect(capabilityIdFromAddress("/capability/my%20notes")).toBe("my notes");
    expect(capabilityIdFromAddress("/")).toBeNull();
    expect(capabilityIdFromAddress("/capability/")).toBeNull();
    // Nothing below the id is an address: a record, a search and a draft die with the
    // tab, so there is never a second segment to parse.
    expect(capabilityIdFromAddress("/capability/notes/read")).toBeNull();
    // A malformed escape names no capability rather than throwing on page load.
    expect(capabilityIdFromAddress("/capability/%E0%A4%A")).toBeNull();
  });

  test("a logo is found by reading ids back, never by a selector built from one", () => {
    // A capability id is a string this module did not author. Reading the attribute
    // back needs no escaping; a selector assembled from one does.
    const logos = [
      logoNode('a"],[data-capability-logo][x="', "Tricky"),
      logoNode("notes", "  Notes  "),
    ];
    const root = { querySelectorAll: () => logos };

    expect(logoFor(root, "notes")).toBe(logos[1] as (typeof logos)[number]);
    expect(logoTitle(logoFor(root, "notes") as (typeof logos)[number])).toBe("Notes");
    expect(logoFor(root, "recipes")).toBeNull();
    expect(logoFor(root, 'a"],[data-capability-logo][x="')).toBe(
      logos[0] as (typeof logos)[number],
    );
  });
});

/** One logo, as much of one as the two rules above actually touch. */
function logoNode(id: string, label: string) {
  return {
    getAttribute: (name: string) => (name === "data-capability-id" ? id : null),
    querySelector: (selector: string) =>
      selector === ".logo-label" ? { textContent: label } : null,
  };
}
