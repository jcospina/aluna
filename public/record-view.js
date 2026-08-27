// @ts-check

/**
 * Opening a record, and going back.
 *
 * A record is a `<button>` in the collection. Pressing it swaps the collection out for
 * that record's form and the back control above it; back swaps the collection in again.
 * Nothing opens over anything else, so there is no modal, no focus trap and no page-wide
 * inertness — the window is the whole surface and this is an ordinary view swap in it
 * (design D2).
 *
 * The form travels with its record. Each item is emitted beside an inert `<template>`
 * holding the record's view, so opening one is a DOM clone rather than a round-trip and
 * there is still no read-single route. The clone is taken *before* the collection is
 * released, because the template goes out with the content it was standing in.
 *
 * Cleanup belongs to the content, not to the window: `releaseRegionContent` runs on the
 * way in and on the way out, so the collection's read, its search controller and the
 * server read token they hold are released when the record replaces them, and the
 * record's own in-flight work is released on the way back. A window-scoped hook would
 * leak on every swap.
 *
 * Back is a fresh read of the collection, not a restored snapshot — the same request a
 * capability logo makes, aimed at the same content region. The collection comes back the
 * way it opens: unfiltered, with an empty search rail. A search term is DOM-only state
 * that lived in the collection this swap took away, and every open is a fresh read.
 */

import { releaseRegionContent } from "./region-scope.js";

const ITEM_SELECTOR = ".capability-item";
const RECORD_VIEW_SELECTOR = "[data-record-view]";
const BUSY_ATTR = "data-record-leaving";
const BACK_SELECTOR = "[data-record-back], [data-record-cancel]";
const COLLECTION_SELECTOR = ".capability-collection";
const SURFACE_SELECTOR = "[data-active-capability-id]";
const RECORDS_REGION_SELECTOR = "[data-content-region='records']";
const CONTENT_REGION_SELECTOR = "[data-content-region]";
const FIRST_FIELD_SELECTOR = "input:not([type=hidden]), textarea, select";

/**
 * @typedef {{
 *   ajax(verb: string, path: string, context: object): Promise<unknown>,
 *   process(node: Element): void,
 * }} Htmx
 */

/** @returns {Htmx | undefined} */
function htmx() {
  return /** @type {Window & { htmx?: Htmx }} */ (window).htmx;
}

/**
 * The record view cloned out of one item's template, or null when the item carries no
 * template — a capability that cannot be updated has no record surface to open.
 *
 * @param {HTMLElement} item
 * @returns {HTMLElement | null}
 */
function recordViewFor(item) {
  const templateId = item.dataset.recordViewTemplate;
  const template = templateId ? document.getElementById(templateId) : null;
  if (!(template instanceof HTMLTemplateElement)) return null;
  const view = template.content.cloneNode(true);
  const root = view instanceof DocumentFragment ? view.firstElementChild : null;
  return root instanceof HTMLElement ? root : null;
}

/**
 * The form takes the window, so the first field is where the user now is. Every field is
 * preceded by its own hidden `__aluna_present` marker, which is why the selector excludes
 * hidden inputs: focusing one silently does nothing.
 *
 * @param {HTMLElement} view
 */
function focusFirstField(view) {
  const control = view.querySelector(FIRST_FIELD_SELECTOR);
  if (control instanceof HTMLElement) control.focus();
}

/**
 * The order the swap depends on, stated once and on its own so it can be proved without a
 * browser. The clone is already taken by the time this runs — the template stands inside
 * the content about to go — and nothing is released until there is something to put in
 * its place, so a record that cannot open leaves the collection exactly as it was.
 *
 * @template T
 * @param {{
 *   outgoing: T,
 *   incoming: T | null,
 *   release: (node: T) => void,
 *   replace: (outgoing: T, incoming: T) => void,
 *   process: (incoming: T) => void,
 * }} swap
 * @returns {boolean} whether the swap happened
 */
export function swapInRecordView({ outgoing, incoming, release, replace, process }) {
  if (!incoming) return false;
  release(outgoing);
  replace(outgoing, incoming);
  process(incoming);
  return true;
}

/** @param {HTMLElement} item */
function openRecord(item) {
  const collection = item.closest(COLLECTION_SELECTOR);
  if (!(collection instanceof HTMLElement)) return;
  // Cloned first: the template is a sibling of the item, inside the content being released.
  const view = recordViewFor(item);
  const swapped = swapInRecordView({
    outgoing: collection,
    incoming: view,
    release: releaseRegionContent,
    replace: (outgoing, incoming) => outgoing.replaceWith(incoming),
    process: (incoming) => htmx()?.process(incoming),
  });
  if (swapped && view) focusFirstField(view);
}

/**
 * Claim the one exit a record view gets at a time. A second press while the collection is
 * on its way would issue a second read at the same region, swap twice and restore focus
 * twice; the claim is released when the request ends, however it ends.
 *
 * @param {{ hasAttribute(name: string): boolean, setAttribute(name: string, value: string): void }} view
 * @returns {boolean} whether this caller may leave
 */
export function claimRecordExit(view) {
  if (view.hasAttribute(BUSY_ATTR)) return false;
  view.setAttribute(BUSY_ATTR, "true");
  return true;
}

/** @param {{ removeAttribute(name: string): void }} view */
export function releaseRecordExit(view) {
  view.removeAttribute(BUSY_ATTR);
}

/**
 * Whether focus is still where the swap left it — on nothing in particular. The
 * collection arrives before its records do, so restoring focus means waiting out a round
 * trip, and in that time the user may have reached for the prompt bar or a search field.
 * Taking focus back off them then would be worse than not restoring it at all.
 *
 * @returns {boolean}
 */
function focusIsUnclaimed() {
  const active = document.activeElement;
  return active === null || active === document.body;
}

/**
 * Give focus back to the record that was open. A view swap that drops focus leaves a
 * keyboard user at the top of the desk, and the collection arrives before its records do,
 * so this waits for the region's own read to settle rather than looking too early.
 *
 * @param {Element} region the window's content region, holding the restored collection
 * @param {string | undefined} itemTargetId
 */
function focusReturnedRecord(region, itemTargetId) {
  if (!itemTargetId || !focusIsUnclaimed()) return;
  const focusItem = () => {
    const item = region.querySelector(`#${CSS.escape(itemTargetId)}`);
    if (item instanceof HTMLElement && focusIsUnclaimed()) {
      item.focus();
      return true;
    }
    return false;
  };
  if (focusItem()) return;
  const records = region.querySelector(RECORDS_REGION_SELECTOR);
  if (!records) return;
  records.addEventListener(
    "htmx:afterSettle",
    () => {
      if (focusItem() || !focusIsUnclaimed()) return;
      // The record is gone from the collection it came back to. The create trigger is
      // where the collection's own keyboard order starts. Asked of the region rather than
      // the document, so a window that has since taken another capability is not answered
      // with that capability's control.
      const trigger = records
        .closest(".capability-collection")
        ?.querySelector(".capability-collection__new");
      if (trigger instanceof HTMLElement) trigger.focus();
    },
    { once: true },
  );
}

/**
 * Leave the record: release what the record view still holds, then ask for the
 * collection again. Exported because a committed update ends the same way a press on
 * back does — the record is done and the collection is what comes next.
 *
 * Asking is the whole of it, so asking can fail. A read the server refuses while it is
 * mid-change answers 409 and htmx swaps nothing, and a severed connection rejects; either
 * way the record view is still standing, and leaving it standing with the control dead
 * would be the silent swallow this replaced. The view is marked busy for the length of
 * the request instead, and unmarked when it ends however it ends — so a refusal leaves
 * the user exactly where they were, with a control that still works.
 *
 * @param {HTMLElement} view
 */
export function leaveRecordView(view) {
  const surface = view.closest(SURFACE_SELECTOR);
  const region = view.closest(CONTENT_REGION_SELECTOR);
  const capabilityId = surface instanceof HTMLElement ? surface.dataset.activeCapabilityId : null;
  const transport = htmx();
  if (!capabilityId || !region || !transport) return;
  if (!claimRecordExit(view)) return;
  const itemTargetId = view.dataset.itemTargetId;

  releaseRegionContent(view);
  void transport
    .ajax("GET", `/capability/${capabilityId}`, {
      source: region,
      target: region,
      swap: "innerHTML",
    })
    .catch(() => undefined)
    .then(() => {
      releaseRecordExit(view);
      focusReturnedRecord(region, itemTargetId);
    });
}

// Delegated and document-level, so it covers records present at load and records htmx
// swaps in later without re-binding. A record is a real button, so there is no key
// handling here: Enter and Space already activate it.
function installRecordView() {
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const back = target.closest(BACK_SELECTOR);
    const view = back?.closest(RECORD_VIEW_SELECTOR);
    if (view instanceof HTMLElement) {
      leaveRecordView(view);
      return;
    }

    const item = target.closest(ITEM_SELECTOR);
    if (item instanceof HTMLElement) openRecord(item);
  });
}

// The rules above are exercised in Bun against structural doubles, which is only possible
// where evaluating this module does not need a document.
if (typeof document !== "undefined") installRecordView();
