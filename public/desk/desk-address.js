// @ts-check

/**
 * The address, and the history it is written into. The bare desk, one capability's collection and
 * one of its records are the only places this desk has (ADR-0010); nothing here knows there is a
 * window.
 */

import {
  capabilityUrl,
  isAddressableRecord,
  RECORD_ID_PATTERN,
  recordAddress,
} from "../core/routes.js";
import { PLACES_ITS_OWN_FOCUS } from "../core/shell-dom.js";

/** `/capability/:id`, a capability's collection (design D14). */
const CAPABILITY_ADDRESS = /^\/capability\/([^/]+)\/?$/;

/** `/capability/:id/:record`, one record open in its record view (ADR-0010). */
const RECORD_ADDRESS = /^\/capability\/([^/]+)\/([^/]+)\/?$/;

/** A record id, read after its segment is decoded, as the server's route reads it. */
const RECORD_ID = new RegExp(`^${RECORD_ID_PATTERN}$`);

/**
 * One segment as the server reads it, or null where its escape is malformed.
 *
 * @param {string | undefined} segment
 * @returns {string | null}
 */
function decodedSegment(segment) {
  if (!segment) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * The capability a collection's address names. A record address and anything deeper name no
 * collection; no search term and no draft has ever been in the address.
 *
 * @param {string} pathname
 * @returns {string | null}
 */
export function capabilityIdFromAddress(pathname) {
  return decodedSegment(CAPABILITY_ADDRESS.exec(pathname)?.[1]);
}

/**
 * The record a record address names, its id in lower case as the server compares it.
 *
 * @param {string} pathname
 * @returns {{ capability: string, record: string } | null}
 */
export function recordFromAddress(pathname) {
  const match = RECORD_ADDRESS.exec(pathname);
  const capability = decodedSegment(match?.[1]);
  const record = decodedSegment(match?.[2]);
  if (capability === null || record === null || !RECORD_ID.test(record)) return null;
  return { capability, record: record.toLowerCase() };
}

/**
 * The place an address names, comparable across spellings, or null where it names none.
 *
 * @param {string} pathname
 * @returns {string | null}
 */
function placeOf(pathname) {
  const addressed = recordFromAddress(pathname);
  if (addressed !== null) return JSON.stringify([addressed.capability, addressed.record]);
  const id = capabilityIdFromAddress(pathname);
  return id === null ? null : JSON.stringify([id]);
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
 * Whether one address is somewhere other than another. Two addresses naming the same collection or
 * the same record are one place however spelled, which stops Back walking a run of entries that
 * all name it.
 *
 * @param {string} current the address in the bar
 * @param {string} next
 * @returns {boolean}
 */
export function isAnotherPlace(current, next) {
  if (current === next) return false;
  const here = placeOf(current);
  return here === null || here !== placeOf(next);
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
 * The address each entry names, by its place in the run, as far as this page has seen: what says
 * whether the entry before a record is its collection (PLAN decision 44). Kept off the entries, so
 * a reload, whose entries before belong to a page now gone, knows none of them.
 *
 * @type {Map<number, string>}
 */
const places = new Map();

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
  places.set(addressIndex, next);
  /* A navigation of the person's own outranks any traversal still expected to land. */
  taking = null;
  steppingOff = null;
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
  if (bar === null) return;
  places.set(addressIndex, next);
  bar.history.replaceState(entryState(), "", next);
}

/**
 * The collection a record view is being left for by its own way out (back, a save, a delete),
 * marked for the length of that read. Only that leaving may step back; a build giving the
 * capability back replaces.
 *
 * @type {{ collection: string, kept?: boolean } | null}
 */
let exiting = null;

/**
 * @param {string} collection the address the record view's way out asks for
 * @returns {() => void} lifts this mark, and no newer one, nor one kept for the desk coming back
 */
export function markRecordExit(collection) {
  /** @type {{ collection: string, kept?: boolean }} */
  const mark = { collection };
  exiting = mark;
  return () => {
    if (exiting === mark && !mark.kept) exiting = null;
  };
}

/**
 * Leave a record for its collection by stepping back, where the record view's own way out is
 * leaving it and the entry before is that collection as this page knows it. Arrived by link, or
 * after a reload, it is left by a replace.
 *
 * @param {string} collection @param {Bar} bar
 * @returns {boolean} whether it stepped back
 */
function stepBackOffRecord(collection, bar) {
  if (exiting === null || isAnotherPlace(exiting.collection, collection)) return false;
  exiting = null;
  const known = (/** @type {number} */ index) => places.get(index) ?? DESK_ADDRESS;
  if (!bar.history.go || isAnotherPlace(known(addressIndex), bar.location.pathname)) return false;
  if (isAnotherPlace(known(addressIndex - 1), collection)) return false;
  steppingOff = bar.location.pathname;
  stepBack(1, bar, addressIndex - 1);
  return true;
}

/**
 * The record address the desk's own step back is leaving, until a traversal arrives. A write while
 * the bar still names it, or while the bar is on an entry the desk is stepping back off, would land
 * on the wrong entry, so it waits, and whether it was owed an entry is kept for when the desk lands.
 *
 * @type {string | null}
 */
let steppingOff = null;
let owedAnEntry = false;

/** @param {Bar} bar @returns {boolean} whether a write now would land on the wrong entry */
function barIsAway(bar) {
  const away = travelled(bar.history.state);
  if (away !== null && away !== 0) return true;
  return steppingOff !== null && !isAnotherPlace(bar.location.pathname, steppingOff);
}

/**
 * What a write held back while the bar is away owes when the desk is back: an entry, if it was a
 * push, and a step back, if it was a record's way out landing.
 *
 * @param {string} next @param {boolean} navigated
 */
function holdBack(next, navigated) {
  owedAnEntry ||= navigated;
  if (exiting !== null && !isAnotherPlace(exiting.collection, next)) exiting.kept = true;
}

/**
 * Point the bar at what the window now shows. Taking the window is a navigation and is owed an
 * entry, except where it takes it back for the capability whose record the bar names: that, and
 * anything else, is the address catching up and is owed none (design D14; PLAN decision 44).
 *
 * @param {string} next the address of what the window shows
 * @param {boolean} navigated
 * @param {Bar | null} bar
 */
export function followWindow(next, navigated, bar) {
  if (bar === null) return;
  const { pathname, search } = bar.location;
  if (barIsAway(bar)) {
    holdBack(next, navigated);
    return;
  }
  const left = recordFromAddress(pathname);
  const offRecord = left !== null && !isAnotherPlace(capabilityAddress(left.capability), next);
  if (offRecord && stepBackOffRecord(next, bar)) return;
  /* A correction asks whether the bar is exactly right, where a push asks only whether it is
   * somewhere else — which is what strips a query string or a trailing slash from outside. */
  if (navigated && !offRecord) pushAddress(next, bar);
  else if (pathname !== next || search !== "") replaceAddress(next, bar);
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
 * What this module is handed rather than reaches for: the answers the desk owns, and this must
 * not have a second opinion about any of them. `knows` says whether a capability is on the desk,
 * and `bring` brings the window forward.
 *
 * @typedef {{
 *   render: (pathname: string) => void,
 *   hold: (go: () => unknown) => boolean,
 *   follow?: (navigated: boolean) => void,
 *   knows?: (capability: string) => boolean,
 *   bring?: () => void,
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
  steppingOff = null;
  const landedAt = travelled(/** @type {{ state?: unknown }} */ (event)?.state, 0);
  const landed = bar.location.pathname;
  if (isOwnStepBack(landedAt)) {
    deskIsBack(/** @type {number} */ (landedAt), landed, desk);
    return;
  }
  /* The person moved: nothing held back for the desk's return, nor any way out, still applies. */
  owedAnEntry = false;
  exiting = null;
  if (landedAt === null) {
    desk.render(landed);
    return;
  }
  const confirmed = taking === landedAt;
  taking = null;
  if (landedAt !== addressIndex && bar.history.go && !confirmed) {
    if (desk.hold(() => takeTheTraversal(landedAt, landed, desk, bar))) {
      stepBack(landedAt - addressIndex, bar);
      return;
    }
  }
  arrive(landedAt, landed);
  desk.render(landed);
}

/**
 * The desk's own step back has landed. Whatever the window took while the bar was away is answered
 * now, from what it shows, and owed an entry only if what was held back was.
 *
 * @param {number} index @param {string} pathname @param {DeskAnswers} desk
 */
function deskIsBack(index, pathname, desk) {
  arrive(index, pathname);
  const owed = owedAnEntry;
  owedAnEntry = false;
  desk.follow?.(owed);
  if (exiting?.kept) exiting = null;
}

/** @param {number} index the entry the bar is on @param {string} pathname what it names */
function arrive(index, pathname) {
  addressIndex = index;
  places.set(index, pathname);
}

/**
 * Undo the move the desk is asking about, so the bar names the window while the question
 * stands. It costs no entry and it leaves the Forward the person still has.
 *
 * @param {number} moved
 * @param {Bar} bar
 * @param {number} [landing] the entry the step back lands on
 */
function stepBack(moved, bar, landing = addressIndex) {
  steppingBackTo = landing;
  bar.history.go?.(-moved);
}

/**
 * Take the traversal the person confirmed, to the entry they asked for, measured from wherever the
 * desk is by then: its own way out of a record may have stepped back while the question stood.
 * It arrives as an ordinary `popstate` and that renders; already there, it renders here. A record
 * it moves to takes the focus as it lands, as on a Back nothing held.
 *
 * @param {number} target @param {string} landed @param {DeskAnswers} desk @param {Bar} bar
 */
function takeTheTraversal(target, landed, desk, bar) {
  const delta = target - addressIndex;
  if (delta === 0) {
    desk.render(landed);
    return;
  }
  taking = target;
  bar.history.go?.(delta);
  return recordFromAddress(landed) === null ? undefined : PLACES_ITS_OWN_FOCUS;
}

/**
 * The entry a confirmed traversal is on its way to. It is not asked about again when it lands:
 * the yes gave focus back to the form it let go of, which counts as starting on it again.
 *
 * @type {number | null}
 */
let taking = null;

/**
 * A press on a name in an answer, asking for the record it names. The detail carries the record's
 * `capability` and `record` ids, never an address: `recordAddress()` spells it here. What became
 * of the ask is written back as the detail's `outcome`, a {@link RecordPress}, and its `landed` is
 * called once the record has opened, at once or after the desk's question.
 */
export const OPEN_THE_RECORD_EVENT = "aluna:open-the-record";

/**
 * What a press on a record came to: opened now, held by the desk's question, or a capability no
 * longer on the desk, which is left alone rather than put away under the person.
 *
 * @typedef {"opened" | "held" | "gone"} RecordPress
 */

/**
 * Open a record the way its address opens it (PLAN decision 48): under the desk's hold, then an
 * entry of its own, then the desk renders it and brings its window forward. A press the desk holds
 * brings that window forward too, where its question is, and a yes leaves the focus to the record.
 *
 * @param {unknown} capability @param {unknown} record
 * @param {DeskAnswers} desk
 * @param {Bar | null} [bar]
 * @param {() => void} [landed] what the presser does once the record has opened
 * @returns {RecordPress | null} null where the ids name no record an address can carry
 */
export function takeRecordAddress(capability, record, desk, bar = deskHistory(), landed) {
  if (bar === null || !isAddressableRecord(capability, record)) return null;
  const id = /** @type {string} */ (capability);
  if (desk.knows && !desk.knows(id)) return "gone";
  const address = recordAddress(id, /** @type {string} */ (record).toLowerCase());
  const go = () => {
    pushAddress(address, bar);
    desk.render(address);
    desk.bring?.();
    landed?.();
    return PLACES_ITS_OWN_FOCUS;
  };
  if (!desk.hold(go)) {
    go();
    return "opened";
  }
  desk.bring?.();
  return "held";
}

/** What the desk answers with, once it has started. @type {DeskAnswers | null} */
let answering = null;
/** Every document already listening for a pressed name. */
const listening = new WeakSet();

/** @param {Event} event */
function openTheRecordFrom(event) {
  const { detail } = /** @type {CustomEvent<Record<string, unknown> | null>} */ (event);
  if (answering === null || typeof detail !== "object" || detail === null) return;
  const { landed } = detail;
  const after = typeof landed === "function" ? () => void landed() : undefined;
  detail.outcome = takeRecordAddress(
    detail.capability,
    detail.record,
    answering,
    deskHistory(),
    after,
  );
}

/**
 * Back and Forward are the desk's to answer: htmx would answer an `{ htmx: true }` entry by
 * restoring a whole-body snapshot (design D14), so the `onpopstate` property is taken, not added.
 *
 * @param {DeskAnswers} desk
 */
export function startDeskHistory(desk) {
  if (typeof window === "undefined") return;
  if (typeof document !== "undefined" && !listening.has(document)) {
    listening.add(document);
    document.addEventListener(OPEN_THE_RECORD_EVENT, openTheRecordFrom);
  }
  answering = desk;
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
