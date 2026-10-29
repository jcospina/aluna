// @ts-check

/**
 * Where a selection in a developer panel well goes: the caret under a point, the word a second
 * press takes and the line a third does, how a drag that began with either grows a word or a line
 * at a time, and what a copy of it carries.
 *
 * The well draws its indent and line breaks with the sheet and keeps them as hidden text, so the
 * browser's own idea of a word, a line or a selection's text would see only half of it. Each is
 * worked out here from the panel's own lines instead.
 */

import { NODE_SELECTOR } from "./devpanel-view.js";

const CODELINE_SELECTOR = ".devpanel__codeline";
const LINE_SELECTOR = ".devpanel__line";
const BODY_SELECTOR = ".devpanel__body";
const UNSEEN_SELECTOR = ".devpanel__unseen";
const FOLDED_CLASS = "is-folded";
const TEXT_NODE = 3;

/** @typedef {{ node: Node, offset: number }} Point */

/** Words as the reader's language draws them, where the page can tell. */
const words =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : null;
/** Without that: letters, digits, and the joiners code names use. */
const WORD = /[\p{L}\p{N}_$]/u;

/**
 * Where the caret would land at a point on screen, in either of the two ways browsers answer.
 *
 * @param {number} x
 * @param {number} y
 * @returns {Point | null}
 */
export function caretAt(x, y) {
  const position = document.caretPositionFromPoint?.(x, y);
  if (position) return { node: position.offsetNode, offset: position.offset };
  const range = document.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

/** @param {Node} node */
const elementOf = (node) =>
  node.nodeType === TEXT_NODE ? node.parentElement : /** @type {Element} */ (node);

/**
 * The word a point is in, as the browser picks one for a double press: `0.25` and `don't` whole,
 * a run of Japanese by its words, and a press between words the one mark it landed on.
 *
 * @param {Point} at
 * @returns {[Point, Point]}
 */
function wordAt(at) {
  if (at.node.nodeType !== TEXT_NODE) return [at, at];
  const [start, end] = wordSpan(at.node.textContent ?? "", at.offset);
  return [
    { node: at.node, offset: start },
    { node: at.node, offset: end },
  ];
}

/**
 * @param {string} text
 * @param {number} offset
 * @returns {[number, number]}
 */
function wordSpan(text, offset) {
  const inside = Math.min(offset, Math.max(text.length - 1, 0));
  const segment = words?.segment(text).containing(inside);
  if (segment) return [segment.index, segment.index + segment.segment.length];
  if (!WORD.test(text[inside] ?? "")) return [inside, Math.min(inside + 1, text.length)];
  let [start, end] = [inside, inside + 1];
  while (start > 0 && WORD.test(text[start - 1] ?? "")) start -= 1;
  while (end < text.length && WORD.test(text[end] ?? "")) end += 1;
  return [start, end];
}

/**
 * The line a point is on, whole however many rows it wraps to, as the browser picks one for a
 * third press: a line of code, a member of the tree up to the bracket that opens what it holds,
 * or, read raw, the run between two line breaks. It starts after the line break that begins it
 * and keeps the indent, which is what a copy of the line should carry.
 *
 * @param {Point} at
 * @returns {[Point, Point]}
 */
function lineAt(at) {
  const element = elementOf(at.node);
  const row =
    element?.closest(CODELINE_SELECTOR) ??
    element?.closest(LINE_SELECTOR) ??
    element?.closest(NODE_SELECTOR);
  if (!row) return textLineAt(at);
  const first = row.firstChild;
  const unseen =
    first instanceof Element && first.matches(UNSEEN_SELECTOR) ? first.firstChild : null;
  const start = unseen?.textContent?.startsWith("\n")
    ? { node: unseen, offset: 1 }
    : { node: row, offset: 0 };
  return [start, lineEnd(row)];
}

/**
 * Where a row ends: before the body of an open fold it holds, or at its own end.
 *
 * @param {Element} row
 * @returns {Point}
 */
function lineEnd(row) {
  const node = row.matches(NODE_SELECTOR)
    ? row
    : [...row.children].find((child) => child.matches(NODE_SELECTOR));
  const body =
    node && !node.classList.contains(FOLDED_CLASS) ? node.querySelector(BODY_SELECTOR) : null;
  if (node && body?.parentElement === node)
    return { node, offset: [...node.childNodes].indexOf(body) };
  return { node: row, offset: row.childNodes.length };
}

/**
 * @param {Point} at
 * @returns {[Point, Point]}
 */
function textLineAt(at) {
  if (at.node.nodeType !== TEXT_NODE) return [at, at];
  const text = at.node.textContent ?? "";
  const start = text.lastIndexOf("\n", at.offset - 1) + 1;
  const stop = text.indexOf("\n", at.offset);
  return [
    { node: at.node, offset: start },
    { node: at.node, offset: stop < 0 ? text.length : stop },
  ];
}

/**
 * Take the word on a second press or the line on a third, and say what was taken so a drag from
 * it can grow by the same measure; a first press leaves a caret.
 *
 * @param {Selection} selection
 * @param {Point} at
 * @param {number} presses
 * @returns {[Point, Point] | null}
 */
export function pick(selection, at, presses) {
  selection.collapse(at.node, at.offset);
  if (presses < 2) return null;
  const [start, end] = presses === 2 ? wordAt(at) : lineAt(at);
  selection.setBaseAndExtent(start.node, start.offset, end.node, end.offset);
  return [start, end];
}

/**
 * Grow a drag's selection to a point. From a caret it grows a character at a time; from a word or
 * a line it grows by words or lines, keeping the whole of what the press took on whichever side
 * the pointer has gone.
 *
 * @param {Selection} selection
 * @param {[Point, Point] | null} picked
 * @param {number} presses
 * @param {Point} at
 */
export function grow(selection, picked, presses, at) {
  if (!picked) {
    if (selection.rangeCount) selection.extend(at.node, at.offset);
    return;
  }
  const [start, end] = picked;
  const span = document.createRange();
  span.setStart(start.node, start.offset);
  span.setEnd(end.node, end.offset);
  const side = span.comparePoint(at.node, at.offset);
  const [from, to] = presses === 2 ? wordAt(at) : lineAt(at);
  if (side < 0) selection.setBaseAndExtent(end.node, end.offset, from.node, from.offset);
  else if (side > 0) selection.setBaseAndExtent(start.node, start.offset, to.node, to.offset);
  else selection.setBaseAndExtent(start.node, start.offset, end.node, end.offset);
}

/**
 * The text a copy of a selection in a well carries: everything it spans, what a fold hides
 * included. A selection that begins where a line's text begins takes the line's indent, which is
 * drawn rather than selectable; one that runs onto the next line takes the line break but not the
 * indent after it.
 *
 * @param {Range} range
 */
export function copiedText(range) {
  const text = (range.cloneContents().textContent ?? "").replace(/\n +$/, "\n");
  const start = elementOf(range.startContainer);
  const row = start?.closest(CODELINE_SELECTOR) ?? start?.closest(LINE_SELECTOR);
  if (!row) return text;
  const before = document.createRange();
  before.setStart(row, 0);
  before.setEnd(range.startContainer, range.startOffset);
  const lead = /^\n?( *)$/.exec(before.toString())?.[1] ?? "";
  return lead + text;
}
