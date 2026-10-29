// @ts-check
/**
 * The pencil over the desk, drawn the way the design system's window anatomy is. A note that names
 * a `data-point` gets a quick arrow from its plate to what it points at, then a ring round it or a
 * highlighter behind its words; a `data-ring` gets the ring alone. A `data-bow` of left, right, up
 * or down sets which way the arrow bulges, where chance would pick badly. The pencil waits until
 * the slide and the window have stopped moving, draws each mark stroke by stroke, and from then on
 * moves only when the desk changes size.
 */

import {
  aim,
  arrowParts,
  HIGHLIGHTER,
  PENCIL,
  ring,
  svgShape,
  swipe,
} from "../../design/scripts/lib/pencil-marks.js";
import { mulberry32 } from "../../design/scripts/lib/random.js";

/** @typedef {import("../../design/scripts/lib/pencil-marks.js").Point} Point */
/** @typedef {import("../../design/scripts/lib/pencil-marks.js").Loop} Loop */
/** @typedef {import("../../design/scripts/lib/pencil-marks.js").Highlight} Highlight */
/** @typedef {{ left: number, top: number, right: number, bottom: number }} Box */
/** @typedef {{ box: Box, boxes: Box[], words: boolean }} Target */
/** @typedef {{ d: string, paint: Record<string, string>, at: number, ms: number }} Stroke */

/** How far an arrow leaves from its plate, and how loose a ring sits round its target. */
const GAP = 8;
const SLACK = { x: 14, y: 10 };
/** A ring round something long squares up, with room to clear its corners. */
const LONG = { ratio: 3, slack: { x: 30, y: 16 }, square: 6 };

/** The largest target a ring goes round; a bigger one, like the whole drawing, takes the arrow alone. */
const RINGED = { width: 260, height: 140 };

/** How long a slide or a step takes to arrive, which the pencil waits out. */
const ARRIVE_MS = 480;

/** How long each stroke takes, in the order the hand draws them. */
const STROKE_MS = { shaft: 260, head: 120, mark: 320, next: 90, loop: 520 };

/** A ring with no arrow to lead the eye to it is drawn heavier, so the wallpaper cannot hide it. */
const LONE_RING = { ...PENCIL, "stroke-width": "2.75" };

/** @type {Record<string, Point>} */
const BOWS = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

/** Where the plate stands over the window, and an arrow would cross what it explains. */
const STACKED = "(max-width: 900px)";

/**
 * @param {Element | null} node
 * @returns {node is HTMLElement}
 */
const isHTML = (node) => node instanceof HTMLElement;

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

/** @param {Box} box */
const sizeOf = (box) => ({ width: box.right - box.left, height: box.bottom - box.top });

/** @param {Box} box @returns {Point} */
const centreOf = (box) => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });

/**
 * Words are marked where the words are, not across the box they stand in. A button is its box.
 *
 * @param {Element} node
 */
const isWords = (node) =>
  !(node instanceof HTMLButtonElement) &&
  node.childElementCount === 0 &&
  Boolean(node.textContent?.trim());

/** @param {Element} node */
function drawnBox(node) {
  if (!isWords(node)) return node.getBoundingClientRect();
  const words = document.createRange();
  words.selectNodeContents(node);
  return words.getBoundingClientRect();
}

/**
 * Every element a selector names, each with its box; null when none of them has a size.
 *
 * @param {HTMLElement} root
 * @param {string} selector
 * @param {DOMRect} origin
 * @returns {Target | null}
 */
function targetOf(root, selector, origin) {
  const nodes = [...root.querySelectorAll(selector)];
  const boxes = nodes
    .map(drawnBox)
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => boxIn(r, origin));
  if (boxes.length === 0) return null;
  const box = {
    left: Math.min(...boxes.map((b) => b.left)),
    top: Math.min(...boxes.map((b) => b.top)),
    right: Math.max(...boxes.map((b) => b.right)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
  return { box, boxes, words: nodes.every(isWords) };
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

/**
 * A ring round a box, squared up when the box is long.
 *
 * @param {Box} box
 * @param {boolean} [squares] whether a long box gets the squared ring
 * @returns {Loop}
 */
function loopRound(box, squares = false) {
  const { width, height } = sizeOf(box);
  const long = squares && width > height * LONG.ratio;
  const slack = long ? LONG.slack : SLACK;
  return {
    kind: "loop",
    at: centreOf(box),
    rx: width / 2 + slack.x,
    ry: height / 2 + slack.y,
    square: long ? LONG.square : 2,
  };
}

/**
 * A highlighter swipe behind one line of words.
 *
 * @param {Box} box
 * @returns {Highlight}
 */
function swipeBehind(box) {
  const { height } = sizeOf(box);
  const y = centreOf(box).y + height * 0.1;
  return {
    kind: "highlight",
    from: { x: box.left - 4, y },
    to: { x: box.right + 4, y: y - 2 },
    thick: height * 0.8,
  };
}

/**
 * What goes round a note's target: a swipe behind each of several words, a ring round something
 * small, a swipe behind a long line, or nothing round something bigger.
 *
 * @param {Target} target
 * @returns {(Loop | Highlight)[]}
 */
function marksFor({ box, boxes, words }) {
  if (words && boxes.length > 1) return boxes.map(swipeBehind);
  const { width, height } = sizeOf(box);
  if (width <= RINGED.width && height <= RINGED.height) return [loopRound(box)];
  return words ? [swipeBehind(box)] : [];
}

/**
 * @param {Loop | Highlight} mark
 * @param {() => number} rnd
 * @param {number} at
 * @param {number} ms
 * @returns {Stroke}
 */
function markStroke(mark, rnd, at, ms) {
  if (mark.kind === "loop") return { d: ring(mark, rnd), paint: PENCIL, at, ms };
  const paint = { ...HIGHLIGHTER, "stroke-width": String(mark.thick) };
  return { d: swipe(mark, rnd), paint, at, ms };
}

/**
 * The arrow from a note's plate, then whatever goes round its target.
 *
 * @param {Target} target
 * @param {Box} plate
 * @param {Box} note
 * @param {() => number} rnd
 * @param {Point} [bow] the way the arrow must bulge
 * @returns {Stroke[]}
 */
function pointStrokes(target, plate, note, rnd, bow) {
  const marks = marksFor(target);
  const from = leaving(plate, note, centreOf(target.box));
  const distance = (/** @type {Loop | Highlight} */ mark) => {
    const at = mark.kind === "loop" ? mark.at : mark.from;
    return Math.hypot(at.x - from.x, at.y - from.y);
  };
  const nearest = [...marks].sort((a, b) => distance(a) - distance(b))[0];
  const to = nearest ? aim(nearest, from) : onEdge(target.box, from);
  const { shaft, head } = arrowParts(from, to, rnd, bow);
  const after = STROKE_MS.shaft + STROKE_MS.head;
  return [
    { d: shaft, paint: PENCIL, at: 0, ms: STROKE_MS.shaft },
    { d: head, paint: PENCIL, at: STROKE_MS.shaft, ms: STROKE_MS.head },
    ...marks.map((mark, i) => markStroke(mark, rnd, after + i * STROKE_MS.next, STROKE_MS.mark)),
  ];
}

/**
 * @param {Stroke[]} strokes
 * @param {boolean} animate whether the hand draws them now, or they are simply there
 */
function groupOf(strokes, animate) {
  const group = svgShape("g", animate ? { class: "is-drawing" } : {});
  for (const { d, paint, at, ms } of strokes) {
    const path = svgShape("path", { ...paint, d, pathLength: "1" });
    if (animate) path.setAttribute("style", `--mark-at: ${at}ms; --mark-ms: ${ms}ms`);
    group.append(path);
  }
  return group;
}

export class Marks {
  /**
   * @param {HTMLElement} root the desk every target and note sits on
   * @param {HTMLElement} layer the pencil's own layer over it
   */
  constructor(root, layer) {
    this.root = root;
    this.svg = svgShape("svg", { "aria-hidden": "true" });
    layer.replaceChildren(this.svg);
    /** @type {HTMLElement | null} */
    this.slide = null;
    /** @type {Map<HTMLElement, SVGElement>} each drawn note's marks */
    this.drawn = new Map();
    /** Whether the slide has arrived, and whether the window still moves what its notes point at. */
    this.arrived = false;
    this.holding = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    this.waiting = undefined;
    this.frame = 0;
    new ResizeObserver(() => this.#follow()).observe(root);
  }

  /**
   * A new slide's marks go at once. Marks already drawn on this one stay, and lose any note a step
   * back hid; new notes are drawn once the slide has arrived and the window, when `holding`, has
   * said with {@link release} that it stopped moving.
   *
   * @param {HTMLElement} slide
   * @param {boolean} [holding] whether the window is still moving what the notes point at
   */
  show(slide, holding = false) {
    clearTimeout(this.waiting);
    if (slide !== this.slide) this.#clear();
    this.slide = slide;
    this.arrived = false;
    this.holding = holding;
    this.#place();
    this.waiting = setTimeout(() => {
      this.arrived = true;
      this.#settle();
    }, ARRIVE_MS);
  }

  /** The window has stopped moving what the slide's notes point at. */
  release() {
    this.holding = false;
    this.#settle();
  }

  #settle() {
    if (!this.arrived || this.holding) return;
    this.#place();
    this.#drawNew(true);
  }

  /** A desk that changes size moves every mark with it, drawn at once. */
  #follow() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      this.#place();
      if (this.arrived && !this.holding) this.#drawNew(false);
    });
  }

  #clear() {
    this.drawn.clear();
    this.svg.replaceChildren();
  }

  /** Every mark already drawn, placed again; one whose note is hidden or target gone goes. */
  #place() {
    if (matchMedia(STACKED).matches) return this.#clear();
    const origin = this.root.getBoundingClientRect();
    for (const [note, group] of this.drawn) {
      const strokes = this.#visible(note) ? this.#strokes(note, origin) : null;
      if (strokes) {
        const placed = groupOf(strokes, false);
        group.replaceWith(placed);
        this.drawn.set(note, placed);
      } else {
        group.remove();
        this.drawn.delete(note);
      }
    }
  }

  /** @param {boolean} animate */
  #drawNew(animate) {
    if (matchMedia(STACKED).matches) return;
    const origin = this.root.getBoundingClientRect();
    for (const note of this.#notes()) {
      if (this.drawn.has(note) || !this.#visible(note)) continue;
      const strokes = this.#strokes(note, origin);
      if (!strokes) continue;
      const group = groupOf(strokes, animate);
      this.svg.append(group);
      this.drawn.set(note, group);
    }
  }

  #notes() {
    return [...(this.slide?.querySelectorAll("[data-point], [data-ring]") ?? [])].filter(isHTML);
  }

  /**
   * The same note draws the same marks every time, so a mark placed again does not change shape.
   *
   * @param {HTMLElement} note
   * @param {DOMRect} origin
   * @returns {Stroke[] | null}
   */
  #strokes(note, origin) {
    const seed = (Number(this.slide?.dataset.seed) || 7) * 97 + this.#notes().indexOf(note);
    const rnd = mulberry32(seed);
    const alone = note.dataset.ring;
    const target = targetOf(this.root, alone ?? note.dataset.point ?? "", origin);
    if (!target) return null;
    if (alone !== undefined) {
      const loop = markStroke(loopRound(target.box, true), rnd, 0, STROKE_MS.loop);
      return [{ ...loop, paint: LONE_RING }];
    }
    const plate = note.closest(".plate") ?? note;
    const plateBox = boxIn(plate.getBoundingClientRect(), origin);
    const noteBox = boxIn(note.getBoundingClientRect(), origin);
    return pointStrokes(target, plateBox, noteBox, rnd, BOWS[note.dataset.bow ?? ""]);
  }

  /** @param {HTMLElement} note */
  #visible(note) {
    const stepped = note.closest("[data-step]");
    return !stepped || stepped.classList.contains("is-shown");
  }
}
