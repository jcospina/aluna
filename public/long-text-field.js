// The two behaviours a declared form intent asks of a text control: a multi-line box that
// grows with what is typed, and a character counter under a field that declared a limit.
//
// Ported from `design/scripts/controls-main.js`, which is the contract for both. The port adds
// how a control is found: the design page boots once over static markup, and this surface swaps
// forms in constantly — htmx lands them, `record-view.js` clones one out of a `<template>`, and
// three modules assign `region.innerHTML`. None announce the same event and only one announces
// any, so what a control waits for is entering the document (as in `choice-picker.js`).
//
// Neither behaviour is the limit. `max_length` reaches `maxlength` (which stops the typing),
// `data-length-limit` (which this counts down from) and the server's mutation validation (which
// refuses anything longer however it arrived). This script only says what is left.

import { characterCountSentence } from "./character-count.js";
import { watchArrivals } from "./dom-arrivals.js";
import { registerRegionRelease } from "./region-scope.js";

const GROW_SELECTOR = "textarea[data-grow]";
const COUNT_SELECTOR = "[data-length-limit][data-length-counter]";
const MOUNT_SELECTOR = `${GROW_SELECTOR}, ${COUNT_SELECTOR}`;

/**
 * Grow to fit, then scroll. There is no resize grip: a textarea's own grip is drawn by the OS
 * and would be the only mark on this surface that is not ours.
 *
 * @param {HTMLTextAreaElement} area
 */
function grow(area) {
  const max = Number(area.dataset.growMax ?? 0);
  area.style.height = "auto";
  const wanted = area.scrollHeight;
  // An element with no layout — a create form in an unopened panel — answers 0 to every
  // measurement, and writing 0 leaves a control nobody can click into; `watchLayout` waits.
  if (wanted === 0) {
    area.style.height = "";
    area.style.overflowY = "";
    return;
  }
  const capped = max > 0 ? Math.min(wanted, max) : wanted;
  area.style.height = `${capped}px`;
  area.style.overflowY = capped < wanted ? "auto" : "hidden";
}

/**
 * Re-measure when the control's own box changes width: a field mounted with no layout gets one
 * when the create panel opens, and a narrowed window re-wraps text into a different height.
 *
 * @param {HTMLTextAreaElement} area
 * @param {() => void} refresh
 */
function watchLayout(area, refresh) {
  const Observer = area.ownerDocument.defaultView?.ResizeObserver;
  if (!Observer) return;
  // Width, not height: the height is what `grow` writes, so reacting to it would loop.
  let lastWidth = -1;
  const observer = new Observer(() => {
    if (area.clientWidth === lastWidth) return;
    lastWidth = area.clientWidth;
    refresh();
  });
  observer.observe(area);
  // Released with the control (decision 13): one observer per textarea is minted on every record
  // view and collection swap, and nothing else would ever disconnect them.
  registerRegionRelease(area, "long-text layout watch", () => observer.disconnect());
}

export { characterCountSentence } from "./character-count.js";

/**
 * @param {HTMLInputElement | HTMLTextAreaElement} control
 * @returns {() => void} the repaint, so the mount can run it once immediately
 */
function counterFor(control) {
  const limit = Number(control.dataset.lengthLimit ?? 0);
  const outputId = control.dataset.lengthCounter ?? "";
  const out = control.ownerDocument.getElementById(outputId);
  // A control that names a counter it does not have is a rendering bug, not a state this
  // should paper over: it says so and leaves the field working.
  if (!(out instanceof HTMLElement) || !Number.isFinite(limit) || limit <= 0) {
    throw new Error(`Length counter "${outputId}" is missing or its limit is not a number.`);
  }
  return () => {
    const used = control.value.length;
    out.textContent = characterCountSentence(limit, used);
    out.classList.toggle("is-over", used > limit);
  };
}

/**
 * Wire one control up, and paint it once.
 *
 * @param {HTMLInputElement | HTMLTextAreaElement} control
 */
function mountControl(control) {
  const paint = control.dataset.lengthLimit ? counterFor(control) : undefined;
  const growing = control instanceof HTMLTextAreaElement && control.dataset.grow !== undefined;
  const refresh = () => {
    if (control instanceof HTMLTextAreaElement && growing) grow(control);
    paint?.();
  };
  control.addEventListener("input", refresh);
  // A form reset restores values without firing `input`, and fires before the values are put
  // back, which is why the repaint waits a turn.
  control.form?.addEventListener("reset", () => {
    setTimeout(refresh, 0);
  });
  if (control instanceof HTMLTextAreaElement && growing) watchLayout(control, refresh);
  refresh();
}

/**
 * Every unmounted control under `root`, plus `root` itself when it is one: the arrival watch
 * hands over the node that landed, and `querySelectorAll` answers about descendants only.
 *
 * @param {Document | Element} root
 * @returns {(HTMLInputElement | HTMLTextAreaElement)[]}
 */
function unmountedControls(root) {
  const found = [...root.querySelectorAll(MOUNT_SELECTOR)];
  if (root instanceof Element && root.matches(MOUNT_SELECTOR)) found.unshift(root);
  /** @type {(HTMLInputElement | HTMLTextAreaElement)[]} */
  const controls = [];
  for (const control of found) {
    if (!(control instanceof HTMLInputElement) && !(control instanceof HTMLTextAreaElement)) {
      continue;
    }
    if (!control.dataset.longTextMounted) controls.push(control);
  }
  return controls;
}

/**
 * Mount every control under `root` that is not already mounted.
 *
 * @param {Document | Element} root
 * @returns {number} how many were mounted
 */
export function mountLongTextFields(root) {
  let mounted = 0;
  for (const control of unmountedControls(root)) {
    mountControl(control);
    // Flagged after, not before: a control that refuses would otherwise be marked as
    // mounted on its way out and never be offered a script again.
    control.dataset.longTextMounted = "true";
    mounted += 1;
  }
  return mounted;
}

/** @param {Document} root */
export function startLongTextFields(root) {
  /** @param {readonly Element[]} nodes */
  const arrived = (nodes) => {
    /** @type {unknown} */
    let refusal;
    for (const node of nodes) {
      // One refusal must not take down every other form that landed in the same batch,
      // so the batch finishes and then reports.
      try {
        mountLongTextFields(node);
      } catch (error) {
        refusal ??= error;
      }
    }
    if (refusal !== undefined) throw refusal;
  };

  // The watch is installed before the first scan: a refusal in the opening pass propagates out
  // of here, and an unarmed observer would leave every later form with no script.
  watchArrivals(root, arrived);
  arrived([root.documentElement]);
}

if (typeof document !== "undefined") startLongTextFields(document);
