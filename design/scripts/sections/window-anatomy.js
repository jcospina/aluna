// @ts-check
/**
 * The window's anatomy, marked up the way a draughtsman marks a print: tracing paper laid over
 * the wallpaper, each part circled, bracketed or highlighted in pencil, and a note jotted beside
 * it with a quick arrow. The same notes are set as a table, which a stage too narrow for the
 * pencil shows under the picker and a wide one keeps for assistive technology alone.
 */

import { wallpaperUrl } from "../desk/wallpaper.js";
import { round2 as f } from "../lib/geometry.js";
import {
  aim,
  arrow,
  HIGHLIGHTER,
  PENCIL,
  ring,
  svgShape as shape,
  swipe,
} from "../lib/pencil-marks.js";
import { mulberry32 } from "../lib/random.js";

/**
 * @typedef {import("../window/window.js").AlunaWindow} AlunaWindow
 * @typedef {import("../lib/pencil-marks.js").Point} Point
 * @typedef {{ left: number, top: number, right: number, bottom: number, width: number,
 *   height: number }} Box
 * @typedef {{ win: Box, bar: Box, title: Box, lamps: Box, body: Box }} Parts
 * @typedef {import("../lib/pencil-marks.js").Loop} Loop
 * @typedef {{ kind: "brace", from: Point, to: Point }} Brace
 * @typedef {import("../lib/pencil-marks.js").Highlight} Highlight
 * @typedef {Loop | Brace | Highlight} Mark
 * @typedef {"left" | "right" | "top"} Side
 * @typedef {{ name: string, says: string | ((reach: number) => string), side: Side,
 *   mark: (parts: Parts) => Mark, note?: (parts: Parts) => Point }} Note
 */

/** How far a brace stands off what it spans; a braced note stands a gap beyond its tip. */
const BRACE = 10;
const GAP = 6;

/**
 * Each part, clockwise from the top-left corner: the mark that singles it out, and where its
 * note is anchored (the edge facing the mark, or its foot when it stands above). A braced note
 * stands at the brace's tip.
 *
 * @type {Note[]}
 */
const NOTES = [
  {
    name: "Corner",
    says: "Mitred, radius 0",
    side: "left",
    mark: ({ win }) => ({ kind: "loop", at: { x: win.left, y: win.top }, rx: 19, ry: 16 }),
    note: ({ win }) => ({ x: win.left - 54, y: win.top - 34 }),
  },
  {
    name: "Title",
    says: "Fraunces 700 · 26px, 20px on a phone; a long one ends in an ellipsis",
    side: "top",
    mark: ({ title }) => ({
      kind: "highlight",
      from: { x: title.left - 5, y: title.top + title.height * 0.62 },
      to: { x: title.right + 5, y: title.top + title.height * 0.62 - 2 },
      thick: title.height * 0.6,
    }),
    note: ({ win, title }) => ({ x: title.left + title.width * 0.4, y: win.top - 40 }),
  },
  {
    name: "Panes",
    says: "Plain surface to 50%, then five 10% panes",
    side: "top",
    mark: ({ win }) => ({
      kind: "brace",
      from: { x: win.left + win.width / 2 + 3, y: win.top - 9 },
      to: { x: win.right - 3, y: win.top - 9 },
    }),
  },
  {
    name: "Lamps",
    says: "12px circles: leaf maximises, clay puts away",
    side: "right",
    mark: ({ lamps }) => ({
      kind: "loop",
      at: { x: (lamps.left + lamps.right) / 2, y: (lamps.top + lamps.bottom) / 2 },
      rx: lamps.width / 2 + 11,
      ry: lamps.height / 2 + 9,
    }),
    note: ({ win, lamps }) => ({ x: win.right + 50, y: (lamps.top + lamps.bottom) / 2 + 8 }),
  },
  {
    name: "Line",
    says: "2px ink, inked twice, 0.9px off true",
    side: "right",
    mark: ({ win }) => ({
      kind: "loop",
      at: { x: win.right + 1, y: win.top + win.height * 0.4 },
      rx: 11,
      ry: 36,
    }),
    note: ({ win }) => ({ x: win.right + 50, y: win.top + win.height * 0.4 + 62 }),
  },
  {
    name: "Shadow",
    says: "5px across, 6px down, never blurred; ink at 40% here, 24% on flat ground",
    side: "right",
    mark: ({ win }) => ({
      kind: "loop",
      at: { x: win.right + 2, y: win.bottom + 3 },
      rx: 17,
      ry: 14,
    }),
    note: ({ win }) => ({ x: win.right + 50, y: win.bottom - 64 }),
  },
  {
    name: "Body",
    says: "Flat surface, no texture",
    side: "left",
    mark: ({ win, body }) => ({
      kind: "brace",
      from: { x: win.left - 13, y: body.bottom - Math.min(28, body.height * 0.1) },
      to: { x: win.left - 13, y: body.top + Math.min(120, body.height * 0.3) },
    }),
  },
  {
    name: "Title-bar rule",
    says: (reach) =>
      reach > 0
        ? `Runs ${reach}px through the frame, ×1.15 on the second pass`
        : "Stops at the frame",
    side: "left",
    mark: ({ win, bar }) => ({
      kind: "loop",
      at: { x: win.left - 3, y: bar.bottom },
      rx: 16,
      ry: 11,
    }),
    note: ({ win, bar }) => ({ x: win.left - 54, y: bar.bottom + 52 }),
  },
];

/** Every mark is the same hand, so a redraw on resize puts the pencil back where it was. */
const HAND_SEED = 23;

/** Below this the stage has no room for notes beside the window, so the table stands in. */
const NOTES_FROM = 800;

/** Tracing paper laid over the wallpaper, so the notes read and the window stays crisp. */
const WASH =
  "linear-gradient(color-mix(in srgb, var(--surface) 74%, transparent), color-mix(in srgb, var(--surface) 74%, transparent))";

/**
 * @param {Note} note
 * @param {number} reach
 */
const saying = (note, reach) => (typeof note.says === "string" ? note.says : note.says(reach));

/**
 * A box relative to the stage's padding box, where its absolute children are placed.
 *
 * @param {DOMRect} r
 * @param {HTMLElement} stage
 * @returns {Box}
 */
function boxIn(r, stage) {
  const outer = stage.getBoundingClientRect();
  const left = r.left - outer.left - stage.clientLeft;
  const top = r.top - outer.top - stage.clientTop;
  return {
    left,
    top,
    right: left + r.width,
    bottom: top + r.height,
    width: r.width,
    height: r.height,
  };
}

/**
 * @param {HTMLElement} stage
 * @param {HTMLElement} win
 * @returns {Parts | null}
 */
function partsOf(stage, win) {
  const bar = win.querySelector(".window__bar");
  const title = win.querySelector(".window__title");
  const lamps = win.querySelector(".window__lamps");
  const body = win.querySelector(".window__body");
  if (!bar || !title || !lamps || !body) return null;
  /* The title box spans the bar; the mark belongs on the words, cut where the ellipsis cuts. */
  const words = document.createRange();
  words.selectNodeContents(title);
  const set = boxIn(words.getBoundingClientRect(), stage);
  const right = Math.min(set.right, boxIn(title.getBoundingClientRect(), stage).right);
  return {
    win: boxIn(win.getBoundingClientRect(), stage),
    bar: boxIn(bar.getBoundingClientRect(), stage),
    title: { ...set, right, width: right - set.left },
    lamps: boxIn(lamps.getBoundingClientRect(), stage),
    body: boxIn(body.getBoundingClientRect(), stage),
  };
}

/**
 * The unit vector along a brace, and its length.
 *
 * @param {Brace} brace
 */
function run({ from, to }) {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { length, u: { x: (to.x - from.x) / length, y: (to.y - from.y) / length } };
}

/**
 * A curly brace along a span, its tip standing `BRACE` off the span on the left of the way it
 * runs: a span drawn left to right points up, one drawn bottom to top points left.
 *
 * @param {Brace} brace
 * @param {() => number} rnd
 */
function curl(brace, rnd) {
  const { from } = brace;
  const { length, u } = run(brace);
  const q = Math.min(14, length / 6);
  const half = length / 2;
  const mid = BRACE / 2;
  /** @param {number} along @param {number} off */
  const at = (along, off) => {
    const o = off + (rnd() - 0.5) * 0.8;
    return `${f(from.x + u.x * along + u.y * o)},${f(from.y + u.y * along - u.x * o)}`;
  };
  return (
    `M${at(0, 0)} Q${at(0, mid)} ${at(q, mid)} L${at(half - q, mid)} ` +
    `Q${at(half, mid)} ${at(half, BRACE)} Q${at(half, mid)} ${at(half + q, mid)} ` +
    `L${at(length - q, mid)} Q${at(length, mid)} ${at(length, 0)}`
  );
}

/**
 * The point `off` beyond a brace's tip.
 *
 * @param {Brace} brace
 * @param {number} off
 * @returns {Point}
 */
function beyondTip(brace, off) {
  const { from, to } = brace;
  const { u } = run(brace);
  return { x: (from.x + to.x) / 2 + u.y * off, y: (from.y + to.y) / 2 - u.x * off };
}

/**
 * @param {Mark} mark
 * @param {() => number} rnd
 */
function draw(mark, rnd) {
  if (mark.kind === "loop") return shape("path", { ...PENCIL, d: ring(mark, rnd) });
  if (mark.kind === "brace") return shape("path", { ...PENCIL, d: curl(mark, rnd) });
  return shape("path", {
    ...HIGHLIGHTER,
    d: swipe(mark, rnd),
    "stroke-width": f(mark.thick).toString(),
  });
}

/**
 * Mark one part, jot its note beside it, and draw the arrow from the note to the mark.
 *
 * @param {Note} note
 * @param {Parts} parts
 * @param {number} reach
 * @param {HTMLElement} layer
 * @param {SVGElement} svg
 * @param {() => number} rnd
 */
function annotate(note, parts, reach, layer, svg, rnd) {
  const mark = note.mark(parts);
  const at = mark.kind === "brace" ? beyondTip(mark, BRACE + GAP) : note.note?.(parts);
  if (!at) return;
  const text = document.createElement("div");
  text.className = "stage__note";
  text.dataset.side = note.side;
  const name = document.createElement("b");
  name.textContent = note.name;
  text.append(name, saying(note, reach));
  layer.append(text);
  const { offsetWidth: w, offsetHeight: h } = text;
  text.style.left = `${{ left: at.x - w, right: at.x, top: at.x - w / 2 }[note.side]}px`;
  text.style.top = `${note.side === "top" ? at.y - h : at.y - h / 2}px`;
  text.style.rotate = `${f((rnd() - 0.5) * 3)}deg`;
  svg.append(draw(mark, rnd));
  if (mark.kind === "brace") return;
  const leave = {
    left: { x: at.x + GAP, y: at.y },
    right: { x: at.x - GAP, y: at.y },
    top: { x: at.x, y: at.y + GAP },
  }[note.side];
  svg.append(shape("path", { ...PENCIL, d: arrow(leave, aim(mark, leave), rnd) }));
}

/**
 * Lay the pencil over the window: every part marked, and its note jotted beside it.
 *
 * @param {HTMLElement} stage
 * @param {AlunaWindow} win
 * @param {HTMLElement} layer
 */
function markUp(stage, win, layer) {
  const parts = partsOf(stage, win.el);
  if (!parts) return;
  const svg = shape("svg", {});
  layer.replaceChildren(svg);
  const rnd = mulberry32(HAND_SEED);
  for (const note of NOTES) annotate(note, parts, win.dividerReach, layer, svg, rnd);
}

/** The notes as a table: each part beside what it is, its rows filled on every draw. */
function keyTable() {
  const key = document.createElement("div");
  key.hidden = true;
  key.innerHTML =
    '<div class="spec spec--fit"><div class="spec__scroll"><table>' +
    '<caption class="caps">The anatomy</caption>' +
    '<thead><tr><th scope="col">Part</th><th scope="col">Specification</th></tr></thead>' +
    "<tbody></tbody></table></div></div>";
  return key;
}

/**
 * @param {HTMLElement} key
 * @param {number} reach
 */
function fillKey(key, reach) {
  key.querySelector("tbody")?.replaceChildren(
    ...NOTES.map((note) => {
      const row = document.createElement("tr");
      const part = document.createElement("td");
      part.append(
        ...note.name.split(" ").flatMap((word, index) => {
          const span = document.createElement("span");
          span.textContent = word;
          return index === 0 ? [span] : [" ", span];
        }),
      );
      const says = document.createElement("td");
      says.textContent = saying(note, reach);
      row.append(part, says);
      return row;
    }),
  );
}

/**
 * The window's anatomy over its bench. The stage keeps the margins the notes need in every
 * view, so marking the window up never moves the page; `show` lays the marks on or lifts them,
 * and `redraw` follows a change to the window the stage cannot see, such as the rule's reach.
 *
 * @param {HTMLElement} stage
 * @param {AlunaWindow} win
 * @returns {{ show: (on: boolean) => void, redraw: () => void }}
 */
export function wireAnatomy(stage, win) {
  const layer = document.createElement("div");
  layer.className = "stage__marks";
  layer.setAttribute("aria-hidden", "true");
  layer.hidden = true;
  stage.append(layer);
  const key = keyTable();
  stage.before(key);
  let shown = false;

  const fit = () => {
    const room = stage.offsetWidth >= NOTES_FROM;
    stage.style.paddingTop = room ? "8rem" : "";
    stage.style.paddingInline = room ? "12.5rem" : "0.5rem";
    return room;
  };

  const redraw = () => {
    /* A put-away section has no width; read as narrow, it would flash the table on return. */
    if (!stage.offsetWidth) return;
    const room = fit();
    const marked = shown && room;
    layer.hidden = !marked;
    key.hidden = !shown;
    key.classList.toggle("visually-hidden", room);
    stage.style.backgroundImage = marked ? `${WASH}, ${wallpaperUrl()}` : wallpaperUrl();
    if (shown) fillKey(key, win.dividerReach);
    if (marked) markUp(stage, win, layer);
  };

  /* Resizes are answered on the next frame: fitting the stage resizes it, and doing that inside
   * the observer's own callback is the loop the browser reports as an error. */
  let frame = 0;
  const observer = new ResizeObserver(() => {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        redraw();
      });
  });
  observer.observe(stage);
  observer.observe(win.el);
  if (stage.offsetWidth) fit();

  return {
    show: (on) => {
      if (on === shown) return;
      shown = on;
      if (!on) layer.replaceChildren();
      redraw();
    },
    redraw,
  };
}
