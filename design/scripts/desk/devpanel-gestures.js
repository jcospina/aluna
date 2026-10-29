// @ts-check

/**
 * What a reader's keys and pointer do inside the developer panel's wells.
 *
 * A well is a scroller inside a scroller, and a drag that started in one used to wander: past the
 * well's edge the pointer is over the next block's caption, so the selection jumped between the
 * payload and that caption while the well scrolled under it. A drag that starts in a well is now
 * the panel's to carry, the way a text area carries one: the selection follows the pointer held
 * inside the well's edges, and the well scrolls while the pointer is past them. A payload being
 * selected holds still until the selection lets go, so a live stage cannot rewrite text out from
 * under the reader. ⌘A or Ctrl+A in a block selects that block's payload and nothing else.
 */

import { caretAt, copiedText, grow, pick } from "./devpanel-select.js";
import { FOLDED_CLASS, NODE_SELECTOR, TWIST_SELECTOR } from "./devpanel-view.js";

export const BLOCK_SELECTOR = ".devpanel__block";
export const PRE_SELECTOR = ".devpanel__pre";
export const CODE_SELECTOR = ".devpanel__code";
const PANEL_SELECTOR = ".devpanel";
const SELECTING_CLASS = "is-selecting";
export const HELD_CLASS = "is-held";
/** On the root for the length of a drag, which is what `devpanel.css` keys the containment off. */
const PAGE_SELECTING_CLASS = "devpanel-selecting";
const ROVING_SELECTOR = `${TWIST_SELECTOR}[tabindex="0"]`;
/** How fast a well scrolls under a drag, in pixels a millisecond per pixel the pointer is past. */
const SCROLL_RATE = 0.02;
/** Past this far, the pointer asks for nothing faster. */
const SCROLL_REACH = 80;

/**
 * Each block whose newest payload is waiting, and what shows it.
 *
 * @type {Map<HTMLElement, () => void>}
 */
const held = new Map();

/**
 * Whether a block's payload should hold still: a drag is selecting in it, or a selection lies
 * wholly inside its well. A selection that runs past the well is not reading it, and a collapsed
 * block shows nothing to hold still for.
 *
 * @param {HTMLElement} block
 */
export function isHolding(block) {
  if (block.classList.contains(SELECTING_CLASS)) return true;
  const pre = block.querySelector(PRE_SELECTOR);
  const selection = document.getSelection?.();
  if (!pre || pre.hasAttribute("hidden") || !selection || selection.isCollapsed) return false;
  return pre.contains(selection.anchorNode) && pre.contains(selection.focusNode);
}

/**
 * Show this block's newest payload once nothing holds it. Only the newest is kept: a stage is a
 * snapshot, and the ones in between were already out of date when they arrived.
 *
 * @param {HTMLElement} block
 * @param {() => void} show
 */
export function holdUntilReleased(block, show) {
  held.set(block, show);
  block.classList.add(HELD_CLASS);
  /* The same listener twice is one listener, so this binds once however often a block holds. */
  document.addEventListener("selectionchange", releaseHeld);
}

/** @param {HTMLElement} block */
export function dropHeld(block) {
  held.delete(block);
  block.classList.remove(HELD_CLASS);
}

/*
 * Showing a block drops its hold, so each one waiting is shown once. A block whose panel has been
 * put away has nowhere to show anything, and is let go of instead.
 */
export function releaseHeld() {
  for (const [block, show] of held) {
    if (!block.isConnected) dropHeld(block);
    else if (!isHolding(block)) show();
  }
}

/**
 * Let go of the selection holding a block, so its newest payload can show. A block holds only
 * while the selection lies in it, so this is the reader's selection in that block.
 */
export function letGo() {
  document.getSelection()?.removeAllRanges();
}

/**
 * @param {Event} event
 * @returns {HTMLElement | null}
 */
const targetOf = (event) => (event.target instanceof HTMLElement ? event.target : null);

/**
 * @param {number} value
 * @param {number} low
 * @param {number} high
 */
const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

/**
 * @typedef {import("./devpanel-select.js").Point} Point
 * @typedef {{ pre: HTMLElement, x: number, y: number, frame: number, last: number,
 *             carry: number, presses: number, picked: [Point, Point] | null }} Drag
 */

/**
 * The part of a well the reader can see: its own scrollport, cut to the panel it stands in, which
 * may have scrolled half of it out of sight.
 *
 * @param {HTMLElement} pre
 */
function visibleBox(pre) {
  const box = pre.getBoundingClientRect();
  const panel = pre.closest(PANEL_SELECTOR)?.getBoundingClientRect() ?? box;
  return {
    left: Math.max(box.left, panel.left),
    right: Math.min(box.left + pre.clientWidth, panel.right),
    top: Math.max(box.top, panel.top),
    bottom: Math.min(box.top + pre.clientHeight, panel.bottom),
  };
}

/**
 * Carry the selection's moving end to the pointer, held inside the well's visible edges.
 *
 * @param {Drag} drag
 */
function extendTo(drag) {
  const { pre } = drag;
  const box = visibleBox(pre);
  if (box.right <= box.left || box.bottom <= box.top) return;
  const at = caretAt(
    clamp(drag.x, box.left + 1, box.right - 1),
    clamp(drag.y, box.top + 1, box.bottom - 1),
  );
  const selection = document.getSelection();
  if (!at || !pre.contains(at.node) || !selection) return;
  grow(selection, drag.picked, drag.presses, at);
}

/**
 * One frame of scrolling the well toward a pointer held past the top or bottom of what can be
 * seen of it. A page scrolls in whole pixels, so the fraction a slow frame asks for is kept for
 * the next one. A well that can go no further, with more of it hidden past the panel's edge on
 * that side, has the panel scrolled to bring the rest into sight.
 *
 * @param {Drag} drag
 * @param {number} now
 */
function scrollToward(drag, now) {
  drag.frame = 0;
  const box = visibleBox(drag.pre);
  const past = drag.y < box.top ? drag.y - box.top : Math.max(drag.y - box.bottom, 0);
  if (past === 0) {
    drag.last = 0;
    return;
  }
  const step = drag.last === 0 ? 16 : Math.min(now - drag.last, 50);
  drag.last = now;
  drag.carry += Math.sign(past) * Math.min(Math.abs(past), SCROLL_REACH) * SCROLL_RATE * step;
  const whole = Math.trunc(drag.carry);
  drag.carry -= whole;
  const was = drag.pre.scrollTop;
  drag.pre.scrollTop += whole;
  if (drag.pre.scrollTop === was) revealMore(drag.pre, whole);
  extendTo(drag);
  drag.frame = requestAnimationFrame((time) => scrollToward(drag, time));
}

/**
 * Scroll the panel by as much as the well asked for, if the well runs past the panel that way.
 *
 * @param {HTMLElement} pre
 * @param {number} by
 */
function revealMore(pre, by) {
  const panel = pre.closest(PANEL_SELECTOR);
  if (!(panel instanceof HTMLElement) || by === 0) return;
  const box = pre.getBoundingClientRect();
  const bounds = panel.getBoundingClientRect();
  if (by > 0 ? box.bottom > bounds.bottom : box.top < bounds.top) panel.scrollTop += by;
}

/**
 * Whether a press lands inside the selection already made: that drag moves the selected text,
 * and moving text is the browser's to do.
 *
 * @param {MouseEvent} event
 */
function pressedInSelection(event) {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed) return false;
  const at = caretAt(event.clientX, event.clientY);
  return at !== null && selection.getRangeAt(0).isPointInRange(at.node, at.offset);
}

/**
 * Whether a press is on the well's own scrollbar, where a scrollbar takes room of its own:
 * that press scrolls, and scrolling is the browser's to do.
 *
 * @param {MouseEvent} event
 * @param {HTMLElement} pre
 */
function onScrollbar(event, pre) {
  const box = pre.getBoundingClientRect();
  const right = box.left + pre.clientLeft + pre.clientWidth;
  const bottom = box.top + pre.clientTop + pre.clientHeight;
  return event.clientX >= right || event.clientY >= bottom;
}

/**
 * Put the selection where the press landed — a caret, a word or a line, by how many presses — or
 * carry a selection already in this well there on a shifted press. The well takes the focus the
 * press would have given it, without the ring a keyboard's focus draws.
 *
 * @param {MouseEvent} event
 * @param {Drag} drag
 */
function placeCaret(event, drag) {
  const { pre } = drag;
  pre.focus(/** @type {FocusOptions} */ ({ preventScroll: true, focusVisible: false }));
  const at = caretAt(event.clientX, event.clientY);
  const selection = document.getSelection();
  if (!at || !selection || !pre.contains(at.node)) return;
  if (event.shiftKey && pre.contains(selection.anchorNode)) selection.extend(at.node, at.offset);
  else drag.picked = pick(selection, at, drag.presses);
}

/** Ends the drag under way, if there is one. @type {(() => void) | null} */
let ending = null;
/** What ends a drag besides a move with no button held: a release, a menu, a cancelled press. */
const ENDINGS = /** @type {const} */ (["mouseup", "pointercancel", "contextmenu"]);

/**
 * A press in a well, and the drag it may become. The panel takes the press from the browser —
 * places the caret, picks the word or the line, and carries the selection from there — because
 * the browser's own drag maps a pointer past the well to the nearest selectable text, the next
 * block's caption or the payload's far end, and scrolls the whole panel along with the well.
 * A stage that lands mid-press waits for the release, and the update that follows keeps the
 * element pressed, so a click on a fold's count is still a click.
 *
 * @param {MouseEvent} event
 */
function startDrag(event) {
  const target = targetOf(event);
  if (event.button !== 0 || !target || target.closest("button")) return;
  const pre = target.closest(PRE_SELECTOR);
  const block = pre?.closest(BLOCK_SELECTOR);
  if (!(pre instanceof HTMLElement) || !(block instanceof HTMLElement)) return;
  /* A second or third press lands in what the first selected, and is still a press, not a move. */
  if (onScrollbar(event, pre) || (event.detail === 1 && pressedInSelection(event))) return;

  ending?.();
  event.preventDefault();
  /** @type {Drag} */
  const drag = {
    pre,
    x: event.clientX,
    y: event.clientY,
    frame: 0,
    last: 0,
    carry: 0,
    presses: event.detail,
    picked: null,
  };
  placeCaret(event, drag);
  /* Held from the press, so a stage landing before the first move cannot pull the caret away. */
  block.classList.add(SELECTING_CLASS);
  const root = document.documentElement;
  const view = document.defaultView;
  let moved = false;

  /** @param {MouseEvent} move */
  const follow = (move) => {
    /* A release the page never heard — a menu took it, or the window was left — ends it here. */
    if ((move.buttons & 1) === 0) {
      end();
      return;
    }
    move.preventDefault();
    moved = true;
    root.classList.add(PAGE_SELECTING_CLASS);
    drag.x = move.clientX;
    drag.y = move.clientY;
    extendTo(drag);
    if (!drag.frame) drag.frame = requestAnimationFrame((time) => scrollToward(drag, time));
  };
  const scrolled = () => {
    if (moved) extendTo(drag);
  };
  /** @param {Event} [up] */
  const end = (up) => {
    if (up?.type === "mouseup" && /** @type {MouseEvent} */ (up).button !== 0) return;
    ending = null;
    document.removeEventListener("mousemove", follow, true);
    for (const type of ENDINGS) document.removeEventListener(type, end, true);
    view?.removeEventListener("blur", end);
    pre.removeEventListener("scroll", scrolled);
    cancelAnimationFrame(drag.frame);
    block.classList.remove(SELECTING_CLASS);
    root.classList.remove(PAGE_SELECTING_CLASS);
    releaseHeld();
  };
  ending = end;
  document.addEventListener("mousemove", follow, true);
  for (const type of ENDINGS) document.addEventListener(type, end, true);
  view?.addEventListener("blur", end);
  pre.addEventListener("scroll", scrolled);
}

/**
 * A copy of a selection inside a well takes the payload's own text: what a fold hides, and the
 * line breaks and indent the sheet draws rather than prints. Without it a folded array copies as
 * `[]`, which is not what the payload said.
 *
 * @param {ClipboardEvent} event
 */
function copyFromWell(event) {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || !event.clipboardData) return;
  const range = selection.getRangeAt(0);
  const holder = range.commonAncestorContainer;
  const within = holder instanceof Element ? holder : holder.parentElement;
  if (!within?.closest(CODE_SELECTOR)) return;
  event.clipboardData.setData("text/plain", copiedText(range));
  event.preventDefault();
}

/**
 * @param {KeyboardEvent} event
 * @returns {boolean} whether the keys were this block's select-all
 */
function selectAll(event) {
  /* By the key's place as well as its letter, so a layout without a Latin A still has it. */
  const a = String(event.key).toLowerCase() === "a" || event.code === "KeyA";
  if (!a || event.altKey || event.shiftKey || (!event.metaKey && !event.ctrlKey)) return false;
  const block = targetOf(event)?.closest(BLOCK_SELECTOR);
  if (!block) return false;

  event.preventDefault();
  const selection = document.getSelection();
  const pre = /** @type {HTMLElement} */ (block.querySelector(PRE_SELECTOR));
  /* A collapsed block shows nothing, so it has nothing to select. */
  if (pre.hasAttribute("hidden")) selection?.removeAllRanges();
  else selection?.selectAllChildren(/** @type {HTMLElement} */ (pre.querySelector(CODE_SELECTOR)));
  return true;
}

/**
 * Make this fold the one Tab reaches in its well. One stop per well, not one per fold: a metrics
 * payload has hundreds, and the arrows walk them once inside.
 *
 * @param {Element} twist
 */
export function rove(twist) {
  const code = /** @type {HTMLElement} */ (twist.closest(CODE_SELECTOR));
  for (const other of code.querySelectorAll(ROVING_SELECTOR)) other.setAttribute("tabindex", "-1");
  twist.setAttribute("tabindex", "0");
}

/**
 * Rewrite a well and keep the reader's place among its folds: the same fold stays the one Tab
 * reaches, and keeps focus if it had it.
 *
 * @param {HTMLElement} code
 * @param {() => void} render
 */
export function keepPlace(code, render) {
  const before = code.querySelector(ROVING_SELECTOR);
  const path = before?.closest(NODE_SELECTOR)?.getAttribute("data-path");
  const focused = before !== null && document.activeElement === before;
  render();
  const node = path == null ? null : code.querySelector(`[data-path="${CSS.escape(path)}"]`);
  const twist = node?.querySelector(TWIST_SELECTOR) ?? code.querySelector(TWIST_SELECTOR);
  if (!(twist instanceof HTMLElement)) return;
  rove(twist);
  if (focused) twist.focus({ preventScroll: true });
}

const WALKS = new Set(["ArrowDown", "ArrowUp", "Home", "End", "ArrowRight", "ArrowLeft"]);

/**
 * The arrows among a well's folds, as a tree takes them: up and down to the neighbouring fold,
 * right opens and then steps in, and left closes and then climbs to the fold around it. An arrow
 * with a modifier is the browser's or the system's, not the panel's.
 *
 * @param {KeyboardEvent} event
 * @param {(node: HTMLElement, open: boolean) => void} fold
 */
function walkFolds(event, fold) {
  const twist = targetOf(event)?.closest(TWIST_SELECTOR);
  const modified = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
  if (!twist || modified || !WALKS.has(event.key)) return;
  event.preventDefault();
  const next = stepFrom(twist, event.key, fold);
  /* Focusing it makes it the fold Tab reaches, through the panel's own focusin. */
  if (next instanceof HTMLElement) next.focus();
}

/**
 * Where one arrow goes from a fold, or `null` when it opens or closes the fold instead.
 *
 * @param {Element} twist
 * @param {string} key
 * @param {(node: HTMLElement, open: boolean) => void} fold
 * @returns {Element | null | undefined}
 */
function stepFrom(twist, key, fold) {
  const node = /** @type {HTMLElement} */ (twist.parentElement);
  const code = /** @type {HTMLElement} */ (twist.closest(CODE_SELECTOR));
  const shown = [...code.querySelectorAll(TWIST_SELECTOR)].filter(
    (each) => each.getClientRects().length > 0,
  );
  const at = shown.indexOf(twist);
  const open = !node.classList.contains(FOLDED_CLASS);
  if (key === "Home") return shown[0];
  if (key === "End") return shown.at(-1);
  if (key === "ArrowUp") return shown[at - 1];
  if (key === "ArrowDown") return shown[at + 1];
  if (key === "ArrowRight" && open) return within(node, shown[at + 1]);
  if (key === "ArrowLeft" && !open) {
    const around = /** @type {HTMLElement} */ (node.parentElement).closest(NODE_SELECTOR);
    return around?.querySelector(TWIST_SELECTOR);
  }
  fold(node, key === "ArrowRight");
  return null;
}

/**
 * The next fold, if it is one of this node's own; an open node with none has nowhere to step in.
 *
 * @param {Element} node
 * @param {Element | undefined} next
 */
const within = (node, next) => (next && node.contains(next) ? next : null);

/**
 * Bind the panel's reading gestures to its shell, and its copy to the document, where a copy
 * lands whatever holds focus.
 *
 * @param {HTMLElement} shell
 * @param {(node: HTMLElement, open: boolean) => void} fold
 */
export function watchReading(shell, fold) {
  shell.addEventListener("mousedown", startDrag);
  shell.addEventListener("keydown", (event) => {
    if (!selectAll(event)) walkFolds(event, fold);
  });
  shell.addEventListener("focusin", (event) => {
    const focused = targetOf(event);
    if (focused?.matches(TWIST_SELECTOR)) rove(focused);
  });
  document.addEventListener("copy", copyFromWell);
}
