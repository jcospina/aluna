// @ts-check

/**
 * Opening a record: a DOM clone of the item's inert `<template>`, so a press asks the server for
 * nothing, and there is no modal, no focus trap and no page-wide inertness — an ordinary view swap
 * (design D2). Its record address draws the same view (ADR-0010).
 */

import { releaseRegionContent } from "../core/region-scope.js";
import { capabilityUrl, RECORD_ID_PATTERN, recordAddress } from "../core/routes.js";
import { focusFirstField, RECORD_ID_FIELD } from "../core/shell-dom.js";
import { deskHistory, markRecordExit, pushAddress } from "../desk/desk-address.js";

const ITEM_SELECTOR = ".capability-item";
const RECORD_VIEW_SELECTOR = "[data-record-view]";
const BUSY_ATTR = "data-record-leaving";
const BACK_SELECTOR = "[data-record-back], [data-record-cancel]";
const COLLECTION_SELECTOR = ".capability-collection";
const SURFACE_SELECTOR = "[data-active-capability-id]";
const RECORDS_REGION_SELECTOR = "[data-content-region='records']";
const CONTENT_REGION_SELECTOR = "[data-content-region]";

/** A record id an address can name; any other id has no record address to push. */
const RECORD_ID = new RegExp(`^${RECORD_ID_PATTERN}$`);

export { FIRST_FIELD_SELECTOR } from "../core/shell-dom.js";

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
 * The order the swap depends on, provable without a browser: nothing is released until there is
 * something to put in its place, so a record that cannot open leaves the collection as it was.
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
  // Cleanup belongs to the content, not the window, which would leak on every swap.
  const view = recordViewFor(item);
  const swapped = swapInRecordView({
    outgoing: collection,
    incoming: view,
    release: releaseRegionContent,
    replace: (outgoing, incoming) => outgoing.replaceWith(incoming),
    process: (incoming) => htmx()?.process(incoming),
  });
  if (!swapped || !view) return;
  pushRecordAddress(view);
  // After the microtask that mounts what the swap brought, or a file field would have no control.
  queueMicrotask(() => focusFirstField(view));
}

/**
 * A press is a navigation, so the record it opened gets an entry of its own (PLAN decision 44).
 * Its id is the one its forms post; the search term the collection stood under is not in it.
 *
 * @param {HTMLElement} view
 */
function pushRecordAddress(view) {
  const surface = view.closest(SURFACE_SELECTOR);
  const capabilityId = surface instanceof HTMLElement ? surface.dataset.activeCapabilityId : null;
  const record = view.querySelector(`input[name="${RECORD_ID_FIELD}"]`)?.getAttribute("value");
  if (!capabilityId || !record || !RECORD_ID.test(record)) return;
  pushAddress(recordAddress(capabilityId, record), deskHistory());
}

/**
 * Claim the one exit a record view gets at a time: a second press while the collection is on
 * its way would read twice, swap twice and restore focus twice.
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
 * Whether focus is still where the swap left it — on nothing in particular. Restoring focus
 * means waiting out a round trip, and taking it back off a prompt bar would be worse.
 *
 * @returns {boolean}
 */
function focusIsUnclaimed() {
  const active = document.activeElement;
  return active === null || active === document.body;
}

/**
 * Give focus back to the record that was open: a view swap that drops focus leaves a keyboard
 * user at the top of the desk, and the collection arrives before its records do.
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
      // The record is gone from the collection. The create trigger starts the collection's
      // keyboard order, asked of the region so another capability's control cannot answer.
      const trigger = records
        .closest(".capability-collection")
        ?.querySelector(".capability-collection__new");
      if (trigger instanceof HTMLElement) trigger.focus();
    },
    { once: true },
  );
}

/**
 * Leave the record: release what it holds, then ask for the collection again — a fresh read, so
 * it comes back unfiltered. Exported because a committed update ends the same way back does.
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
  const collection = capabilityUrl(capabilityId);
  const unmark = markRecordExit(collection);
  const { source, done } = askingElement(region, view);
  void transport
    .ajax("GET", collection, { source, target: region, swap: "innerHTML" })
    // A read refused mid-change answers 409, drawn where the view stood (`public/app.js`); a
    // severed connection rejects and leaves the view standing. The busy mark comes off either way.
    .catch(() => undefined)
    .then(() => {
      unmark();
      done();
      releaseRecordExit(view);
      focusReturnedRecord(region, itemTargetId);
    });
}

/**
 * The element the way out asks from: its own, inside the window so a refusal is drawn there, and
 * not the region, where htmx would queue it behind a press still being answered. Once anything
 * else has swapped into the window, a press, a build, a question, what comes back is not its to
 * draw or say.
 *
 * @param {Element} region @param {HTMLElement} view
 * @returns {{ source: HTMLElement, done: () => void }}
 */
function askingElement(region, view) {
  const source = document.createElement("span");
  source.hidden = true;
  region.append(source);
  let changedHands = false;
  const overtaken = () => changedHands || !view.isConnected;
  /** @param {Event} event @returns {{ requestConfig?: { elt?: unknown }, shouldSwap?: boolean }} */
  const detailOf = (event) => /** @type {CustomEvent} */ (event).detail ?? {};
  /** @param {Event} event */
  const swapped = (event) => {
    if (event.target === region && detailOf(event).requestConfig?.elt !== source) {
      changedHands = true;
    }
  };
  /** @param {Event} event */
  const swapping = (event) => {
    const detail = detailOf(event);
    if (detail.requestConfig?.elt !== source || !overtaken()) return;
    detail.shouldSwap = false;
    event.stopPropagation();
  };
  /** @param {Event} event */
  const unheard = (event) => {
    if (overtaken()) event.stopPropagation();
  };
  /** @type {[EventTarget, string, (event: Event) => void][]} */
  const listening = [
    [region, "htmx:afterSwap", swapped],
    [region, "htmx:beforeSwap", swapping],
    [source, "htmx:responseError", unheard],
    [source, "htmx:sendError", unheard],
  ];
  for (const [node, type, run] of listening) node.addEventListener(type, run);
  const done = () => {
    for (const [node, type, run] of listening) node.removeEventListener(type, run);
    source.remove();
  };
  return { source, done };
}

// Delegated and document-level, so it covers records htmx swaps in later without re-binding.
// A record is a real button, so Enter and Space already activate it and no key handling is here.
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
