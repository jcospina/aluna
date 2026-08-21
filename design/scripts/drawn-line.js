// @ts-check
/**
 * The drawn line, as one definition: every border on screen is this line, not a CSS
 * border. Pure — geometry in, SVG strings out, never touching the DOM. `ink.js`
 * mounts what this builds; `window-frame.js` builds the one shape that needs more
 * than a box.
 *
 * CSS keeps the background: a 2px stroke centred on the path covers ±1px and the
 * largest deviation is 0.9px, so a true rectangle of background can never escape the
 * line. A shadow does not get that reprieve — it lands outside the ink, where a
 * straight edge beside a drawn one is visible — so it is drawn here instead.
 */

import {
  displace,
  round2 as f,
  ringPath,
  roundedRectPoints,
  sharpRectPoints,
} from "./lib/geometry.js";
import { HAND, SPEC } from "./spec.js";

/**
 * The second pass carries its own seed rather than being a translated copy of the
 * first, so the two lines diverge and converge along their length instead of running
 * parallel — a re-inking, not a shadow.
 */
const PASS_2_SEED = 130;

/** @typedef {import("./spec.js").Hand} Hand */

let uidCounter = 0;
/**
 * @param {string} prefix
 * @returns {string}
 */
const uid = (prefix) => `${prefix}-${++uidCounter}`;

/**
 * Every line is 2px. The weight argument exists so a component can say otherwise
 * in its own stylesheet, through `--ink-weight`; nothing on the surface does.
 *
 * @param {number} [weight]
 * @returns {string}
 */
export function strokeAttrs(weight = SPEC.weight) {
  return (
    `fill="none" stroke="var(--ink)" stroke-linejoin="round" ` +
    `stroke-linecap="round" stroke-width="${weight}"`
  );
}

/**
 * Build both SVG layers for one drawn box.
 *
 * Two layers, because real HTML content lives between them: `ground` carries the
 * shadow and the fill and sits behind the content, `ink` carries the two stroke
 * passes and sits in front, so content never crosses the frame.
 *
 * A box is inked as a closed ring rather than as four open edges (the window walks
 * its edges separately only because the title-bar rule runs through its frame).
 *
 * @param {object} opts
 * @param {number} opts.w        width in px
 * @param {number} opts.h        height in px
 * @param {number} opts.seed     the element's own seed, stable across renders
 * @param {Hand} [opts.hand]     HAND.frame or HAND.fine
 * @param {number} [opts.weight] stroke width; 2px unless `--ink-weight` says otherwise
 * @param {{x:number,y:number,alpha:number}|null} [opts.shadow] hard offset
 * @param {number} [opts.radius] corner radius; 0 — mitred — for all but the chip
 * @returns {{ground: string, ink: string, viewBox: string, width: number,
 *            height: number}}
 */
export function buildBoxFrame({
  w,
  h,
  seed,
  hand = HAND.fine,
  weight = SPEC.weight,
  shadow = null,
  radius = 0,
}) {
  const { passOffset } = hand;

  /* The line follows the shape CSS declares rather than carrying a second opinion
   * about it, so a rounded component stays a decision in its own stylesheet. */
  const sample = () => (radius > 0 ? roundedRectPoints(w, h, radius) : sharpRectPoints(w, h));

  /* One silhouette, used for the shadow and for the first ink pass. */
  const points = displace(sample(), hand, seed);
  const silhouette = ringPath(points);
  const second = ringPath(displace(sample(), hand, seed + PASS_2_SEED));

  let ground = "";
  if (shadow) {
    /*
     * The silhouette displaced, with the element's own silhouette cut back out, so
     * only the crescent falling clear of the element remains. Without the cut a 40%
     * ink wash sits under the whole component — the ground layer paints over the CSS
     * background, being a negative-z-index child of an isolated stacking context.
     *
     * The cut must be a clip, not a second subpath: two rings wound in opposite
     * directions only hole out where they *overlap*, and everywhere the displaced
     * ring misses, the element's own ring still winds to -1 and fills — an inner
     * shadow along the two edges the offset moves away from. Clipping to "anything
     * but the silhouette" leaves nothing inside the element at all.
     *
     * Classed so CSS can retract it: a button pressing onto its own shadow is a
     * state change, not a redraw.
     */
    const clipId = uid("ink-cast");
    const cast = ringPath(points.map((p) => ({ ...p, x: p.x + shadow.x, y: p.y + shadow.y })));

    /*
     * A field comfortably larger than anything the shadow can reach, with the
     * silhouette wound back out of it. The silhouette is strictly inside that
     * field, so here the non-zero rule *does* leave a true hole.
     */
    const reach = Math.max(Math.abs(shadow.x), Math.abs(shadow.y)) + SPEC.bleed;
    const field =
      `M${f(-reach)},${f(-reach)}H${f(w + reach)}V${f(h + reach)}H${f(-reach)}Z ` +
      ringPath([...points].reverse());

    ground +=
      `<defs><clipPath id="${clipId}"><path d="${field}"/></clipPath></defs>` +
      `<path class="ink-shadow" clip-path="url(#${clipId})" d="${cast}" ` +
      `fill="${shadow.alpha === 0.4 ? "var(--ink-shadow-wall)" : "var(--ink-shadow)"}"/>`;
  }

  const attrs = strokeAttrs(weight);
  const ink =
    `<g opacity="${SPEC.passInk}"><path d="${silhouette}" ${attrs}/></g>` +
    `<g opacity="${SPEC.passInk}" ` +
    `transform="translate(${f(passOffset[0])},${f(passOffset[1])})">` +
    `<path d="${second}" ${attrs}/></g>`;

  /*
   * The SVG box is exactly the element's box and the ink paints outside it
   * (`overflow: visible`, see ink.css). Sizing the SVG to include the overhang
   * instead would make it a box that overflows its element, which enlarges the
   * scrollable area of every ancestor. Paint that escapes a box does not.
   */
  return { ground, ink, viewBox: `0 0 ${w} ${h}`, width: w, height: h };
}
