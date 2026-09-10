// @ts-check

import { refusePress } from "../design/scripts/window-press.js";

/**
 * Three windows exist at most — the capability's, the developer panel's (design D13) and the
 * answer window's (ADR-0008) — and each stands in a slot, front to back, by when the pointer
 * last landed on it. There is one slot per window and never a fourth window. A level is which
 * slot a window is in, not a number that climbs, so the desk still has no taskbar and no window
 * manager.
 */

/** The slots, front to back. The front one is whatever was raised last. */
export const FRONT_Z = "6";
export const BACK_Z = "5";
export const BEHIND_Z = "4";
const STACK_LEVELS = [FRONT_Z, BACK_Z, BEHIND_Z];

/**
 * A window as the stack needs to see it: something to put a class and a custom
 * property on, and the frame that owns its focused presentation.
 *
 * @typedef {{ el: { classList: { toggle: (name: string, on: boolean) => void },
 *                   style: { setProperty: (name: string, value: string) => void } },
 *             win: { setFocused: (focused: boolean) => void } }} StackMember
 */

/** Standing windows, oldest first — a raise moves one to the end. @type {Set<StackMember>} */
const standing = new Set();

/**
 * Put one window in front and step every other one back. Idempotent: a pointer landing on the
 * window already in front rewrites the same slots it already had. A window that is not standing
 * is not raised at all, because stepping every other one back for it would leave the desk with
 * no front window and, below the breakpoint, with nothing in the page.
 *
 * @param {StackMember} member
 */
export function raise(member) {
  if (!standing.has(member)) return;
  /* Deleting the member and adding it back puts it last, so the set reads oldest-first and
   * reversing it reads front to back. Two windows behind must not share a slot: paint order
   * would fall to the order they were built in, which changes as soon as one is reopened. */
  standing.delete(member);
  standing.add(member);
  const order = [...standing].reverse();
  for (const [index, other] of order.entries()) {
    const front = other === member;
    other.win.setFocused(front);
    other.el.classList.toggle("is-focused", front);
    other.el.style.setProperty("--win-z", STACK_LEVELS[index] ?? BEHIND_Z);
  }
}

/**
 * Raise from a press, and let the press be only that. A press on the window behind is a person
 * reaching for it, not choosing text in it, and `window-press.js` refuses the selection the
 * browser would have started. `design/styles/components/desk.css` answers this for a logo with
 * `user-select: none`; a window cannot borrow that answer, because whether it is the front one
 * is the very thing the press changes.
 *
 * @param {StackMember} member
 * @param {PointerEvent} press
 */
export function raiseFromPress(member, press) {
  /* Bound in the capture phase by every caller: the title bar raises the window itself, so a
   * bubbling listener meets a window that already reads as the one in front
   * (`design/scripts/window-gestures.js`). */
  refusePress(press, [...standing].at(-1) !== member);
  raise(member);
}

/**
 * A window opens in front. `front: false` is the developer panel restored from a remembered
 * preference; it still rises when alone, because on a phone a lone window behind is a blank desk.
 *
 * @param {StackMember} member
 * @param {boolean} [front]
 */
export function joinStack(member, front = true) {
  if (front || standing.size === 0) {
    standing.add(member);
    raise(member);
    return;
  }
  /* It joins behind everything already standing, so it is the least recently raised and goes to
   * the head of the set rather than the end of it. Appended, it would read as the window in
   * front, and the next press on the window the person is in would be refused as a reach. */
  const order = [member, ...standing];
  standing.clear();
  for (const one of order) standing.add(one);
  /* Raising the window that stays in front is what puts the newcomer behind. One writer for
   * every slot, so the newcomer cannot be handed a level another window already holds — below
   * the breakpoint a window that is not exposed is out of the page entirely (desk.css). */
  const inFront = [...standing].at(-1);
  if (inFront) raise(inFront);
}

/**
 * A window has gone, and the desk goes back to the one the user was in before it — the last one
 * raised, which with two windows was the only one left and with three is a choice. Dismissing an
 * answer gives back whatever it stood over, and putting that away gives back the bare desk.
 *
 * @param {StackMember} member
 */
export function leaveStack(member) {
  standing.delete(member);
  const survivor = [...standing].at(-1);
  if (survivor) raise(survivor);
}

/** How many windows are standing. The two-exception rule, observable. */
export function standingCount() {
  return standing.size;
}
