// @ts-check

/**
 * The address, and the history it is written into.
 *
 * One capability's address and the bare desk are the only two places this desk has
 * (design D14), and every one of them is spelled here: what an address names, whether
 * two of them are the same place, and the two verbs that move the bar. `desk-window.js`
 * re-exports the lot, so the desk's rules are still reached through the one face they
 * have always had.
 *
 * Back and Forward are answered here too, and that is why this is a module rather than a
 * section. Answering a traversal is no longer one line: since PLAN decision 17 a Back
 * that would take a live build or evolution has to be *held* — asked about instead of
 * taken, and then either dropped or taken exactly once — and holding a move the browser
 * has already made is a subject with its own state. What it must not become is a second
 * opinion about what the address means, so it is handed the desk's own answers rather
 * than reaching for them: what to render, what the window is called, and whether there
 * is anything to ask about. Nothing here knows there is a window.
 */

/** `/capability/:id`, and nothing below it (design D14). */
const CAPABILITY_ADDRESS = /^\/capability\/([^/]+)\/?$/;

/**
 * The capability an address names — and an address names a capability or nothing at
 * all (design D14). No search term, no open record and no draft has ever been in
 * here, so there is nothing below the id to parse and nothing to keep in step.
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
  return `/capability/${encodeURIComponent(id)}`;
}

/**
 * Whether one address is somewhere other than another.
 *
 * Two addresses naming the same capability are one place however they are spelled, which
 * is what stops Back walking a run of entries that all name it — a press on the logo
 * already open, a swap correcting an address that was already right (design D14).
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
 * The stable half of the mark on the entries this module writes, and deliberately not
 * htmx's. `entryState` writes this plus the entry's own place in the run of them. htmx claims
 * the entries stamped `{ htmx: true }` and answers a Back onto one by restoring a snapshot
 * of the whole body — the DOM as it stood, search term and open record included.
 *
 * Two things stand between that and the desk, and this is only the second of them. The
 * shell carries `hx-history="false"`, so no snapshot is ever taken; and `startDeskHistory`
 * below takes `popstate` outright, so htmx never answers a Back at all. This mark is what
 * would still tell the two apart if either were ever undone — it is not read at run time,
 * and htmx may re-stamp an entry it corrects through `HX-Replace-Url` without consequence.
 */
export const DESK_HISTORY_STATE = { aluna: "desk" };

/**
 * Where the desk is in its own run of entries, and the number every entry it writes
 * carries with it.
 *
 * A `popstate` says which entry the browser landed on and nothing about how far it
 * travelled to get there, and "how far" is exactly what a traversal the desk has to ask
 * about needs: the question is asked *instead of* the move, so the move has to be undone
 * while it stands and taken again if the person says yes. Two `history.go` calls of equal
 * and opposite size are what leave the stack exactly as it was — neither an entry more
 * for the asking, nor one fewer for the answering.
 *
 * Counted rather than measured. `history.length` is the whole tab's, shared with whatever
 * the person was doing before the desk, and it says nothing about position.
 */
let addressIndex = 0;

/** This desk's mark, with this entry's place in it. @returns {object} */
function entryState() {
  return { ...DESK_HISTORY_STATE, index: addressIndex };
}

/**
 * How far a traversal moved, or nothing where the entry it landed on is not one this desk
 * wrote — one from before the page, from another site, or one whose stamp something else
 * overwrote.
 *
 * `null` is not a fallback to guess around. An entry the desk did not write is not a move
 * *within* the desk, and a question about losing a run cannot be asked of a traversal that
 * is leaving the document — the page unloads and takes the run with it whatever anyone
 * answers. So the desk answers it the way it always has, and the one thing that could
 * manufacture a `null` inside the desk's own run of entries is closed below
 * ({@link restampAfterHtmx}).
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
 * The address bar and its history, or nothing where there is no browser.
 *
 * Handed to the verbs below rather than reached for inside them, the way `localStore` is
 * handed to `savePresentation`: the whole of the history contract is then something a
 * test can run, rather than something a test can only read off the source.
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
 * Push one address, unless the bar already names that place.
 *
 * The bar is asked rather than a copy kept here. Back and Forward move the address
 * without passing through this, so a mirror in this module would be wrong the moment the
 * user pressed either.
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
 * Move the address, adding no entry. A correction rather than a navigation: the user did
 * not go anywhere, so there is nowhere new for Back to step off.
 *
 * Unconditional, unlike the push. A caller correcting an address that may already be right
 * asks `isAnotherPlace` first; the one stepping a failed press back knows the bar is
 * carrying the entry that press just made.
 *
 * @param {string} next
 * @param {Bar | null} bar
 */
export function replaceAddress(next, bar) {
  bar?.history.replaceState(entryState(), "", next);
}

/**
 * A window that never filled, or an address that turned out to name nothing, leaves no
 * address behind naming what did not open.
 *
 * Only where the bar is still carrying the address that press, that Back or that load put
 * there. A slow failure can answer long after the user has opened something else, and
 * correcting then would answer the wrong question — the same reason
 * `putAwayUnfilledWindow` asks which window is up before taking one down.
 *
 * A correction rather than a step back. `history.back()` is asynchronous, would arrive as
 * a `popstate` this desk would then answer, and would throw away a Forward the user may
 * still have. The cost is one entry naming the same place as the one before it, so a
 * single Back out of a failed press looks inert; a live address naming a capability
 * nobody can open is the worse of the two.
 *
 * @param {string} attempted the address that was being opened
 * @param {string} back where to leave the bar instead
 */
export function correctUnfilledAddress(attempted, back) {
  const bar = deskHistory();
  if (bar === null || isAnotherPlace(bar.location.pathname, attempted)) return;
  replaceAddress(back, bar);
}

/* ── Back and Forward ──────────────────────────────────────────────────────── */

/**
 * What this module is handed rather than reaches for. Two answers the desk owns and this
 * must not have a second opinion about: what an address renders as, and whether there is
 * anything standing that a traversal would have to ask about first.
 *
 * @typedef {{
 *   render: (pathname: string) => void,
 *   hold: (go: () => void) => boolean,
 * }} DeskAnswers
 */

/**
 * Put this desk's mark on the entry the page loaded into, spelled exactly as it stands.
 *
 * The number is *read back first*, and that is the load-bearing half. Entry state survives
 * a reload and a restore from the back-forward cache, so the entries on either side of
 * this one keep the numbers they were given in the page that is gone — while the counter
 * in this module has just started again at zero. Stamping without reading would make this
 * entry claim to be the first of a run it is in the middle of, and every distance measured
 * off it afterwards would be wrong by however far along the person actually was: a Back
 * would measure as a Forward, and the step meant to undo it would travel the wrong way,
 * possibly out of the document entirely.
 *
 * The address is not corrected here — a query string and a trailing slash are answered
 * where they are read (`addressTheWindow`), and this runs before the window holds anything
 * to answer for.
 *
 * @param {Bar | null} bar
 */
function stampThisEntry(bar) {
  if (bar === null) return;
  const stamped = travelled(bar.history.state, 0);
  if (stamped !== null) addressIndex = stamped;
  replaceAddress(`${bar.location.pathname}${bar.location.search}`, bar);
}

/**
 * Put the number back on an entry htmx has just written the address of.
 *
 * `HX-Replace-Url` is answered by htmx calling `replaceState` with its own state, which
 * takes this desk's stamp off the entry the person is standing on — a deletion's outcome
 * is the route that does it (`src/capability-deletion/http.ts`). Left that way, a Back
 * onto that entry later would be a move the desk could not measure, inside its own run of
 * entries. Re-stamping is one line and it closes that off at the source, which is better
 * than a branch downstream that has to guess.
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
 * The entry the desk's own step back is on its way to, or nothing.
 *
 * The `popstate` that step causes is not a traversal the person made, so it is swallowed
 * rather than answered — answering it would render the address the question is still
 * standing over. Held as *which entry* rather than as a bare flag, because a bare flag is
 * only ever cleared by the arrival it is waiting for: a `go` the browser silently declines
 * (a delta past the end of the session's history) would leave the flag set forever, and
 * the next Back the person actually pressed would be eaten instead. An expectation that
 * names its entry is wrong about one traversal at worst, never about all of them.
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
 * Back and Forward, answered — or held, when taking them would take a run with them.
 *
 * Held rather than refused: the person is entitled to leave, and what they are owed first
 * is the cost (PLAN decision 17). While the question stands the address is stepped back to
 * where the desk actually is, so the bar never names a place the window is not (design
 * D14); confirming takes exactly the same traversal again, so the stack ends up one move
 * on and no wider.
 *
 * A traversal the desk cannot measure is never held. It is a move onto an entry this desk
 * did not write, which is a move out of the desk — the page unloads and takes the run with
 * it whatever anyone answers, so a question there would be a question about nothing.
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
 * Take the traversal the person confirmed, now that the run it would have lost is over.
 *
 * The move rather than a render, so the entry the person asked for is the entry they end
 * up standing on. It arrives back here as an ordinary `popstate` with nothing left to hold
 * it, and that is what renders the address.
 *
 * @param {number} moved
 * @param {Bar} bar
 */
function takeTheTraversal(moved, bar) {
  bar.history.go?.(moved);
}

/**
 * Back and Forward are the desk's to answer.
 *
 * htmx answers any entry stamped `{ htmx: true }` — every entry an `HX-Replace-Url` has
 * touched — by restoring a snapshot of the whole body. A window the desk built and still
 * holds would be replaced by a copy it has never seen, carrying whatever search term or
 * open record stood there when the snapshot was taken (design D14). So the property is
 * taken rather than a listener added beside it: two answers to one Back is the
 * desynchronised frame D14 exists to rule out.
 *
 * Taken twice, and that is the load-bearing part. htmx installs its handler on
 * `DOMContentLoaded` and *chains* whatever it finds there, so taking the property only
 * before that moment leaves htmx wrapping this and still answering its own entries.
 * Taking it on both sides of that moment is what makes this independent of which script
 * ran first.
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
  if (typeof document !== "undefined" && document.readyState !== "complete") {
    document.addEventListener("DOMContentLoaded", take, { once: true });
  }
}
