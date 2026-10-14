// Where the chooser's panel hangs. It extends the picker's placement with what the design draws: the
// panel heads its list, so its cap is the listbox's own height plus the heading, measured at the width
// the panel will stand at; and it hangs off the field's shell, since the chain is a glyph too narrow
// to be what a list is under. The double has no layout, so the panel that arrives is laid out here.

import { describe, expect, test } from "bun:test";
import { MAX_PANEL_HEIGHT, PANEL_GAP } from "#shell/controls/choice-picker.js";
import { El } from "../double/choice-picker.test-support.ts";
import { installLinkGlobals, linkScene, listed } from "./link-control.test-support.ts";

installLinkGlobals();

const px = (value: number) => `${value}px`;
const SHELL = { left: 40, right: 440, width: 400, height: 36 };
const writeInside = Object.getOwnPropertyDescriptor(El.prototype, "innerHTML")?.set;

/**
 * Open a chooser whose shell stands from `top`, over a list `content` tall, with a heading as tall
 * as `head` says at the width the panel stands at, and report where the panel went.
 */
async function place({
  top,
  content,
  head,
  sentence,
}: {
  top: number;
  content: number;
  head: (width: string) => number;
  /** With nothing to pick: how tall the empty sentence stands once it is back in. */
  sentence?: number;
}) {
  const scene = await linkScene([sentence === undefined ? listed() : listed({ groups: [] })]);
  const { panel } = scene;
  const inside = (selector: string) => panel.querySelector(selector);
  const headHeight = () => (inside(".link-control__head") ? head(panel.style.width ?? "") : 0);
  const shown = () => {
    const cap = Number.parseFloat(inside(".listbox__scroll")?.style.maxHeight ?? "");
    return Number.isFinite(cap) ? Math.min(content, cap) : content;
  };
  const said = () => (inside(".listbox__empty")?.textContent ? (sentence ?? 0) : 0);
  Object.defineProperty(panel, "innerHTML", {
    configurable: true,
    set(html: string) {
      writeInside?.call(panel, html);
      const scroll = inside(".listbox__scroll") as El;
      scroll.scrollHeight = content;
      Object.defineProperty(scroll, "offsetHeight", { get: shown, configurable: true });
      Object.defineProperty(inside(".link-control__head"), "offsetHeight", {
        get: headHeight,
        configurable: true,
      });
    },
  });
  Object.defineProperty(panel, "offsetHeight", {
    get: () => headHeight() + shown() + said(),
    configurable: true,
  });
  panel.box = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
  scene.shell.box = { ...SHELL, top, bottom: top + SHELL.height };
  scene.button.box = {
    top: top + 5,
    bottom: top + 31,
    left: 410,
    right: 434,
    width: 24,
    height: 26,
  };
  await scene.press(scene.button);
  const placedTop = Number.parseFloat(panel.style.top ?? "");
  return {
    list: inside(".listbox__scroll")?.style.maxHeight,
    height: headHeight() + shown() + said(),
    top: placedTop,
    bottom: placedTop + headHeight() + shown() + said(),
    left: panel.style.left,
    width: panel.style.width,
    above: scene.root.classList.contains("is-above"),
    shell: scene.shell.box,
  };
}

/** A heading that wraps at the shell's width and stands on one line at any wider one. */
const wrapping = (width: string) => (width === px(SHELL.width) ? 90 : 48);

describe("how tall the chooser stands", () => {
  test("a long list keeps the listbox's own height, with the heading measured on above it", async () => {
    for (const tall of [48, 90]) {
      const placed = await place({ top: 100, content: 1000, head: () => tall });
      expect(placed.list).toBe(px(MAX_PANEL_HEIGHT));
      expect(placed.height).toBe(MAX_PANEL_HEIGHT + tall);
    }
  });

  test("a short list is as tall as it is", async () => {
    const placed = await place({ top: 100, content: 120, head: () => 48 });
    expect(placed.height).toBe(48 + 120);
  });

  test("a heading that wraps at the shell's width is measured there, so the panel never covers the field", async () => {
    const placed = await place({ top: 500, content: 1000, head: wrapping });
    expect(placed.height).toBeLessThanOrEqual(MAX_PANEL_HEIGHT + wrapping(px(SHELL.width)));
    expect(placed.above).toBe(false);
    expect(placed.top).toBeGreaterThanOrEqual(placed.shell.bottom + PANEL_GAP);
    expect(placed.bottom).toBeLessThanOrEqual(900 - PANEL_GAP);
  });
});

describe("what it hangs from", () => {
  test("the field's shell: a gap below it, as wide as it, from its left edge", async () => {
    const placed = await place({ top: 200, content: 120, head: () => 48 });
    expect([placed.top, placed.left, placed.width, placed.above]).toEqual([
      200 + SHELL.height + PANEL_GAP,
      px(SHELL.left),
      px(SHELL.width),
      false,
    ]);
  });

  test("an empty one is placed again once its sentence is back, by the height it ends with", async () => {
    // Room below for the heading alone, not for the heading and the sentence under it.
    const placed = await place({ top: 794, content: 0, head: () => 48, sentence: 21 });
    expect(placed.height).toBe(48 + 21);
    expect(placed.above).toBe(true);
    expect(placed.bottom).toBeLessThanOrEqual(placed.shell.top - PANEL_GAP);
  });

  test("with no room below, it opens above the shell, clear of the field", async () => {
    const placed = await place({ top: 800, content: 1000, head: wrapping });
    expect(placed.above).toBe(true);
    expect(placed.bottom).toBeLessThanOrEqual(placed.shell.top - PANEL_GAP);
    expect(placed.top).toBeGreaterThanOrEqual(PANEL_GAP);
    expect(placed.height).toBeLessThanOrEqual(MAX_PANEL_HEIGHT + wrapping(px(SHELL.width)));
  });
});
