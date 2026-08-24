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

/**
 * Every length below is the stylesheet's, read back rather than restated: the
 * logo grid stops on the same floor the windows do, and a second copy here
 * would let the two drift. `tokens.css` registers each one as a `<length>`, so
 * what comes back is already resolved to pixels at whatever text size the
 * reader has set — the layout is in rem and this file never has to know it.
 *
 * The literals are the fallback for a stylesheet that has not applied yet, and
 * they are stated here once rather than beside each length below.
 */
const FALLBACK = { minW: 276, minH: 176, clearance: 78, edge: 18 };

/**
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function readLength(name, fallback) {
  if (typeof window === "undefined") return fallback;
  const root = getComputedStyle(document.documentElement);
  const declared = root.getPropertyValue(name).trim();

  /*
   * Registered, so this arrives in pixels. Where the registration did not take —
   * a browser without `@property`, a build that dropped an at-rule it did not
   * know — what arrives is the rem literal, and `4.875` is a number every check
   * below would accept and the desk would then lay itself out on. Resolve it
   * here instead: falling back to the literal would leave the windows stopping
   * on one floor and the logo grid on another, which is the drift this file
   * reads the stylesheet to avoid.
   */
  const value = Number.parseFloat(declared);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  if (declared.endsWith("px")) return value;
  if (declared.endsWith("rem")) return value * (Number.parseFloat(root.fontSize) || 16);
  return fallback;
}

/** No window goes below this, at any size of screen. */
export let MIN_SIZE = { w: FALLBACK.minW, h: FALLBACK.minH };

/** The strip the prompt bar reserves along the bottom. */
export let PROMPT_CLEARANCE = FALLBACK.clearance;

/** The inset a maximised window keeps on the other three sides. */
export let EDGE = FALLBACK.edge;

/**
 * Re-read all four, because none of them is a constant any more: they are rem,
 * and the reader's text size is a setting that can change with the page open.
 * Held from module load, a maximised window would keep the floor it was fitted
 * to and slide under a prompt bar that had grown past it.
 *
 * Every function below opens with this rather than trusting what it was handed
 * at import, so a clamp is right whether or not anything noticed the change.
 * The desk calls it too, from the path that re-fits what it remembers — that is
 * what moves a window already on screen, where this only stops the next
 * question being answered from a stale floor.
 */
export function refreshGeometry() {
  MIN_SIZE = {
    w: readLength("--window-min-w", FALLBACK.minW),
    h: readLength("--window-min-h", FALLBACK.minH),
  };
  PROMPT_CLEARANCE = readLength("--prompt-clearance", FALLBACK.clearance);
  EDGE = readLength("--window-edge", FALLBACK.edge);
}

refreshGeometry();

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
  refreshGeometry();
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
  refreshGeometry();
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
  refreshGeometry();
  box.x = EDGE;
  box.y = EDGE;
  box.w = Math.round(bounds.width - EDGE * 2);
  box.h = Math.round(bounds.height - EDGE * 2 - PROMPT_CLEARANCE);
  return box;
}
