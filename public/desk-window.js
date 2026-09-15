// @ts-check
/**
 * The window, in the product. `design/scripts/window.js` is the window itself; this file owns the
 * one window on the desk — when it exists, what is in it, where it sits, and what a lamp does.
 *
 * Making it here rather than serving it in the page has three consequences. The shell carries no
 * content area, so the server composes a desk rather than a desk with a hole in it. Putting the
 * window away is the only way a content region disappears, so it is a release and a removal
 * rather than a teardown kept in step with the region rule forever. And both openers listen in
 * the capture phase, because htmx resolves `hx-target` from a listener on the element itself,
 * which runs after every capture listener on the document.
 *
 * Where the window sits (`desk-window-store.js`) and the address it is written into
 * (`desk-address.js`) are modules beside it, re-exported here so the rules keep one face.
 */

import {
  fillDesk,
  fitToDesk,
  PHONE,
  placeWindow,
  refreshGeometry,
} from "../design/scripts/desk-geometry.js";
import { AlunaWindow } from "../design/scripts/window.js";
import { addWindowDrag, addWindowGrip, setMaximised } from "../design/scripts/window-gestures.js";
import {
  capabilityAddress,
  capabilityIdFromAddress,
  correctUnfilledAddress,
  DESK_ADDRESS,
  deskHistory,
  pushAddress,
  replaceAddress,
  startDeskHistory,
} from "./desk-address.js";
import { answerDoorway, WINDOW_DOORWAY_SELECTOR, whenTheRequestFails } from "./desk-doorway.js";
import { joinStack, leaveStack, raise, raiseFromPress } from "./desk-stack.js";
import {
  centredBox,
  onDeskReady,
  syncMaximiseLamp,
  syncWindowForm,
  WALL_SHADOW,
} from "./desk-window-frame.js";
import {
  forgetOnDismissal,
  loadPresentation,
  localStore,
  savePresentation,
} from "./desk-window-store.js";
import {
  askBeforeLeaving,
  buildRunIn,
  endRunIn,
  leavingIsBeingAsked,
  runIsUsingWindow,
  startLeavingGuard,
} from "./leaving-a-run.js";
import { RELEASE_REGION_EVENT } from "./region-scope.js";
import { ACTIVE_CAPABILITY_ATTRIBUTE, WINDOW_CONTENT_ID } from "./shell-dom.js";

/** The desk's window layer — the ground the one window stands on. */
export const WINDOW_LAYER_SELECTOR = ".desk__windows";

/** A capability's logo, the one way a capability's collection reaches the window. */
export const CAPABILITY_LOGO_SELECTOR = "[data-capability-logo]";

/** The prompt bar's form. A build needs a window to narrate into. */
export const PROMPT_FORM_ID = "spec-build-form";

/**
 * The window's content region. The id is the temporary shell's and every existing
 * swap still addresses it; what changed is where it lives and who makes it.
 */
export { WINDOW_CONTENT_ID } from "./shell-dom.js";

/**
 * What `region-scope.js` reports this region as when it releases it. Named for the content, never
 * for the frame: one window holds many successive contents, and the frame is what stays.
 */
export const WINDOW_CONTENT_REGION = "the window's content";

/**
 * What the title bar says while a build has the window and no capability does. The title is
 * information (M5 plan 1); `renderBuildWindowTitle` names it again once resolution settles.
 */
export const THINKING_WINDOW_TITLE = "Thinking…";

/**
 * A window a prompt stood up and has not been given anything to show: htmx resolves where a
 * response lands before it sends, so the frame waits unrevealed rather than appearing and going.
 */
const PENDING_WINDOW_CLASS = "is-pending";

/**
 * The window itself, reached from whatever inside it is being talked about. `is-pending` is
 * `visibility`, not `display`: a box with no layout would be drawn at nothing and stay that way.
 * @typedef {{
 *   matches?: (selector: string) => boolean,
 *   closest?: (selector: string) => { classList: { remove(name: string): void } } | null,
 * }} RevealingListener
 */
const DESK_WINDOW_SELECTOR = ".window--desk";

/**
 * The degenerate case: a window a run opened itself whose run ended without activating, so there
 * is no earlier name to put back and no capability to name it after. A noun claiming nothing.
 */
export const BUILD_WINDOW_TITLE = "Aluna";

/**
 * The desk being told what the window is called now. `null` means put back the name the run took
 * over. Kept in sync with public/app.js, and pinned by a platform test.
 */
export const NAME_THE_WINDOW_EVENT = "aluna:name-the-window";

/**
 * Ask for the window to be put away, from a script that cannot import this module: `app.js` is
 * the one that notices the window has been left holding nothing. Pinned by a platform test.
 */
export const PUT_WINDOW_AWAY_EVENT = "aluna:put-window-away";

/**
 * Set on the desk ground below the breakpoint, so the page states the form the script believes it
 * is in. Nothing in the stylesheet needs it: it is where the two can be seen agreeing.
 */
export const PHONE_CLASS = "desk--phone";

/**
 * The desk ground: the wallpaper the logos, the window layer and the prompt bar stand on. Missing
 * one is not fatal the way a missing window layer is; every gesture reads the script's answer.
 */
export const DESK_GROUND_SELECTOR = ".shell";

/**
 * How much of the desk a window takes when it first opens. A collection is a list, so height is
 * what it wants, and the desk still has to read as a desk around it.
 */
const DEFAULT_FILL = { w: 0.62, h: 0.72 };

/**
 * The two things borrowed from htmx. `swap` is the teardown — `remove` is `removeChild`
 * and leaks the `EventSource` — and `ajax` asks for a fragment the way a click on the logo would.
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
 * @property {string | null} [displacedTitle] the name a run took over, owed back
 */

/** The one window (design D1). The developer panel's second one is 5.6/04. */
/** @type {DeskWindow | null} */
let mounted = null;

/** How many windows this page has stood up, so no two share a title's id. */
let mountCount = 0;

/**
 * Whether the desk is below the breakpoint. Held rather than asked each time, because every
 * gesture and every write consults it and only the media query can answer.
 */
let phone = false;

/** Whether the viewport is already being watched. The three subscriptions are for life. */
let watching = false;

/**
 * The layer, or a loud failure (5.3/02): a desk that cannot mount a window looks like a capability
 * that refused to open, and the two want opposite fixes. Structural, so a test can force it.
 *
 * @param {{ querySelector(selector: string): unknown }} root
 * @returns {HTMLElement}
 */
export function windowLayer(root) {
  const layer = root.querySelector(WINDOW_LAYER_SELECTOR);
  if (layer === null || layer === undefined) throw new Error("The desk's window layer is missing.");
  return /** @type {HTMLElement} */ (layer);
}

/** This page's window, remembered in this page's store. @param {DeskWindow} entry */
const remember = (entry) => savePresentation(entry, phone, localStore());

export {
  capabilityAddress,
  capabilityIdFromAddress,
  correctUnfilledAddress,
  DESK_ADDRESS,
  DESK_HISTORY_STATE,
  deskHistory,
  isAnotherPlace,
  pushAddress,
  replaceAddress,
} from "./desk-address.js";
export {
  forgetOnDismissal,
  forgetPresentation,
  loadPresentation,
  localStore,
  parsePresentation,
  presentationOf,
  savePresentation,
  WINDOW_STORAGE_KEY,
} from "./desk-window-store.js";

/* ── where the window sits ─────────────────────────────────────────────────── */

/**
 * Whether the desk has edges worth measuring: a cold load measures zero until `@import`ed
 * stylesheets arrive, and a `ResizeObserver` reports zero for anything taken out of flow.
 *
 * @param {{ width: number, height: number }} bounds
 * @returns {boolean}
 */
const laidOut = (bounds) => bounds.width >= 2 && bounds.height >= 2;

/**
 * The first box a window gets, fitted to the desk it opens on and centred: the room left over is
 * halved above and below the prompt bar's floor, and again to either side.
 *
 * @param {DOMRect} bounds
 * @returns {Box}
 */
function defaultBox(bounds) {
  return centredBox(bounds, DEFAULT_FILL);
}

/**
 * Where a window's box belongs on a desk this size, in this form — the whole geometry decision.
 * Told which form it is in and given a box, so the crossing is one call made twice, and testable.
 *
 * @param {{ box: StoredBox, maximised: boolean, sized: boolean,
 *           first?: (bounds: DOMRect) => Box }} state mutated in place
 * @param {DOMRect} bounds the desk
 * @param {boolean} isPhone
 * @returns {boolean} whether the window is now worth placing from that box
 */
export function fitBox(state, bounds, isPhone) {
  // On a phone this decides nothing: the window is the screen and the stylesheet places it, and a
  // box fitted to a filled screen would let a narrow browser author a desktop box.
  if (isPhone || !laidOut(bounds)) return false;
  if (!state.sized) {
    state.sized = true;
    // `state.first` is what no preference yet means for this window: most of the desk for a
    // collection, a narrow column for the panel meant to be read beside one.
    const first = (state.first ?? defaultBox)(bounds);
    if (state.maximised) state.box.restore = first;
    else Object.assign(state.box, first);
  }
  if (state.maximised) fillDesk(bounds, state.box);
  else fitToDesk(bounds, state.box);
  return true;
}

/**
 * Turn a record back into a standing window: the box it opens on, whether it is maximised, and
 * whether that box is a preference or a first guess.
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
  // `setMaximised` first, so the record's box is stashed as the one to give back before `fitBox`
  // overwrites the live one: backwards, this desk's own size becomes the remembered box.
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

  /* A named region rather than an anonymous box: the window is a landmark. The id counts up, so
   * neither of the other two windows can arrive carrying a duplicate of this one. */
  mountCount += 1;
  win.titleEl.id = `aluna-window-title-${mountCount}`;
  el.setAttribute("aria-labelledby", win.titleEl.id);

  /** @type {DeskWindow} */
  const entry = { win, el, layer, region, ...geometry, openedBy: null, gestures: false };

  addLamps(entry);
  syncMaximiseLamp(entry);
  syncForm(entry, phone);

  /* More than one window may stand at once, so this one has to say which it is: joining puts it
   * in front, and a pointer landing anywhere on it brings it back (`public/desk-stack.js`). */
  joinStack(entry);
  el.addEventListener("pointerdown", (event) => raiseFromPress(entry, event), true);
  return entry;
}

/**
 * Tell the window which form it is in. Below the breakpoint the grip is never built and the lamp
 * is taken out of the page: a tab stop whose Enter does nothing is worse than no tab stop.
 *
 * @param {DeskWindow} entry
 * @param {boolean} isPhone
 */
export function syncForm(entry, isPhone) {
  syncWindowForm(entry, isPhone);
  if (!isPhone) bindGestures(entry);
}

/**
 * The gestures ship from `window-gestures.js`, so a desk cannot drift from the design's. Bound
 * once and never on a phone; one already standing when the browser narrows stands down instead.
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
 * The window an opening lands in. One window: a standing one is retitled and handed back, so a
 * second capability swaps what is inside the frame rather than standing another beside it (D1, D2).
 *
 * @template {{ win: { setTitle(title: string): void }, openedBy: unknown, displacedTitle?: string | null }} T
 * @param {T | null} standing
 * @param {() => T} mountWindow
 * @param {string} title
 * @param {T["openedBy"]} openedBy where focus goes back to when it is put away
 * @returns {T}
 */
export function windowForOpening(standing, mountWindow, title, openedBy) {
  const entry = standing ?? mountWindow();
  entry.win.setTitle(title);
  /* Whatever opened it named it, so it is no longer holding a name for a run. */
  entry.displacedTitle = null;
  /* The way back is the last thing that filled the window, not the first: after A → B → C, the
   * first dropped a keyboard user on A's logo, three moves from where they had been looking. */
  if (openedBy !== null) entry.openedBy = openedBy;
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
  /* Whatever is about to fill it is what the user just asked for, so it comes to the front —
   * below the breakpoint, the difference between being on screen and out of the page. */
  raise(mounted);
  return mounted.region;
}

/**
 * Put the window away, saying nothing about the record: the two ways a window goes away without
 * the user asking are not decisions about where windows go (design D3).
 *
 * @returns {boolean} whether there was a window to put away
 */
export function putAway() {
  const entry = mounted;
  if (!entry) return false;
  mounted = null;
  // The backstop rather than the path: every navigation that can reach this ends its own run
  // first, but a window going away over a live one may not leave the server making it.
  endRunIn(entry.el);
  tearDownWindow(entry, htmx());
  return true;
}

/**
 * The user closing their window: it goes away, and the box goes with it. Both ways a user
 * dismisses one arrive here, the lamp pushing the very address a Back arrives at.
 *
 * @returns {boolean} whether there was a window to dismiss
 */
export function dismissWindow() {
  return forgetOnDismissal(putAway(), localStore());
}

/**
 * Call the window something, remembering what it was called first.
 *
 * @param {string} title
 * @param {string} [displaced] the name to put back when the run does not activate
 */
export function nameWindow(title, displaced) {
  if (!mounted) return;
  if (displaced !== undefined) mounted.displacedTitle ??= displaced;
  mounted.win.setTitle(title);
}

/**
 * Put back the name the run took over, if it took one over. A run that activated is not this:
 * `addressTheWindow` writes that name from the ground.
 */
export function releaseWindowName() {
  if (!mounted) return;
  const displaced = mounted.displacedTitle;
  mounted.displacedTitle = null;
  if (displaced !== null && displaced !== undefined) mounted.win.setTitle(displaced);
}

/**
 * Everything a window owes on its way out, in order: the region rule releases the content's
 * scope, then htmx's cleanup runs. Both need the window still connected, or neither works.
 *
 * @param {Pick<DeskWindow, "el" | "region" | "win" | "openedBy">} entry
 * @param {Htmx | undefined} api
 */
export function tearDownWindow(entry, api) {
  entry.region.dispatchEvent(new CustomEvent(RELEASE_REGION_EVENT, { bubbles: true }));
  // Swapping the window empty is how htmx's cleanup is reached — `htmx.remove` does not do it —
  // and it closes an `EventSource` a build left open, letting `htmx:sseClose` bubble.
  api?.swap?.(entry.el, "", { swapStyle: "innerHTML", swapDelay: 0, settleDelay: 0 });
  /* Before the frame goes: whatever is left standing is now the only window, and on a
   * phone the survivor is only exposed once it is the front one. */
  leaveStack(entry);
  entry.win.destroy();
  entry.el.remove();
  focusOpener(entry.openedBy);
}

/**
 * Give focus back, if the thing that opened the window is still on the desk. Without it a
 * keyboard user who presses the clay lamp loses focus to `<body>` and tabs the desk again.
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
    /* The clay lamp is a navigation, so the bare desk is the entry Back steps off (design D14).
     * A window emptied by a deletion is the address being wrong, and is corrected in place. */
    if (action === "putaway") {
      const away = () => {
        dismissWindow();
        pushAddress(DESK_ADDRESS, deskHistory());
      };
      /* Not silent when there is something to lose (design D3, as decision 17 amends it): the
       * lamp still means put away, and simply asks first when it would take a run with it. */
      if (!askBeforeLeaving(entry.el, away)) away();
    }
  });
}

/**
 * The desk this window is held inside, and what a gesture on it may do. Two things stand a
 * gesture down: a maximised window, and a phone, where no box may be written at all.
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
    /* The grip stops its own `pointerdown` propagating, so the window's own raise never runs and
     * the one you are resizing is left behind the one you are not (`window-gestures.js`). */
    onStart: () => raise(entry),
    /* Only while this is still the window on the desk: a teardown releases the pointer capture,
     * and the `lostpointercapture` reads as an ending that would write a dismissed box back. */
    onEnd: () => void (mounted === entry && remember(entry)),
  };
}

/**
 * Maximise, or give the window back the box it had. What is remembered is the flag and that box,
 * never the maximised size, so the same window on another screen fills that screen (design D9).
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
 * The desk's one viewport listener: a screen can change size between two visits and during one,
 * so what is remembered is re-fitted rather than trusted.
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
  // Three sources: the media query says which form this is, `resize` is the ordinary case, and the
  // layer is watched too: the floor is in rem, so raising text size resizes with no viewport move.
  const query = window.matchMedia(PHONE);

  const onResize = () => {
    refreshGeometry();
    const was = phone;
    phone = query.matches;
    ground?.classList.toggle(PHONE_CLASS, phone);
    if (!mounted) return;
    syncForm(mounted, phone);
    refit(mounted);
    /* Only the crossing is written, and only upward: the first desktop box of a window born
     * below the breakpoint is the one thing a resize authors rather than merely clamps. */
    if (was !== phone) remember(mounted);
  };

  query.addEventListener("change", onResize);
  window.addEventListener("resize", onResize);
  if (typeof ResizeObserver === "function") new ResizeObserver(onResize).observe(layer);
  onResize();
}

/* ── who opens it ──────────────────────────────────────────────────────────── */

/**
 * The DOM facts the three rules below need, and no more. Structural on purpose, so a test double
 * satisfies them as well as an `Element` and the rules run in Bun without a browser.
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
 * One capability's logo, found by reading ids back rather than building a selector out of one:
 * a capability id is a string this module did not author.
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

/** The marker the server puts on the surface of the capability standing in a window. */
export { ACTIVE_CAPABILITY_ATTRIBUTE } from "./shell-dom.js";

/* A direct child of the region and never a descendant: a build narrates beside what it displaced
   and nests its copy of that surface, which is why a build does not change the address. */
const ACTIVE_CAPABILITY_SELECTOR = `:scope > [${ACTIVE_CAPABILITY_ATTRIBUTE}]`;

/**
 * The capability whose collection is standing in the window, read off the surface rather than
 * remembered: a copy kept here would be wrong the moment a swap landed on it.
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
 * The window's content changed hands, said by `app.js` rather than decided there, so the rule for
 * "already there" stays in one place. `detail.navigated` is true only for a v1 activation.
 */
export const WINDOW_TOOK_CAPABILITY_EVENT = "aluna:window-took-capability";

/**
 * Point the address at the capability standing in the window. Taking the window is a navigation
 * and is owed an entry; anything else is the address catching up, and is owed none (design D14).
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
  /* A correction asks whether the bar is exactly right, where a push asks only whether it is
   * somewhere else — which is what strips a query string or a trailing slash from outside. */
  if (bar.location.pathname !== next || bar.location.search !== "") replaceAddress(next, bar);
}

/**
 * What the window is showing, for the one question a press asks. `buildRunIn` rather than
 * `buildJobIdIn`: a run waiting to be read still covers the collection, so a press changes it.
 *
 * @param {DeskWindow | null} entry
 * @returns {string | null}
 */
function settledCapabilityInWindow(entry) {
  if (entry === null || buildRunIn(entry.el) !== null) return null;
  return capabilityInWindow(entry);
}

/**
 * Whether a press on this logo has anything to open. The capability already standing there is
 * not opened again: fetching would swap the collection out and back in, and the window flickers.
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
 * What an address asks of the desk. The rehydrated logo layer is this page's only statement of
 * what exists, so an address naming something not standing there asks for the bare desk.
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
 * The addressed open still waiting for a desk with edges. A Back onto the bare desk takes a window
 * down rather than putting one up, so without this it is answered by the window opening anyway.
 *
 * @type {ResizeObserver | null}
 */
let waitingForDesk = null;

/** Stop waiting, whether the wait ended or was overtaken. */
function stopWaitingForDesk() {
  waitingForDesk?.disconnect();
  waitingForDesk = null;
}

/**
 * Run once the desk has edges to measure. A press and a submit both happen long after a cold
 * load; the address is the one opener that runs at exactly the moment the desk measures zero.
 *
 * @param {ParentNode} root
 * @param {() => void} open
 */
function whenDeskIsLaidOut(root, open) {
  stopWaitingForDesk();
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
    // Only one open ever waits, and it is the newest thing asked for: a second address overtakes
    // the first, and a press or a submit cancels the wait outright by mounting a window.
    if (!laidOut() && !mounted) return;
    /* Its own wait, not whichever one is current: a callback already queued when this
     * observer was overtaken would otherwise cancel the open that overtook it. */
    if (waitingForDesk === observer) stopWaitingForDesk();
    else observer.disconnect();
    if (!mounted) open();
  });
  waitingForDesk = observer;
  observer.observe(layer);
}

/**
 * Show what an address names, and write nothing back to history: an answer that pushed would put
 * the entry it was answering back on top of the stack, which is the loop design D14 rules out.
 *
 * @param {ParentNode} root
 * @param {string} pathname
 */
function renderAddress(root, pathname) {
  const asked = addressAsks(root, pathname, capabilityInWindow(mounted));
  if (asked.ask === "nothing") return;
  if (asked.ask === "bare desk") {
    /* No run reaches here any more: a traversal that would take one is held above and a
     * confirmed one has already ended it, so this is a window going away over nothing. */
    stopWaitingForDesk();
    /* `addressAsks` answers "bare desk" to two things: the bare desk, and an address naming a
     * capability that is not on the ground. Only the first is the user dismissing a window. */
    if (pathname === DESK_ADDRESS) {
      dismissWindow();
      return;
    }
    putAway();
    /* Left alone the bar goes on naming a capability nobody can open, and a replace keeps the
     * Forward the person still has. */
    correctUnfilledAddress(pathname, DESK_ADDRESS);
    return;
  }
  /* The capability's own address, not the one in the bar: both spellings of it reach the
   * view, and this asks for the one the logo's own press asks for. */
  whenDeskIsLaidOut(root, () => openAddressedWindow(root, capabilityAddress(asked.id), asked.logo));
}

/**
 * @param {ParentNode} root
 * @param {string} pathname
 * @param {LogoNode} logo
 */
function openAddressedWindow(root, pathname, logo) {
  const region = openWindow(logoTitle(logo), root, asElement(logo));
  /* The same fragment a logo click serves, asked for by the same client. The address is already
   * right, so nothing is pushed. */
  void htmx()
    ?.ajax?.("GET", pathname, { source: logo, target: region, swap: "innerHTML" })
    .catch(() => undefined)
    .finally(() => {
      if (putAwayUnfilledWindow(region)) correctUnfilledAddress(pathname, DESK_ADDRESS);
    });
}

/**
 * A window opened for a request that never filled it does not get to stand there. Checked against
 * the window up now: a slow read can answer after the user has opened something else.
 *
 * @param {Element | null} region the region the request was aimed at, if there is one
 * @returns {boolean} whether there was an unfilled window and it is now gone
 */
function putAwayUnfilledWindow(region) {
  if (mounted?.region !== region) return false;
  if (region.childNodes.length > 0) return false;
  return putAway();
}

/**
 * The logo as something focus can be given back to. `LogoNode` is deliberately structural, so
 * this is the one place the module asks whether it is also a real element.
 *
 * @param {LogoNode} logo
 * @returns {Element | null}
 */
function asElement(logo) {
  return logo instanceof Element ? logo : null;
}

/**
 * Stand a press down if the capability it asked for answers unsuccessfully: htmx keeps that
 * response out of the DOM, so nothing would take back the empty frame the press just opened.
 *
 * @param {Document} root
 * @param {Element} logo
 * @param {Element} region the region the press opened
 * @param {string | null} attempted the address the press asked for
 * @param {string | null} cameFrom where the bar was before the press pushed, if it pushed
 */
function standDownUnsuccessfulPress(root, logo, region, attempted, cameFrom) {
  whenTheRequestFails(root, logo, () => {
    /* This press's own request and no other: a logo attempt can run for the better part of a
     * minute, and standing down on the first answer would let it hide the failure. */
    if (putAwayUnfilledWindow(region) && attempted !== null) {
      correctUnfilledAddress(attempted, cameFrom ?? DESK_ADDRESS);
    }
  });
}

/**
 * Make the press again, now that the run it would have taken is over. A real click, because the
 * desk owns one half of a press and htmx the other, and replaying is the only way to get both.
 *
 * @param {Element} logo
 */
function pressAgain(logo) {
  if (logo instanceof HTMLElement) logo.click();
}

/**
 * Open the capability a press asked for. The window is stood up before htmx resolves the press,
 * and the address is pushed before the request, which would otherwise overwrite this press's entry.
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
 * What a press on a capability's logo does. A press declined as an opening is declined here and
 * at the request below, those being the two halves htmx splits a press into.
 *
 * @param {Document} root
 * @param {Element} logo
 */
function answerPress(root, logo) {
  if (pressWouldOpen(logo, settledCapabilityInWindow(mounted))) {
    /* A switch that would replace a live run asks first, and a yes replays the press itself, so
     * there is no second opener to keep in step with this one. */
    if (askBeforeLeaving(mounted?.el ?? null, () => pressAgain(logo))) return;
    openPressedCapability(root, logo);
    return;
  }
  /* It gives back the name a run took over: a confirmed switch onto the capability the run
   * displaced opens nothing, so nothing else would stop the window saying `Evolving…`. */
  releaseWindowName();
  /* And it still brings that window forward: without this the capability behind the developer
   * panel has no way back, and on a phone no way back on screen. */
  if (mounted) raise(mounted);
}

/**
 * The handful of things a doorway asks of the window, named once.
 * @param {Document} root
 * @returns {import("./desk-doorway.js").WindowForDoorways}
 */
function windowForDoorways(root) {
  return {
    /* The same question the desk's refusal asks (`runIsUsingTheWindow`, `public/app.js`): a press
     * about to be turned down must leave the run holding everything, its window's name included. */
    isNarrating: () => mounted !== null && runIsUsingWindow(mounted.region),
    logoFor: (id) => {
      const found = id === "" ? null : logoFor(root, id);
      return found instanceof Element ? found : null;
    },
    titleOf: (logo) => logoTitle(logo),
    fallbackTitle: BUILD_WINDOW_TITLE,
    openWindow: (title, openedBy) => openWindow(title, root, openedBy),
    putAwayUnfilled: (region) => {
      putAwayUnfilledWindow(region);
    },
  };
}

/**
 * Both openers, and the load-time one. The layer is demanded here rather than at the first press:
 * a shell shipped without one would render a normal-looking desk and fail on the first click.
 *
 * @param {Document} root
 * @param {string} [pathname] the address to open, defaulting to the one in the bar
 */
export function startDeskWindow(root, pathname = window.location.pathname) {
  const layer = windowLayer(root);

  /* Before either opener, so the first window mounted knows which form it is in and
   * the phone's is never built with a grip and a lamp it may not use. */
  watchViewport(root, layer);

  /* The question every navigation below stands behind (`leaving-a-run.js`), started here rather
   * than from its own module evaluation, so the desk has one starter and one root. */
  startLeavingGuard(root);

  root.addEventListener(
    "click",
    (event) => {
      const { target } = event;
      if (!(target instanceof Element)) return;
      const logo = target.closest(CAPABILITY_LOGO_SELECTOR);
      if (logo !== null) {
        answerPress(root, logo);
        return;
      }
      const doorway = target.closest(WINDOW_DOORWAY_SELECTOR);
      if (doorway !== null) answerDoorway(root, doorway, windowForDoorways(root));
    },
    true,
  );

  /* A window that holds nothing does not exist. The glue that empties the region says so here
   * rather than reaching into the window itself. */
  root.addEventListener(PUT_WINDOW_AWAY_EVENT, () => {
    putAway();
  });

  /* A request that never came back leaves the frame it stood up holding nothing, with no swap to
   * settle and no stream to close: the two moments that otherwise answer for an empty one. */
  for (const failed of ["htmx:sendError", "htmx:responseError"]) {
    root.addEventListener(failed, () => putAwayUnfilledWindow(mounted?.region ?? null));
  }

  root.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || form.id !== PROMPT_FORM_ID) return;
      /* A submission the bar has already turned down never becomes a request, so a window opened
       * anyway would appear and close in the same breath (`public/prompt-bar.js`). */
      if (event.defaultPrevented) return;
      /* A build takes over whatever the window holds and remembers the name, because a run that
       * does not activate owes it back. It has to be in front, or the story is behind the panel. */
      const displaced = mounted?.win.title ?? BUILD_WINDOW_TITLE;
      if (mounted) raise(mounted);
      /* Nothing was standing, so this frame exists only for a run that may turn out to
       * have nothing to say. It waits out of sight until it is given something. */ else
        openWindow(THINKING_WINDOW_TITLE, root, form.querySelector("input"))
          .closest(DESK_WINDOW_SELECTOR)
          ?.classList.add(PENDING_WINDOW_CLASS);
      nameWindow(THINKING_WINDOW_TITLE, displaced);
    },
    true,
  );

  /* htmx turns a press into a request from a listener on the logo itself, which runs after every
   * capture listener and ignores `defaultPrevented`, so cancelling here is what stops it. */
  root.addEventListener("htmx:beforeRequest", (event) => {
    const elt = /** @type {CustomEvent<{ elt?: unknown }>} */ (event).detail?.elt;
    // Matched rather than `closest`: a faceless tile's one-attempt POST is fired from a span
    // inside the logo, and it is not this press.
    if (!(elt instanceof Element) || !elt.matches(CAPABILITY_LOGO_SELECTOR)) return;
    if (!pressWouldOpen(elt, settledCapabilityInWindow(mounted)) || leavingIsBeingAsked()) {
      event.preventDefault();
    }
  });

  /* The message rather than the swap: htmx's SSE extension swaps without an event info object,
   * so `htmx:afterSwap` arrives for these with no target on it at all. */
  root.addEventListener("htmx:sseBeforeMessage", (event) => {
    /* Structural, like every other node this module is handed: the rule is proved against a
     * double, and `Element` is a browser global a double does not have. */
    const listener = /** @type {RevealingListener | null} */ (event.target);
    /* The first thing a run has to say is what the frame was for, and nothing else reveals the
     * window: a restoration landing in it is the run giving back what it displaced. */
    if (listener?.matches?.(".build-stream__narration, .build-stream__commit") !== true) return;
    listener.closest?.(DESK_WINDOW_SELECTOR)?.classList.remove(PENDING_WINDOW_CLASS);
  });

  /* The window's content changing hands is `app.js`'s to notice and the desk's to answer. The
   * new name is read off the ground, so the title bar and the logo can only agree. */
  root.addEventListener(WINDOW_TOOK_CAPABILITY_EVENT, (event) => {
    const detail = /** @type {CustomEvent<{ navigated?: boolean }>} */ (event).detail;
    addressTheWindow(detail?.navigated === true);
    const showing = capabilityInWindow(mounted);
    const logo = showing === null ? null : logoFor(root, showing);
    if (logo !== null && mounted) {
      mounted.displacedTitle = null;
      mounted.win.setTitle(logoTitle(logo));
    }
  });

  /* What the run turned out to be, told by the server through the shell. A `null` name is a run
   * ending without activating, and the window gets its earlier name back. */
  root.addEventListener(NAME_THE_WINDOW_EVENT, (event) => {
    const title = /** @type {CustomEvent<{ title?: unknown }>} */ (event).detail?.title;
    if (typeof title === "string" && title !== "") nameWindow(title);
    else releaseWindowName();
  });

  startDeskHistory({
    render: (landed) => renderAddress(root, landed),
    /* A traversal that would take a live run asks first, and the answer is what moves. A desk
     * with nothing running answers `false`, and the traversal is taken as it always was. */
    hold: (go) => askBeforeLeaving(mounted?.el ?? null, go),
  });
  renderAddress(root, pathname);
}

onDeskReady(() => startDeskWindow(document));
