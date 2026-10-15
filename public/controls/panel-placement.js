// @ts-check

/**
 * The box arithmetic a drawn listbox's panel is placed with. The panel is `position: fixed` inside
 * a desk window placed by `translate`, so where it may stand is worked out from its ancestors.
 */

/**
 * @param {{ top: number, left: number, right: number, bottom: number }} box
 * @param {number} by
 */
export function inset(box, by) {
  return {
    top: box.top + by,
    left: box.left + by,
    right: box.right - by,
    bottom: box.bottom - by,
  };
}

/** @param {number} value @param {number} low @param {number} high */
export function clamp(value, low, high) {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

/**
 * The box a fixed panel is actually painted inside — not its containing block, but any ancestor
 * up to it that both hides overflow and is positioned. A static scroller does not clip.
 *
 * @param {HTMLElement} panel
 */
export function clipBounds(panel) {
  const view = panel.ownerDocument.defaultView;
  let bounds = { top: 0, left: 0, right: view?.innerWidth ?? 0, bottom: view?.innerHeight ?? 0 };
  for (const node of clippingAncestors(panel)) {
    bounds = intersect(bounds, node.getBoundingClientRect());
  }
  return bounds;
}

/**
 * The ancestors that clip a fixed panel: those hiding their overflow, up to and including
 * the one that is its containing block.
 *
 * @param {HTMLElement} panel
 * @returns {HTMLElement[]}
 */
function clippingAncestors(panel) {
  const view = panel.ownerDocument.defaultView;
  /** @type {HTMLElement[]} */
  const clippers = [];
  for (let node = panel.parentElement; node; node = node.parentElement) {
    const style = view?.getComputedStyle(node);
    if (!style) break;
    // `translate`/`scale`/`rotate` make a containing block exactly as `transform` does, and a
    // dragged row carries a `translate` (design/styles/tokens.css).
    const containing =
      style.transform !== "none" ||
      style.filter !== "none" ||
      style.translate !== "none" ||
      style.scale !== "none" ||
      style.rotate !== "none";
    if (clips(style, containing)) clippers.push(node);
    if (containing) break;
  }
  return clippers;
}

/** @param {CSSStyleDeclaration} style @param {boolean} containing */
function clips(style, containing) {
  if (!containing && style.position === "static") return false;
  return style.overflowX !== "visible" || style.overflowY !== "visible";
}

/**
 * @param {{ top: number, left: number, right: number, bottom: number }} box
 * @param {DOMRect} other
 */
function intersect(box, other) {
  return {
    top: Math.max(box.top, other.top),
    left: Math.max(box.left, other.left),
    right: Math.min(box.right, other.right),
    bottom: Math.min(box.bottom, other.bottom),
  };
}
