// @ts-check
/**
 * Drawing the frame.
 *
 * Ten stroke paths per window: four edges plus the title-bar rule, twice. The
 * fill silhouette is a closed ring over the same four edges.
 *
 * Four rules matter more than this code does:
 *   1. The noise is smooth and periodic       — see lib/random.js
 *   2. The seed lives on the window           — see window.js
 *   3. Regenerate on resize only              — see window.js
 *   4. Corners must be pinned                 — see lib/geometry.js
 *
 * This module is pure: geometry in, SVG strings out. It never touches the DOM
 * and never decides when to run.
 */

import { strokeAttrs as inkStroke } from "./drawn-line.js";
import {
  displace,
  round2 as f,
  openPath,
  ringPath,
  sharpRectPoints,
  wobbleLine,
} from "./lib/geometry.js";
import { HAND, SHADOW_OFFSET, SPEC } from "./spec.js";

const SURFACE = "var(--surface)";
const PANES = Object.freeze([
  "var(--pane-1)",
  "var(--pane-2)",
  "var(--pane-3)",
  "var(--pane-4)",
  "var(--pane-5)",
]);

/** @param {number} alpha */
function shadowFill(alpha) {
  return alpha === 0.4 ? "var(--ink-shadow-wall)" : "var(--ink-shadow)";
}

let uidCounter = 0;
/**
 * @param {string} prefix
 * @returns {string}
 */
const uid = (prefix) => `${prefix}-${++uidCounter}`;

/**
 * The window is drawn in the full hand — it is one of the two things on the
 * surface that is, the other being the prompt rail. Everything inside it is
 * drawn in the fine hand by `drawn-line.js`, which is what lets the frame read
 * as being in front of its contents without the frame getting thicker.
 */
const HERE = HAND.frame;

const strokeAttrs = inkStroke(SPEC.weight);

/**
 * One inking pass: four mitred edges plus the title-bar rule, which runs
 * through the frame rather than stopping at it.
 *
 * Each pass carries its own seed. It is a genuine re-inking, not a translated
 * copy — that is what makes the two lines diverge and converge along their
 * length instead of running parallel.
 *
 * @param {object} pass
 * @param {number} pass.w       window width in px
 * @param {number} pass.h       window height in px
 * @param {number} pass.barH    title-bar height in px, where the rule sits
 * @param {number} pass.seed    this pass's own seed
 * @param {number} pass.dx      px this pass lands across from the first
 * @param {number} pass.dy      px this pass lands down from the first
 * @param {number} pass.reach   px each side the rule runs through the frame
 * @param {boolean} pass.divider whether this window has a rule to draw
 * @returns {string}
 */
function inkPass({ w, h, barH, seed, dx, dy, reach, divider }) {
  /**
   * @param {number} x0
   * @param {number} y0
   * @param {number} x1
   * @param {number} y1
   * @param {number} s
   */
  const line = (x0, y0, x1, y1, s) =>
    wobbleLine(x0, y0, x1, y1, s, { amp: HERE.deviation, wavelength: HERE.wavelength });

  const edges = [
    line(0, 0, w, 0, seed + 1),
    line(w, 0, w, h, seed + 2),
    line(w, h, 0, h, seed + 3),
    line(0, h, 0, 0, seed + 4),
  ];
  if (divider) {
    edges.push(line(-reach, barH, w + reach, barH, seed + 41));
  }
  const paths = edges.map((pts) => `<path d="${openPath(pts)}" ${strokeAttrs}/>`).join("");
  const move = dx || dy ? ` transform="translate(${f(dx)},${f(dy)})"` : "";
  return `<g opacity="${SPEC.passInk}"${move}>${paths}</g>`;
}

/**
 * Build both SVG layers for one window.
 *
 * The window is drawn in two layers because real HTML content lives between
 * them: `ground` carries the shadow, the fill and the title-bar panes and sits
 * behind the content; `ink` carries the two stroke passes and sits in front,
 * so the frame is genuinely a frame and content never crosses it.
 *
 * @param {object} opts
 * @param {number} opts.w      window width in px
 * @param {number} opts.h      window height in px
 * @param {number} opts.barH   title-bar height in px, where the rule sits
 * @param {number} opts.seed   the window's own seed, stable across drags
 * @param {number} [opts.dividerReach] px each side the rule runs through
 * @param {boolean} [opts.unfocused] desaturate the title bar to 50%
 * @param {number} [opts.shadowAlpha] 0.24 on flat ground, 0.4 over wallpaper
 * @param {boolean} [opts.divider] false for a rolled-up window, which is all
 *   title bar and has nothing to divide
 * @returns {{ground: string, ink: string, viewBox: string, width: number,
 *            height: number}}
 */
export function buildFrame({
  w,
  h,
  barH,
  seed,
  dividerReach = SPEC.dividerReach,
  unfocused = false,
  shadowAlpha = 0.24,
  divider = true,
}) {
  /* A drawing coordinate, not a box dimension — see the return below. */
  const bleed = SPEC.bleed;
  const clipId = uid("win-clip");
  const desatId = uid("win-desat");

  /* The silhouette: one closed ring over the same four edges the ink walks. */
  const silhouette = ringPath(displace(sharpRectPoints(w, h), HERE, seed));

  /*
   * The title-bar rule, as a boundary rather than a stroke. Painting the bar
   * full-bleed and then painting the body surface over everything below this
   * path is what makes the cut follow the drawn line exactly.
   */
  const dividerPts = wobbleLine(-bleed, barH, w + bleed, barH, seed + 41);
  const bodyFill =
    `${openPath(dividerPts)} L${w + bleed},${h + bleed} ` + `L${-bleed},${h + bleed} Z`;

  /* ── ground: shadow, fill, panes ─────────────────────────────────────── */
  /* A rolled-up window is all title bar, so the panes run its full height. */
  const barFillH = divider ? barH + bleed : h + bleed * 2;
  let bar =
    `<rect x="${-bleed}" y="${-bleed}" width="${w + bleed * 2}" ` +
    `height="${barFillH}" fill="${SURFACE}"/>`;
  PANES.forEach((color, i) => {
    bar +=
      `<rect x="${f(w * (0.5 + i * 0.1))}" y="${-bleed}" ` +
      `width="${f(w * 0.1) + 1}" height="${barFillH}" fill="${color}"/>`;
  });

  let ground =
    `<path d="${silhouette}" fill="${shadowFill(shadowAlpha)}" ` +
    `transform="translate(${SHADOW_OFFSET.x},${SHADOW_OFFSET.y})"/>`;
  ground += `<g clip-path="url(#${clipId})">`;
  ground += unfocused ? `<g filter="url(#${desatId})">${bar}</g>` : bar;
  if (divider) ground += `<path d="${bodyFill}" fill="${SURFACE}"/>`;
  ground += `</g>`;

  const defs =
    `<clipPath id="${clipId}"><path d="${silhouette}"/></clipPath>` +
    (unfocused
      ? `<filter id="${desatId}"><feColorMatrix type="saturate" values="0.5"/></filter>`
      : "");

  ground = `<defs>${defs}</defs>${ground}`;

  /* ── ink: the two passes ─────────────────────────────────────────────── */
  const ink =
    inkPass({ w, h, barH, seed, dx: 0, dy: 0, reach: dividerReach, divider }) +
    inkPass({
      w,
      h,
      barH,
      seed: seed + 130,
      dx: HERE.passOffset[0],
      dy: HERE.passOffset[1],
      reach: dividerReach * SPEC.pass2Reach,
      divider,
    });

  /*
   * The SVG box is the window's box. The shadow, the overhanging title-bar rule
   * and the outer half of the stroke all paint outside it — `bleed` is a
   * drawing coordinate, never a box dimension. An SVG grown to contain the
   * overhang would be a box overflowing the window, and every ancestor's
   * scrollable area would grow with it: a horizontal scrollbar on the page,
   * and two more inside anything that scrolls. Paint that escapes does not.
   */
  return { ground, ink, viewBox: `0 0 ${w} ${h}`, width: w, height: h };
}
