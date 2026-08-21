// @ts-check
/**
 * Path geometry for the drawn line.
 *
 * The deviation is in *where the line goes*, never in how thick it is. So
 * everything here displaces sample points along their own normal and then
 * fits a spline through them; nothing in this file varies a stroke width.
 */

import { SPEC } from "../spec.js";
import { lineNoise, ringNoiseAt } from "./random.js";

/**
 * A sample point carrying the outward normal its displacement rides along, and
 * the index of the run it belongs to.
 *
 * `run` is what lets each edge of a box be given its own budget of waves rather
 * than its pro-rata share of one wave spread evenly round the perimeter — see
 * {@link displace}. A pinned corner belongs to the run that starts there, so a
 * run is exactly one edge and the boundary between two runs is exactly a corner.
 * @typedef {{ x: number, y: number, nx: number, ny: number, run: number }} NormalPoint
 */

/**
 * A path point once the normal has been spent. Every sampler's output widens
 * to this on the way into a spline, which only ever reads `x` and `y`.
 * @typedef {{ x: number, y: number }} PathPoint
 */

/**
 * The deviation controls a single run may override, all of them optional.
 * @typedef {{ amp?: number, wavelength?: number, step?: number }} WobbleOptions
 */

/**
 * Two decimal places is plenty for a 0.9px deviation, and halves path size.
 * @param {number} n
 * @returns {number}
 */
const f = (n) => Math.round(n * 100) / 100;

/**
 * Sample points around a sharp-cornered rectangle.
 *
 * Corners must be pinned: a spline through a corner rounds it, so the corner
 * point is repeated and the tangents collapse there. Without this, "mitred"
 * quietly becomes a 3px radius.
 *
 * @param {number} w
 * @param {number} h
 * @param {number} [step]
 * @returns {NormalPoint[]} points with normals
 */
export function sharpRectPoints(w, h, step = SPEC.step) {
  /** @type {NormalPoint[]} */
  const pts = [];
  /* One run per edge. The corner pinned at its start belongs to it, so a run's
   * arc length is exactly that edge's length and a run boundary is a corner. */
  let run = -1;
  /**
   * @param {number} x0
   * @param {number} y0
   * @param {number} x1
   * @param {number} y1
   * @param {number} nx
   * @param {number} ny
   */
  const seg = (x0, y0, x1, y1, nx, ny) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      pts.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, nx, ny, run });
    }
  };
  const k = Math.SQRT1_2;
  /**
   * Opens the next run: the corner is the first thing on the edge leaving it.
   * @param {number} x
   * @param {number} y
   * @param {number} nx
   * @param {number} ny
   */
  const pin = (x, y, nx, ny) => {
    run += 1;
    pts.push({ x, y, nx, ny, run });
    pts.push({ x, y, nx, ny, run });
  };

  pin(0, 0, -k, -k);
  seg(0, 0, w, 0, 0, -1);
  pin(w, 0, k, -k);
  seg(w, 0, w, h, 1, 0);
  pin(w, h, k, k);
  seg(w, h, 0, h, 0, 1);
  pin(0, h, -k, k);
  seg(0, h, 0, 0, -1, 0);
  return pts;
}

/**
 * Sample points around a rounded rectangle, corners included.
 *
 * Everything square-edged on this surface is a thing you *press*; the one caller
 * here is the status chip, which *reports*. Squared and inked it would be
 * indistinguishable from a button, so it stays a stadium.
 *
 * Nothing is pinned here, because a stadium has no corners to pin. At a radius of
 * half the height the two vertical runs vanish and the caps meet the top and bottom
 * runs tangentially.
 *
 * @param {number} w
 * @param {number} h
 * @param {number} radius
 * @param {number} [step]
 * @returns {NormalPoint[]} points with normals
 */
export function roundedRectPoints(w, h, radius, step = SPEC.step) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r === 0) return sharpRectPoints(w, h, step);

  /** @type {NormalPoint[]} */
  const pts = [];
  /* Straights and arcs alternate, and each is its own run. A straight the radius
   * has eaten contributes no points, so its run simply does not appear. */
  let index = -1;

  /**
   * A straight run contributes nothing when the radius has eaten it.
   * @param {number} x0
   * @param {number} y0
   * @param {number} x1
   * @param {number} y1
   * @param {number} nx
   * @param {number} ny
   */
  const run = (x0, y0, x1, y1, nx, ny) => {
    index += 1;
    const n = Math.round(Math.hypot(x1 - x0, y1 - y0) / step);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      pts.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, nx, ny, run: index });
    }
  };

  /**
   * The normal on an arc is the radius itself, so it comes free.
   * @param {number} cx
   * @param {number} cy
   * @param {number} from
   * @param {number} to
   */
  const arc = (cx, cy, from, to) => {
    index += 1;
    const n = Math.max(2, Math.round((Math.abs(to - from) * r) / step));
    for (let i = 0; i < n; i++) {
      const a = from + (to - from) * (i / n);
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      pts.push({ x: cx + nx * r, y: cy + ny * r, nx, ny, run: index });
    }
  };

  const q = Math.PI / 2;
  run(r, 0, w - r, 0, 0, -1);
  arc(w - r, r, -q, 0);
  run(w, r, w, h - r, 1, 0);
  arc(w - r, h - r, 0, q);
  run(w - r, h, r, h, 0, 1);
  arc(r, h - r, q, 2 * q);
  run(0, h - r, 0, r, -1, 0);
  arc(r, r, 2 * q, 3 * q);
  return pts;
}

/**
 * Push each point off true along its own normal, by smooth ring noise —
 * **giving each run its own budget of waves rather than its share of one.**
 *
 * Spreading the lattice evenly by arc length instead is what makes a control's short
 * edges come out straight: a box is not one length, so on a 220×36 shell the lateral
 * edges see less than one lattice cell each, and a near-constant displacement slides
 * an edge rather than bending it.
 *
 * So the wavelength sets the rate and `hand.cycles` floors the result: every run gets
 * `length / wavelength` waves, lifted so a short edge still bows once, and is then
 * given that many lattice cells of phase ({@link ringNoiseAt}). The ring still closes,
 * because the phases still sum to one turn.
 *
 * @param {NormalPoint[]} pts
 * @param {import("../spec.js").Hand} hand
 * @param {number} seed
 * @returns {NormalPoint[]}
 */
export function displace(pts, hand, seed) {
  const { deviation: amp, wavelength } = hand;
  if (amp <= 0 || pts.length === 0) return pts.map((p) => ({ ...p }));

  const spans = runSpans(pts);
  let total = 0;
  for (const span of spans.values()) {
    span.cycles = cyclesFor(span.length, wavelength, hand.cycles);
    total += span.cycles;
  }
  if (total <= 0) return pts.map((p) => ({ ...p }));

  const noise = ringNoiseAt(phaseOf(pts, spans, total), Math.max(4, Math.round(total)), seed);
  /* `ringNoiseAt` returns one value per phase, so the fallback is unreachable. */
  return pts.map((p, i) => ({
    ...p,
    x: p.x + p.nx * (noise[i] ?? 0) * amp,
    y: p.y + p.ny * (noise[i] ?? 0) * amp,
  }));
}

/**
 * One run's arc length, and the waves it is owed.
 * @typedef {{ length: number, cycles: number, start: number }} RunSpan
 */

/**
 * Measure every run. The step from a point to the next belongs to that point's
 * run, and the last step closes the ring — so the lengths sum to the perimeter
 * and nothing falls between two runs.
 *
 * @param {readonly NormalPoint[]} pts
 * @returns {Map<number, RunSpan>}
 */
function runSpans(pts) {
  /** @type {Map<number, RunSpan>} */
  const spans = new Map();
  for (const [i, p] of pts.entries()) {
    /* The ring wraps, so the fallback is unreachable. */
    const next = pts[(i + 1) % pts.length] ?? p;
    const span = spans.get(p.run) ?? { length: 0, cycles: 0, start: 0 };
    span.length += Math.hypot(next.x - p.x, next.y - p.y);
    spans.set(p.run, span);
  }
  return spans;
}

/**
 * The waves one run of `length` is owed: its own rate, floored, and never pushed
 * below `SPEC.minWave` — a floor applied to a 6px arc would ask for a wave a few
 * pixels long, and per-point randomness is sandpaper.
 *
 * @param {number} length
 * @param {number} wavelength
 * @param {import("../spec.js").CycleBounds} bounds
 * @returns {number}
 */
function cyclesFor(length, wavelength, [fewest, most]) {
  if (length <= 0) return 0;
  const floor = Math.min(fewest, length / SPEC.minWave);
  return Math.max(floor, Math.min(length / wavelength, most));
}

/**
 * Each point's phase round the ring, in [0, 1). Within a run the phase advances
 * in proportion to distance travelled *along that run*, so a run's whole budget
 * of waves is spent on it and nowhere else.
 *
 * @param {readonly NormalPoint[]} pts
 * @param {Map<number, RunSpan>} spans
 * @param {number} total
 * @returns {number[]}
 */
function phaseOf(pts, spans, total) {
  let cursor = 0;
  for (const span of spans.values()) {
    span.start = cursor;
    cursor += span.cycles;
  }

  /** @type {number[]} */
  const phases = [];
  /** @type {Map<number, number>} */
  const walked = new Map();
  for (const [i, p] of pts.entries()) {
    const span = spans.get(p.run);
    if (!span) {
      phases.push(0);
      continue;
    }
    const done = walked.get(p.run) ?? 0;
    const along = span.length > 0 ? done / span.length : 0;
    phases.push((span.start + span.cycles * along) / total);
    /* The ring wraps, so the fallback is unreachable. */
    const next = pts[(i + 1) % pts.length] ?? p;
    walked.set(p.run, done + Math.hypot(next.x - p.x, next.y - p.y));
  }
  return phases;
}

/**
 * Catmull-Rom through a closed ring of points, as cubic beziers.
 *
 * @param {PathPoint[]} p
 * @returns {string}
 */
export function ringPath(p) {
  const n = p.length;
  const first = p[0];
  if (n < 2 || !first) return "";
  /**
   * Ring access: the index wraps, so the fallback is unreachable.
   * @param {number} i
   * @returns {PathPoint}
   */
  const at = (i) => p[((i % n) + n) % n] ?? first;
  let d = `M${f(first.x)},${f(first.y)}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    d +=
      `C${f(p1.x + (p2.x - p0.x) / 6)},${f(p1.y + (p2.y - p0.y) / 6)} ` +
      `${f(p2.x - (p3.x - p1.x) / 6)},${f(p2.y - (p3.y - p1.y) / 6)} ` +
      `${f(p2.x)},${f(p2.y)}`;
  }
  return `${d}Z`;
}

/**
 * Catmull-Rom through an open run of points, as cubic beziers.
 *
 * @param {PathPoint[]} p
 * @returns {string}
 */
export function openPath(p) {
  const n = p.length;
  const first = p[0];
  if (n < 2 || !first) return "";
  /**
   * Open-run access: the index is clamped, so the fallback is unreachable.
   * @param {number} i
   * @returns {PathPoint}
   */
  const at = (i) => p[Math.min(n - 1, Math.max(0, i))] ?? first;
  let d = `M${f(first.x)},${f(first.y)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    d +=
      `C${f(p1.x + (p2.x - p0.x) / 6)},${f(p1.y + (p2.y - p0.y) / 6)} ` +
      `${f(p2.x - (p3.x - p1.x) / 6)},${f(p2.y - (p3.y - p1.y) / 6)} ` +
      `${f(p2.x)},${f(p2.y)}`;
  }
  return d;
}

/**
 * One straight run, displaced along its normal by smooth value noise.
 * This is the whole of the drawn line: an edge, or the title-bar rule.
 *
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {number} seed
 * @param {WobbleOptions} [opts]
 * @returns {PathPoint[]}
 */
export function wobbleLine(x0, y0, x1, y1, seed, opts = {}) {
  const amp = opts.amp ?? SPEC.deviation;
  const wavelength = opts.wavelength ?? SPEC.wavelength;
  const step = opts.step ?? SPEC.step;

  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const n = Math.max(2, Math.round(len / step) + 1);
  const nx = -(y1 - y0) / len;
  const ny = (x1 - x0) / len;
  const noise =
    amp > 0
      ? lineNoise(n, Math.max(2, len / wavelength), seed)
      : Array.from({ length: n }, () => 0);

  /** @type {PathPoint[]} */
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    /* `noise` carries one value per sample, so the fallback is unreachable. */
    pts.push({
      x: x0 + (x1 - x0) * t + nx * (noise[i] ?? 0) * amp,
      y: y0 + (y1 - y0) * t + ny * (noise[i] ?? 0) * amp,
    });
  }
  return pts;
}

export { f as round2 };
