// @ts-check

/**
 * The answer window — the third window, and the second exception to there being one (ADR-0008,
 * PLAN decisions 21, 25). It opens when a sentence turns out to be a question, and it displaces
 * nothing: the capability being asked about stays open and stays itself, which is the whole
 * reason an answer is a window rather than something anchored to the prompt bar.
 *
 * It is the one window that remembers nothing. No box is stored, no tile or address names it,
 * and its clay lamp dismisses rather than puts away — put away means the logo brings it back,
 * and closing this destroys the answer. The frame is never closed between questions either: a
 * second question replaces what it holds, so it stays where the user left it without anything
 * having been written down.
 */

import {
  fitToDesk,
  PHONE,
  PROMPT_CLEARANCE,
  placeWindow,
  refreshGeometry,
} from "../design/scripts/desk-geometry.js";
import { AlunaWindow } from "../design/scripts/window.js";
import { addWindowDrag, addWindowGrip, setMaximised } from "../design/scripts/window-gestures.js";
import { joinStack, leaveStack, raise, raiseFromPress } from "./desk-stack.js";
import { fitBox, openingGeometry, PROMPT_FORM_ID, windowLayer } from "./desk-window.js";

/**
 * The desk being told a sentence turned out to be a question: what to call the window, and what
 * Aluna says while she has not looked yet. Restated in `public/app.js`, a classic script that can
 * import nothing, and pinned by a platform test.
 */
export const OPEN_THE_ANSWER_WINDOW_EVENT = "aluna:open-the-answer-window";

/** What the clay lamp is called here. A capability window is put away and comes back; this is not. */
export const ANSWER_DISMISS_LABEL = "Dismiss";

/** What marks an answer window among the three, the way `window--dev` marks the panel. */
export const ANSWER_WINDOW_CLASS = "window--answer";
export const ANSWER_WINDOW_SELECTOR = `.${ANSWER_WINDOW_CLASS}`;

/** Where an answer's words go. Live, because an answer arrives without anyone looking for it. */
export const ANSWER_BODY_CLASS = "desk-window__answer";
export const ANSWER_BODY_SELECTOR = `.${ANSWER_BODY_CLASS}`;

/** Over a wallpaper, a window carries its shadow at 40% rather than 24%. */
const WALL_SHADOW = 0.4;

/**
 * How much of the desk an answer takes when it first opens: centred, and smaller than a
 * capability window's own first box, because it is about what is standing there. Where either
 * window has been dragged since is the user's business. An answer is prose, so the width is a
 * measure to read a sentence across rather than room for a list.
 */
const ANSWER_FILL = { w: 0.44, h: 0.4 };

/** Nothing is remembered, so every answer window opens on the box this desk computes for it. */
const NOTHING_REMEMBERED = Object.freeze({ box: null, max: false });

/** @typedef {import("../design/scripts/desk-geometry.js").Box} Box */
/** @typedef {import("../design/scripts/window-gestures.js").StoredBox} StoredBox */

/**
 * @typedef {{ win: AlunaWindow, el: HTMLElement, layer: HTMLElement, body: HTMLElement,
 *             box: StoredBox, maximised: boolean, sized: boolean,
 *             first: (bounds: DOMRect) => Box, gestures: boolean }} AnswerWindow
 */

/** The one answer window, or nothing. A second is never created. @type {AnswerWindow | null} */
let mounted = null;
/** Whether the desk is below the breakpoint right now. */
let phone = false;
/** Bound once, however many times an answer window opens and is dismissed. */
let watching = false;
let titleCount = 0;

/**
 * The answer's first box on a desk this size: centred on the room above the prompt bar's floor,
 * the same floor the logo grid and the other two windows stop on.
 *
 * @param {DOMRect} bounds
 * @returns {Box}
 */
export function answerDefaultBox(bounds) {
  refreshGeometry();
  const floor = bounds.height - PROMPT_CLEARANCE;
  const w = Math.round(bounds.width * ANSWER_FILL.w);
  const h = Math.round(floor * ANSWER_FILL.h);
  return fitToDesk(bounds, {
    x: Math.round((bounds.width - w) / 2),
    y: Math.round((floor - h) / 2),
    w,
    h,
  });
}

/* ── the window ────────────────────────────────────────────────────────────── */

/** Fit the answer to the desk as it is right now, and put it there. @param {AnswerWindow} entry */
function refit(entry) {
  if (fitBox(entry, entry.layer.getBoundingClientRect(), phone)) {
    placeWindow(entry.el, entry.box);
  }
}

/**
 * Build the window: the same frame, lamps and gestures the other two have, so the exception
 * cannot drift into a second kind of thing. Untitled here — the question names it.
 *
 * @param {ParentNode} root
 * @returns {AnswerWindow}
 */
function mount(root) {
  const layer = windowLayer(root);
  const bounds = layer.getBoundingClientRect();

  const el = document.createElement("section");
  el.className = `window window--desk ${ANSWER_WINDOW_CLASS}`;
  const geometry = openingGeometry(el, NOTHING_REMEMBERED, bounds, phone, answerDefaultBox);

  const content = document.createElement("div");
  content.className = "desk-window__content";
  const body = document.createElement("div");
  body.className = ANSWER_BODY_CLASS;
  body.setAttribute("aria-live", "polite");
  content.append(body);
  el.append(content);
  layer.append(el);

  const win = new AlunaWindow(el, {
    title: "",
    seed: Math.floor(Math.random() * 9000) + 10,
    shadowAlpha: WALL_SHADOW,
  });

  /* Counted rather than fixed: an answer window dismissed and opened again while either of the
   * other two is standing must not arrive carrying an id already on the page. */
  titleCount += 1;
  win.titleEl.id = `aluna-answer-title-${titleCount}`;
  el.setAttribute("aria-labelledby", win.titleEl.id);

  /** @type {AnswerWindow} */
  const entry = { win, el, layer, body, ...geometry, gestures: false };

  addLamps(entry);
  nameTheClayLamp(entry);
  syncMaximiseLamp(entry);
  syncAnswerForm(entry, phone);
  joinStack(entry);
  el.addEventListener("pointerdown", (event) => raiseFromPress(entry, event), true);
  return entry;
}

/**
 * The clay lamp says what it does. `AlunaWindow` reads this back whenever the title changes, so
 * the word is fixed before the question arrives and every later naming keeps it. The action stays
 * the frame's own `putaway` — it names which of the two lamps was pressed, not what pressing it
 * means — so the vocabulary lives in what a person reads and hears, which is all three of them.
 *
 * @param {AnswerWindow} entry
 */
function nameTheClayLamp(entry) {
  const lamp = entry.el.querySelector('.lamp[data-action="putaway"]');
  if (!(lamp instanceof HTMLElement)) return;
  lamp.dataset.lampLabel = ANSWER_DISMISS_LABEL;
  lamp.title = ANSWER_DISMISS_LABEL;
}

/** @param {AnswerWindow} entry */
function addLamps(entry) {
  entry.el.addEventListener("window:lamp", (event) => {
    const { action } = /** @type {CustomEvent<{ action?: string }>} */ (event).detail;
    if (action === "maximise") toggleMaximise(entry);
    if (action === "putaway") dismissAnswerWindow();
  });
}

/** @param {AnswerWindow} entry */
function syncMaximiseLamp(entry) {
  const lamp = entry.el.querySelector('.lamp[data-action="maximise"]');
  lamp?.setAttribute("aria-pressed", entry.maximised ? "true" : "false");
}

/** @param {AnswerWindow} entry */
function toggleMaximise(entry) {
  if (phone) return;
  entry.maximised = !entry.maximised;
  setMaximised(entry.el, entry.box, entry.maximised);
  refit(entry);
  syncMaximiseLamp(entry);
}

/**
 * Tell the window which form it is in. Its own copy rather than `syncForm`, whose gestures write
 * a finished drag under the capability window's key — and this one writes nowhere at all.
 *
 * @param {AnswerWindow} entry
 * @param {boolean} isPhone
 */
export function syncAnswerForm(entry, isPhone) {
  entry.el.querySelector('.lamp[data-action="maximise"]')?.toggleAttribute("hidden", isPhone);
  if (!isPhone) bindGestures(entry);
  entry.win.bar.classList.toggle("window__bar--draggable", !isPhone);
}

/** @param {AnswerWindow} entry */
function bindGestures(entry) {
  if (entry.gestures) return;
  entry.gestures = true;
  /* No `onEnd`: a finished drag is worth remembering only where there is a record to write it
   * into, and this window has none. The box it is left at is simply where it still is.
   *
   * `onStart` is not optional here: the grip stops its own `pointerdown` propagating, so without
   * it the window you are actively resizing stays behind the one you are not. */
  const host = {
    el: entry.el,
    box: entry.box,
    bounds: () => entry.layer.getBoundingClientRect(),
    standDown: () => entry.maximised || phone,
    onStart: () => raise(entry),
  };
  addWindowGrip(host);
  addWindowDrag(entry.win.bar, host);
}

/* ── opening and dismissing ────────────────────────────────────────────────── */

/**
 * Open the answer window for a question, or hand the standing one the new question. The frame is
 * never closed and reopened between questions (PLAN decision 25): only what it holds changes, so
 * a window the user dragged or resized is exactly where and as they left it.
 *
 * @param {ParentNode} [root]
 * @param {string} [question] what the window is called
 * @param {string} [saying] what Aluna says while she has not looked yet
 * @returns {AnswerWindow}
 */
export function openAnswerWindow(root = document, question = "", saying = "") {
  const fresh = mounted === null;
  mounted ??= mount(root);
  const entry = mounted;
  entry.win.setTitle(question);
  /* Raised before it is written into, not after: below the breakpoint a window that is not in
   * front is out of the page, and a live region mutated while it is hidden is a sentence nobody
   * hears. It is also what the user just asked for, so the front is where it belongs. */
  raise(entry);
  /* A live region announces what changes in it, never what it was built holding — the same rule
   * `prompt-bar.js` keeps for the sentence the page arrives with. So the first answer window's
   * words are written in a later task than the one that built the region to hold them.
   *
   * A task and not a frame: a question asked and then left for another tab paints no frames at
   * all, and `requestAnimationFrame` would leave that answer window blank until it was looked at. */
  const say = () => {
    if (mounted === entry) entry.body.textContent = saying;
  };
  if (fresh) setTimeout(say);
  else say();
  return entry;
}

/**
 * The user closing the answer, and the only way it goes away. The answer goes with the window and
 * there is no logo, tile or address that could bring it back.
 *
 * @returns {boolean} whether there was an answer window to dismiss
 */
export function dismissAnswerWindow() {
  const entry = mounted;
  if (!entry) return false;
  mounted = null;
  leaveStack(entry);
  entry.win.destroy();
  entry.el.remove();
  /* Focus goes back to the bar rather than to `<body>`: a question is what opened this, the way a
   * logo opens a capability window, and the bar is where the next one is typed. It is empty by
   * now — the run's ending woke it and cleared it — so there are no words to keep. Whichever of
   * its controls can take focus: `focus()` on a disabled one is a no-op, and a build disables
   * both, which is the case 6.5/04 removes. */
  const bar = document.getElementById(PROMPT_FORM_ID);
  const control = bar?.querySelector("input:not(:disabled), button:not(:disabled)");
  if (control instanceof HTMLElement && control.isConnected) control.focus();
  return true;
}

/* ── the desk changing size ────────────────────────────────────────────────── */

/**
 * The answer answers a resize the way the other two windows do, minus the half that writes a
 * record: the screen is clamped every tick and nothing is ever remembered.
 *
 * @param {HTMLElement} layer
 */
function watchViewport(layer) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  /* Three subscriptions with no way off them, so they are taken once, the way the other two
   * windows take theirs. The product starts each desk module exactly once. */
  if (watching) return;
  watching = true;
  const media = window.matchMedia(PHONE);

  const onResize = () => {
    refreshGeometry();
    phone = media.matches;
    if (!mounted) return;
    syncAnswerForm(mounted, phone);
    refit(mounted);
  };

  media.addEventListener("change", onResize);
  window.addEventListener("resize", onResize);
  if (typeof ResizeObserver === "function") new ResizeObserver(onResize).observe(layer);
  onResize();
}

/* ── wiring ────────────────────────────────────────────────────────────────── */

/**
 * @param {ParentNode & { addEventListener: Document["addEventListener"] }} root
 */
export function startDeskAnswerWindow(root = document) {
  /* Demanded first, and before a single listener is bound: a shell shipped without a window layer
   * must fail where it can be seen, not leave a question answered by nothing at all. */
  const layer = windowLayer(root);

  root.addEventListener(OPEN_THE_ANSWER_WINDOW_EVENT, (event) => {
    const detail = /** @type {CustomEvent<{ question?: string, saying?: string }>} */ (event)
      .detail;
    if (typeof detail?.question !== "string") return;
    openAnswerWindow(root, detail.question, detail.saying ?? "");
  });

  watchViewport(layer);
}

/* Guarded the way every other browser module here is: Bun has no `document`, so the
 * module can be imported by a test for what it exports without starting a desk. */
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => startDeskAnswerWindow(document), {
      once: true,
    });
  } else {
    startDeskAnswerWindow(document);
  }
}
