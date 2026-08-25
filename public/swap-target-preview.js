// @ts-check

/**
 * The developer preview's client half: the shipped swap-target guard, driven against a
 * region the page can put away on demand.
 *
 * A real build's stream is closed by the same teardown that removes its region, so the
 * residual case this guards is one a real page will almost never reach — which is exactly
 * why it needs a surface where it can be reached on purpose. The subscriber below carries
 * the same `sse-swap` listeners the server renders, and an `EventTarget` stands in for the
 * `EventSource`, because the guard only ever asked its source for `addEventListener`.
 *
 * htmx is loaded on this page for one reason: the guard resolves a target by asking htmx
 * where the swap would land, so a preview without it would be exercising a different rule
 * from the shipped one.
 */

import {
  guardSwapTargets,
  htmxSwapTargetResolver,
  MISSING_SWAP_TARGET_EVENT,
} from "./swap-target.js";

const host = document.querySelector("[data-preview-host]");
const readout = document.querySelector("[data-preview-readout]");

/** @type {EventTarget | null} */
let source = null;
/** @type {Element | null} */
let connection = null;
/** @type {string | null} */
let raisedThisDelivery = null;

/** @param {string} line */
function write(line) {
  if (!(readout instanceof HTMLElement)) return;
  readout.textContent = `${readout.textContent ?? ""}${line}\n`;
}

function mountRegion() {
  if (!(host instanceof HTMLElement)) return;
  host.innerHTML = [
    '<section class="build-stream" data-build-job-id="preview" data-content-region="preview region"',
    '  sse-connect="/demo/swap-targets/stream" sse-close="done">',
    '  <div class="build-stream__fragment" sse-swap="fragment" hx-swap="beforeend"></div>',
    '  <div class="build-stream__commit" sse-swap="commit" hx-swap="innerHTML"></div>',
    "</section>",
  ].join("\n");

  connection = host.querySelector("[sse-connect]");
  source = new EventTarget();
  if (connection !== null) guardSwapTargets(connection, source, htmxSwapTargetResolver());
  write("The region is on screen. Its commit and fragment listeners are guarded.");
}

/** @param {string} eventName */
function deliver(eventName) {
  if (source === null) return;
  raisedThisDelivery = null;
  source.dispatchEvent(new Event(eventName));
  write(
    raisedThisDelivery === null
      ? `${eventName}: found its named target — the swap has somewhere to land.`
      : `${eventName}: RAISED — ${raisedThisDelivery}`,
  );
}

document.addEventListener(MISSING_SWAP_TARGET_EVENT, (event) => {
  const error = /** @type {CustomEvent<{ error?: unknown }>} */ (event).detail?.error;
  raisedThisDelivery = error instanceof Error ? error.message : String(error);
});

// The announcement is the readable half; this is the proof it is a real throw and not a
// logged string — it escapes the listener to the page's own error handler.
window.addEventListener("error", (event) => write(`uncaught in the page: ${event.message}`));

document.addEventListener("click", (event) => {
  const trigger = event.target;
  if (!(trigger instanceof Element)) return;

  const deliverable = trigger.closest("[data-preview-deliver]");
  if (deliverable instanceof HTMLElement) {
    deliver(deliverable.dataset.previewDeliver ?? "");
    return;
  }
  if (trigger.closest("[data-preview-away]") !== null) {
    if (host instanceof HTMLElement) host.replaceChildren();
    write("The region was put away. The guard and its source are still listening.");
    return;
  }
  if (trigger.closest("[data-preview-back]") !== null) mountRegion();
});

mountRegion();
