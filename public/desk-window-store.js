// @ts-check

/**
 * What the browser remembers about the window: one box and one flag.
 *
 * A record is kept so a window survives the browser being closed on it — the tab goes,
 * the window was never dismissed, and it comes back where it was left. A window the
 * user *did* dismiss is over, and its box is not a standing preference for every window
 * after it. That difference is one boolean, and it is the single most load-bearing rule
 * here, which is why every one of these is a pure function over an injected store rather
 * than a reach for `localStorage`: the rules run in Bun, against a double.
 *
 * Lifted out of `public/desk-window.js` intact, as its own subject. Nothing here knows
 * what a desk or a frame is.
 */

/* A real relative URL, never the `#design/*` package specifier: this file is served
 * to a browser verbatim, and a browser has no import map to resolve a `#` with. */
import { readBox } from "../design/scripts/desk-geometry.js";

/**
 * A window's box and whether it is maximised — as much of the entry as a record is made
 * of, and deliberately no more. Structural so a test double satisfies it.
 * @typedef {{ x: number, y: number, w: number, h: number }} Box
 * @typedef {Box & { restore?: Box }} LiveBox a live box carries its pre-maximise one
 * @typedef {{ box: LiveBox, maximised: boolean }} Recordable
 */

/**
 * The one presentation record this module keeps, and the only key it writes. The
 * developer panel's is 5.6/04's, and those two are the whole of what the browser
 * remembers (design D9; ARCH §6.1).
 */
export const WINDOW_STORAGE_KEY = "aluna.desk.window.v1";

/* ── what the browser remembers ────────────────────────────────────────────── */

/**
 * The record, as it is written down: one box and one flag, and no third thing. While
 * the window is maximised the box it is standing in is the desk's, so the box kept
 * here is the one it will be given back — which is what stops a wide screen writing
 * *its* width minus the inset into the record and stranding the window on a narrower
 * one (PLAN decision 18).
 *
 * @typedef {Box & { max: boolean }} Presentation
 */

/**
 * Read a record back, believing as little of it as possible.
 *
 * A presentation preference is the shell's to keep and never the shell's to depend
 * on: malformed JSON, something that is not an object, geometry that is not four
 * finite numbers, or a flag that is not a boolean each fall back to this window's
 * default rather than reaching the desk. A bad preference may not stop an addressed
 * capability from opening, so nothing in here throws and nothing in here is trusted.
 *
 * The box is `readBox`'s question and the flag is this one's; each falls back on its
 * own, so a good box survives a bad flag.
 *
 * @param {string | null | undefined} raw
 * @returns {{ box: Box | null, max: boolean }}
 */
export function parsePresentation(raw) {
  /** @type {{ box: Box | null, max: boolean }} */
  const fresh = { box: null, max: false };
  if (typeof raw !== "string") return fresh;

  let stored;
  try {
    stored = JSON.parse(raw);
  } catch {
    return fresh;
  }
  if (stored === null || typeof stored !== "object") return fresh;

  /* `readBox` is `desk-geometry.js`'s, so the product and the design page believe
   * exactly the same things about a remembered box. */
  return { box: readBox(stored), max: stored.max === true };
}

/**
 * What a window is worth remembering as. `setMaximised` stashes the pre-maximise box
 * on the live one and clears it again on the way back, so the normal box is always
 * exactly that — no second geometry record, and no second key.
 *
 * @param {Recordable} entry
 * @returns {Presentation}
 */
export function presentationOf(entry) {
  const { x, y, w, h } = entry.box.restore ?? entry.box;
  return { x, y, w, h, max: entry.maximised };
}

/**
 * The store, where the browser has one to give.
 *
 * Reached for behind a `try`, not just read behind one: a browser told to block site
 * data throws on the *access* to `localStorage`, before any method is called. Storage
 * that cannot be opened is storage that remembers nothing, which is a working desk.
 *
 * @typedef {{ getItem(key: string): string | null, setItem(key: string, value: string): void,
 *             removeItem?(key: string): void }} Store
 * @returns {Store | null}
 */
export function localStore() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Read the record back. The store is an argument so the two ways it fails — throwing
 * on read, and holding nonsense — can both be handed to this rather than only reached
 * in a browser.
 *
 * The key is an argument because there are two records, one per allowed window, and
 * exactly two: this window's, and the developer panel's (`public/desk-dev-panel.js`).
 * Reading and writing them is one piece of code so the two cannot drift in how much
 * they believe of what they find.
 *
 * @param {Store | null} store
 * @param {string} [key]
 * @returns {{ box: Box | null, max: boolean }}
 */
export function loadPresentation(store, key = WINDOW_STORAGE_KEY) {
  try {
    return parsePresentation(store?.getItem(key));
  } catch {
    return { box: null, max: false };
  }
}

/**
 * Write the record, unless the desk is a phone. There the window is the screen and the
 * box it is standing in is the stylesheet's, so writing would turn a narrow browser
 * into a new desktop preference — the desktop record is read past, never over.
 *
 * Called where the user *authored* something: a finished drag or resize, the maximise
 * lamp, and the moment a phone becomes a desk. Deliberately not called on every resize
 * tick, and the difference matters. A clamp is not a preference: `fitToDesk` only ever
 * pulls a box in, so persisting each tick would let one transient narrowing — a browser
 * dragged small, a sidebar opened, a tablet turned — erode the remembered box for good,
 * with no way back to the screen it was authored on. The screen is clamped; the record
 * keeps what was asked for. (It also kept a synchronous, disk-backed write on the
 * resize path, which is the last place one belongs.)
 *
 * @param {Recordable} entry
 * @param {boolean} isPhone
 * @param {Store | null} store
 * @param {string} [key]
 * @param {Record<string, unknown>} [flags] extra presentation this window carries
 */
export function savePresentation(entry, isPhone, store, key = WINDOW_STORAGE_KEY, flags) {
  if (isPhone) return;
  const record = JSON.stringify({ ...presentationOf(entry), ...flags });
  try {
    /* Compared against what storage actually holds rather than against a copy kept
     * here: the record is shared with every tab on this origin, and a mirror in this
     * one is wrong the moment another writes. */
    if (store?.getItem(key) === record) return;
    store?.setItem(key, record);
  } catch {
    /* A desk that cannot persist is still a working desk. */
  }
}

/**
 * Drop the record, so the next window opens the way a first one does.
 *
 * A remembered box is a remembered *window*. While one is up, moving it is the user
 * saying where their window goes, and a browser closed on it should find it there
 * again. Dismissing it ends that window, and the box goes with it — otherwise a
 * position authored for one capability outlives it and the next capability opens
 * wherever the last was left standing, which reads as the desk failing to centre a
 * window rather than as a preference being honoured (design D9).
 *
 * No phone rule, and the asymmetry with `savePresentation` is the point. That rule
 * exists to stop a screen-sized box being *authored* as a desktop preference; there is
 * no box here to author. What is left is the user's own gesture, and a window dismissed
 * on a narrow browser is the same one window ending — so the record goes, rather than a
 * box surviving on a technicality and standing the next desktop window in the old place.
 *
 * The record is shared with every tab on this origin, so the last gesture wins: a
 * dismissal here drops a box another tab authored a moment ago. That is the same
 * single-record bargain `savePresentation` already makes, and the reason it refuses to
 * keep a mirror of what it wrote.
 *
 * `removeItem` is called optionally: `localStorage` has it, and a store handed in by a
 * test is only obliged to hold the two methods the record is otherwise kept with.
 *
 * @param {Store | null} store
 * @param {string} [key]
 */
export function forgetPresentation(store, key = WINDOW_STORAGE_KEY) {
  try {
    store?.removeItem?.(key);
  } catch {
    /* A desk that cannot forget is still a working desk. */
  }
}

/**
 * What a window going away means for the record, decided apart from the going away.
 *
 * A dismissal forgets and a bare desk does not, and the difference is one boolean: on a
 * cold load at `/` there was no window, nothing was dismissed, and the record of a
 * window the browser was closed on is the whole feature. That is the single most
 * load-bearing rule in this file, so it is a function that can be run rather than an
 * order of two statements that can only be read.
 *
 * @param {boolean} hadWindow whether there was a window to dismiss
 * @param {Store | null} store
 * @returns {boolean} whether a window was dismissed
 */
export function forgetOnDismissal(hadWindow, store) {
  if (!hadWindow) return false;
  forgetPresentation(store);
  return true;
}
