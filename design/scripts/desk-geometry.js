// @ts-check
/**
 * Where a window is allowed to be.
 *
 * The desk has edges, and one of them is not a real edge: the prompt bar
 * floats over the bottom of the surface and reserves a strip there. That strip
 * is a floor for every window — maximise stops clear of it, and so do
 * dragging and resizing, so the tail of a records list is never hidden under
 * the bar and never unclickable.
 *
 * Kept apart from `desk.js` because these are the only functions on the desk
 * that answer a question about the screen rather than about a capability.
 */

/** A window's box. The only geometry anything on this surface has. */
/** @typedef {{ x: number, y: number, w: number, h: number }} Box */

/** No window goes below this, at any size of screen. */
export const MIN_SIZE = { w: 276, h: 176 };

/**
 * The strip the prompt bar reserves along the bottom.
 *
 * The stylesheet owns this number — the logo grid stops on the same floor, so
 * restating it here would let the two drift. Read once at module load, with the
 * literal kept only as the fallback for a stylesheet that has not applied yet.
 */
export const PROMPT_CLEARANCE = readClearance();

function readClearance() {
  if (typeof window === "undefined") return 78;
  const declared = getComputedStyle(document.documentElement)
    .getPropertyValue("--prompt-clearance")
    .trim();
  const value = Number.parseFloat(declared);
  return Number.isFinite(value) && value > 0 ? value : 78;
}

/** The inset a maximised window keeps on the other three sides. */
export const EDGE = 18;

/**
 * Below this the window stops floating and is the screen. Forms drop to one
 * column at 620px; that one is the stylesheet's alone.
 */
export const PHONE = "(max-width: 720px)";

/**
 * @param {number} value
 * @param {number} low
 * @param {number} high
 * @returns {number}
 */
const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

/**
 * Geometry goes onto the element as custom properties rather than as inline
 * `width`/`transform`, so the phone layout can override it by ordinary
 * cascade — an inline style would need `!important` to beat.
 *
 * @param {HTMLElement} el
 * @param {Box} box
 */
export function placeWindow(el, box) {
  el.style.setProperty("--win-w", `${box.w}px`);
  el.style.setProperty("--win-h", `${box.h}px`);
  el.style.setProperty("--win-x", `${box.x}px`);
  el.style.setProperty("--win-y", `${box.y}px`);
}

/**
 * Hold a window on the desk while it is dragged. Size is untouched: a drag
 * moves a window and never resizes one, so the bottom edge stops at the
 * prompt bar's strip rather than the window collapsing against it.
 *
 * @param {DOMRect} bounds the desk
 * @param {Box} box mutated in place
 * @returns {Box}
 */
export function clampPosition(bounds, box) {
  const floor = bounds.height - PROMPT_CLEARANCE;
  box.x = Math.round(clamp(box.x, 0, Math.max(0, bounds.width - box.w)));
  box.y = Math.round(clamp(box.y, 0, Math.max(0, floor - box.h)));
  return box;
}

/**
 * Hold a window on the desk while it is resized. Position is untouched,
 * because the grip drags the bottom-right corner and the top-left stays where
 * it is, so the room a window has is the room to the right of and below it.
 *
 * @param {DOMRect} bounds the desk
 * @param {Box} box mutated in place
 * @returns {Box}
 */
export function clampSize(bounds, box) {
  const floor = bounds.height - PROMPT_CLEARANCE;
  box.w = Math.round(clamp(box.w, MIN_SIZE.w, Math.max(MIN_SIZE.w, bounds.width - box.x)));
  box.h = Math.round(clamp(box.h, MIN_SIZE.h, Math.max(MIN_SIZE.h, floor - box.y)));
  return box;
}

/**
 * Fit a whole box to the desk, for a box arriving from storage or surviving a
 * screen that changed size. Position first, so a window remembered off the
 * right of a smaller screen is pulled inside at the size it had rather than
 * being cut down to the sliver that was left where it used to sit.
 *
 * @param {DOMRect} bounds the desk
 * @param {Box} box mutated in place
 * @returns {Box}
 */
export function fitToDesk(bounds, box) {
  return clampSize(bounds, clampPosition(bounds, box));
}

/**
 * The maximised box, computed rather than stored (D9): the desk less its
 * inset, and less the prompt bar's strip along the bottom.
 *
 * @param {DOMRect} bounds the desk
 * @param {Box} box mutated in place
 * @returns {Box}
 */
export function fillDesk(bounds, box) {
  box.x = EDGE;
  box.y = EDGE;
  box.w = Math.round(bounds.width - EDGE * 2);
  box.h = Math.round(bounds.height - EDGE * 2 - PROMPT_CLEARANCE);
  return box;
}
