import { afterEach, describe, expect, test } from "bun:test";

import { PHONE, PROMPT_CLEARANCE } from "#design/desk-geometry.js";
import {
  DESK_GROUND_SELECTOR,
  deskGround,
  fitBox,
  openingGeometry,
  PHONE_CLASS,
  syncForm,
  WINDOW_STORAGE_KEY,
} from "#shell/desk-window.js";
import { elementsOf } from "../../../server/http/served-page.test-support.ts";
import { readSource as read } from "../../safety/source.test-support.ts";
import { desk, fakeEl, type Stored } from "./desk-window.test-support.ts";
import { dragBy, type El } from "./standing-desk.test-support.ts";
import { designDesk, type ViewportDesk, viewportDesk } from "./viewport-desk.test-support.ts";

// Below the breakpoint the window is the screen, and the script is told so (PLAN decisions 47 and
// 48; design D9). What the script does when told; the two widths sheets may break on are policy.

/** A window, as much of one as `syncForm` touches — lamp, bar, and the gestures. */
function fakeWindow() {
  const el = fakeEl();
  const lamp = fakeEl();
  const bar = fakeEl();
  el.querySelector = (() => lamp) as never;
  return { entry: { el, win: { bar }, gestures: false }, lamp, bar };
}

/**
 * `addWindowGrip` builds its handle with `document`, which Bun does not have. The property is put
 * back exactly as found, because the shell's classic scripts self-start on a `document` they see.
 */
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

/** The one window on a started desk, opened the way a logo opens one. */
function mounted(screen: ViewportDesk): El {
  screen.module.openWindow("Notes", screen.desk.doc as never);
  return screen.desk.windows()[0] as El;
}

/** The leaf lamp, the one a keyboard maximises with. */
const leafLamp = (el: El) => el.querySelector('.lamp[data-action="maximise"]') as El;

/** What a grip is to the page: a box the window holds that is hidden from assistive tech. */
const gripsOf = (el: El) =>
  el.children.filter(
    (child) => child.tagName === "div" && child.getAttribute("aria-hidden") === "true",
  );

describe("below the breakpoint the window is the screen, and the script is told so", () => {
  let screen: ViewportDesk | undefined;
  afterEach(() => {
    screen?.restore();
    screen = undefined;
  });

  test("the phone class is set on the ground rather than only read", async () => {
    screen = await viewportDesk(true);
    expect(screen.asked).toEqual([PHONE]);
    expect(screen.ground.classList.contains(PHONE_CLASS)).toBe(true);
    screen.setPhone(false);
    expect(screen.ground.classList.contains(PHONE_CLASS)).toBe(false);
  });

  test("the ground the script sets it on is one the shell serves", async () => {
    const served = await elementsOf(read("public/index.html"));
    const [ground] = served.filter((element) =>
      (element.attributes.get("class") ?? "").split(/\s+/).includes(DESK_GROUND_SELECTOR.slice(1)),
    );
    expect(ground, `the shell serves no ${DESK_GROUND_SELECTOR}`).toBeDefined();

    // And the ground is found structurally, so a page without one is not a crash.
    const found = fakeEl();
    const root = { querySelector: (s: string) => (s === DESK_GROUND_SELECTOR ? found : null) };
    expect(deskGround(root)).toBe(found as never);
    expect(deskGround({ querySelector: () => null })).toBeNull();
    expect(deskGround({ querySelector: () => ({ notAnElement: true }) })).toBeNull();
    expect(deskGround({} as never)).toBeNull();
  });
});

describe("what a window may do below the breakpoint", () => {
  let screen: ViewportDesk | undefined;
  afterEach(() => {
    screen?.restore();
    screen = undefined;
  });

  test("the drag and the grip do not bind at all below the breakpoint", () => {
    // Not bound and then stood down: a window that opens on a phone gets no grip
    // element and no drag listener, rather than a grip the stylesheet has to hide.
    const { entry, bar } = fakeWindow();
    withDocument(() => syncForm(entry as never, true));
    expect(entry.gestures).toBe(false);
    expect(entry.el.children, "a grip was built for a phone").toHaveLength(0);
    expect(bar.bound, "a drag was bound on a phone").toHaveLength(0);
  });

  test("crossing up binds them, and crossing back and forth binds them once", () => {
    const { entry, bar } = fakeWindow();
    withDocument(() => {
      syncForm(entry as never, true);
      syncForm(entry as never, false);
      syncForm(entry as never, true);
      syncForm(entry as never, false);
    });
    expect(entry.gestures).toBe(true);
    expect(entry.el.children, "a second grip was built").toHaveLength(1);
    expect(bar.bound, "a second drag was bound").toEqual(["pointerdown"]);
  });

  test("the title bar stops claiming a phone's touches when it stops being draggable", () => {
    // The class carries `touch-action: none` (held by the policy beside this file), so it has to
    // come off on a phone or the browser hands every title-bar touch to a drag that stands down.
    const { entry, bar } = fakeWindow();
    withDocument(() => syncForm(entry as never, false));
    expect(bar.classList.contains("window__bar--draggable")).toBe(true);
    withDocument(() => syncForm(entry as never, true));
    expect(bar.classList.contains("window__bar--draggable")).toBe(false);
  });

  test("no dead maximise lamp on a phone, and it comes back above the breakpoint", () => {
    // The window already is the screen, so the leaf lamp has nothing to toggle, and `hidden`
    // takes it out of the focus order rather than leaving a tab stop whose Enter does nothing.
    const { entry, lamp } = fakeWindow();
    withDocument(() => syncForm(entry as never, true));
    expect(lamp.attrs.has("hidden")).toBe(true);
    withDocument(() => syncForm(entry as never, false));
    expect(lamp.attrs.has("hidden")).toBe(false);
  });

  test("a maximise that arrives some other way is refused on a phone", async () => {
    screen = await viewportDesk(true);
    const el = mounted(screen);
    el.dispatchEvent({ type: "window:lamp", detail: { action: "maximise" } });
    expect(leafLamp(el).getAttribute("aria-pressed")).toBe("false");
    screen.setPhone(false);
    el.dispatchEvent({ type: "window:lamp", detail: { action: "maximise" } });
    expect(leafLamp(el).getAttribute("aria-pressed")).toBe("true");
  });

  test("a window standing when the screen crosses changes form with it", async () => {
    screen = await viewportDesk(false);
    const el = mounted(screen);
    screen.setPhone(true);
    expect(leafLamp(el).hasAttribute("hidden")).toBe(true);
    screen.setPhone(false);
    expect(leafLamp(el).hasAttribute("hidden")).toBe(false);
  });

  test("a window born on a phone is placed and remembered only when the screen crosses up", async () => {
    screen = await viewportDesk(true);
    const el = mounted(screen);
    const placed = () => el.props.get("--win-w");
    expect(placed()).toBeUndefined();
    screen.setPhone(true);
    expect(screen.desk.store.writes).toEqual([]);
    screen.setPhone(false);
    expect(placed()).toBeDefined();
    expect(screen.desk.store.writes).toEqual([`set ${WINDOW_STORAGE_KEY}`]);
  });

  test("a window that is already up stands its gestures down when narrowed", async () => {
    // The half a listener can do: `addWindowDrag` binds to the bar and offers no way back off
    // it, so a window carried into the phone form answers through the host.
    screen = await viewportDesk(false);
    const el = mounted(screen);
    const placed = () => [...el.props.entries()].filter(([name]) => name.startsWith("--win-"));
    screen.setPhone(true);
    const before = placed();
    dragBy(el.querySelector("header") as El, 120, 80);
    for (const grip of gripsOf(el)) dragBy(grip, 120, 80);
    expect(placed()).toEqual(before);
  });
});

describe("the desktop box survives the phone", () => {
  test("the crossing down leaves the desktop box exactly as it found it", () => {
    const box = { x: 240, y: 18, w: 794, h: 462 };
    const state = { box: { ...box }, maximised: false, sized: true };
    expect(fitBox(state, desk(400, 800), true), "a phone placed the window").toBe(false);
    expect(state.box).toEqual(box);
  });

  test("the crossing up restores and clamps the box the phone was handed", () => {
    // Desk to phone to a narrower desk, in one sequence: the box survives the phone and meets the
    // new desk's edges on the way back, rather than returning to a screen that is gone.
    const state = { box: { x: 900, y: 18, w: 794, h: 462 }, maximised: false, sized: true };
    fitBox(state, desk(1600, 900), false);
    expect(state.box.x).toBe(806);

    fitBox(state, desk(400, 800), true);
    expect(state.box.x, "the phone moved it").toBe(806);

    expect(fitBox(state, desk(1000, 700), false)).toBe(true);
    expect(state.box.x + state.box.w).toBe(1000);
    expect(state.box.y + state.box.h).toBeLessThanOrEqual(700 - PROMPT_CLEARANCE);
  });

  test("a maximised window crosses both ways and comes back maximised", () => {
    const state = {
      box: { x: 100, y: 60, w: 600, h: 400, max: true, restore: { x: 100, y: 60, w: 600, h: 400 } },
      maximised: true,
      sized: true,
    };
    fitBox(state, desk(1600, 900), false);
    fitBox(state, desk(400, 800), true);
    expect(state.box, "the phone recomputed a maximised box").toMatchObject({ w: 1600 - 36 });
    fitBox(state, desk(900, 700), false);
    expect(state.box).toMatchObject({ w: 900 - 36, h: 700 - 36 - PROMPT_CLEARANCE });
    expect(state.box.restore).toEqual({ x: 100, y: 60, w: 600, h: 400 });
  });

  test("a box a phone authored does not become the desktop's on the way back up", () => {
    // A window opened below the breakpoint with nothing remembered was fitted to a screen it
    // filled, so it is no preference: the desk is asked for a first box when there is one.
    const el = fakeEl();
    const state = openingGeometry(el as never, { box: null, max: false }, desk(390, 800), true);
    expect(state.sized, "a phone authored a desktop preference").toBe(false);
    expect(el.props.size, "a phone placed the window").toBe(0);

    expect(fitBox(state, desk(1600, 900), false)).toBe(true);
    expect(state.box.w).toBeGreaterThan(600);
    expect(state.sized, "the desk's box is a preference now").toBe(true);

    // Maximised, the first box is the one to give back — the live box is the desk.
    const max: { box: Stored; maximised: boolean; sized: boolean } = {
      box: { x: 0, y: 18, w: 220, h: 560, max: true },
      maximised: true,
      sized: false,
    };
    fitBox(max, desk(1600, 900), false);
    expect(max.box).toMatchObject({ w: 1600 - 36 });
    expect(max.box.restore?.w, "un-maximising would hand back a phone's box").toBeGreaterThan(600);
  });
});

describe("the focus order advertises nothing it cannot do", () => {
  let screen: ViewportDesk | undefined;
  afterEach(() => {
    screen?.restore();
    screen = undefined;
  });

  test("the corner grip is pointer geometry rather than a keyboard control", async () => {
    screen = await viewportDesk(false);
    const [grip, ...more] = gripsOf(mounted(screen));
    expect(more).toHaveLength(0);
    expect(grip?.tagName).toBe("div");
    expect(grip?.hasAttribute("tabindex")).toBe(false);
    expect((grip as unknown as { tabIndex?: number }).tabIndex).toBeUndefined();
  });

  test("what is left in the window's focus order is two real buttons", async () => {
    // The lamps are the whole of the window's chrome and both are `<button>`. The leaf lamp is the
    // size change a keyboard can make, which lets the grip stay out of the order entirely.
    screen = await viewportDesk(false);
    const el = mounted(screen);
    const buttons = el.querySelectorAll("button");
    expect(buttons.map((button) => button.type)).toEqual(["button", "button"]);
    expect(leafLamp(el).getAttribute("aria-pressed")).toBe("false");
  });

  test("the design page's own desk keeps the same two promises", async () => {
    // `design/scripts/desk.js` is the other consumer of the shared gestures (PLAN decision 47).
    // It bound both gestures on a phone and left the maximise lamp in the focus order.
    const design = await designDesk(true);
    try {
      const el = design.design.open("notes").el as El;
      expect(gripsOf(el)).toHaveLength(0);
      expect(leafLamp(el).hasAttribute("hidden")).toBe(true);
      expect(el.querySelector("header")?.classList.contains("window__bar--draggable")).toBe(false);
      design.setPhone(false);
      design.setPhone(true);
      design.setPhone(false);
      expect(gripsOf(el)).toHaveLength(1);
      expect(leafLamp(el).hasAttribute("hidden")).toBe(false);
      // The bar is a drag handle again, and a handle with one drag bound to it however often
      // the screen crossed: two would each move the window by the whole of every move.
      const header = el.querySelector("header") as El;
      expect(header.classList.contains("window__bar--draggable")).toBe(true);
      expect(header.listeners.count("pointerdown")).toBe(1);
    } finally {
      design.restore();
    }
  });
});
