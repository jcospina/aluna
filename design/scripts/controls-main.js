// @ts-check
/**
 * Bootstrap for the controls page.
 *
 * The sibling of `main.js`, and deliberately not the same file: the desk page
 * boots a window manager and three benches this page has no use for, and a
 * bootstrap that guards its way through half a page it is not on is a bootstrap
 * nobody trusts. What the two share — the section lamps, the ink system, the
 * window itself — they share by importing it.
 *
 * Everything on this page is real. The fields take text, the listboxes open,
 * the textarea grows, the toggles change what is actually drawn. A control that
 * only *looked* right in a screenshot is exactly the failure this page exists
 * to catch.
 */

import { mountAllInk, reseedInk, startInk } from "./ink.js";
import { mountListboxes } from "./listbox.js";
import { wireSectionWindows } from "./sections/section-window.js";
import { mountWindows } from "./window.js";

/* ── The textarea, growing ──────────────────────────────────────────────────
 *
 * A textarea's own resize grip is three diagonal lines drawn by the operating
 * system in the bottom-right corner. It cannot be styled, it cannot be drawn,
 * and it is the only mark on this page that would not be ours. So the control
 * has no grip: it grows with what is typed until it reaches its ceiling, then
 * scrolls.
 *
 * That is also the better behaviour. Dragging a box to fit text you have
 * already written is work the box can do for you, and a field that is exactly
 * as tall as its content is a field you can read at a glance.
 *
 * The ink follows for free — `ink.js` watches every drawn element with a
 * ResizeObserver, so a field that grows is redrawn without this knowing the ink
 * system exists.
 */

/** @param {HTMLTextAreaElement} area */
function grow(area) {
  const max = Number(area.dataset.growMax ?? 0);
  area.style.height = "auto";
  const wanted = area.scrollHeight;
  const capped = max > 0 ? Math.min(wanted, max) : wanted;
  area.style.height = `${capped}px`;
  area.style.overflowY = capped < wanted ? "auto" : "hidden";
}

/**
 * Seed and wire every growing textarea.
 *
 * Sample text arrives as `data-sample` rather than as the element's content,
 * which looks like an affectation and is not: a textarea's content is
 * whitespace-significant, and an HTML formatter reflows it. Written inline, a
 * one-line sample comes back indented across two lines and fifty characters
 * longer — which the character counter below dutifully reports as being over
 * its limit before anyone has typed anything.
 *
 * @param {Document | Element} root
 */
function mountTextareas(root) {
  for (const area of root.querySelectorAll("textarea[data-grow]")) {
    if (!(area instanceof HTMLTextAreaElement)) continue;
    if (area.dataset.sample && area.value.trim() === "") area.value = area.dataset.sample;
    area.addEventListener("input", () => grow(area));
    grow(area);
  }
}

/* ── The counter ────────────────────────────────────────────────────────────
 *
 * A remaining-characters count, in the guidance slot under the field, because
 * that is where a field already says things about itself. It turns to signal
 * only once the limit is actually passed — a counter that is red for the last
 * twenty characters trains you to ignore it.
 */

/** @param {Document | Element} root */
function mountCounters(root) {
  for (const area of root.querySelectorAll("textarea[data-count-into]")) {
    if (!(area instanceof HTMLTextAreaElement)) continue;
    const selector = area.dataset.countInto;
    const out = selector ? root.querySelector(selector) : null;
    if (!(out instanceof HTMLElement)) continue;

    const limit = Number(area.dataset.countLimit ?? 0);
    const paint = () => {
      const left = limit - area.value.length;
      // "1 characters left" is wrong wherever it is drawn. Carried back from
      // `public/long-text-field.js`, which is the port of this file, so the two do not drift.
      out.textContent =
        left >= 0 ? `${left} character${left === 1 ? "" : "s"} left` : `${-left} over the limit`;
      out.classList.toggle("is-over", left < 0);
    };
    area.addEventListener("input", paint);
    paint();
  }
}

/* ── The benches ────────────────────────────────────────────────────────────
 *
 * Each one is a decision this page has not made yet, wired so it can be looked
 * at rather than argued about. They set an attribute and ask the ink to redraw;
 * nothing here knows what the stylesheet does with it.
 */

/**
 * A pressed/unpressed pair of buttons, both of which say what they will do
 * rather than what state they are in.
 *
 * @param {HTMLElement} root
 * @param {string} selector the `[data-…]` control
 * @param {(on: boolean) => void} apply
 */
function toggleBench(root, selector, apply) {
  const button = root.querySelector(selector);
  if (!(button instanceof HTMLButtonElement)) return;
  button.addEventListener("click", () => {
    const on = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(on));
    apply(on);
  });
}

/** @param {HTMLElement} root */
function mountBenches(root) {
  /* Every control at once, so a disabled row can be read as a row. */
  const states = root.querySelector("[data-state-bench]");
  toggleBench(root, "[data-disable-toggle]", (off) => {
    if (!(states instanceof HTMLElement)) return;
    for (const el of states.querySelectorAll("input, textarea, select, button")) {
      if (el instanceof HTMLElement && "disabled" in el) {
        /** @type {{ disabled: boolean }} */ (/** @type {unknown} */ (el)).disabled = off;
      }
    }
    states.classList.toggle("is-disabled", off);
  });

  root.querySelector("[data-reink]")?.addEventListener("click", () => reseedInk());
}

/* ── The chosen value, echoed ───────────────────────────────────────────────
 *
 * The listbox reports through a bubbling event rather than by being read, so
 * this is the whole of what a consumer has to write.
 */

/** @param {HTMLElement} root */
function mountEcho(root) {
  root.addEventListener("listbox:change", (event) => {
    const { detail } = /** @type {CustomEvent<{ value: string, label: string }>} */ (event);
    const echo = root.querySelector("[data-listbox-echo]");
    if (echo instanceof HTMLElement) echo.textContent = detail.value;
  });
}

function boot() {
  wireSectionWindows(mountWindows(document));

  mountListboxes(document);
  mountTextareas(document);
  mountCounters(document);
  mountBenches(document.body);
  mountEcho(document.body);

  /*
   * Last, once the document has stopped being rearranged — mounting a window
   * moves its contents into a body. From here the ink system watches the
   * document, so anything added later arrives drawn without being told.
   */
  startInk();

  /*
   * The listbox panels are `hidden` at boot, so they measure 0×0 and are not
   * worth drawing yet. They are mounted all the same, and the ResizeObserver
   * draws each one the first time it opens.
   */
  mountAllInk(document);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
