// @ts-check

/**
 * Two windows exist at most — the capability's and the developer panel's exception (design D13),
 * so stacking is a pair, not a counter: no climbing z-index, no taskbar, no window manager.
 */

/** The focused window's stacking level, and the other one's. */
export const FRONT_Z = "6";
export const BACK_Z = "5";

/**
 * A window as the stack needs to see it: something to put a class and a custom
 * property on, and the frame that owns its focused presentation.
 *
 * @typedef {{ el: { classList: { toggle: (name: string, on: boolean) => void },
 *                   style: { setProperty: (name: string, value: string) => void } },
 *             win: { setFocused: (focused: boolean) => void } }} StackMember
 */

/** @type {Set<StackMember>} */
const standing = new Set();

/**
 * Put one window in front and every other behind it. Idempotent, so a pointer that
 * lands on the window already in front costs a class toggle and nothing else.
 *
 * @param {StackMember} member
 */
export function raise(member) {
  for (const other of standing) {
    const front = other === member;
    other.win.setFocused(front);
    other.el.classList.toggle("is-focused", front);
    other.el.style.setProperty("--win-z", front ? FRONT_Z : BACK_Z);
  }
}

/**
 * A window opens in front. `front: false` is the developer panel restored from a remembered
 * preference; it still rises when alone, because on a phone a lone window behind is a blank desk.
 *
 * @param {StackMember} member
 * @param {boolean} [front]
 */
export function joinStack(member, front = true) {
  standing.add(member);
  if (front || standing.size === 1) raise(member);
  else lower(member);
}

/**
 * Put one window behind; below the breakpoint that is out of the page entirely
 * (`design/styles/components/desk.css`), though the remembered desktop box is left unwritten.
 *
 * @param {StackMember} member
 */
function lower(member) {
  member.win.setFocused(false);
  member.el.classList.toggle("is-focused", false);
  member.el.style.setProperty("--win-z", BACK_Z);
}

/**
 * A window has gone. Whatever is left is the only window, so it is the front one — on a phone
 * that is the difference between showing the survivor and going blank.
 *
 * @param {StackMember} member
 */
export function leaveStack(member) {
  standing.delete(member);
  const [survivor] = standing;
  if (survivor) raise(survivor);
}

/** How many windows are standing. The one-exception rule, observable. */
export function standingCount() {
  return standing.size;
}
