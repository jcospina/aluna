// @ts-check
/**
 * The pencil over the desk, drawn the way the design system's window anatomy is: every note on
 * the slide that names a `data-point` gets a ring round what it points at and a quick arrow to it,
 * leaving from the side of its plate that faces the ring. A point that matches nothing, or nothing
 * with a size yet, is left unmarked until the next draw.
 */

import {
  aim,
  arrow,
  HIGHLIGHTER,
  PENCIL,
  ring,
  svgShape,
  swipe,
} from "../../design/scripts/lib/pencil-marks.js";
import { mulberry32 } from "../../design/scripts/lib/random.js";

/** @typedef {import("../../design/scripts/lib/pencil-marks.js").Point} Point */
/** @typedef {{ left: number, top: number, right: number, bottom: number }} Box */

/** How far an arrow leaves from its plate, and how loose a ring sits round its target. */
const GAP = 8;
const SLACK = { x: 14, y: 10 };

/** The largest target a ring goes round; a bigger one, like the whole drawing, takes the arrow alone. */
const RINGED = { width: 260, height: 140 };

/** How long a step takes to arrive, after which its note stands where its arrow should leave. */
const SETTLED_MS = 450;

/** Where the plate stands over the window, and an arrow would cross what it explains. */
const STACKED = "(max-width: 900px)";

/** The drawing's own strokes and ticks move nothing a note points at. */
const SKETCH = ".narration__sheet";

/**
 * @param {DOMRect} r
 * @param {DOMRect} origin
 * @returns {Box}
 */
const boxIn = (r, origin) => ({
  left: r.left - origin.left,
  top: r.top - origin.top,
  right: r.right - origin.left,
  bottom: r.bottom - origin.top,
});

/**
 * Words are marked where the words are, not across the box they stand in.
 *
 * @param {Element} node
 */
const isWords = (node) => node.childElementCount === 0 && Boolean(node.textContent?.trim());

/** @param {Element} node */
function drawnBox(node) {
  if (!isWords(node)) return node.getBoundingClientRect();
  const words = document.createRange();
  words.selectNodeContents(node);
  return words.getBoundingClientRect();
}

/**
 * Every element a selector names, as one box; null when none of them has a size.
 *
 * @param {HTMLElement} root
 * @param {string} selector
 * @param {DOMRect} origin
 * @returns {{ box: Box, words: boolean } | null}
 */
function targetOf(root, selector, origin) {
  const nodes = [...root.querySelectorAll(selector)];
  const boxes = nodes
    .map(drawnBox)
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => boxIn(r, origin));
  if (boxes.length === 0) return null;
  return {
    box: {
      left: Math.min(...boxes.map((b) => b.left)),
      top: Math.min(...boxes.map((b) => b.top)),
      right: Math.max(...boxes.map((b) => b.right)),
      bottom: Math.max(...boxes.map((b) => b.bottom)),
    },
    words: nodes.every(isWords),
  };
}

/**
 * Where an arrow leaves: the plate's edge facing the target, level with the note it belongs to.
 *
 * @param {Box} plate
 * @param {Box} note
 * @param {Point} toward
 * @returns {Point}
 */
function leaving(plate, note, toward) {
  const level = Math.min(Math.max(toward.y, note.top + 6), note.bottom - 6);
  if (toward.x > plate.right) return { x: plate.right + GAP, y: level };
  if (toward.x < plate.left) return { x: plate.left - GAP, y: level };
  const x = Math.min(Math.max(toward.x, plate.left), plate.right);
  return toward.y < plate.top ? { x, y: plate.top - GAP } : { x, y: plate.bottom + GAP };
}

/**
 * Where an arrow to a big target lands: just outside its edge, at the point nearest the arrow.
 *
 * @param {Box} box
 * @param {Point} from
 * @returns {Point}
 */
function onEdge(box, from) {
  const x = Math.min(Math.max(from.x, box.left), box.right);
  const y = Math.min(Math.max(from.y, box.top), box.bottom);
  const length = Math.hypot(from.x - x, from.y - y) || 1;
  return { x: x + ((from.x - x) / length) * GAP, y: y + ((from.y - y) / length) * GAP };
}

export class Marks {
  /**
   * @param {HTMLElement} root the desk every target and note sits on
   * @param {HTMLElement} layer the pencil's own layer over it
   */
  constructor(root, layer) {
    this.root = root;
    this.layer = layer;
    /** @type {HTMLElement | null} */
    this.slide = null;
    this.frame = 0;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    this.settling = undefined;
    new ResizeObserver(() => this.draw()).observe(root);
    // A line rolling in or a window changing what it holds moves what a note points at.
    /** @param {Node} target */
    const moves = (target) =>
      !layer.contains(target) && !(target instanceof Element && target.closest(SKETCH));
    new MutationObserver((records) => {
      if (records.some(({ target }) => moves(target))) this.draw();
    }).observe(root, { childList: true, subtree: true });
  }

  /**
   * Draw for a slide now, and again once its steps have finished moving. A new slide's pencil
   * waits out of sight until then, since its plate is still sliding in.
   *
   * @param {HTMLElement} slide
   */
  show(slide) {
    const arriving = slide !== this.slide;
    this.slide = slide;
    if (arriving) this.layer.classList.add("is-arriving");
    this.draw();
    clearTimeout(this.settling);
    this.settling = setTimeout(() => {
      this.layer.classList.remove("is-arriving");
      this.draw();
    }, SETTLED_MS);
  }

  /** Draw on the next frame. */
  draw() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.#draw());
  }

  #draw() {
    const svg = svgShape("svg", { "aria-hidden": "true" });
    this.layer.replaceChildren(svg);
    const { slide } = this;
    if (!slide || matchMedia(STACKED).matches) return;
    const origin = this.root.getBoundingClientRect();
    const rnd = mulberry32(Number(slide.dataset.seed) || 7);
    for (const note of slide.querySelectorAll("[data-point]")) {
      if (note instanceof HTMLElement && this.#visible(note)) this.#mark(note, svg, origin, rnd);
    }
  }

  /**
   * @param {HTMLElement} note
   * @param {SVGElement} svg
   * @param {DOMRect} origin
   * @param {() => number} rnd
   */
  #mark(note, svg, origin, rnd) {
    const target = targetOf(this.root, note.dataset.point ?? "", origin);
    if (!target) return;
    const { box } = target;
    const width = box.right - box.left;
    const height = box.bottom - box.top;
    const at = { x: box.left + width / 2, y: box.top + height / 2 };
    const plate = note.closest(".plate") ?? note;
    const from = leaving(
      boxIn(plate.getBoundingClientRect(), origin),
      boxIn(note.getBoundingClientRect(), origin),
      at,
    );
    /** @type {import("../../design/scripts/lib/pencil-marks.js").Loop | import("../../design/scripts/lib/pencil-marks.js").Highlight | null} */
    let mark = null;
    if (width <= RINGED.width && height <= RINGED.height) {
      mark = { kind: "loop", at, rx: width / 2 + SLACK.x, ry: height / 2 + SLACK.y };
      svg.append(svgShape("path", { ...PENCIL, d: ring(mark, rnd) }));
    } else if (target.words) {
      const y = at.y + height * 0.1;
      mark = {
        kind: "highlight",
        from: { x: box.left - 4, y },
        to: { x: box.right + 4, y: y - 2 },
        thick: height * 0.8,
      };
      svg.append(
        svgShape("path", {
          ...HIGHLIGHTER,
          d: swipe(mark, rnd),
          "stroke-width": String(mark.thick),
        }),
      );
    }
    const to = mark ? aim(mark, from) : onEdge(box, from);
    svg.append(svgShape("path", { ...PENCIL, d: arrow(from, to, rnd) }));
  }

  /** @param {HTMLElement} note */
  #visible(note) {
    const stepped = note.closest("[data-step]");
    return !stepped || stepped.classList.contains("is-shown");
  }
}
