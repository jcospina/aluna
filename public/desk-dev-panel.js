// @ts-check

/**
 * The developer panel — the one second window, and the last one.
 *
 * D13 is a single, named exception to D1's one window, not the first step towards a
 * window manager. It is furniture rather than a capability: it never appears in the
 * capability list, it is never addressed (`/capability/:id` names a capability and
 * nothing else — design D14), it opens from its own tile, and it is allowed to sit
 * beside the capability being watched, because reading a build and watching it run is
 * one activity. Module 9's experimenter surface lands *in this window* for the same
 * reason, which is what keeps the exception at one.
 *
 * It is read-only in the strongest sense available: nothing in this file has ever
 * heard of a record, a schema or a capability's state. The only thing it writes
 * anywhere is its own presentation record — box, maximised flag, and whether it was
 * open — which is the second and last thing `localStorage` holds (design D9).
 *
 * The stage payloads it shows arrive from `app.js` as events rather than being fetched
 * here, and are kept whether or not the panel is open. A developer who starts a build
 * and *then* thinks to open the panel would otherwise find an empty one: the interesting
 * stages are over by the time the tile is pressed.
 */

import {
  EDGE,
  fitToDesk,
  PHONE,
  PROMPT_CLEARANCE,
  placeWindow,
  readBox,
  refreshGeometry,
} from "../design/scripts/desk-geometry.js";
import { clearStages, devPanelBody, writeStage } from "../design/scripts/devpanel.js";
import { AlunaWindow } from "../design/scripts/window.js";
import { addWindowDrag, addWindowGrip, setMaximised } from "../design/scripts/window-gestures.js";
import { joinStack, leaveStack, raise } from "./desk-stack.js";
import {
  fitBox,
  loadPresentation,
  localStore,
  openingGeometry,
  savePresentation,
  windowLayer,
} from "./desk-window.js";

/** The tile on the desk that opens the panel. Not a capability logo, and never one. */
export const DEV_TILE_SELECTOR = "[data-dev-tile]";

/** A stage the served page already carried, for the panel to file at start. */
export const DEV_SEED_SELECTOR = "[data-dev-stage-seed]";

/**
 * The second presentation record, and the last. It carries what the capability
 * window's carries — one normal box and the maximised flag, never a maximised size —
 * plus the one thing only this window has: whether it should be standing on next load.
 */
export const DEV_STORAGE_KEY = "aluna.desk.dev.v1";

export const DEV_WINDOW_TITLE = "Developer";

/**
 * A stage payload, from `app.js`'s SSE glue to here. A classic script cannot import
 * this module, so the two agree on an event name; a platform test pins both strings.
 */
export const STAGE_PAYLOAD_EVENT = "aluna:stage-payload";
/** A new build has been accepted: the panel starts empty rather than half-full. */
export const STAGES_CLEARED_EVENT = "aluna:stages-cleared";

/** Over a wallpaper, a window carries its shadow at 40% rather than 24%. */
const WALL_SHADOW = 0.4;

/**
 * How much of the desk the panel takes when nothing is remembered: a tall, narrow
 * column against the right edge. Narrow because a payload is read a line at a time and
 * a wide one is worse; against the edge because the whole point of the exception is
 * that it sits *beside* what it is reporting on rather than over it.
 */
const DEV_FILL = { w: 0.3, h: 0.78 };

/** @typedef {import("../design/scripts/desk-geometry.js").Box} Box */
/** @typedef {import("../design/scripts/window-gestures.js").StoredBox} StoredBox */

/**
 * @typedef {{ win: AlunaWindow, el: HTMLElement, layer: HTMLElement, box: StoredBox,
 *             maximised: boolean, sized: boolean, first: (bounds: DOMRect) => Box,
 *             gestures: boolean, openedBy: Element | null }} DevWindow
 */

/** The one panel, or nothing. @type {DevWindow | null} */
let mounted = null;
/** Whether the desk is below the breakpoint right now. */
let phone = false;
/** Bound once, however many times the panel opens and closes. */
let watching = false;
let titleCount = 0;

/**
 * The latest payload per stage, kept whether the panel is open or not, and replayed
 * into it whenever it opens. Presentation only: this is a copy of what already came
 * down a stream, never a source anything reads back as truth.
 *
 * @type {Map<string, string>}
 */
const stages = new Map();

/**
 * The panel's first box on a desk this size. Right edge, top, above the prompt bar's
 * floor — the same floor the logo grid and the capability window stop on.
 *
 * @param {DOMRect} bounds
 * @returns {Box}
 */
export function devDefaultBox(bounds) {
  refreshGeometry();
  const w = Math.round(bounds.width * DEV_FILL.w);
  const h = Math.round((bounds.height - PROMPT_CLEARANCE) * DEV_FILL.h);
  return fitToDesk(bounds, { x: Math.round(bounds.width - w - EDGE), y: EDGE, w, h });
}

/**
 * This panel's box, remembered with its own extra flag — and only once there is a
 * desk to have authored it against.
 *
 * The `sized` guard is the difference between a preference and an accident. On a
 * cold load the desk measures zero until its stylesheets apply, and a box fitted to
 * a 0×0 desk is `MIN_SIZE` in the corner; written down, that becomes the box this
 * panel opens on for good. `fitBox` sets `sized` only where there were edges to fit
 * to, so this asks it rather than guessing.
 */
function remember() {
  if (!mounted?.sized) return;
  savePresentation(mounted, phone, localStore(), DEV_STORAGE_KEY, { open: true });
}

/**
 * Remember only whether the panel should be standing next time, leaving whatever box
 * is written down exactly as it is — including none at all.
 *
 * Two things follow, and both matter. Opening the panel no longer authors a box on
 * the user's behalf: until they move or resize it, the record carries the flag alone
 * and every load recomputes the default for the screen it is actually on. And this
 * runs on a phone, where `savePresentation` correctly refuses — the phone rule is
 * about not letting a narrow browser author a *desktop box*, and a flag is not one.
 * Without that, a panel put away on a phone came back on the next phone load with no
 * way at all to stop it.
 *
 * @param {boolean} open
 */
function rememberOpen(open) {
  const store = localStore();
  try {
    const stored = JSON.parse(store?.getItem(DEV_STORAGE_KEY) ?? "null");
    const box = readBox(stored);
    const record = JSON.stringify(box ? { ...box, max: stored?.max === true, open } : { open });
    if (store?.getItem(DEV_STORAGE_KEY) === record) return;
    store?.setItem(DEV_STORAGE_KEY, record);
  } catch {
    /* A desk that cannot persist is still a working desk. */
  }
}

/**
 * Whether the panel was standing when the tab was last closed. Read on its own rather
 * than through `loadPresentation`, which answers about geometry: a record whose box is
 * nonsense may still carry a good flag, and the panel should still open.
 *
 * @param {import("./desk-window.js").Store | null} store
 * @returns {boolean}
 */
export function storedOpenFlag(store) {
  try {
    const stored = JSON.parse(store?.getItem(DEV_STORAGE_KEY) ?? "null");
    return stored !== null && typeof stored === "object" && stored.open === true;
  } catch {
    return false;
  }
}

/* ── the window ────────────────────────────────────────────────────────────── */

/**
 * Fit the panel to the desk as it is right now, and put it there.
 *
 * @param {DevWindow} entry
 */
function refit(entry) {
  if (fitBox(entry, entry.layer.getBoundingClientRect(), phone)) {
    placeWindow(entry.el, entry.box);
  }
}

/**
 * Build the panel. Same frame, same two lamps and same gestures as the capability
 * window — one implementation of a window, so the exception cannot drift into a
 * second kind of thing — with `window--dev` for the one difference that is real: what
 * is inside it is set in a monospace face, because it is a payload rather than a
 * sentence.
 *
 * @param {ParentNode} root
 * @param {boolean} front whether this opening is one the user just asked for
 * @returns {DevWindow}
 */
function mount(root, front) {
  const layer = windowLayer(root);
  const bounds = layer.getBoundingClientRect();

  const el = document.createElement("section");
  el.className = "window window--desk window--dev";
  const geometry = openingGeometry(
    el,
    loadPresentation(localStore(), DEV_STORAGE_KEY),
    bounds,
    phone,
    devDefaultBox,
  );

  const content = document.createElement("div");
  content.className = "desk-window__content";
  content.append(devPanelBody());
  el.append(content);
  layer.append(el);

  const win = new AlunaWindow(el, {
    title: DEV_WINDOW_TITLE,
    seed: Math.floor(Math.random() * 9000) + 10,
    shadowAlpha: WALL_SHADOW,
  });

  /* Counted rather than fixed: a panel closed and reopened while the capability
   * window is still standing must not arrive carrying an id already on the page. */
  titleCount += 1;
  win.titleEl.id = `aluna-dev-title-${titleCount}`;
  el.setAttribute("aria-labelledby", win.titleEl.id);

  /** @type {DevWindow} */
  const entry = { win, el, layer, ...geometry, gestures: false, openedBy: null };

  addLamps(entry);
  syncMaximiseLamp(entry);
  syncDevForm(entry, phone);
  joinStack(entry, front);
  el.addEventListener("pointerdown", () => raise(entry));
  return entry;
}

/**
 * @param {DevWindow} entry
 */
function addLamps(entry) {
  entry.el.addEventListener("window:lamp", (event) => {
    const { action } = /** @type {CustomEvent<{ action?: string }>} */ (event).detail;
    if (action === "maximise") toggleMaximise(entry);
    /* The clay lamp is the one put-away action, exactly as it is for a capability
     * window — and unlike one, it changes no address, because the panel was never in
     * the address to leave. Pressing the tile again focuses; only this closes. */
    if (action === "putaway") closePanel();
  });
}

/** @param {DevWindow} entry */
function syncMaximiseLamp(entry) {
  const lamp = entry.el.querySelector('.lamp[data-action="maximise"]');
  lamp?.setAttribute("aria-pressed", entry.maximised ? "true" : "false");
}

/** @param {DevWindow} entry */
function toggleMaximise(entry) {
  if (phone) return;
  entry.maximised = !entry.maximised;
  setMaximised(entry.el, entry.box, entry.maximised);
  refit(entry);
  syncMaximiseLamp(entry);
  remember();
}

/**
 * Tell the panel which form it is in — the capability window's rule, applied to the
 * second window.
 *
 * Deliberately its own copy rather than the capability window's `syncForm`: that one
 * binds gestures whose finished drag is remembered under the *capability* window's key,
 * and a panel that quietly wrote its box into the other window's record would strand
 * both. One implementation of a window, two records, and each window writes only its
 * own.
 *
 * @param {DevWindow} entry
 * @param {boolean} isPhone
 */
export function syncDevForm(entry, isPhone) {
  entry.el.querySelector('.lamp[data-action="maximise"]')?.toggleAttribute("hidden", isPhone);
  if (!isPhone) bindGestures(entry);
  entry.win.bar.classList.toggle("window__bar--draggable", !isPhone);
}

/** @param {DevWindow} entry */
function bindGestures(entry) {
  if (entry.gestures) return;
  entry.gestures = true;
  const host = {
    el: entry.el,
    box: entry.box,
    bounds: () => entry.layer.getBoundingClientRect(),
    standDown: () => entry.maximised || phone,
    onEnd: () => remember(),
  };
  addWindowGrip(host);
  addWindowDrag(entry.win.bar, host);
}

/* ── opening, focusing and putting away ────────────────────────────────────── */

/**
 * Open the panel, or bring it to the front if it is already up.
 *
 * The tile is not a toggle. A second press on an open panel focuses it, which is what
 * every desk does and what a developer pressing it while reading a build actually
 * wants; the clay lamp is the one way it goes away. That is the same contract the
 * capability window's logo keeps.
 *
 * @param {ParentNode} [root]
 * @param {Element | null} [openedBy]
 * @param {boolean} [front] false only for the panel restored from a remembered
 *   preference on load, which nobody asked for on this visit
 * @returns {DevWindow}
 */
export function openPanel(root = document, openedBy = null, front = true) {
  if (mounted) {
    raise(mounted);
    return mounted;
  }
  mounted = mount(root, front);
  mounted.openedBy = openedBy;
  replayStages(mounted);
  rememberOpen(true);
  return mounted;
}

/** Take the panel down, keeping its box and marking it closed for next load. */
export function closePanel() {
  const entry = mounted;
  if (!entry) return false;
  rememberOpen(false);
  mounted = null;
  leaveStack(entry);
  entry.win.destroy();
  entry.el.remove();
  const opener = entry.openedBy;
  if (opener && "focus" in opener && opener.isConnected) {
    /** @type {HTMLElement} */ (opener).focus();
  }
  return true;
}

/** @param {DevWindow} entry */
function replayStages(entry) {
  for (const [key, payload] of stages) writeStage(entry.el, key, payload);
}

/* ── what the panel shows ──────────────────────────────────────────────────── */

/**
 * File a stage's payload, whether or not there is a panel to show it in.
 *
 * @param {string} key
 * @param {string} payload
 */
export function recordStage(key, payload) {
  stages.set(key, payload);
  if (mounted) writeStage(mounted.el, key, payload);
}

/** A new build: nothing kept, and any open panel back to resting. */
export function clearRecordedStages() {
  stages.clear();
  if (mounted) clearStages(mounted.el);
}

/**
 * The stages the served page already knew — lifecycle metrics and committed versions,
 * which are what the platform has already done rather than anything a stream will say.
 * Taken off the page once, at start, so a refresh finds the panel carrying the same
 * history it had before (`src/web/cached-view.ts`).
 *
 * An empty seed is skipped rather than filed: a desk with nothing behind it should show
 * a resting stage, not an empty payload dressed as one.
 *
 * @param {ParentNode} root
 */
export function seedStagesFromPage(root) {
  for (const node of root.querySelectorAll(DEV_SEED_SELECTOR)) {
    const stage = node instanceof HTMLElement ? node.dataset.devStageSeed : undefined;
    const payload = node.textContent?.trim();
    if (stage && payload) recordStage(stage, payload);
  }
}

/* ── the desk changing size ────────────────────────────────────────────────── */

/**
 * The panel answers a resize the way the capability window does: the screen is clamped
 * every tick, and the record is written only where the user authored something — here,
 * the moment a phone becomes a desk again. A clamp is not a preference.
 *
 * @param {ParentNode} root
 */
function watchViewport(root) {
  if (watching) return;
  watching = true;
  const media = window.matchMedia(PHONE);

  const onResize = () => {
    const was = phone;
    phone = media.matches;
    if (mounted) {
      const wasSized = mounted.sized;
      syncDevForm(mounted, phone);
      refit(mounted);
      /* Two authored moments, and no others. A phone becoming a desk is the user
       * changing the form the panel is in; the desk arriving at a real size for the
       * first time is the first moment the box on screen is a box at all, and the
       * one that finally makes the remembered flag safe to write beside it. */
      if (was !== phone || (!wasSized && mounted.sized)) remember();
    }
  };

  media.addEventListener("change", onResize);
  window.addEventListener("resize", onResize);
  onResize();
  new ResizeObserver(onResize).observe(/** @type {Element} */ (windowLayer(root)));
}

/* ── wiring ────────────────────────────────────────────────────────────────── */

/**
 * @param {ParentNode & { addEventListener: Document["addEventListener"] }} root
 */
export function startDeskDevPanel(root = document) {
  watchViewport(root);
  seedStagesFromPage(root);

  root.addEventListener("click", (event) => {
    const { target } = event;
    if (!(target instanceof Element)) return;
    const tile = target.closest(DEV_TILE_SELECTOR);
    if (tile !== null) openPanel(root, tile);
  });

  root.addEventListener(STAGE_PAYLOAD_EVENT, (event) => {
    const detail = /** @type {CustomEvent<{ stage?: string, payload?: string }>} */ (event).detail;
    if (typeof detail?.stage === "string" && typeof detail.payload === "string") {
      recordStage(detail.stage, detail.payload);
    }
  });

  root.addEventListener(STAGES_CLEARED_EVENT, () => clearRecordedStages());

  /* Restored rather than opened, so it stands behind the capability the address
   * names. Nobody asked for the panel on this visit; the URL asked for that. */
  if (storedOpenFlag(localStore())) {
    openPanel(root, root.querySelector(DEV_TILE_SELECTOR), false);
  }
}

/* Guarded the way every other browser module here is: Bun has no `document`, so the
 * module can be imported by a test for what it exports without starting a desk. */
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => startDeskDevPanel(document), {
      once: true,
    });
  } else {
    startDeskDevPanel(document);
  }
}
