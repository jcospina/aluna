// The two behaviours a declared form intent asks of a text control: a multi-line box that
// grows with what is typed, and a character counter under a field that declared a limit.
//
// Ported from `design/scripts/controls-main.js`, which is the contract for both. The one
// thing the port adds is how a control is found: the design page boots once over static
// markup, and this surface swaps forms in constantly — htmx lands them, `record-view.js`
// clones a record view out of a `<template>` itself, and three modules assign
// `region.innerHTML` outright. None of those announce the same event, and only one of them
// announces any. What a control actually waits for is entering the document, which is what
// an observer reports whoever put it there — the same conclusion `choice-picker.js` reached
// and for the same reasons.
//
// Neither behaviour is the limit. The limit is `max_length` on the field, and the server
// writes it into `maxlength` (which stops the typing), into `data-length-limit` (which this
// counts down from) and into its own mutation validation (which refuses anything longer
// however it arrived). This script only says what is left.

const GROW_SELECTOR = "textarea[data-grow]";
const COUNT_SELECTOR = "[data-length-limit][data-length-counter]";
const MOUNT_SELECTOR = `${GROW_SELECTOR}, ${COUNT_SELECTOR}`;

/**
 * Grow to fit, then scroll. There is no resize grip: a textarea's own grip is drawn by the
 * operating system and would be the only mark on this surface that is not ours, and
 * dragging a box to fit text already written is work the box can do itself.
 *
 * @param {HTMLTextAreaElement} area
 */
function grow(area) {
  const max = Number(area.dataset.growMax ?? 0);
  area.style.height = "auto";
  const wanted = area.scrollHeight;
  // Nothing to measure. An element with no layout — a create form still inside the panel
  // that has not been opened — answers 0 to every measurement, and writing that answer
  // sets the height to zero and leaves it there once the panel does open: a control that
  // looks like an empty single-line input and cannot be clicked into. Leave the height to
  // the `rows` the server wrote, and wait to be told there is a box (see `watchLayout`).
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
 * Re-measure when the control's own box changes width.
 *
 * Two things need this and neither is a keystroke. A field mounted with no layout has to be
 * measured again the moment it gets one, which is when the create panel opens. And a width
 * change re-wraps the text, so the height it needs is a different height — a window
 * narrowed after typing would otherwise clip what is already written.
 *
 * Width, not height: the height is what `grow` itself writes, and reacting to that is the
 * loop this avoids by comparing.
 *
 * @param {HTMLTextAreaElement} area
 * @param {() => void} refresh
 */
function watchLayout(area, refresh) {
  const Observer = area.ownerDocument.defaultView?.ResizeObserver;
  if (!Observer) return;
  let lastWidth = -1;
  new Observer(() => {
    if (area.clientWidth === lastWidth) return;
    lastWidth = area.clientWidth;
    refresh();
  }).observe(area);
}

/**
 * The counter's words. The server paints the identical sentence for the field's opening
 * value (`src/presentation/field-chrome.ts`), so the first frame and every one after agree.
 *
 * Lengths are UTF-16 code units, which is what `maxlength` counts and what the server
 * enforces — the number counted down to is the number refused past.
 *
 * @param {number} limit
 * @param {number} used
 * @returns {string}
 */
export function characterCountSentence(limit, used) {
  const left = limit - used;
  if (left < 0) return `${-left} over the limit`;
  return `${left} character${left === 1 ? "" : "s"} left`;
}

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
  // A form reset restores values without firing `input`, so both behaviours would be left
  // describing text that is no longer there. The event fires *before* the values are put
  // back, which is why the repaint waits a turn.
  control.form?.addEventListener("reset", () => {
    setTimeout(refresh, 0);
  });
  if (control instanceof HTMLTextAreaElement && growing) watchLayout(control, refresh);
  refresh();
}

/**
 * Every unmounted control under `root`, plus `root` itself when it is one.
 *
 * The arrival watch hands this the node that landed, which is as often the control itself
 * as a form holding one — `querySelectorAll` answers about descendants only.
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

/**
 * @param {readonly MutationRecord[]} records
 * @returns {Element[]}
 */
function addedElements(records) {
  const added = [];
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node instanceof Element) added.push(node);
    }
  }
  return added;
}

/**
 * @param {Document} root
 * @param {(nodes: readonly Element[]) => void} arrived
 */
function watchArrivals(root, arrived) {
  const Observer = root.defaultView?.MutationObserver;
  if (!Observer) return;
  new Observer((records) => {
    const added = addedElements(records);
    if (added.length > 0) arrived(added);
  }).observe(root, { childList: true, subtree: true });
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

  // The watch is installed *before* the first scan, not after. A refusal in the opening
  // pass propagates out of here — which is the point, it is a rendering bug and says so —
  // and if the observer were still unarmed at that moment every form the page landed
  // afterwards would stand there with no script for the rest of the session.
  watchArrivals(root, arrived);
  arrived([root.documentElement]);
}

if (typeof document !== "undefined") startLongTextFields(document);
