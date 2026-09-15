// @ts-check

/**
 * What the desk's three windows — the capability window, the developer panel and the answer
 * window — share about being a window at all: the shadow they carry over a wallpaper, the
 * maximise lamp's pressed state, which form the frame is in, and where a centred one opens.
 *
 * A leaf: it imports the design's geometry and nothing of the desk's. `fitBox` and the `refit`
 * each window wraps it in stay in `desk-window.js`, which owns the default box `fitBox` falls
 * back to — sharing them would close a cycle through that module rather than remove one.
 */

import { fitToDesk, PROMPT_CLEARANCE, refreshGeometry } from "../design/scripts/desk-geometry.js";

/** @typedef {import("../design/scripts/desk-geometry.js").Box} Box */

/** Over a wallpaper, a window carries its shadow at 40% rather than 24%. */
export const WALL_SHADOW = 0.4;

/** The selector the maximise lamp answers to, which is the design's and not the desk's. */
const MAXIMISE_LAMP = '.lamp[data-action="maximise"]';

/**
 * The leaf lamp is a toggle, so it reports whether it is pressed. Without this the only way to
 * know a window is maximised is to look at it.
 *
 * @param {{ el: { querySelector(selector: string): { setAttribute(name: string, value: string): void } | null }, maximised: boolean }} entry
 */
export function syncMaximiseLamp(entry) {
  entry.el
    .querySelector(MAXIMISE_LAMP)
    ?.setAttribute("aria-pressed", entry.maximised ? "true" : "false");
}

/**
 * Tell a window which form it is in. Below the breakpoint the maximise lamp is taken out of the
 * page — a tab stop whose Enter does nothing is worse than no tab stop — and the bar stops being
 * draggable, because `.window__bar--draggable` carries `touch-action: none` and a title bar left
 * wearing it on a phone hands every touch to a drag that stands itself down.
 *
 * @param {{ el: { querySelector(selector: string): { toggleAttribute(name: string, on: boolean): void } | null },
 *           win: { bar: { classList: { toggle(name: string, on: boolean): void } } } }} entry
 * @param {boolean} isPhone
 */
export function syncWindowForm(entry, isPhone) {
  entry.el.querySelector(MAXIMISE_LAMP)?.toggleAttribute("hidden", isPhone);
  entry.win.bar.classList.toggle("window__bar--draggable", !isPhone);
}

/**
 * A window centred on the room above the prompt bar's floor, taking `fill` of it. No floor of its
 * own under the halved room: `fitToDesk` clamps `y` into the desk anyway, and a second, higher
 * floor here would only ever disagree with the one that wins.
 *
 * @param {DOMRect} bounds
 * @param {{ w: number, h: number }} fill
 * @returns {Box}
 */
export function centredBox(bounds, fill) {
  refreshGeometry();
  const floor = bounds.height - PROMPT_CLEARANCE;
  const w = Math.round(bounds.width * fill.w);
  const h = Math.round(floor * fill.h);
  const y = Math.round((floor - h) / 2);
  return fitToDesk(bounds, { x: Math.round((bounds.width - w) / 2), y, w, h });
}

/**
 * Start a desk module once the document has a body to start it on. Guarded the way every browser
 * module here is: Bun has no `document`, so a module can be imported by a test for what it
 * exports without starting a desk.
 *
 * @param {() => void} start
 */
export function onDeskReady(start) {
  if (typeof document === "undefined") return;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}
