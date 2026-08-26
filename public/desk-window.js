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
 */

import {
  EDGE,
  fillDesk,
  fitToDesk,
  PROMPT_CLEARANCE,
  placeWindow,
  refreshGeometry,
} from "../design/scripts/desk-geometry.js";
import { AlunaWindow } from "../design/scripts/window.js";
import { addWindowDrag, addWindowGrip, setMaximised } from "../design/scripts/window-gestures.js";
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
 * Over a wallpaper the window carries its shadow at 40% rather than 24% — the
 * design's own number for a window standing on the desk rather than in a document.
 */
const WALL_SHADOW = 0.4;

/**
 * How much of the desk a window takes when it first opens.
 *
 * A collection is a list, so height is what it wants; and the desk has to still read
 * as a desk around it, or the wallpaper and the logos have been replaced by a page.
 * Anything remembered from a previous visit is 5.6/02's, and it replaces this.
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
 */

/** The one window (design D1). The developer panel's second one is 5.6/04. */
/** @type {DeskWindow | null} */
let mounted = null;

/** How many windows this page has stood up, so no two share a title's id. */
let mountCount = 0;

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
 * Build the one window and everything that lives inside it.
 *
 * @param {ParentNode} root
 * @param {string} title
 * @returns {DeskWindow}
 */
function mount(root, title) {
  const layer = windowLayer(root);
  const box = defaultBox(layer.getBoundingClientRect());

  const el = document.createElement("section");
  el.className = "window window--desk is-focused";
  placeWindow(el, box);

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
  const entry = { win, el, layer, region, box, maximised: false, openedBy: null };

  /* The three gestures ship from `window-gestures.js`, the way the frame ships from
   * `window.js`: one implementation, so a desk cannot drift from the design's. */
  const host = gestureHost(entry);
  addWindowGrip(host);
  addWindowDrag(win.bar, host);
  addLamps(entry);
  syncMaximiseLamp(entry);
  return entry;
}

/* ── opening and putting away ──────────────────────────────────────────────── */

/**
 * Open the window, or bring what is already open under a new title. One window: a
 * second capability swaps what is inside the frame rather than standing another
 * frame beside it (design D1, D2).
 *
 * @param {string} title
 * @param {ParentNode} [root]
 * @param {Element | null} [openedBy] where focus goes back to when it is put away
 * @returns {HTMLElement} the content region, ready to be swapped into
 */
export function openWindow(title, root = document, openedBy = null) {
  mounted ??= mount(root, title);
  mounted.win.setTitle(title);
  /* The first opener owns the way back. A capability swapped into a window that is
   * already up did not open it, and must not move where putting it away returns. */
  mounted.openedBy ??= openedBy;
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
    if (action === "putaway") putAway();
  });
}

/**
 * The desk this window is held inside, and what a gesture on it may do. Nothing here
 * stands a gesture down but a maximised window: the phone form, where the window is
 * the screen and no box may be written for it, is 5.6/02's.
 *
 * @param {DeskWindow} entry
 * @returns {import("../design/scripts/window-gestures.js").GestureHost}
 */
function gestureHost(entry) {
  return {
    el: entry.el,
    box: entry.box,
    bounds: () => entry.layer.getBoundingClientRect(),
    standDown: () => entry.maximised,
  };
}

/**
 * Maximise, or give the window back the box it had. Remembering either across a
 * reload is 5.6/02's; what is kept here lives only as long as the window does.
 *
 * @param {DeskWindow} entry
 */
function toggleMaximise(entry) {
  const bounds = entry.layer.getBoundingClientRect();
  entry.maximised = !entry.maximised;
  setMaximised(entry.el, entry.box, entry.maximised);
  if (entry.maximised) fillDesk(bounds, entry.box);
  else fitToDesk(bounds, entry.box);
  placeWindow(entry.el, entry.box);
  syncMaximiseLamp(entry);
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
 * The capability the address names, if it names one and the desk has it. A logo
 * layer rehydrated from the registry is the only statement on this page of what
 * exists, so an address naming something not standing there opens nothing and
 * leaves the bare desk — which is also what a link to a deleted capability should
 * do, and 5.9/03 makes the server say so.
 *
 * @param {ParentNode} root
 * @param {string} pathname
 */
function openAddressedCapability(root, pathname) {
  const id = capabilityIdFromAddress(pathname);
  if (id === null) return;

  const logo = logoFor(root, id);
  if (!logo) return;

  whenDeskIsLaidOut(root, () => openAddressedWindow(root, pathname, logo));
}

/**
 * @param {ParentNode} root
 * @param {string} pathname
 * @param {LogoNode} logo
 */
function openAddressedWindow(root, pathname, logo) {
  const region = openWindow(logoTitle(logo), root, asElement(logo));
  /* The same fragment a logo click serves, asked for by the same client. The address
   * is already right, so nothing is pushed. */
  void htmx()
    ?.ajax?.("GET", pathname, { source: logo, target: region, swap: "innerHTML" })
    .catch(() => undefined)
    .finally(() => putAwayUnfilledWindow(region));
}

/**
 * A window opened for a request that never filled it does not get to stand there.
 *
 * Checked against the window that is up *now*: by the time a slow read answers, the
 * user may have opened something else, and putting that away would be answering the
 * wrong question.
 *
 * @param {Element} region the region the request was aimed at
 */
function putAwayUnfilledWindow(region) {
  if (mounted?.region !== region) return;
  if (region.childNodes.length > 0) return;
  putAway();
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
  windowLayer(root);

  root.addEventListener(
    "click",
    (event) => {
      const { target } = event;
      if (!(target instanceof Element)) return;
      const logo = target.closest(CAPABILITY_LOGO_SELECTOR);
      if (!logo) return;
      const region = openWindow(logoTitle(logo), root, logo);
      /* A logo whose capability has gone — deleted in another tab — answers
       * unsuccessfully, and htmx keeps an unsuccessful response out of the DOM.
       * Nothing swaps, so nothing would take back the window the press just opened,
       * and the desk would be left holding an empty frame titled with a capability
       * that no longer exists. */
      root.addEventListener(
        "htmx:afterRequest",
        (done) => {
          const detail = /** @type {CustomEvent<{ elt?: unknown, successful?: boolean }>} */ (done)
            .detail;
          if (detail?.elt === logo && detail.successful === false) putAwayUnfilledWindow(region);
        },
        { once: true },
      );
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
       * finds no window has to say what the window is for. */
      if (!mounted) openWindow(BUILD_WINDOW_TITLE, root, form.querySelector("input"));
    },
    true,
  );

  openAddressedCapability(root, pathname);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => startDeskWindow(document), { once: true });
  } else {
    startDeskWindow(document);
  }
}
