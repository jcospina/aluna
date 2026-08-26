// @ts-check
/**
 * Moving a window and changing its size.
 *
 * The three gestures a window's frame offers — drag it by the title bar, resize it
 * from the bottom-right corner, maximise it — are the same gestures wherever a window
 * stands, so they are written once here and not again beside each desk. This is the
 * same rule the frame itself keeps: `window.js` draws every window, and no surface
 * gets a second, simpler one of its own.
 *
 * Two properties hold across all three and are the reason they belong together:
 *
 *   - A drag is a transform and nothing else. The frame's path is untouched, so the
 *     hand never re-rolls mid-drag and the window is not the slowest thing on the
 *     desk. A size change is the one gesture that does invalidate the path, and the
 *     window's own `ResizeObserver` is what notices.
 *   - Every one of them ends inside the desk. `desk-geometry.js` carries the edges,
 *     the prompt bar's floor among them, and every clamp here goes through it.
 *
 * What stays with the caller is what only the caller knows: whether this desk is one
 * a window may be dragged on at all, what to bring to the front when a gesture
 * starts, and whether the result is worth remembering.
 */

import { clampPosition, clampSize, placeWindow } from "./desk-geometry.js";

/** @typedef {import("./desk-geometry.js").Box} Box */

/**
 * A box as it is remembered. Maximised is a flag rather than a size, so it is
 * recomputed against whatever screen the window comes back on, and the box it had
 * before is kept beside it to give back.
 * @typedef {Box & { max?: boolean, restore?: Box }} StoredBox
 */

/**
 * One window, as much of one as a gesture touches.
 *
 * @typedef {object} GestureHost
 * @property {HTMLElement} el the window
 * @property {StoredBox} box mutated in place as the gesture runs
 * @property {() => DOMRect} bounds the desk this window is held inside
 * @property {() => boolean} [standDown] whether a gesture must not begin at all — a
 *   maximised window, or a phone, where the window is the screen
 * @property {() => void} [onStart] the window was touched; bring it to the front
 * @property {() => void} [onEnd] the gesture finished; the box is worth remembering
 */

/** Every way a pointer gesture ends: the ordinary release, and the two interruptions. */
export const DRAG_ENDINGS = ["pointerup", "pointercancel", "lostpointercapture"];

/**
 * Run one pointer gesture from a press to whichever way it ends.
 *
 * Exported so the unbinding can be proven rather than grepped for: hand it a fake
 * handle, end the gesture each of the three ways, and the move listener is gone every
 * time.
 *
 * `pointercancel` and `lostpointercapture` end a gesture too — a system gesture or a
 * browser interruption raises one instead of `pointerup`. Without them the move
 * listener stays attached, the window follows a pointer with no button held, and
 * every later gesture stacks another live listener.
 *
 * @typedef {{
 *   setPointerCapture(pointerId: number): void,
 *   addEventListener(type: string, listener: (event: PointerEvent) => void): void,
 *   removeEventListener(type: string, listener: (event: PointerEvent) => void): void,
 * }} PointerHandle
 *
 * @param {PointerHandle} handle the element the pointer is captured on
 * @param {{ pointerId: number }} event the press that started it
 * @param {(move: PointerEvent) => void} onMove
 * @param {() => void} [onEnd]
 */
export function trackPointer(handle, event, onMove, onEnd) {
  handle.setPointerCapture(event.pointerId);
  const finish = () => {
    handle.removeEventListener("pointermove", onMove);
    for (const ending of DRAG_ENDINGS) handle.removeEventListener(ending, finish);
    onEnd?.();
  };
  handle.addEventListener("pointermove", onMove);
  for (const ending of DRAG_ENDINGS) handle.addEventListener(ending, finish);
}

/**
 * Drag a window by its title bar, and by nothing else. A press on a lamp is not the
 * start of a drag.
 *
 * @param {HTMLElement} bar the window's title bar
 * @param {GestureHost} host
 */
export function addWindowDrag(bar, host) {
  bar.classList.add("window__bar--draggable");

  bar.addEventListener("pointerdown", (event) => {
    const { target } = event;
    if (target instanceof Element && target.closest(".lamp")) return;
    if (host.standDown?.()) return;

    const { box } = host;
    const bounds = host.bounds();
    const grabX = event.clientX - box.x;
    const grabY = event.clientY - box.y;
    host.el.classList.add("is-dragging");
    host.onStart?.();

    trackPointer(
      bar,
      event,
      (move) => {
        box.x = move.clientX - grabX;
        box.y = move.clientY - grabY;
        clampPosition(bounds, box);
        placeWindow(host.el, box);
      },
      () => {
        host.el.classList.remove("is-dragging");
        host.onEnd?.();
      },
    );
  });
}

/**
 * The bottom-right corner. Pointer geometry rather than a control: it is not
 * focusable and it is hidden from the accessibility tree, because a tab stop whose
 * Enter does nothing is worse than no tab stop. The leaf lamp is the size change a
 * keyboard can make.
 *
 * @param {GestureHost} host
 * @returns {HTMLElement} the grip, already appended to the window
 */
export function addWindowGrip(host) {
  const grip = document.createElement("div");
  grip.className = "window__grip";
  grip.setAttribute("aria-hidden", "true");
  host.el.append(grip);

  grip.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    if (host.standDown?.()) return;

    const { box } = host;
    const bounds = host.bounds();
    const fromX = event.clientX;
    const fromY = event.clientY;
    const fromW = box.w;
    const fromH = box.h;
    host.onStart?.();

    trackPointer(
      grip,
      event,
      (move) => {
        box.w = fromW + (move.clientX - fromX);
        box.h = fromH + (move.clientY - fromY);
        clampSize(bounds, box);
        placeWindow(host.el, box);
      },
      () => host.onEnd?.(),
    );
  });

  return grip;
}

/**
 * Maximise a window, or give it back the box it had.
 *
 * Maximised is a state, never a size (D9): what is kept is that the window was
 * maximised and what box to return to, so a window that comes back on a different
 * screen fills that screen instead of the one it left. Fitting the result to the desk
 * stays with the caller — only the caller knows whether this desk is a phone, where
 * the stylesheet places the window and no box may be written for it.
 *
 * @param {HTMLElement} el
 * @param {StoredBox} box mutated in place
 * @param {boolean} maximised
 */
export function setMaximised(el, box, maximised) {
  if (maximised) box.restore = { x: box.x, y: box.y, w: box.w, h: box.h };
  else if (box.restore) {
    Object.assign(box, box.restore);
    box.restore = undefined;
  }
  box.max = maximised;
  el.classList.toggle("is-maximised", maximised);
}
