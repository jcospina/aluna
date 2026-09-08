// @ts-check

/**
 * The address, and the history it is written into. One capability's address and the bare desk are
 * the only two places this desk has (design D14); nothing here knows there is a window.
 */

import { capabilityUrl } from "./routes.js";

/** `/capability/:id`, and nothing below it (design D14). */
const CAPABILITY_ADDRESS = /^\/capability\/([^/]+)\/?$/;

/**
 * The capability an address names — and an address names a capability or nothing at all
 * (design D14). No search term, no open record and no draft has ever been below the id.
 *
 * @param {string} pathname
 * @returns {string | null}
 */
export function capabilityIdFromAddress(pathname) {
  const match = CAPABILITY_ADDRESS.exec(pathname);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    /* A malformed escape names no capability. */
    return null;
  }
}

/** The bare desk. Putting the window away comes back here (design D14). */
export const DESK_ADDRESS = "/";

/**
 * One capability's address. `renderCapabilityLogo` spells the logo's own request the same
 * way, so a press and a reload of what the press wrote ask the server for one URL.
 *
 * @param {string} id
 * @returns {string}
 */
export function capabilityAddress(id) {
  return capabilityUrl(id);
}

/**
 * Whether one address is somewhere other than another. Two addresses naming the same capability
 * are one place however spelled, which stops Back walking a run of entries that all name it.
 *
 * @param {string} current the address in the bar
 * @param {string} next
 * @returns {boolean}
 */
export function isAnotherPlace(current, next) {
  if (current === next) return false;
  const here = capabilityIdFromAddress(current);
  return here === null || here !== capabilityIdFromAddress(next);
}

/**
 * The stable half of the mark on the entries this module writes, and deliberately not htmx's.
 * Not read at run time: the shell's `hx-history="false"` and `startDeskHistory` do the work.
 */
export const DESK_HISTORY_STATE = { aluna: "desk" };

/**
 * Where the desk is in its own run of entries. Counted, not measured: `history.length` is the
 * whole tab's and says nothing about position, and a `popstate` says only where it landed.
 */
let addressIndex = 0;

/** This desk's mark, with this entry's place in it. @returns {object} */
function entryState() {
  return { ...DESK_HISTORY_STATE, index: addressIndex };
}

/**
 * How far a traversal moved, or `null` where the entry it landed on is not one this desk wrote.
 * `null` is a move out of the desk, not a fallback to guess around ({@link restampAfterHtmx}).
 *
 * @param {unknown} state
 * @param {number} [from]
 * @returns {number | null}
 */
export function travelled(state, from = addressIndex) {
  const index = /** @type {{ index?: unknown } | null} */ (state)?.index;
  return typeof index === "number" ? index - from : null;
}

/**
 * The address bar and its history, or nothing where there is no browser. Handed to the verbs
 * below rather than reached for, so the whole history contract is something a test can run.
 *
 * @typedef {{
 *   location: { pathname: string, search: string },
 *   history: {
 *     state?: unknown,
 *     pushState(state: unknown, unused: string, url: string): void,
 *     replaceState(state: unknown, unused: string, url: string): void,
 *     go?: (delta: number) => void,
 *   },
 * }} Bar
 * @returns {Bar | null}
 */
export function deskHistory() {
  return typeof window === "undefined" ? null : window;
}

/**
 * Push one address, unless the bar already names that place. The bar is asked rather than a copy
 * kept here: Back and Forward move the address without passing through this.
 *
 * @param {string} next
 * @param {Bar | null} bar
 * @returns {string | null} the address it left, for a caller that may have to step back
 */
export function pushAddress(next, bar) {
  if (bar === null) return null;
  const cameFrom = bar.location.pathname;
  if (!isAnotherPlace(cameFrom, next)) return null;
  addressIndex += 1;
  bar.history.pushState(entryState(), "", next);
  return cameFrom;
}

/**
 * Move the address, adding no entry: a correction rather than a navigation. Unconditional,
 * unlike the push — a caller that may already be right asks `isAnotherPlace` first.
 *
 * @param {string} next
 * @param {Bar | null} bar
 */
export function replaceAddress(next, bar) {
  bar?.history.replaceState(entryState(), "", next);
}

/**
 * A window that never filled leaves no address behind naming what did not open — and only where
 * the bar still carries it, since a slow failure can answer long after the user moved on.
 *
 * @param {string} attempted the address that was being opened
 * @param {string} back where to leave the bar instead
 */
export function correctUnfilledAddress(attempted, back) {
  const bar = deskHistory();
  if (bar === null || isAnotherPlace(bar.location.pathname, attempted)) return;
  // A correction, not `history.back()`: that is asynchronous, would arrive as a `popstate` this
  // desk would answer, and would throw away a Forward. The cost is one inert-looking Back.
  replaceAddress(back, bar);
}

/* ── Back and Forward ──────────────────────────────────────────────────────── */

/**
 * What this module is handed rather than reaches for: two answers the desk owns, and this must
 * not have a second opinion about either.
 *
 * @typedef {{
 *   render: (pathname: string) => void,
 *   hold: (go: () => void) => boolean,
 * }} DeskAnswers
 */

/**
 * Put this desk's mark on the entry the page loaded into, spelled exactly as it stands. The
 * address is not corrected here; `addressTheWindow` answers a query string and a trailing slash.
 *
 * @param {Bar | null} bar
 */
function stampThisEntry(bar) {
  if (bar === null) return;
  // Read back first: entry state survives a reload and a bfcache restore while this counter
  // restarts at zero, so stamping blind would measure a later Back as a Forward.
  const stamped = travelled(bar.history.state, 0);
  if (stamped !== null) addressIndex = stamped;
  replaceAddress(`${bar.location.pathname}${bar.location.search}`, bar);
}

/**
 * Put the number back on an entry htmx has written the address of: `HX-Replace-Url` makes htmx
 * `replaceState` its own state (`src/lifecycle/deletion/http.ts`), leaving a Back unmeasurable.
 *
 * @param {{ addEventListener(type: string, listener: () => void): void }} root
 */
function restampAfterHtmx(root) {
  const restamp = () => {
    const bar = deskHistory();
    if (bar !== null) replaceAddress(`${bar.location.pathname}${bar.location.search}`, bar);
  };
  root.addEventListener("htmx:replacedInHistory", restamp);
}

/**
 * The entry the desk's own step back is on its way to. Which entry, not a bare flag: a `go` the
 * browser silently declines would leave a flag set forever and eat the next real Back.
 *
 * @type {number | null}
 */
let steppingBackTo = null;

/**
 * Whether this `popstate` is the desk's own step back arriving.
 *
 * @param {number | null} landedAt
 * @returns {boolean}
 */
function isOwnStepBack(landedAt) {
  if (steppingBackTo === null) return false;
  const expected = steppingBackTo;
  steppingBackTo = null;
  return landedAt === expected;
}

/**
 * Back and Forward, answered — or held, when taking them would take a run with them. Held rather
 * than refused: the person may leave, but is owed the cost first (PLAN decision 17).
 *
 * @param {unknown} event
 * @param {DeskAnswers} desk
 * @param {Bar | null} [bar]
 */
export function answerTraversal(event, desk, bar = deskHistory()) {
  if (bar === null) return;
  const landedAt = travelled(/** @type {{ state?: unknown }} */ (event)?.state, 0);
  if (isOwnStepBack(landedAt)) return;
  const landed = bar.location.pathname;
  const moved = landedAt === null ? null : landedAt - addressIndex;
  if (moved !== null && moved !== 0 && bar.history.go) {
    if (desk.hold(() => takeTheTraversal(moved, bar))) {
      stepBack(moved, bar);
      return;
    }
  }
  if (moved !== null) addressIndex += moved;
  desk.render(landed);
}

/**
 * Undo the move the desk is asking about, so the bar names the window while the question
 * stands. It costs no entry and it leaves the Forward the person still has.
 *
 * @param {number} moved
 * @param {Bar} bar
 */
function stepBack(moved, bar) {
  steppingBackTo = addressIndex;
  bar.history.go?.(-moved);
}

/**
 * Take the traversal the person confirmed. Equal and opposite to `stepBack`, so the stack ends
 * one move on and no wider; it arrives back as an ordinary `popstate` and that renders.
 *
 * @param {number} moved
 * @param {Bar} bar
 */
function takeTheTraversal(moved, bar) {
  bar.history.go?.(moved);
}

/**
 * Back and Forward are the desk's to answer: htmx would answer an `{ htmx: true }` entry by
 * restoring a whole-body snapshot (design D14), so the `onpopstate` property is taken, not added.
 *
 * @param {DeskAnswers} desk
 */
export function startDeskHistory(desk) {
  if (typeof window === "undefined") return;
  stampThisEntry(deskHistory());
  if (typeof document !== "undefined") restampAfterHtmx(document.body);
  const take = () => {
    window.onpopstate = (event) => answerTraversal(event, desk);
  };
  take();
  // Taken twice: htmx installs its handler on `DOMContentLoaded` and chains whatever it finds,
  // so taking the property only before that leaves htmx wrapping this and answering its own.
  if (typeof document !== "undefined" && document.readyState !== "complete") {
    document.addEventListener("DOMContentLoaded", take, { once: true });
  }
}
