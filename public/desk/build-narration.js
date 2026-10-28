// @ts-check
/**
 * A build's narration in its window. Every `progress` fact the build sends is drawn by the design
 * system's narrator inside the run's narration region, in place of a swap. A run that lands holds
 * its finished drawing and last line for a moment before the window turns into what it made, and
 * a run that ends without landing stops the narration where it stood, its ending in the line.
 */

import { Narrator } from "../../design/scripts/narration/narrator.js";

const NARRATION_SELECTOR = ".build-stream__narration";
const COMMIT_SELECTOR = ".build-stream__commit";
const SUBSCRIBER_SELECTOR = ".build-stream";
/** A failure's ending (`renderBuildEnding`): every ending but "nothing to change" is one. */
const FAILED_ENDING_SELECTOR = '[data-build-ending="failed"]';
const BOOKENDING_CLASS = "is-bookending";

/** The event `app.js` asks before it places a finished run, so the run can still be read. */
export const RUN_CLOSING_EVENT = "aluna:run-closing";

/** How long a landed run's last line stays before its window becomes what it made. */
const HOLD_MS = 1600;

/** @type {WeakMap<Element, Narrator>} */
const narrators = new WeakMap();

/** @type {WeakSet<Narrator>} narrators whose run landed or said its last words */
const settled = new WeakSet();

/** @type {WeakMap<Element, number>} when each landed run may be placed */
const holdUntil = new WeakMap();

/** @param {HTMLElement} region */
function narratorFor(region) {
  const known = narrators.get(region);
  if (known) return known;
  const narrator = new Narrator(region);
  narrators.set(region, narrator);
  return narrator;
}

/**
 * The SSE message an `htmx:sseBeforeMessage` or `htmx:sseMessage` carries.
 *
 * @param {Event} event
 * @returns {MessageEvent | undefined}
 */
const messageOf = (event) => /** @type {CustomEvent<MessageEvent>} */ (event).detail;

/** @param {Event} event */
function drawFact(event) {
  const region = event.target;
  const message = messageOf(event);
  if (!(region instanceof HTMLElement) || message?.type !== "progress") return;
  if (!region.matches(NARRATION_SELECTOR)) return;
  event.preventDefault();
  try {
    narratorFor(region).take(JSON.parse(message.data));
  } catch (error) {
    // A fact the window cannot read leaves the drawing where it was; the run itself goes on.
    console.error("Aluna narration could not read a progress fact:", error);
  }
}

/** @param {Event} event */
function hearLastWords(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const type = messageOf(event)?.type;
  const narrator = narrators.get(target);
  if (narrator && type === "narration") {
    narrator.conclude(target.querySelector(FAILED_ENDING_SELECTOR) !== null);
    settled.add(narrator);
  }
  if (type !== "commit" || !target.matches(COMMIT_SELECTOR)) return;
  const run = target.closest(SUBSCRIBER_SELECTOR);
  const region = run?.querySelector(NARRATION_SELECTOR);
  const landed = region ? narrators.get(region) : undefined;
  if (!run || !landed) return;
  run.classList.add(BOOKENDING_CLASS);
  landed.ready();
  settled.add(landed);
  holdUntil.set(run, performance.now() + HOLD_MS);
  // The hold ends on its own, so a stream that stalls before it closes still shows what landed.
  setTimeout(() => run.classList.remove(BOOKENDING_CLASS), HOLD_MS);
}

/**
 * A run closing. One that landed is placed once its hold is over; one that went without a last
 * word (a dropped stream, a cancel) stops narrating where it stood.
 *
 * @param {Event} event
 */
function closeRun(event) {
  const detail = /** @type {CustomEvent<{ run: EventTarget | null, until?: Promise<void> }>} */ (
    event
  ).detail;
  const run = detail.run instanceof Element ? detail.run.closest(SUBSCRIBER_SELECTOR) : null;
  if (!run) return;
  const region = run.querySelector(NARRATION_SELECTOR);
  const narrator = region ? narrators.get(region) : undefined;
  if (narrator && !settled.has(narrator)) narrator.stop();
  const until = holdUntil.get(run);
  if (until === undefined) return;
  holdUntil.delete(run);
  detail.until = new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, until - performance.now()));
  });
}

/** @param {Pick<Document, "addEventListener">} page */
export function startBuildNarration(page) {
  page.addEventListener("htmx:sseBeforeMessage", drawFact);
  page.addEventListener("htmx:sseMessage", hearLastWords);
  page.addEventListener(RUN_CLOSING_EVENT, closeRun);
}

if (typeof document !== "undefined") startBuildNarration(document);
