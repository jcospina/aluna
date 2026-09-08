// @ts-check

/**
 * What the browser remembers about the window: one box and one flag. Every rule here is a pure
 * function over an injected store, so it runs in Bun against a double.
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
 * The one presentation record this module keeps, and the only key it writes. The developer
 * panel's is the other, and those two are the whole of what the browser remembers (D9; ARCH §6.1).
 */
export const WINDOW_STORAGE_KEY = "aluna.desk.window.v1";

/* ── what the browser remembers ────────────────────────────────────────────── */

/**
 * The record as written down. While a window is maximised its standing box is the desk's, so
 * this keeps the one it gets back, and a wide screen cannot strand it (PLAN decision 18).
 *
 * @typedef {Box & { max: boolean }} Presentation
 */

/**
 * Read a record back, believing as little of it as possible: a bad preference must not stop an
 * addressed capability opening, and each of the box and the flag falls back on its own.
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
 * What a window is worth remembering as. `setMaximised` stashes the pre-maximise box on the live
 * one and clears it on the way back, so there is no second geometry record and no second key.
 *
 * @param {Recordable} entry
 * @returns {Presentation}
 */
export function presentationOf(entry) {
  const { x, y, w, h } = entry.box.restore ?? entry.box;
  return { x, y, w, h, max: entry.maximised };
}

/**
 * The store, where the browser has one to give. Reached for behind a `try`, not just read behind
 * one: a browser told to block site data throws on the access itself, before any method call.
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
 * Read the record back. The store is an argument so both its failures — throwing, and holding
 * nonsense — are testable, and the key so the panel's record cannot drift from this one.
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
 * Write the record, unless the desk is a phone: there the box is the stylesheet's, so writing
 * would turn a narrow browser into a desktop preference. The desktop record is read past.
 *
 * @param {Recordable} entry
 * @param {boolean} isPhone
 * @param {Store | null} store
 * @param {string} [key]
 * @param {Record<string, unknown>} [flags] extra presentation this window carries
 */
export function savePresentation(entry, isPhone, store, key = WINDOW_STORAGE_KEY, flags) {
  if (isPhone) return;
  // Called only where the user authored something — a finished drag, the maximise lamp — never
  // on a resize tick: `fitToDesk` only pulls a box in, so ticks would erode the record for good.
  const record = JSON.stringify({ ...presentationOf(entry), ...flags });
  try {
    /* Compared against what storage holds, not a local copy: the record is shared with every
     * tab on this origin, and a mirror here is wrong the moment another tab writes. */
    if (store?.getItem(key) === record) return;
    store?.setItem(key, record);
  } catch {
    /* A desk that cannot persist is still a working desk. */
  }
}

/**
 * Drop the record, so the next window opens the way a first one does: a box outliving the
 * capability it was authored for reads as the desk failing to centre a window (design D9).
 *
 * @param {Store | null} store
 * @param {string} [key]
 */
export function forgetPresentation(store, key = WINDOW_STORAGE_KEY) {
  // No phone rule, unlike `savePresentation`: that one stops a screen-sized box becoming a
  // desktop preference, and there is no box here to author.
  try {
    // `removeItem` optionally: `localStorage` has it, and a store handed in by a test is only
    // obliged to hold the two methods the record is otherwise kept with.
    store?.removeItem?.(key);
  } catch {
    /* A desk that cannot forget is still a working desk. */
  }
}

/**
 * What a window going away means for the record, decided apart from the going away: a dismissal
 * forgets and a bare desk does not, so a cold load at `/` keeps the record it found.
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
