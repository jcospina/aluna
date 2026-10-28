// @ts-check
/**
 * The draughtsman's pencil: a ring round a part, a highlighter behind words and a quick arrow to
 * either, in clay. The window's anatomy marks a print with it, and the architecture deck marks the
 * build it walks through.
 */

import { round2 as f, openPath } from "./geometry.js";

/**
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ kind: "loop", at: Point, rx: number, ry: number, square?: number }} Loop a `square`
 *   above 2 bends the ring toward a rectangle, for a target too wide for an ellipse
 * @typedef {{ kind: "highlight", from: Point, to: Point, thick: number }} Highlight
 */

const SVG_NS = "http://www.w3.org/2000/svg";

export const PENCIL = {
  fill: "none",
  stroke: "var(--clay)",
  "stroke-width": "1.75",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
};

/** A highlighter's ink, swiped behind words; its width is the height of what it marks. */
export const HIGHLIGHTER = { fill: "none", stroke: "var(--sun)", opacity: "0.6" };

/**
 * @param {string} name
 * @param {Record<string, string>} attributes
 */
export function svgShape(name, attributes) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

/**
 * A pencil ring round a part: one stroke that runs on past where it started, opening as it
 * goes, so it never quite closes on itself.
 *
 * @param {Loop} loop
 * @param {() => number} rnd
 */
export function ring({ at, rx, ry, square = 2 }, rnd) {
  const start = -Math.PI * (0.6 + rnd() * 0.25);
  const sweep = Math.PI * 2 * (1.14 + rnd() * 0.1);
  // A long ring leans less, or its ends would cross what it rings.
  const tilt = (rnd() - 0.5) * 0.35 * (square > 2 ? Math.min(1, ry / rx) : 1);
  /** @param {number} v */
  const bend = (v) => Math.sign(v) * Math.abs(v) ** (2 / square);
  const steps = square > 2 ? 48 : 28;
  /** @type {Point[]} */
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = start + sweep * t;
    const x = bend(Math.cos(a)) * rx * (0.94 + 0.16 * t);
    const y = bend(Math.sin(a)) * ry * (0.94 + 0.16 * t);
    points.push({
      x: at.x + x * Math.cos(tilt) - y * Math.sin(tilt),
      y: at.y + x * Math.sin(tilt) + y * Math.cos(tilt),
    });
  }
  return openPath(points);
}

/**
 * A highlighter swipe: straight-ish, a little uphill, and wobbling where the hand did.
 *
 * @param {Highlight} highlight
 * @param {() => number} rnd
 */
export function swipe({ from, to }, rnd) {
  /** @type {Point[]} */
  const points = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    points.push({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t + (rnd() - 0.5) * 1.4,
    });
  }
  return openPath(points);
}

/**
 * A quick pen arrow: a shallow bow, and a head of two unequal flicks.
 *
 * @param {Point} from
 * @param {Point} to
 * @param {() => number} rnd
 */
export function arrow(from, to, rnd) {
  const { shaft, head } = arrowParts(from, to, rnd);
  return `${shaft} ${head}`;
}

/**
 * The same arrow as its two strokes, for a hand that draws the shaft and then the head.
 *
 * @param {Point} from
 * @param {Point} to
 * @param {() => number} rnd
 */
export function arrowParts(from, to, rnd) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const bow = (rnd() < 0.5 ? -1 : 1) * length * (0.12 + rnd() * 0.08);
  const c = { x: from.x + dx / 2 - (dy / length) * bow, y: from.y + dy / 2 + (dx / length) * bow };
  const back = Math.atan2(c.y - to.y, c.x - to.x);
  /** @param {number} spread @param {number} size */
  const flick = (spread, size) =>
    `${f(to.x + Math.cos(back + spread) * size)},${f(to.y + Math.sin(back + spread) * size)}`;
  const tip = `${f(to.x)},${f(to.y)}`;
  return {
    shaft: `M${f(from.x)},${f(from.y)} Q${f(c.x)},${f(c.y)} ${tip}`,
    head: `M${flick(0.5, 9)} L${tip} L${flick(-0.42, 7.5)}`,
  };
}

/**
 * Where an arrow from `from` lands: just clear of a ring, or just above a highlighted word.
 *
 * @param {Loop | Highlight} mark
 * @param {Point} from
 * @returns {Point}
 */
export function aim(mark, from) {
  if (mark.kind === "highlight") {
    const x = Math.min(Math.max(from.x, mark.from.x + 8), mark.to.x - 8);
    return { x, y: Math.min(mark.from.y, mark.to.y) - mark.thick / 2 - 5 };
  }
  const { at, rx, ry } = mark;
  const a = Math.atan2(from.y - at.y, from.x - at.x);
  const reach = (rx * ry) / Math.hypot(ry * Math.cos(a), rx * Math.sin(a)) + 7;
  return { x: at.x + Math.cos(a) * reach, y: at.y + Math.sin(a) * reach };
}
