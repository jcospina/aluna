// @ts-check
/**
 * The ink system: mounts the drawn line from `drawn-line.js` onto live elements
 * and keeps several hundred of them redrawn without stalling the page.
 *
 * CSS still owns layout and colour. Mounting takes over a component's border and
 * draws it by hand, which works because of three things:
 *
 *   1. The border is made transparent, not removed (ink.css), so it still occupies
 *      its 2px and no padding value had to change.
 *   2. The background is left alone — a 2px stroke centred on the path covers ±1px
 *      and the largest deviation is 0.9px, so the CSS background cannot escape it.
 *   3. A CSS shadow is a true rectangle, so a straight edge would show next to a
 *      drawn one. A component hands its shadow over as `--ink-shadow` instead, and
 *      it is drawn on the same deviating path.
 */

import { buildBoxFrame } from "./drawn-line.js";
import { fineHand, HAND, SPEC } from "./spec.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Which boundaries are drawn: the outer boundary of every component.
 *
 * Deliberately absent and still ruled by CSS are internal dividers (they divide,
 * they do not enclose) and page chrome. Height is not the test — what has to be
 * long enough to complete a cycle of the deviation is the *perimeter*, so a 22px
 * checkbox and a 20px-tall chip are both drawn (in the close hand) even though a
 * straight edge that short would read as bent rather than drawn.
 *
 * Moving something between drawn and ruled is a one-line edit here.
 */
export const INK_SELECTOR = [
  /* Things you press */
  ".btn",
  ".segmented",
  /* Things you type into */
  ".search",
  ".field__control",
  ".prompt-bar",
  /* Things you choose from */
  ".listbox__panel",
  ".choice__mark",
  /* Things that report state */
  ".pill",
  ".stage__tag",
  /* Things that contain other things */
  ".record",
  ".note",
  ".spec",
  ".numbers",
  ".swatch",
  ".specimen",
  ".stage",
  /* Anything asking for it by name */
  "[data-ink]",
].join(",");

/** @typedef {import("./spec.js").Hand} Hand */

/**
 * What was last drawn for one mounted element. `key` is the measured box and
 * hand rolled into a string, so a redraw that would change nothing is skipped.
 * @typedef {{ ground: SVGSVGElement, ink: SVGSVGElement, seed: number, key: string }} InkRecord
 */

/** @type {WeakMap<HTMLElement, InkRecord>} */
const MOUNTED = new WeakMap();

/**
 * Every drawn element at or under `root`. Narrowed to `HTMLElement` because the
 * ink measures an offset box, which an SVG element caught by the same selector
 * does not have.
 *
 * @param {Document | Element} root
 * @returns {HTMLElement[]}
 */
function inkTargets(root) {
  return [...root.querySelectorAll(INK_SELECTOR)].filter((el) => el instanceof HTMLElement);
}

/**
 * A seed per element, handed out in mount order. Never derived from position or
 * size, so a frame does not re-roll the moment something moves.
 */
let seedCounter = 7919;

/** The next hand. A cheap deterministic walk, not randomness — order is enough. */
function nextSeed() {
  seedCounter = (seedCounter * 31 + 17) % 100000;
  return seedCounter;
}

/* ── Reading what CSS already said ──────────────────────────────────────── */

/**
 * @param {CSSStyleDeclaration} styles
 * @param {string} name
 * @returns {string}
 */
const readProp = (styles, name) => styles.getPropertyValue(name).trim();

/**
 * `--ink-shadow: <x> <y> <alpha>`, or absent for none. Three numbers rather than a
 * `box-shadow` because this shadow is a path, not a box — the element's own
 * silhouette displaced, deviating with the line it belongs to.
 *
 * @param {CSSStyleDeclaration} styles
 * @returns {{ x: number, y: number, alpha: number } | null}
 */
function readShadow(styles) {
  const raw = readProp(styles, "--ink-shadow");
  if (!raw || raw === "none") return null;
  /* A short declaration leaves NaN behind, which the finite checks below read
   * exactly as a missing component. */
  const [x = Number.NaN, y = Number.NaN, alpha = Number.NaN] = raw.split(/[\s,]+/).map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y, alpha: Number.isFinite(alpha) ? alpha : 0.24 };
}

/**
 * `--ink-hand: frame | fine | close`. Fine unless the component says otherwise:
 * `frame` for a surface that holds things, `close` for a part small enough that
 * the fine hand's wavelength would not complete a cycle round its perimeter.
 *
 * @param {CSSStyleDeclaration} styles
 * @returns {Hand}
 */
function readHand(styles) {
  const named = readProp(styles, "--ink-hand");
  if (named === "frame") return HAND.frame;
  if (named === "close") return HAND.close;
  return fineHand();
}

/**
 * @param {CSSStyleDeclaration} styles
 * @returns {number}
 */
function readWeight(styles) {
  const raw = Number(readProp(styles, "--ink-weight"));
  return Number.isFinite(raw) && raw > 0 ? raw : SPEC.weight;
}

/**
 * The corner, read from the element's own `border-radius` rather than a custom
 * property — the component already states its shape the ordinary way, and a second
 * declaration would be a second place to be wrong. The sampler clamps an oversized
 * radius (a stadium's `999px`) to half the height.
 *
 * @param {CSSStyleDeclaration} styles
 * @returns {number}
 */
function readRadius(styles) {
  const raw = Number.parseFloat(styles.borderTopLeftRadius);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/* ── Mounting ───────────────────────────────────────────────────────────── */

/**
 * @param {string} className
 * @returns {SVGSVGElement}
 */
function layer(className) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  return svg;
}

/**
 * Draw one element, if its measured box actually changed.
 *
 * Measures the *border* box, because that is where the CSS border sat and where
 * the ink has to land for nothing to move. An absolutely positioned child is placed
 * against the padding box, so the layers are pulled back out over the border by its
 * own width.
 *
 * @param {HTMLElement} el
 * @param {boolean} [force] redraw even when the measured box is unchanged
 */
function refresh(el, force = false) {
  const record = MOUNTED.get(el);
  if (!record) return;

  const w = Math.round(el.offsetWidth);
  const h = Math.round(el.offsetHeight);
  if (w < 2 || h < 2) return;

  const styles = getComputedStyle(el);
  const hand = readHand(styles);
  const weight = readWeight(styles);
  const shadow = readShadow(styles);
  const radius = readRadius(styles);
  const border = {
    left: Number.parseFloat(styles.borderLeftWidth) || 0,
    top: Number.parseFloat(styles.borderTopWidth) || 0,
  };

  const key = [
    w,
    h,
    record.seed,
    hand.deviation,
    hand.wavelength,
    weight,
    radius,
    JSON.stringify(shadow),
  ].join(":");
  if (!force && key === record.key) return;
  record.key = key;

  const frame = buildBoxFrame({ w, h, seed: record.seed, hand, weight, shadow, radius });

  /** @type {[SVGSVGElement, string][]} */
  const layers = [
    [record.ground, frame.ground],
    [record.ink, frame.ink],
  ];
  for (const [svg, markup] of layers) {
    svg.setAttribute("viewBox", frame.viewBox);
    svg.setAttribute("width", String(frame.width));
    svg.setAttribute("height", String(frame.height));
    svg.style.left = `${-border.left}px`;
    svg.style.top = `${-border.top}px`;
    svg.innerHTML = markup;
  }
}

/**
 * Mount one element. The two layers sandwich the existing children rather than
 * wrapping them — wrapping would break every flex and grid component on the surface.
 *
 * @param {HTMLElement} el
 */
export function mountInk(el) {
  if (MOUNTED.has(el)) return;

  const ground = layer("ink__ground");
  const ink = layer("ink__layer");

  el.prepend(ground);
  el.append(ink);
  el.classList.add("is-ink");

  /*
   * The absolutely positioned layers need a positioned ancestor. Set here rather
   * than in ink.css, and only when the element is static: this runs after every
   * component stylesheet, so a blanket `position: relative` would override a
   * component that positions itself.
   */
  if (getComputedStyle(el).position === "static") el.style.position = "relative";

  const seed = Number(el.dataset.inkSeed ?? nextSeed());
  el.dataset.inkSeed = String(seed);

  MOUNTED.set(el, { ground, ink, seed, key: "" });
  observer.observe(el);
  refresh(el, true);
}

/** @param {HTMLElement} el */
export function unmountInk(el) {
  const record = MOUNTED.get(el);
  if (!record) return;
  observer.unobserve(el);
  record.ground.remove();
  record.ink.remove();
  el.classList.remove("is-ink");
  MOUNTED.delete(el);
}

/* ── Keeping up ─────────────────────────────────────────────────────────── */

/*
 * One ResizeObserver for the whole surface, and one animation frame for the redraws
 * it asks for. A page resize touches every drawn element at once; without the batch
 * that is several hundred synchronous path rebuilds inside a single layout pass.
 */
/** @type {Set<HTMLElement>} */
const pending = new Set();
let scheduled = 0;

function flush() {
  scheduled = 0;
  const work = [...pending];
  pending.clear();
  for (const el of work) refresh(el);
}

const observer = new ResizeObserver((entries) => {
  for (const entry of entries) {
    if (entry.target instanceof HTMLElement) pending.add(entry.target);
  }
  if (!scheduled) scheduled = requestAnimationFrame(flush);
});

/**
 * @param {NodeList} nodes
 * @param {(el: Element) => void} run
 */
function eachElement(nodes, run) {
  for (const node of nodes) {
    if (node instanceof Element) run(node);
  }
}

/**
 * Put the layers back if the element's content was replaced wholesale.
 *
 * `el.textContent = "Focus"` removes every child, including both layers, leaving a
 * mounted element with a transparent border and no line at all. Re-inserting with
 * the same seed means the hand does not change either.
 *
 * @param {Node} el the mutated node; only a mounted element is of interest
 */
function reattach(el) {
  if (!(el instanceof HTMLElement)) return;
  const record = MOUNTED.get(el);
  if (!record || record.ground.isConnected) return;
  el.prepend(record.ground);
  el.append(record.ink);
  refresh(el, true);
}

const nursery = new MutationObserver((records) => {
  for (const record of records) {
    eachElement(record.addedNodes, mountAllInk);
    eachElement(record.removedNodes, unmountAllInk);
    reattach(record.target);
  }
});

/**
 * Mount `root` and everything under it that asks to be drawn.
 *
 * @param {Document | Element} [root]
 */
export function mountAllInk(root = document) {
  if (root instanceof HTMLElement && root.matches(INK_SELECTOR)) mountInk(root);
  for (const el of inkTargets(root)) mountInk(el);
}

/** @param {Document | Element} root */
function unmountAllInk(root) {
  if (root instanceof HTMLElement && root.matches(INK_SELECTOR)) unmountInk(root);
  for (const el of inkTargets(root)) unmountInk(el);
}

/**
 * Start the system. Idempotent; safe to call once from the bootstrap.
 *
 * @param {Element} [root]
 */
export function startInk(root = document.body) {
  mountAllInk(root);
  nursery.observe(root, { childList: true, subtree: true });
}

/**
 * Redraw every drawn element without changing whose hand drew it.
 *
 * @param {Document | Element} [root]
 */
export function redrawInk(root = document) {
  for (const el of inkTargets(root)) refresh(el, true);
}

/**
 * Re-ink every drawn element on the page with a fresh hand.
 *
 * @param {Document | Element} [root]
 */
export function reseedInk(root = document) {
  for (const el of inkTargets(root)) {
    const record = MOUNTED.get(el);
    if (!record) continue;
    record.seed = nextSeed();
    el.dataset.inkSeed = String(record.seed);
    refresh(el, true);
  }
}
