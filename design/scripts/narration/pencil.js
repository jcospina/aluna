// @ts-check
/**
 * How the drawing moves between facts. A part being made is drawn one stroke after another across
 * the time it usually takes, each stroke's ghost fading as it is drawn over; its last stroke then
 * crawls on, each leg halving what is left of it, so a step that runs long still moves. When the
 * step ends the part finishes in one quick sweep. While a part's house rules are written its ghost
 * grows surer; a part being mended is rubbed out and drawn again; a run that fails lets go of what
 * it had not inked. The pace is written as custom properties that the sheet's own rules read
 * (narration.css).
 */

import { shape, shapesOf } from "./sheet.js";

/** How much of a stroke is left undrawn when the first sweep ends. */
const FIRST_REACH = 0.12;
/** The first sweep takes this share of the usual time; each leg of the crawl this many times it. */
const FIRST_SHARE = 0.9;
const CRAWL = 1.5;
const FIRST_EASE = "cubic-bezier(0.3, 0.55, 0.4, 1)";
/**
 * How much a stroke drawn in its turn leaves undrawn, too little to see. Finishing it is then a
 * change, which cuts short a stroke still waiting its turn; an equal end would leave it waiting.
 */
const SHORT = 0.002;

/** How quickly a finished step's strokes complete, and its ghosts go. */
export const SETTLE_MS = 450;

/** How long a part being mended takes to be rubbed out, before it is drawn again. */
const ERASE_MS = 500;
/** Where a rubbed-out stroke is set before it is drawn again: undrawn, and a change from 1. */
const ERASED = 1 + SHORT;

/**
 * How far each piece leans, in degrees, once a run that failed lets go of it, a second piece of
 * the same name by the second number. The frame holds.
 */
/** @type {Record<string, readonly number[]>} */
const LEAN = {
  rail: [2],
  newbtn: [3.5],
  count: [5],
  card: [2.5, 1.5],
  sheet: [1.5],
  save: [4],
  delete: [3],
};
/** How long after the piece before it each one lets go. */
const LETTING_GO_MS = 60;

/** How long a prod's tick stays before it fades. */
const PROD_MS = 1800;

/** How much of each stroke its last leg left undrawn, which is where the next leg starts. */
/** @type {WeakMap<Element, number>} */
const aimed = new WeakMap();

/** The drawing each part's last stroke is in, so a part drawn again leaves the old one behind. */
/** @type {WeakMap<Element, object>} */
const drawings = new WeakMap();

/**
 * @param {Element} node
 * @param {number} reach how much of the stroke stays undrawn
 * @param {string} pace a duration and an easing
 */
function aim(node, reach, pace) {
  aimed.set(node, reach);
  const { style } = /** @type {SVGElement} */ (node);
  style.setProperty("--narration-reach", String(reach));
  style.setProperty("--narration-pace", pace);
}

/** @param {Element} node */
const creeping = (node) => ["sketching", "mending"].includes(node.getAttribute("data-state") ?? "");

/**
 * How much of the stroke is undrawn right now, mid-transition included; all of it if unknown.
 *
 * @param {Element} node
 */
function standing(node) {
  const stands = Number.parseFloat(getComputedStyle(node).strokeDashoffset);
  return Number.isFinite(stands) ? stands : 1;
}

/**
 * Draw the named parts toward finished across `ms`, one stroke after another in the order they
 * stand in the drawing, then crawl on with the last. The caller puts them in their drawing state
 * in the same turn. Parts already being drawn, remade while they are made, go on as they were.
 *
 * @param {SVGSVGElement} svg
 * @param {readonly string[]} parts
 * @param {number} ms
 * @param {boolean} fades whether each stroke's ghost fades as it is drawn over
 * @returns {() => void} what stops the crawl
 */
export function creep(svg, parts, ms, fades) {
  const last = shapesOf(svg, parts).at(-1);
  if (!last || creeping(last)) return () => {};
  return sweep(svg, parts, ms, fades);
}

/**
 * Rub the named parts out, their ghosts coming back under them, then draw them again across `ms`
 * as `creep` draws them. The caller puts them in their drawing state in the same turn.
 *
 * @param {SVGSVGElement} svg
 * @param {readonly string[]} parts
 * @param {number} ms
 * @returns {() => void} what stops the drawing
 */
export function redraw(svg, parts, ms) {
  const last = shapesOf(svg, parts).at(-1);
  if (!last) return () => {};
  const erasing = {};
  drawings.set(last, erasing);
  for (const node of shapesOf(svg, parts)) aim(node, 1, `${ERASE_MS}ms ease-in`);
  for (const ghost of shapesOf(svg, parts, "ghost")) fade(ghost, null, ERASE_MS);
  let stop = () => {};
  const timer = setTimeout(() => {
    if (!current(svg, last, erasing)) return;
    // The rubbing out may not quite be over; a stroke still waiting its turn would hold that stub.
    for (const node of shapesOf(svg, parts)) aim(node, ERASED, "0s linear");
    stop = sweep(svg, parts, ms, true);
  }, ERASE_MS);
  return () => {
    clearTimeout(timer);
    stop();
  };
}

/**
 * @param {SVGSVGElement} svg
 * @param {Element} last
 * @param {object} drawing
 */
const current = (svg, last, drawing) =>
  svg.isConnected && creeping(last) && drawings.get(last) === drawing;

/**
 * @param {SVGSVGElement} svg
 * @param {readonly string[]} parts
 * @param {number} ms
 * @param {boolean} fades
 * @returns {() => void}
 */
function sweep(svg, parts, ms, fades) {
  const shapes = shapesOf(svg, parts);
  const last = shapes.at(-1);
  if (!last) return () => {};
  const drawing = {};
  drawings.set(last, drawing);
  const leg = Math.round(ms * CRAWL);
  /** @param {number} i */
  const turn = (i) => Math.round((i * ms * FIRST_SHARE) / Math.max(1, shapes.length));
  shapes.forEach((node, i) => {
    const reach = Math.min(standing(node), node === last ? FIRST_REACH : SHORT);
    aim(node, reach, `${turn(i + 1) - turn(i)}ms ${FIRST_EASE} ${turn(i)}ms`);
  });
  if (fades) {
    shapesOf(svg, parts, "ghost").forEach((ghost, i) => {
      fade(ghost, "fading", turn(i + 1) - turn(i), turn(i));
    });
  }
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const crawl = () => {
    if (!current(svg, last, drawing)) return;
    aim(last, (aimed.get(last) ?? FIRST_REACH) / 2, `${leg}ms linear`);
    timer = setTimeout(crawl, leg);
  };
  timer = setTimeout(crawl, ms * FIRST_SHARE);
  return () => clearTimeout(timer);
}

/**
 * The named parts finish quickly, whatever they were drawing toward. Which state they finish in
 * is the caller's.
 *
 * @param {SVGSVGElement} svg
 * @param {readonly string[]} parts
 */
export function settle(svg, parts) {
  for (const node of shapesOf(svg, parts)) aim(node, 0, `${SETTLE_MS}ms ease-out`);
}

/**
 * A ghost still coming in is let arrive, so the opacity a stopped drawing keeps is its own, not
 * one on its way in.
 *
 * @param {Element} ghost
 */
function arrive(ghost) {
  for (const animation of ghost.getAnimations?.() ?? []) {
    if (animation instanceof CSSAnimation && animation.animationName === "narration-ghost") {
      animation.finish();
    }
  }
}

/**
 * Every stroke stops where it stands; one already finished stands at its end.
 *
 * @param {SVGSVGElement} svg
 */
export function freeze(svg) {
  // A prod's tick and a ghost on its way out only ever pass; once the drawing stops, they are gone.
  for (const node of svg.querySelectorAll(".narration__prod, [data-leaving]")) node.remove();
  for (const node of svg.querySelectorAll("[data-part]")) aim(node, standing(node), "0s linear");
  for (const node of svg.querySelectorAll("[data-ghost]")) {
    const { style } = /** @type {SVGElement} */ (node);
    arrive(node);
    const { opacity } = getComputedStyle(node);
    if (opacity) style.setProperty("opacity", opacity);
    style.setProperty("--narration-fade", "0s");
    style.setProperty("--narration-fade-delay", "0s");
  }
  svg.setAttribute("data-still", "");
}

/**
 * @param {Element} ghost
 * @param {string | null} state none for a ghost back as it first stood
 * @param {number} ms
 * @param {number} [delay]
 */
function fade(ghost, state, ms, delay = 0) {
  const { style } = /** @type {SVGElement} */ (ghost);
  style.setProperty("--narration-fade", `${Math.round(ms)}ms`);
  style.setProperty("--narration-fade-delay", `${Math.round(delay)}ms`);
  if (state) ghost.setAttribute("data-state", state);
  else ghost.removeAttribute("data-state");
}

/**
 * The ghosts of the named parts go across `ms`. A ghost drawn over is all but gone (`creep`), and
 * this takes it the rest of the way, so a part finished early takes its ghost with it at once
 * rather than at the pace it set out at.
 *
 * @param {SVGSVGElement} svg
 * @param {readonly string[]} parts
 * @param {number} ms
 */
export function unghost(svg, parts, ms) {
  for (const node of shapesOf(svg, parts, "ghost")) fade(node, "gone", ms);
}

/**
 * The ghosts of the named parts grow surer across `ms` while their house rules are written, and
 * finish growing sure at once when they are, however far along they were.
 *
 * @param {SVGSVGElement} svg
 * @param {readonly string[]} parts
 * @param {"writing" | "written"} state
 * @param {number} ms
 */
export function firm(svg, parts, state, ms) {
  for (const node of shapesOf(svg, parts, "ghost")) {
    const { style } = /** @type {SVGElement} */ (node);
    style.setProperty("--narration-fade", `${Math.round(state === "writing" ? ms : SETTLE_MS)}ms`);
    node.setAttribute("data-rules", state);
  }
}

/**
 * A run that failed lets go of every piece it had not inked, its ghost with it: each leans from its
 * own corner, a moment after the piece before it. Ink the checks had not yet confirmed goes back to
 * pencil, so what holds is what is inked.
 *
 * @param {SVGSVGElement} svg
 */
export function loosen(svg) {
  /** @type {Map<string, Element[]>} */
  const ghosts = new Map();
  for (const ghost of svg.querySelectorAll("[data-ghost-piece]:not([data-leaving])")) {
    const name = String(ghost.getAttribute("data-ghost-piece"));
    ghosts.set(name, [...(ghosts.get(name) ?? []), ghost]);
  }
  /** @type {Map<string, number>} */
  const seen = new Map();
  const loose = [...svg.querySelectorAll("[data-piece]")].flatMap((piece) => {
    const name = String(piece.getAttribute("data-piece"));
    const nth = seen.get(name) ?? 0;
    seen.set(name, nth + 1);
    const twin = ghosts.get(name)?.[nth];
    // The field names are inked only once the window lands; the sheet holds by its own lines.
    if (!piece.querySelector('[data-part]:not([data-part="labels"]):not([data-state="inked"])')) {
      return [];
    }
    const shown =
      piece.querySelector("[data-part][data-state]") ??
      twin?.querySelector('[data-ghost]:not([data-state="gone"])');
    if (!shown) return [];
    const lean = LEAN[name]?.[nth] ?? LEAN[name]?.[0] ?? 0;
    return [{ nodes: twin ? [piece, twin] : [piece], lean }];
  });
  loose.forEach(({ nodes, lean }, i) => {
    for (const node of nodes) {
      const { style } = /** @type {SVGElement} */ (node);
      style.setProperty("--narration-lean", `${lean}deg`);
      style.setProperty("--narration-lean-delay", `${i * LETTING_GO_MS}ms`);
      node.setAttribute("data-loose", "");
    }
  });
  for (const node of svg.querySelectorAll('[data-state="inking"]')) {
    node.setAttribute("data-state", "sketched");
  }
}

/**
 * A small tick on one of the drawn boxes, gone again a moment later: the poking and prodding.
 *
 * @param {SVGSVGElement} svg
 */
export function prod(svg) {
  const boxes = [...svg.querySelectorAll("rect[data-part]")].filter(
    (box) => box.getAttribute("data-part") !== "frame",
  );
  const box = boxes[Math.floor(Math.random() * boxes.length)];
  if (!box) return;
  const [x = 0, y = 0, w = 0, h = 0] = ["x", "y", "width", "height"].map((name) =>
    Number(box.getAttribute(name) ?? 0),
  );
  const at = [x + 4 + Math.random() * Math.max(1, w - 14), y + Math.min(h - 4, 10)];
  const [tx = 0, ty = 0] = at.map((value) => value.toFixed(1));
  const d = `M${tx} ${ty}l2.4 2.6l4.6-5.6`;
  const tick = shape("path", { class: "narration__prod", pathLength: 1, d });
  svg.append(tick);
  setTimeout(() => tick.setAttribute("data-state", "gone"), PROD_MS);
  setTimeout(() => tick.remove(), PROD_MS + 700);
}
