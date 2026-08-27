// @ts-check

/**
 * Which of the desk's windows is in front.
 *
 * Two windows exist at most — the capability's, and the developer panel's one
 * exception to that (design D13) — so stacking is a pair rather than a counter:
 * the one you touched last is in front, and the other is behind it. There is no
 * z-index that climbs, no taskbar, and nothing here that would become a window
 * manager if a third window ever asked. It could not: the exception is one.
 *
 * Below the breakpoint the same pair means something stronger. The window is the
 * screen there, so the one behind is not behind anything — it is underneath the
 * whole surface, and `.window--desk.is-unfocused` is taken out of the page
 * entirely (`design/styles/components/desk.css`). That is presentation only:
 * neither window's remembered desktop box is written while a phone is showing
 * one, so widening gives both of them back.
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
 * A window has opened. It arrives in front, which is what every window manager and
 * every desk agrees on: the thing you just asked for is the thing you are looking at.
 *
 * `front: false` is for the one window nobody asked for — the developer panel
 * reopening from a remembered preference on load. The address names a capability and
 * that is what the page is for, so a panel restored beside it stands behind it. It
 * still comes to the front if it is the only window there is, because on a phone the
 * one behind is not shown at all and a lone window behind nothing is a blank desk.
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
 * Put one window behind, without disturbing which of the others is in front.
 *
 * @param {StackMember} member
 */
function lower(member) {
  member.win.setFocused(false);
  member.el.classList.toggle("is-focused", false);
  member.el.style.setProperty("--win-z", BACK_Z);
}

/**
 * A window has gone. Whatever is left is now the only window, so it is the front
 * one — and on a phone that is the difference between the survivor being shown and
 * the surface going blank.
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
