// @ts-check
/**
 * The window, in the product.
 *
 * `design/scripts/window.js` is the window itself and ships as it stands, the way
 * `design/scripts/ink.js` does. This file is the product's half of the seam: it owns
 * the *one* window on the desk — when it exists, what is in it, where it sits, and
 * what happens to it when a lamp is pressed.
 *
 * Three things follow from the window being created and destroyed here rather than
 * served in the page.
 *
 *   - The shell no longer carries a content area. There is nothing to render into
 *     until a window exists, so page assembly has one anchor fewer and the server
 *     composes a desk rather than a desk with a hole in it.
 *   - Putting the window away is the only way a content region disappears. The
 *     region rule (`region-scope.js`) already releases everything a region's content
 *     started, on replace and on removal alike, so put-away is a release and a
 *     removal — never a window-scoped teardown of its own, which would have to be
 *     kept in step with the region rule forever.
 *   - The window is opened by whatever is about to need it, before the request that
 *     fills it is issued. Both openers listen in the capture phase for exactly that
 *     reason: htmx resolves `hx-target` from a listener on the element itself, which
 *     runs after every capture listener on the document, so the target is already
 *     standing by the time htmx looks for it.
 *
 * Two lamps, and no minimise: with no taskbar there is nowhere for a minimised
 * window to be seen waiting, so it would be indistinguishable from one put away, and
 * both come back by the same click on the same logo (design D12).
 *
 * Where the window sits is remembered and what is in it is not. One record holds one
 * normal box and a maximised *flag*, so a desk that comes back on a different screen
 * fills that screen rather than the one it left, and a box that no longer fits is
 * pulled inside — on load and on every resize alike. Below the breakpoint none of that
 * applies: the window is the screen, the stylesheet places it, and the desktop record
 * is read past rather than written over (design D9; PLAN decisions 18, 47).
 */

import {
  EDGE,
  fillDesk,
  fitToDesk,
  PHONE,
  PROMPT_CLEARANCE,
  placeWindow,
  readBox,
  refreshGeometry,
} from "../design/scripts/desk-geometry.js";
import { AlunaWindow } from "../design/scripts/window.js";
import { addWindowDrag, addWindowGrip, setMaximised } from "../design/scripts/window-gestures.js";
import { joinStack, leaveStack, raise } from "./desk-stack.js";
import { RELEASE_REGION_EVENT } from "./region-scope.js";

/** The desk's window layer — the ground the one window stands on. */
export const WINDOW_LAYER_SELECTOR = ".desk__windows";

/** A capability's logo, the one way a capability's collection reaches the window. */
export const CAPABILITY_LOGO_SELECTOR = "[data-capability-logo]";

/** The prompt bar's form. A build needs a window to narrate into. */
export const PROMPT_FORM_ID = "spec-build-form";

/** One build's subscriber — the node the run's id is written on. */
const BUILD_SUBSCRIBER_SELECTOR = "[data-build-job-id]";

/**
 * The window's content region. The id is the temporary shell's and every existing
 * swap still addresses it; what changed is where it lives and who makes it.
 */
export const WINDOW_CONTENT_ID = "spec-build-output";

/**
 * What `region-scope.js` reports this region as when it releases it. Named for the
 * content, never for the frame: one window holds many successive region contents, and
 * a release that said "the window" would be naming the thing that stayed.
 */
export const WINDOW_CONTENT_REGION = "the window's content";

/** What the title bar says while a build has the window and no capability does. */
export const BUILD_WINDOW_TITLE = "Making it";

/**
 * Ask for the window to be put away, from a script that cannot import this module —
 * the shell's classic-script glue in `app.js` is the one that notices the window has
 * been left holding nothing. Kept in sync there; a platform test pins the strings.
 */
export const PUT_WINDOW_AWAY_EVENT = "aluna:put-window-away";

/**
 * The one presentation record this module keeps, and the only key it writes. The
 * developer panel's is 5.6/04's, and those two are the whole of what the browser
 * remembers (design D9; ARCH §6.1).
 */
export const WINDOW_STORAGE_KEY = "aluna.desk.window.v1";

/**
 * Set on the desk ground below the breakpoint, so the page states the form the script
 * believes it is in. Nothing in the stylesheet needs it — the phone layout is painted
 * by the media query — which is exactly why it is worth writing down: it is the one
 * place the script's answer and the stylesheet's can be seen agreeing.
 */
export const PHONE_CLASS = "desk--phone";

/**
 * The desk ground: the wallpaper filling the viewport that the logos, the window layer
 * and the prompt bar all stand on. Missing one is not fatal the way a missing window
 * layer is — the class is a statement about the ground, and every gesture reads the
 * script's own answer rather than the class.
 */
export const DESK_GROUND_SELECTOR = ".shell";

/**
 * Over a wallpaper the window carries its shadow at 40% rather than 24% — the
 * design's own number for a window standing on the desk rather than in a document.
 */
const WALL_SHADOW = 0.4;

/**
 * How much of the desk a window takes when it first opens.
 *
 * A collection is a list, so height is what it wants; and the desk has to still read
 * as a desk around it, or the wallpaper and the logos have been replaced by a page.
 * A box remembered from a previous visit replaces this.
 */
const DEFAULT_FILL = { w: 0.62, h: 0.72 };

/** `/capability/:id`, and nothing below it (design D14). */
const CAPABILITY_ADDRESS = /^\/capability\/([^/]+)\/?$/;

/**
 * The two things this module borrows from htmx.
 *
 * `swap` is the teardown. htmx's `remove` is *not* — it is `removeChild` and nothing
 * more — so detaching the window with it would leave the SSE extension holding an
 * open `EventSource` for a build streaming into a node that is no longer anywhere,
 * and the `htmx:sseClose` that unlocks the prompt bar would be fired from a detached
 * node and never reach the document. Swapping the window empty runs htmx's own
 * cleanup over every descendant *while it is still connected*, which is what closes
 * the stream and lets its close event bubble.
 *
 * `ajax` asks for a fragment the way a click on the same logo would.
 *
 * @typedef {{
 *   swap?: (target: Element, content: string, spec: { swapStyle: string, swapDelay: number, settleDelay: number }) => void,
 *   ajax?: (method: string, url: string, context: object) => Promise<unknown>,
 * }} Htmx
 */

/** @returns {Htmx | undefined} */
function htmx() {
  return /** @type {Window & { htmx?: Htmx }} */ (window).htmx;
}

/**
 * @typedef {import("../design/scripts/desk-geometry.js").Box} Box
 * @typedef {import("../design/scripts/window-gestures.js").StoredBox} StoredBox
 *
 * @typedef {object} DeskWindow
 * @property {AlunaWindow} win
 * @property {HTMLElement} el
 * @property {HTMLElement} layer
 * @property {HTMLElement} region the content region the window holds
 * @property {StoredBox} box carries the box to give back while the window is maximised
 * @property {boolean} maximised
 * @property {Element | null} openedBy what to give focus back to when it is put away
 * @property {boolean} gestures whether the drag and the grip have been bound
 * @property {boolean} sized whether this box was ever authored against a desk
 */

/** The one window (design D1). The developer panel's second one is 5.6/04. */
/** @type {DeskWindow | null} */
let mounted = null;

/** How many windows this page has stood up, so no two share a title's id. */
let mountCount = 0;

/**
 * Whether the desk is below the breakpoint. Held rather than asked each time, because
 * every gesture and every write consults it and the media query is the one thing that
 * can answer it — the stylesheet has no class for the script to read back.
 */
let phone = false;

/** Whether the viewport is already being watched. The three subscriptions are for life. */
let watching = false;

/**
 * The layer, or a loud failure. A missing live anchor is never absorbed in silence
 * (5.3/02): a desk that cannot mount a window looks like a capability that refused
 * to open, and the two want opposite fixes.
 *
 * Structural in what it asks of the root, the way the tile's rules are, so the
 * failure can be forced in a test rather than only in a browser.
 *
 * @param {{ querySelector(selector: string): unknown }} root
 * @returns {HTMLElement}
 */
export function windowLayer(root) {
  const layer = root.querySelector(WINDOW_LAYER_SELECTOR);
  if (layer === null || layer === undefined) {
    throw new Error("The desk's window layer is missing.");
  }
  return /** @type {HTMLElement} */ (layer);
}

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
 * @param {Pick<DeskWindow, "box" | "maximised">} entry
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
 * @typedef {{ getItem(key: string): string | null, setItem(key: string, value: string): void }} Store
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
 * @param {Pick<DeskWindow, "box" | "maximised">} entry
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

/** This page's window, remembered in this page's store. @param {DeskWindow} entry */
const remember = (entry) => savePresentation(entry, phone, localStore());

/* ── where the window sits ─────────────────────────────────────────────────── */

/**
 * Whether the desk has edges worth measuring.
 *
 * On a cold load the shell's stylesheets arrive through `@import`s, so at the moment a
 * deferred module runs the page is parsed and still unstyled and the desk measures
 * zero. A `ResizeObserver` reports zero too, for any element an ancestor has taken out
 * of flow. Fitting a box to a desk of no size is the smallest box there is, in the
 * corner — and now that a re-fit can be followed by a write, it would be that box
 * remembered.
 *
 * @param {{ width: number, height: number }} bounds
 * @returns {boolean}
 */
const laidOut = (bounds) => bounds.width >= 2 && bounds.height >= 2;

/**
 * The first box a window gets, fitted to the desk it is opening on. `fitToDesk`
 * carries the prompt bar's floor, so a window is never born under the bar.
 *
 * @param {DOMRect} bounds
 * @returns {Box}
 */
function defaultBox(bounds) {
  refreshGeometry();
  const w = Math.round(bounds.width * DEFAULT_FILL.w);
  const h = Math.round((bounds.height - PROMPT_CLEARANCE) * DEFAULT_FILL.h);
  return fitToDesk(bounds, { x: Math.round((bounds.width - w) / 2), y: EDGE, w, h });
}

/**
 * Where a window's box belongs on a desk this size, in this form — the whole of the
 * geometry decision, and the only part of it that has to be right. The desk itself if
 * the window is maximised, and inside the edges and above the prompt bar's floor if it
 * is not; either way the box has been through `desk-geometry.js`, so it stops on the
 * same floor the logo grid does.
 *
 * The same call answers on load and on a live resize, because a screen that changed
 * between two visits and a screen that changes during one are the same question.
 *
 * Told which form it is in rather than reading it, and given a box rather than a
 * mounted window. Two things follow. The crossing a browser makes now and then — the
 * one hard case here — is one call made twice with the answer changed, so it can be run
 * end to end in a test rather than only in a browser. And the first call can happen
 * while a window is still being built, which it has to: the frame measures the element,
 * so the element is the right size before there is a frame to ask about it.
 *
 * On a phone it decides nothing and touches nothing. The window is the screen there and
 * the stylesheet places it, so the box is left exactly as it was found — read past,
 * never written over.
 *
 * A window that opened on a phone with nothing remembered is the one case where the box
 * in hand is not a preference at all: it was fitted to a screen the window filled
 * entirely, and carrying it onto a desk would let a narrow browser author a desktop box
 * the user never chose. The desk is asked for a first box instead, the first time there
 * is a desk to ask.
 *
 * `state.first` is how a window says what "no preference yet" means for it. The
 * capability window takes most of the desk because a collection is a list; the
 * developer panel takes a narrow column at the edge because it is meant to be read
 * beside one. Everything after that first box — the clamping, the floor, the
 * maximised case, the phone — is the same question for both, and is answered here once.
 *
 * @param {{ box: StoredBox, maximised: boolean, sized: boolean,
 *           first?: (bounds: DOMRect) => Box }} state mutated in place
 * @param {DOMRect} bounds the desk
 * @param {boolean} isPhone
 * @returns {boolean} whether the window is now worth placing from that box
 */
export function fitBox(state, bounds, isPhone) {
  if (isPhone || !laidOut(bounds)) return false;
  if (!state.sized) {
    state.sized = true;
    const first = (state.first ?? defaultBox)(bounds);
    if (state.maximised) state.box.restore = first;
    else Object.assign(state.box, first);
  }
  if (state.maximised) fillDesk(bounds, state.box);
  else fitToDesk(bounds, state.box);
  return true;
}

/**
 * Turn a record back into a standing window: the box it opens on, whether it is
 * maximised, and whether that box is a preference or a first guess.
 *
 * The order is the whole of it, and it is why this is one function rather than four
 * lines in `mount`. `setMaximised` runs **first**, so the box the record carried is
 * stashed as the one to give back before `fitBox` overwrites the live one with this
 * desk. Get that backwards and there is nothing to restore to: the desk's own size
 * becomes the remembered box, which is exactly the stranding this issue exists to stop
 * — and it is a silent swap, so it wants a test rather than a careful reader.
 *
 * @param {HTMLElement} el
 * @param {{ box: Box | null, max: boolean }} stored
 * @param {DOMRect} bounds
 * @param {boolean} isPhone
 * @param {(bounds: DOMRect) => Box} [first] this window's box when nothing is remembered
 * @returns {{ box: StoredBox, maximised: boolean, sized: boolean,
 *             first: (bounds: DOMRect) => Box }}
 */
export function openingGeometry(el, stored, bounds, isPhone, first = defaultBox) {
  /** @type {StoredBox} */
  const box = { ...(stored.box ?? first(bounds)) };
  if (stored.max) setMaximised(el, box, true);

  /* A box that came out of storage is a preference whatever screen this is; one this
   * desk just authored is a preference only if there was a desk to author it against. */
  const state = {
    box,
    maximised: stored.max,
    sized: stored.box !== null || (!isPhone && laidOut(bounds)),
    first,
  };
  if (fitBox(state, bounds, isPhone)) placeWindow(el, box);
  return state;
}

/**
 * Fit the mounted window to the desk as it is right now, and put it there.
 *
 * @param {DeskWindow} entry
 */
function refit(entry) {
  if (fitBox(entry, entry.layer.getBoundingClientRect(), phone)) {
    placeWindow(entry.el, entry.box);
  }
}

/**
 * Build the one window and everything that lives inside it.
 *
 * @param {ParentNode} root
 * @param {string} title
 * @returns {DeskWindow}
 */
function mount(root, title) {
  const layer = windowLayer(root);
  const bounds = layer.getBoundingClientRect();

  const el = document.createElement("section");
  el.className = "window window--desk is-focused";
  const geometry = openingGeometry(el, loadPresentation(localStore()), bounds, phone);

  /* The layout the window's contents sit in; the region below is what they are. */
  const content = document.createElement("div");
  content.className = "desk-window__content";

  const region = document.createElement("div");
  region.id = WINDOW_CONTENT_ID;
  region.className = "desk-window__region";
  region.dataset.contentRegion = WINDOW_CONTENT_REGION;
  region.setAttribute("aria-live", "polite");

  content.append(region);
  el.append(content);
  layer.append(el);

  /* Mounted last: the chrome measures the element, so the element has to be placed
   * and on the page before the first frame is drawn for it. */
  const win = new AlunaWindow(el, {
    title,
    /* The hand is rolled when the window opens and never re-rolled by a content
     * swap — the frame does not change because what it frames did (design D10). */
    seed: Math.floor(Math.random() * 9000) + 10,
    shadowAlpha: WALL_SHADOW,
  });

  /* A named region rather than an anonymous box: the window is a landmark, and its
   * title is the name a screen reader should hear for it. The id counts up rather
   * than being derived from the region's, so the developer panel's second window
   * (5.6/04) cannot arrive carrying a duplicate of this one. */
  mountCount += 1;
  win.titleEl.id = `aluna-window-title-${mountCount}`;
  el.setAttribute("aria-labelledby", win.titleEl.id);

  /** @type {DeskWindow} */
  const entry = { win, el, layer, region, ...geometry, openedBy: null, gestures: false };

  addLamps(entry);
  syncMaximiseLamp(entry);
  syncForm(entry, phone);

  /* Two windows may stand at once, so this one has to say which it is. Joining puts
   * it in front, and a pointer landing anywhere on it brings it back — the whole of
   * stacking for a pair (`public/desk-stack.js`). */
  joinStack(entry);
  el.addEventListener("pointerdown", () => raise(entry));
  return entry;
}

/**
 * Tell the window which form it is in.
 *
 * Below the breakpoint the window is the screen: the stylesheet places it, the grip is
 * hidden and the leaf lamp has nothing left to toggle. Neither may stay in the focus
 * order — a tab stop whose Enter does nothing is worse than no tab stop — so the grip
 * is never built and the lamp is taken out of the page. Above it, the two gestures
 * bind the first time there is a desk to make them on.
 *
 * @param {DeskWindow} entry
 * @param {boolean} isPhone
 */
export function syncForm(entry, isPhone) {
  entry.el.querySelector('.lamp[data-action="maximise"]')?.toggleAttribute("hidden", isPhone);
  if (!isPhone) bindGestures(entry);
  /* `addWindowDrag` marks the bar draggable and offers no way back off it, and the mark
   * is not cosmetic: `.window__bar--draggable` carries `touch-action: none`. Left on a
   * phone — where the window is the screen and its title bar is the top strip of it —
   * the browser hands every touch that starts there to a drag that stands itself down,
   * so a scroll begun on the title bar does nothing at all. `cursor: grab` and
   * `user-select: none` come off with it. */
  entry.win.bar.classList.toggle("window__bar--draggable", !isPhone);
}

/**
 * The three gestures ship from `window-gestures.js`, the way the frame ships from
 * `window.js`: one implementation, so a desk cannot drift from the design's.
 *
 * Bound once, and never on a phone. A window that opens below the breakpoint gets no
 * drag and no grip at all rather than a grip the stylesheet has hidden; one already
 * standing when the browser narrows keeps the listeners it has and stands them down
 * through the host instead, which is the only half of this a listener can do.
 *
 * @param {DeskWindow} entry
 */
function bindGestures(entry) {
  if (entry.gestures) return;
  entry.gestures = true;
  const host = gestureHost(entry);
  addWindowGrip(host);
  addWindowDrag(entry.win.bar, host);
}

/* ── opening and putting away ──────────────────────────────────────────────── */

/**
 * The window an opening lands in. One window: a standing one is retitled and handed
 * back, so a second capability swaps what is inside the frame rather than standing
 * another frame beside it (design D1, D2). Nothing here reaches the geometry or the
 * frame — the box, the maximised flag and the seed the hand was rolled from are settled
 * at mount, so a change of contents moves nothing and redraws nothing (design D10).
 *
 * `mount` is taken as a thunk rather than reached for, so the rule is one testable thing
 * rather than a shape only a browser can hold — the way `tearDownWindow` is.
 *
 * @template {{ win: { setTitle(title: string): void }, openedBy: unknown }} T
 * @param {T | null} standing
 * @param {() => T} mountWindow
 * @param {string} title
 * @param {T["openedBy"]} openedBy where focus goes back to when it is put away
 * @returns {T}
 */
export function windowForOpening(standing, mountWindow, title, openedBy) {
  const entry = standing ?? mountWindow();
  entry.win.setTitle(title);
  /* The first opener owns the way back. A capability swapped into a window that is
   * already up did not open it, and must not move where putting it away returns. */
  entry.openedBy ??= openedBy;
  return entry;
}

/**
 * Open the window, and hand back the region whatever opened it is about to fill.
 *
 * @param {string} title
 * @param {ParentNode} [root]
 * @param {Element | null} [openedBy] where focus goes back to when it is put away
 * @returns {HTMLElement} the content region, ready to be swapped into
 */
export function openWindow(title, root = document, openedBy = null) {
  mounted = windowForOpening(mounted, () => mount(root, title), title, openedBy);
  /* A window that was already up may have been standing behind the developer panel.
   * Whatever is about to fill it is what the user just asked for, so it comes to the
   * front — and below the breakpoint that is the difference between the build they
   * started being on screen and being taken out of the page entirely. */
  raise(mounted);
  return mounted.region;
}

/**
 * Put the window away. The logo stays where it was and the same click brings the
 * window back, which is the whole of what the clay lamp promises (design D3).
 *
 * @returns {boolean} whether there was a window to put away
 */
export function putAway() {
  const entry = mounted;
  if (!entry) return false;
  mounted = null;
  cancelBuildIn(entry.el);
  tearDownWindow(entry, htmx());
  return true;
}

/**
 * The build the window was narrating, if it was narrating one.
 *
 * @param {{ querySelector(selector: string): { getAttribute(name: string): string | null } | null }} el
 * @returns {string | null}
 */
export function buildJobIdIn(el) {
  return el.querySelector(BUILD_SUBSCRIBER_SELECTOR)?.getAttribute("data-build-job-id") ?? null;
}

/**
 * Where a build is cancelled. The same route the run's own Cancel control posts to.
 * @param {string} jobId
 * @returns {string}
 */
export const buildCancelUrl = (jobId) => `/build/${encodeURIComponent(jobId)}/cancel`;

/**
 * Putting the window away during a build cancels the build.
 *
 * The window is the only way back to a run's narration, so closing it makes the run
 * unreachable; leaving the server building a capability nobody can see, and that will
 * simply appear on the desk later, is the worse half of a half-done teardown. This is
 * the run's own cancel path, pressed on the user's behalf. **5.8/04 puts a warning in
 * front of this** — today the clay lamp cancels a build without asking.
 *
 * @param {HTMLElement} el the window
 */
function cancelBuildIn(el) {
  const jobId = buildJobIdIn(el);
  if (jobId === null) return;
  /* `keepalive`, because the node that would have carried an htmx request is about to
   * be detached and the page may be on its way out behind it. */
  void fetch(buildCancelUrl(jobId), { method: "POST", keepalive: true }).catch(() => undefined);
}

/**
 * Everything a window owes on its way out, in the order it owes it. Both halves run
 * while the window is still connected, because being connected is what makes either
 * of them work.
 *
 *   1. The region rule releases the content's scope. This is the only moment an htmx
 *      request inside it can still be aborted, and aborting the request is what
 *      releases the server's read token.
 *   2. htmx's own cleanup runs over every descendant. Swapping the window empty is
 *      how that is reached — `htmx.remove` does not do it — and it is what closes an
 *      `EventSource` a build left open in there and lets the `htmx:sseClose` that
 *      unlocks the prompt bar and takes the build's tile down bubble to the document.
 *
 * Focus is handed back to whatever opened the window. Without that a keyboard user
 * who presses the clay lamp loses focus to `<body>` and has to tab the whole desk
 * again to reach the logo that brings the window back.
 *
 * Taken as an argument rather than reached for, so the sequence is one testable
 * thing rather than a shape only a browser can hold.
 *
 * @param {Pick<DeskWindow, "el" | "region" | "win" | "openedBy">} entry
 * @param {Htmx | undefined} api
 */
export function tearDownWindow(entry, api) {
  entry.region.dispatchEvent(new CustomEvent(RELEASE_REGION_EVENT, { bubbles: true }));
  api?.swap?.(entry.el, "", { swapStyle: "innerHTML", swapDelay: 0, settleDelay: 0 });
  /* Before the frame goes: whatever is left standing is now the only window, and on a
   * phone the survivor is only exposed once it is the front one. */
  leaveStack(entry);
  entry.win.destroy();
  entry.el.remove();
  focusOpener(entry.openedBy);
}

/**
 * Give focus back, if the thing that opened the window is still on the desk. A logo
 * removed by the deletion that emptied the window is not, and focus is better left
 * where the browser puts it than thrown at a detached node.
 *
 * @param {Element | null | undefined} opener
 */
function focusOpener(opener) {
  if (opener && "focus" in opener && opener.isConnected) {
    /** @type {HTMLElement} */ (opener).focus();
  }
}

/* ── the lamps ─────────────────────────────────────────────────────────────── */

/** @param {DeskWindow} entry */
function addLamps(entry) {
  entry.el.addEventListener("window:lamp", (event) => {
    const { action } = /** @type {CustomEvent<{ action?: string }>} */ (event).detail;
    if (action === "maximise") toggleMaximise(entry);
    /* The clay lamp is a navigation: the user asked for the bare desk, so the bare desk
     * is the entry Back steps off (design D14). The other two ways a window goes away are
     * not. A window emptied by a deletion and one opened for a read that never filled it
     * are both the address turning out to be wrong rather than the user moving, and each
     * is corrected in place — neither may leave an entry naming what has gone. */
    if (action === "putaway") {
      putAway();
      pushAddress(DESK_ADDRESS, deskHistory());
    }
  });
}

/**
 * The desk this window is held inside, and what a gesture on it may do. Two things
 * stand a gesture down: a maximised window, and a phone, where the window is the
 * screen and no box may be written for it. A gesture that finishes is worth
 * remembering, which is the only moment a drag or a resize reaches storage.
 *
 * @param {DeskWindow} entry
 * @returns {import("../design/scripts/window-gestures.js").GestureHost}
 */
function gestureHost(entry) {
  return {
    el: entry.el,
    box: entry.box,
    bounds: () => entry.layer.getBoundingClientRect(),
    standDown: () => entry.maximised || phone,
    onEnd: () => remember(entry),
  };
}

/**
 * Maximise, or give the window back the box it had. What is remembered is the flag and
 * that box, never the maximised size — so the same window on a different screen fills
 * *that* screen (design D9).
 *
 * On a phone there is nothing to toggle: the window already is the screen. The lamp is
 * out of the page there, so this is the door nobody can reach rather than the lock.
 *
 * @param {DeskWindow} entry
 */
function toggleMaximise(entry) {
  if (phone) return;
  entry.maximised = !entry.maximised;
  setMaximised(entry.el, entry.box, entry.maximised);
  refit(entry);
  syncMaximiseLamp(entry);
  remember(entry);
}

/**
 * The leaf lamp is a toggle, so it reports whether it is pressed. Without this the
 * only way to know a window is maximised is to look at it.
 *
 * @param {DeskWindow} entry
 */
function syncMaximiseLamp(entry) {
  const lamp = entry.el.querySelector('.lamp[data-action="maximise"]');
  lamp?.setAttribute("aria-pressed", entry.maximised ? "true" : "false");
}

/* ── the desk changing size ────────────────────────────────────────────────── */

/**
 * The desk ground, if the page has one. Structural rather than instanceof, the way
 * every other rule in here is, so a test double satisfies it.
 *
 * @param {ParentNode} root
 * @returns {{ classList: DOMTokenList } | null}
 */
export function deskGround(root) {
  const ground = root.querySelector?.(DESK_GROUND_SELECTOR);
  return ground !== null && ground !== undefined && "classList" in ground
    ? /** @type {{ classList: DOMTokenList }} */ (/** @type {unknown} */ (ground))
    : null;
}

/**
 * The desk's one viewport listener, and the thing the shipped scripts have been
 * missing: a screen can change size between two visits and during one, so what is
 * remembered is re-fitted rather than trusted.
 *
 * Three sources, because they no longer move together.
 *
 *   - The media query is what says which form this is, and it changes at exactly one
 *     width rather than on every pixel between.
 *   - `resize` is the ordinary case: the browser window, or a phone turned sideways.
 *   - The layer is watched too. The floor and the minimum are in rem, so a reader
 *     raising their text size grows both without the viewport moving at all — and
 *     that is a resize as far as a window is concerned.
 *
 * Re-fitting cannot feed this: the box is written as custom properties on a window
 * absolutely positioned inside the layer, so nothing it does can resize the layer.
 *
 * @param {ParentNode} root
 * @param {HTMLElement} layer
 */
function watchViewport(root, layer) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  /* Three subscriptions with no way off them, so they are taken once. The product
   * starts the desk exactly once; a second call would otherwise stack a second set. */
  if (watching) return;
  watching = true;
  const ground = deskGround(root);
  const query = window.matchMedia(PHONE);

  const onResize = () => {
    refreshGeometry();
    const was = phone;
    phone = query.matches;
    ground?.classList.toggle(PHONE_CLASS, phone);
    if (!mounted) return;
    syncForm(mounted, phone);
    refit(mounted);
    /* Only the crossing is written, and only upward — a phone writes nothing. What it
     * records is the one thing a resize can author rather than merely clamp: the first
     * desktop box of a window that was born below the breakpoint. */
    if (was !== phone) remember(mounted);
  };

  query.addEventListener("change", onResize);
  window.addEventListener("resize", onResize);
  if (typeof ResizeObserver === "function") new ResizeObserver(onResize).observe(layer);
  onResize();
}

/* ── who opens it ──────────────────────────────────────────────────────────── */

/**
 * The DOM facts the three rules below need, and no more. Structural on purpose, the
 * way the tile's and the release scope's are: a real `Element` satisfies them and so
 * does a test double, which is what lets the rules run in Bun without a browser.
 *
 * @typedef {{ textContent: string | null }} TextNode
 * @typedef {{
 *   getAttribute(name: string): string | null,
 *   querySelector(selector: string): TextNode | null,
 * }} LogoNode
 * @typedef {{ querySelectorAll(selector: string): Iterable<LogoNode> }} LogoRoot
 */

/**
 * What a logo says it is. The label is the capability's canonical one, rendered by
 * the server, so the title bar and the ground agree by construction.
 *
 * @param {LogoNode} logo
 * @returns {string}
 */
export function logoTitle(logo) {
  return logo.querySelector(".logo-label")?.textContent?.trim() ?? "";
}

/**
 * One capability's logo, found by reading ids back rather than by building a
 * selector out of one: a capability id is a string this module did not author, and a
 * selector assembled from one has to be escaped correctly to be safe.
 *
 * @param {LogoRoot} root
 * @param {string} id
 * @returns {LogoNode | null}
 */
export function logoFor(root, id) {
  for (const logo of root.querySelectorAll(CAPABILITY_LOGO_SELECTOR)) {
    if (logo.getAttribute("data-capability-id") === id) return logo;
  }
  return null;
}

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

/* ── the address ───────────────────────────────────────────────────────────── */

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
 * The mark on the entries this module writes, and deliberately not htmx's. htmx claims
 * the entries stamped `{ htmx: true }` and answers a Back onto one by restoring a snapshot
 * of the whole body — the DOM as it stood, search term and open record included.
 *
 * Two things stand between that and the desk, and this is only the second of them. The
 * shell carries `hx-history="false"`, so no snapshot is ever taken; and `ownHistory` below
 * takes `popstate` outright, so htmx never answers a Back at all. This mark is what would
 * still tell the two apart if either were ever undone — it is not read at run time, and
 * htmx may re-stamp an entry it corrects through `HX-Replace-Url` without consequence.
 */
export const DESK_HISTORY_STATE = { aluna: "desk" };

/**
 * The address bar and its history, or nothing where there is no browser.
 *
 * Handed to the two verbs below rather than reached for inside them, the way `localStore`
 * is handed to `savePresentation`: the whole of the history contract is then something a
 * test can run, rather than something a test can only read off the source.
 *
 * @typedef {{
 *   location: { pathname: string, search: string },
 *   history: {
 *     pushState(state: unknown, unused: string, url: string): void,
 *     replaceState(state: unknown, unused: string, url: string): void,
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
  bar.history.pushState(DESK_HISTORY_STATE, "", next);
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
  bar?.history.replaceState(DESK_HISTORY_STATE, "", next);
}

/** The marker the server puts on the surface of the capability standing in a window. */
export const ACTIVE_CAPABILITY_ATTRIBUTE = "data-active-capability-id";

/** That surface, as a direct child of the region and never as a descendant. */
const ACTIVE_CAPABILITY_SELECTOR = `:scope > [${ACTIVE_CAPABILITY_ATTRIBUTE}]`;

/**
 * The capability whose collection is standing in the window — or nothing, for a window
 * holding a build's narration, a confirmation, or nothing at all.
 *
 * Read back off the surface rather than remembered here: one window holds many successive
 * contents, and a copy kept in this module would be wrong the moment a swap landed on it.
 *
 * A direct child on purpose. A build narrates *beside* what it displaced, and the copy of
 * that surface it carries to put back is nested inside its own subscriber; only the one
 * standing beside it is what the window is showing. That is the whole of why a build does
 * not change the address.
 *
 * @typedef {{ getAttribute(name: string): string | null }} SurfaceNode
 * @param {{ region: { querySelector(selector: string): SurfaceNode | null } } | null | undefined} entry
 * @returns {string | null}
 */
export function capabilityInWindow(entry) {
  const surface = entry?.region.querySelector(ACTIVE_CAPABILITY_SELECTOR);
  return surface?.getAttribute(ACTIVE_CAPABILITY_ATTRIBUTE) ?? null;
}

/**
 * The window's content changed hands, said by a script that cannot import this module —
 * `app.js` is the one that sees an htmx swap land and a build's terminal promote. It says
 * what happened and the desk decides what the address does about it, so the rule for
 * "already there" stays in one place rather than being answered twice.
 *
 * `detail.navigated` is true only where a capability *took* the window: a build's
 * successful v1 activation, whose canonical collection is standing somewhere for the
 * first time. Kept in sync in `app.js`; a platform test pins the strings.
 */
export const WINDOW_TOOK_CAPABILITY_EVENT = "aluna:window-took-capability";

/**
 * Point the address at the capability standing in the window.
 *
 * A capability taking the window is a navigation and is owed an entry. Anything else is
 * the address catching up with a window that changed hands underneath it — a cancelled
 * deletion putting the previous capability back — and is owed none. An evolution's commit
 * and every non-activating terminal carry the id the address already names, so neither
 * reaches either verb (design D14; ARCH §6.1).
 *
 * @param {boolean} navigated
 */
function addressTheWindow(navigated) {
  const id = capabilityInWindow(mounted);
  if (id === null) return;
  const next = capabilityAddress(id);
  const bar = deskHistory();
  if (bar === null) return;
  if (navigated) {
    pushAddress(next, bar);
    return;
  }
  /* A correction asks whether the bar is *exactly* right, where a push asks only whether
   * it is somewhere else. The difference is what strips a query string and a trailing
   * slash: nothing here ever writes either, so one in the bar came in from outside — a
   * link, a hand-typed address — and it is below capability identity, which may not be in
   * the address at all (design D14). Correcting it costs no entry, so the canonical
   * spelling wins without the user having navigated anywhere. */
  if (bar.location.pathname !== next || bar.location.search !== "") replaceAddress(next, bar);
}

/**
 * What the window is showing, for the one question a press has to ask of it.
 *
 * A run narrating in the window is not a capability standing in it, even though the
 * collection it displaced is still there beside the subscriber. A press on that
 * capability's logo is entitled to take the window back off the run, so a build makes the
 * window hold nothing as far as this question goes.
 *
 * @param {DeskWindow | null} entry
 * @returns {string | null}
 */
function settledCapabilityInWindow(entry) {
  if (entry === null || buildJobIdIn(entry.el) !== null) return null;
  return capabilityInWindow(entry);
}

/**
 * Whether a press on this logo has anything to open.
 *
 * The capability already standing in the window is not opened again. There is no new
 * address to push and nothing to fetch — and fetching would swap the collection out and
 * straight back in, so the window visibly flickers to arrive exactly where it already
 * was. Pressing the open logo leaves the window that is up as it is, which is the whole
 * of what "focusing the already-open capability" means when there is only one window
 * and it is always the focused one (design D14; ARCH §6.1).
 *
 * @param {LogoNode} logo
 * @param {string | null} showing the capability settled in the window
 * @returns {boolean}
 */
export function pressWouldOpen(logo, showing) {
  const id = logo.getAttribute("data-capability-id");
  return id === null || id === "" || id !== showing;
}

/**
 * What an address asks of the desk, and the only question a load, a Back and a Forward
 * ever ask: this address, this desk — what is in the window?
 *
 * A logo layer rehydrated from the registry is the only statement on this page of what
 * exists, so an address naming something not standing there asks for the bare desk. That
 * is also what a link to a deleted capability should get, and 5.9/03 makes the server say
 * so.
 *
 * @param {LogoRoot} root
 * @param {string} pathname
 * @param {string | null} showing the capability already in the window
 * @returns {{ ask: "bare desk" } | { ask: "nothing" } | { ask: "open", logo: LogoNode, id: string }}
 */
export function addressAsks(root, pathname, showing) {
  const id = capabilityIdFromAddress(pathname);
  const logo = id === null ? null : logoFor(root, id);
  if (id === null || logo === null) return { ask: "bare desk" };
  /* Already standing there: an address that names what the window is holding asks for
   * nothing, the way a press on the open logo does. */
  return id === showing ? { ask: "nothing" } : { ask: "open", logo, id };
}

/**
 * Run once the desk has edges to measure.
 *
 * On a cold load the shell's stylesheets arrive through `@import`s, so at the moment
 * a deferred module runs the page is parsed and still unstyled: the desk measures
 * zero, and a window fitted to a desk of no size is the smallest box there is, in the
 * corner. A press and a submit both happen long after that. The address is the one
 * opener that runs at exactly that moment, so it is the one that waits.
 *
 * Whatever is waiting is the *oldest* thing the user asked for, so anything they do
 * in the meantime wins: a press or a submit that opens the window first cancels this
 * outright rather than flipping a live build's window over to a capability a moment
 * later. The observer disconnects either way, so a desk that never gains edges does
 * not leave one watching it for the life of the page.
 *
 * @param {ParentNode} root
 * @param {() => void} open
 */
function whenDeskIsLaidOut(root, open) {
  const layer = windowLayer(root);
  const laidOut = () => {
    const bounds = layer.getBoundingClientRect();
    return bounds.width >= 2 && bounds.height >= 2;
  };
  if (laidOut()) {
    open();
    return;
  }
  const observer = new ResizeObserver(() => {
    if (!laidOut() && !mounted) return;
    observer.disconnect();
    if (!mounted) open();
  });
  observer.observe(layer);
}

/**
 * Show what an address names, and write nothing back to history.
 *
 * The load-time opener and the answer to Back are one function because they are one
 * question, and answering them apart is how a frame and an address drift out of step.
 * Neither pushes: the address is already what it is, and an answer that pushed would put
 * the entry it was answering back on top of the stack — the loop design D14 rules out.
 *
 * @param {ParentNode} root
 * @param {string} pathname
 */
function renderAddress(root, pathname) {
  const asked = addressAsks(root, pathname, capabilityInWindow(mounted));
  if (asked.ask === "nothing") return;
  if (asked.ask === "bare desk") {
    /* Putting the window away cancels a run it was narrating, so a Back out of a build
     * takes the build with it, silently. Back onto *another capability* falls through to
     * the swap below instead, which releases the subscriber without cancelling anything,
     * so the run is orphaned rather than stopped — the same asymmetry a logo press has
     * had all along. 5.8/04 owns both halves: it puts the leave-a-run warning in front of
     * put-away, logo and history alike, and routes each through the one cancel teardown
     * (PLAN decision 17). */
    putAway();
    return;
  }
  /* The capability's own address, not the one in the bar. `capabilityIdFromAddress`
   * forgives a trailing slash and the route does not, so a hand-typed `/capability/notes/`
   * would otherwise be fetched verbatim and answered with a 404. */
  whenDeskIsLaidOut(root, () => openAddressedWindow(root, capabilityAddress(asked.id), asked.logo));
}

/**
 * @param {ParentNode} root
 * @param {string} pathname
 * @param {LogoNode} logo
 */
function openAddressedWindow(root, pathname, logo) {
  const region = openWindow(logoTitle(logo), root, asElement(logo));
  /* The same fragment a logo click serves, asked for by the same client. The address is
   * already right, so nothing is pushed — and if the read never fills the window, the
   * address stops naming a capability nobody is looking at. */
  void htmx()
    ?.ajax?.("GET", pathname, { source: logo, target: region, swap: "innerHTML" })
    .catch(() => undefined)
    .finally(() => {
      if (putAwayUnfilledWindow(region)) correctUnfilledAddress(pathname, DESK_ADDRESS);
    });
}

/**
 * A window opened for a request that never filled it does not get to stand there.
 *
 * Checked against the window that is up *now*: by the time a slow read answers, the
 * user may have opened something else, and putting that away would be answering the
 * wrong question.
 *
 * @param {Element} region the region the request was aimed at
 * @returns {boolean} whether there was an unfilled window and it is now gone
 */
function putAwayUnfilledWindow(region) {
  if (mounted?.region !== region) return false;
  if (region.childNodes.length > 0) return false;
  return putAway();
}

/**
 * A window that never filled leaves no address behind naming what did not open.
 *
 * Only where the bar is still carrying the address that press or that Back put there. A
 * slow failure can answer long after the user has opened something else, and correcting
 * then would answer the wrong question — the same reason `putAwayUnfilledWindow` asks
 * which window is up before taking one down.
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
function correctUnfilledAddress(attempted, back) {
  const bar = deskHistory();
  if (bar === null || isAnotherPlace(bar.location.pathname, attempted)) return;
  replaceAddress(back, bar);
}

/**
 * The logo as something focus can be given back to. `LogoNode` is deliberately
 * structural — it is what the two rules above need and no more — so this is the one
 * place the module asks whether it also happens to be a real element.
 *
 * @param {LogoNode} logo
 * @returns {Element | null}
 */
function asElement(logo) {
  return logo instanceof Element ? logo : null;
}

/**
 * Stand a press down if the capability it asked for answers unsuccessfully.
 *
 * A logo whose capability has gone — deleted in another tab — answers unsuccessfully, and
 * htmx keeps an unsuccessful response out of the DOM. Nothing swaps, so nothing would take
 * back the window the press just opened, and the desk would be left holding an empty frame
 * titled with a capability that no longer exists, at an address naming it.
 *
 * The listener stands down on *this* press's own request and no other. Standing down on
 * the first request to answer would let any other in flight — a logo attempt can run for
 * the better part of a minute — take it away, and the failure would then go unnoticed.
 *
 * @param {Document} root
 * @param {Element} logo
 * @param {Element} region the region the press opened
 * @param {string | null} attempted the address the press asked for
 * @param {string | null} cameFrom where the bar was before the press pushed, if it pushed
 */
function standDownUnsuccessfulPress(root, logo, region, attempted, cameFrom) {
  /** @param {Event} done */
  const settle = (done) => {
    const detail = /** @type {CustomEvent<{ elt?: unknown, successful?: boolean }>} */ (done)
      .detail;
    if (detail?.elt !== logo) return;
    root.removeEventListener("htmx:afterRequest", settle);
    if (detail.successful !== false) return;
    /* Both halves are asked first: a slow failure can land after the user has opened
     * something else, and the window it would take down and the entry it would write over
     * would both be that. */
    if (putAwayUnfilledWindow(region) && attempted !== null) {
      correctUnfilledAddress(attempted, cameFrom ?? DESK_ADDRESS);
    }
  };
  root.addEventListener("htmx:afterRequest", settle);
}

/**
 * Open the capability a press asked for.
 *
 * The window is stood up before htmx resolves the press into a request, because the
 * target every existing swap addresses lives inside it.
 *
 * The address is pushed before the request goes out rather than after it, because the
 * swap that answers the press corrects the address on its way in and would otherwise
 * overwrite the entry this press is owed instead of standing a new one on top of it. It
 * is therefore pushed before htmx has decided to issue anything; every press that gets
 * here issues one today, and 5.9 hangs a context menu off this same element, so a control
 * there that cancels the request will want the push moved onto `htmx:beforeRequest`.
 *
 * @param {Document} root
 * @param {Element} logo
 */
function openPressedCapability(root, logo) {
  const region = openWindow(logoTitle(logo), root, logo);
  const id = logo.getAttribute("data-capability-id");
  const attempted = id !== null && id !== "" ? capabilityAddress(id) : null;
  const cameFrom = attempted === null ? null : pushAddress(attempted, deskHistory());
  standDownUnsuccessfulPress(root, logo, region, attempted, cameFrom);
}

/**
 * Both openers, and the load-time one.
 *
 * The two listeners are on the capture phase so the window — and with it the target
 * every existing swap addresses — exists before htmx resolves that target.
 *
 * The layer is demanded here rather than at the first press. A shell shipped without
 * one would otherwise render a desk that looks entirely normal and fail on the user's
 * first click, which is the confusion the loud failure exists to prevent.
 *
 * @param {Document} root
 * @param {string} [pathname] the address to open, defaulting to the one in the bar
 */
export function startDeskWindow(root, pathname = window.location.pathname) {
  const layer = windowLayer(root);

  /* Before either opener, so the first window mounted knows which form it is in and
   * the phone's is never built with a grip and a lamp it may not use. */
  watchViewport(root, layer);

  root.addEventListener(
    "click",
    (event) => {
      const { target } = event;
      if (!(target instanceof Element)) return;
      const logo = target.closest(CAPABILITY_LOGO_SELECTOR);
      if (logo === null) return;
      /* The one press the desk declines *as an opening*. Declined here and at the
       * request below, because those are the two halves htmx splits a press into and
       * this listener cannot stop the second on its own. */
      if (pressWouldOpen(logo, settledCapabilityInWindow(mounted))) {
        openPressedCapability(root, logo);
        return;
      }
      /* It opens nothing, but it is still a press on the logo of the thing you want
       * to look at, so it brings that window forward. Without this the capability
       * standing behind the developer panel has no way back — and on a phone, where
       * only the frontmost window is in the page at all, no way back on screen. */
      if (mounted) raise(mounted);
    },
    true,
  );

  /* A window that holds nothing does not exist. The glue that empties the region —
   * a deletion that leaves nothing to restore is the one that reaches this — says so
   * here rather than reaching into the window itself. */
  root.addEventListener(PUT_WINDOW_AWAY_EVENT, () => {
    putAway();
  });

  root.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || form.id !== PROMPT_FORM_ID) return;
      /* A build takes over whatever the window is holding rather than retitling it:
       * the prompt may be an evolution of exactly what is open. Only a build that
       * finds no window has to say what the window is for — but either way the window
       * it narrates into has to be the one in front, or the story of the build is
       * behind the developer panel and, on a phone, not in the page at all. */
      if (mounted) raise(mounted);
      else openWindow(BUILD_WINDOW_TITLE, root, form.querySelector("input"));
    },
    true,
  );

  /* htmx turns a press into a request from a listener on the logo itself, which runs
   * after every capture listener on the document and does not consult `defaultPrevented`
   * — so a press the desk has already declined above would still be fetched. Cancelling
   * `htmx:beforeRequest` is what stops it, and htmx then fires no `afterRequest` for it,
   * which is why the press that gets here never stood a listener up for one.
   *
   * Matched rather than `closest`: a faceless tile's one-attempt POST is fired from a
   * span *inside* the logo, and it is not this press. */
  root.addEventListener("htmx:beforeRequest", (event) => {
    const elt = /** @type {CustomEvent<{ elt?: unknown }>} */ (event).detail?.elt;
    if (!(elt instanceof Element) || !elt.matches(CAPABILITY_LOGO_SELECTOR)) return;
    if (!pressWouldOpen(elt, settledCapabilityInWindow(mounted))) event.preventDefault();
  });

  /* The window's content changing hands is `app.js`'s to notice and the desk's to
   * answer, the way putting the window away is. */
  root.addEventListener(WINDOW_TOOK_CAPABILITY_EVENT, (event) => {
    const detail = /** @type {CustomEvent<{ navigated?: boolean }>} */ (event).detail;
    addressTheWindow(detail?.navigated === true);
  });

  ownHistory(root);
  renderAddress(root, pathname);
}

/**
 * Back and Forward are the desk's to answer.
 *
 * htmx answers any entry stamped `{ htmx: true }` — every entry an `HX-Replace-Url` has
 * touched — by restoring a snapshot of the whole body. A window this module built and
 * still holds would be replaced by a copy it has never seen, carrying whatever search
 * term or open record stood there when the snapshot was taken (design D14). So the
 * property is taken rather than a listener added beside it: two answers to one Back is
 * the desynchronised frame D14 exists to rule out.
 *
 * Taken twice, and that is the load-bearing part. htmx installs its handler on
 * `DOMContentLoaded` and *chains* whatever it finds there, so taking the property only
 * before that moment leaves htmx wrapping this and still answering its own entries.
 * Taking it on both sides of that moment is what makes this independent of which script
 * ran first.
 *
 * @param {ParentNode} root
 */
function ownHistory(root) {
  if (typeof window === "undefined") return;
  const take = () => {
    window.onpopstate = () => renderAddress(root, window.location.pathname);
  };
  take();
  if (typeof document !== "undefined" && document.readyState !== "complete") {
    document.addEventListener("DOMContentLoaded", take, { once: true });
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => startDeskWindow(document), { once: true });
  } else {
    startDeskWindow(document);
  }
}
