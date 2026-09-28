// Where an open picker's panel hangs, run through the real `public/choice-picker.js` on the markup
// the renderer writes. The double has no layout, so each case lays the panel out the way the
// browser would: the list is as tall as its content up to its cap, and the panel is that plus its
// own chrome. The viewport is the double's 1200 by 900; a clipping ancestor narrows it.

import { describe, expect, test } from "bun:test";

import { MAX_PANEL_HEIGHT, MIN_SCROLL_HEIGHT, PANEL_GAP } from "#shell/choice-picker.js";
import { form, installDomGlobals, scene } from "./choice-picker.fixture.test-support.ts";
import { type El, parseHtml } from "./choice-picker.test-support.ts";

installDomGlobals();

type Box = { top: number; bottom: number; left?: number; right?: number };

/** What one opening decided: where the panel went, how tall the list may be, and which side. */
interface Placed {
  top: string | undefined;
  left: string | undefined;
  width: string | undefined;
  cap: string | undefined;
  above: boolean;
  hidden: boolean | undefined;
}

/**
 * Open a picker whose button stands at `button`, over a list `content` tall inside `chrome` of
 * panel, within `clip` when an ancestor clips it, and report where the panel was put.
 */
async function place({
  button,
  content,
  chrome = 10,
  clip,
  clipStyle = { position: "relative", overflowY: "hidden" },
  origin = { left: 0, top: 0 },
}: {
  button: Box;
  content: number;
  chrome?: number;
  clip?: Box;
  clipStyle?: Record<string, string>;
  origin?: { left: number; top: number };
}) {
  const picker = await scene(form("picker"));
  const panel = picker.panel as El;
  const scroll = picker.field.querySelector(".listbox__scroll") as El;
  scroll.scrollHeight = content;
  const shown = () => {
    const cap = Number.parseFloat(scroll.style.maxHeight ?? "");
    return Number.isFinite(cap) ? Math.min(content, cap) : content;
  };
  Object.defineProperty(scroll, "offsetHeight", { get: shown, configurable: true });
  Object.defineProperty(panel, "offsetHeight", { get: () => chrome + shown(), configurable: true });
  const measured: Record<string, string>[] = [];
  panel.getBoundingClientRect = () => {
    measured.push({ ...panel.style, listCap: scroll.style.maxHeight ?? "" });
    return {
      top: origin.top,
      left: origin.left,
      right: origin.left,
      bottom: origin.top,
      width: 0,
      height: 0,
    };
  };
  if (clip) {
    picker.form.computed = { ...picker.form.computed, ...clipStyle };
    picker.form.box = {
      left: 0,
      right: 1200,
      ...clip,
      width: 1200,
      height: clip.bottom - clip.top,
    };
  }
  const left = button.left ?? 50;
  const right = button.right ?? left + 200;
  const control = picker.button as El;
  control.box = { ...button, left, right, width: right - left, height: button.bottom - button.top };
  const elsewhere = parseHtml("<button>elsewhere</button>", picker.doc).querySelector(
    "button:not([aria-haspopup])",
  ) as El;
  elsewhere.focus();
  picker.press(control);
  const placed: Placed = {
    top: panel.style.top,
    left: panel.style.left,
    width: panel.style.width,
    cap: scroll.style.maxHeight,
    above: picker.field.classList.contains("is-above"),
    hidden: panel.hidden,
  };
  return {
    placed,
    measured,
    height: panel.style.height,
    focusStayed: picker.doc.activeElement === elsewhere,
  };
}

const px = (value: number) => `${value}px`;
/** The viewport, and a clip 300px tall, each inset by the gap. */
const VIEW = { top: PANEL_GAP, bottom: 900 - PANEL_GAP, left: PANEL_GAP, right: 1200 - PANEL_GAP };
const CLIP = { top: 0, bottom: 300 };
const CLIPPED = { top: PANEL_GAP, bottom: 300 - PANEL_GAP };
/** The list's cap for a room, as the design floors and ceils it. */
const capFor = (room: number, chrome = 10) =>
  px(Math.min(Math.max(room, MIN_SCROLL_HEIGHT + chrome), MAX_PANEL_HEIGHT) - chrome);

describe("measuring where the panel may live", () => {
  test("the panel is parked filling its containing block, with its list uncapped, when measured", async () => {
    const { measured, height } = await place({ button: { top: 100, bottom: 136 }, content: 100 });
    expect(measured).toEqual([
      { left: "0px", top: "0px", bottom: "auto", width: "100%", height: "100%", listCap: "" },
    ]);
    expect(height).toBe("");
  });
});

describe("hanging below the control", () => {
  test("with room, it hangs a gap below, as wide as the control, its list at the tallest cap", async () => {
    const { placed } = await place({ button: { top: 100, bottom: 136 }, content: 100 });
    expect(placed).toEqual({
      top: px(136 + PANEL_GAP),
      left: "50px",
      width: "200px",
      cap: capFor(VIEW.bottom - 136 - PANEL_GAP),
      above: false,
      hidden: false,
    });
  });

  test("with a long list and little room, the list is held to the room left below", async () => {
    const { placed } = await place({ button: { top: 95, bottom: 131 }, content: 300, clip: CLIP });
    const room = CLIPPED.bottom - 131 - PANEL_GAP;
    expect([placed.top, placed.cap, placed.above]).toEqual([
      px(131 + PANEL_GAP),
      capFor(room),
      false,
    ]);
  });

  test("with less room than a list needs, the list keeps its floor and the panel is pushed up", async () => {
    const { placed } = await place({
      button: { top: 80, bottom: 116 },
      content: 300,
      clip: { top: 0, bottom: 200 },
    });
    const panel = MIN_SCROLL_HEIGHT + 10;
    expect([placed.top, placed.cap]).toEqual([px(200 - PANEL_GAP - panel), capFor(panel)]);
  });

  test("more room below than above stays below, even when neither side has enough", async () => {
    const { placed } = await place({ button: { top: 130, bottom: 166 }, content: 300, clip: CLIP });
    expect(placed.above).toBe(false);
    const level = await place({ button: { top: 132, bottom: 168 }, content: 300, clip: CLIP });
    expect(level.placed.above).toBe(false);
  });

  test("enough room below stays below, however much more there is above", async () => {
    const { placed } = await place({ button: { top: 600, bottom: 636 }, content: 100 });
    expect(placed.above).toBe(false);
  });
});

describe("hanging above the control", () => {
  test("short of room below with more above, it hangs a gap above, its list capped to the rest", async () => {
    const { placed } = await place({ button: { top: 200, bottom: 236 }, content: 100, clip: CLIP });
    const top = 200 - PANEL_GAP - 110;
    expect([placed.top, placed.cap, placed.above]).toEqual([
      px(top),
      capFor(CLIPPED.bottom - top),
      true,
    ]);
  });

  test("a list taller than the room above is held to it, the panel at the top of the box", async () => {
    const { placed } = await place({ button: { top: 200, bottom: 236 }, content: 300, clip: CLIP });
    expect([placed.top, placed.above]).toEqual([px(CLIPPED.top), true]);
  });

  test("the side is chosen by what the whole panel needs, list and chrome together", async () => {
    const below = CLIPPED.bottom - 236 - PANEL_GAP;
    const short = await place({
      button: { top: 200, bottom: 236 },
      content: below - 10 + 6,
      clip: CLIP,
    });
    expect(short.placed.above).toBe(true);
    const exact = await place({
      button: { top: 200, bottom: 236 },
      content: below - 10,
      clip: CLIP,
    });
    expect(exact.placed.above).toBe(false);
  });
});

describe("across, inside the box that paints it", () => {
  test("left is counted from where the containing block starts", async () => {
    const { placed } = await place({
      button: { top: 100, bottom: 136 },
      content: 100,
      origin: { left: 30, top: 20 },
    });
    expect([placed.left, placed.top]).toEqual(["20px", px(136 + PANEL_GAP - 20)]);
  });

  test("a control near either edge keeps its panel inside the box", async () => {
    const right = await place({
      button: { top: 100, bottom: 136, left: 1100, right: 1300 },
      content: 100,
    });
    expect(right.placed.left).toBe(px(VIEW.right - 200));
    const left = await place({
      button: { top: 100, bottom: 136, left: 0, right: 200 },
      content: 100,
    });
    expect(left.placed.left).toBe(px(VIEW.left));
  });
});

describe("a control scrolled out of its own box", () => {
  test("above it, or below it, even by an edge, closes the panel and leaves focus where it was", async () => {
    for (const button of [
      { top: -50, bottom: CLIPPED.top },
      { top: CLIPPED.bottom, bottom: CLIPPED.bottom + 36 },
    ]) {
      const { placed, focusStayed } = await place({ button, content: 100, clip: CLIP });
      expect([placed.hidden, focusStayed]).toEqual([true, true]);
    }
  });
});

describe("which ancestors clip the panel", () => {
  const flipsInside = (clipStyle: Record<string, string>) =>
    place({ button: { top: 200, bottom: 236 }, content: 100, clip: CLIP, clipStyle });

  test("one that makes a containing block clips it, positioned or not", async () => {
    const styles: Record<string, string>[] = [
      { filter: "blur(1px)" },
      { translate: "10px" },
      { scale: "2" },
      { rotate: "10deg" },
    ];
    for (const style of styles) {
      const { placed } = await flipsInside({ ...style, overflowY: "hidden" });
      expect(placed.above).toBe(true);
    }
  });

  test("a positioned one clips on either axis, and not at all while it overflows visibly", async () => {
    for (const [style, clips] of [
      [{ position: "relative", overflowX: "hidden" }, true],
      [{ position: "relative", overflowY: "hidden" }, true],
      [{ position: "relative" }, false],
    ] as const) {
      const { placed } = await flipsInside(style);
      expect(placed.above).toBe(clips);
    }
  });
});
