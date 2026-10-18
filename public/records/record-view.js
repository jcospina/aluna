// @ts-check

/**
 * Opening a record and leaving it. A card press asks the desk to open the card's own record at its
 * record address, whose route draws the form with the records linking to it, as a pasted address
 * and an answer link do (ADR-0010). There is no modal, no focus trap and no page-wide inertness —
 * an ordinary view swap (design D2).
 */

import { registerRegionRelease, releaseRegionContent } from "../core/region-scope.js";
import { capabilityUrl } from "../core/routes.js";
import {
  BUSY_LABEL_ATTRIBUTE,
  CARD_CAPABILITY_ATTRIBUTE,
  CARD_RECORD_ATTRIBUTE,
  RECORD_LINKS_REST_ATTRIBUTE,
} from "../core/shell-dom.js";
import { markRecordExit, OPEN_THE_RECORD_EVENT, RECORD_NOT_THERE } from "../desk/desk-address.js";
import { PROMPT_BAR_MESSAGE_EVENT } from "../desk/prompt-bar.js";

const CARD_SELECTOR = `.capability-item[${CARD_CAPABILITY_ATTRIBUTE}]`;
const SHOW_ALL_SELECTOR = `[${RECORD_LINKS_REST_ATTRIBUTE}]`;
const SECTION_RECORDS_SELECTOR = ".record-links__records";
const SECTION_HEADING_SELECTOR = ".record-links__heading";
const RECORD_VIEW_SELECTOR = "[data-record-view]";
const BUSY_ATTR = "data-record-leaving";
const BACK_SELECTOR = "[data-record-back], [data-record-cancel]";
const SURFACE_SELECTOR = "[data-active-capability-id]";
const RECORDS_REGION_SELECTOR = "[data-content-region='records']";
const CONTENT_REGION_SELECTOR = "[data-content-region]";

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
 * Open the record a card names, in its own capability, never the window's: the desk asks about
 * unsaved changes, writes history, and swaps and retitles the window. A record whose capability
 * has left the desk since the card was drawn is not there, and the bar says so.
 *
 * @param {Element} card
 */
function openCard(card) {
  const capability = card.getAttribute(CARD_CAPABILITY_ATTRIBUTE);
  const record = card.getAttribute(CARD_RECORD_ATTRIBUTE);
  /** @type {{ capability: string | null, record: string | null, outcome?: unknown }} */
  const detail = { capability, record };
  document.dispatchEvent(new CustomEvent(OPEN_THE_RECORD_EVENT, { detail }));
  if (detail.outcome === "gone") sayRefused(RECORD_NOT_THERE);
}

/** What the bar says when the rest of a section could not be fetched. */
export const REST_UNREAD = "I couldn’t get the rest. Try again?";

/**
 * "Show all": the rest of a section's records join its list (`landRest`). While it fetches it is
 * held busy and says so in its words, not disabled, which would take the focus off it, and its
 * region's release ends the fetch. A refusal or a broken connection leaves the section as it was
 * and says so on the prompt bar; a release says nothing, the record having gone.
 *
 * @param {HTMLButtonElement} more
 */
async function showAll(more) {
  const section = more.closest(".record-links");
  const list = section?.querySelector(SECTION_RECORDS_SELECTOR);
  const address = more.getAttribute(RECORD_LINKS_REST_ATTRIBUTE);
  if (!section || !list || !address || more.getAttribute("aria-busy") === "true") return;
  more.setAttribute("aria-busy", "true");
  const idle = more.textContent;
  more.textContent = more.getAttribute(BUSY_LABEL_ATTRIBUTE) ?? idle;
  const asking = new AbortController();
  const deregister = registerRegionRelease(more, "show all", () => asking.abort());
  let refused = false;
  try {
    const headers = { "HX-Request": "true" };
    const answer = await fetch(address, { headers, signal: asking.signal });
    refused = !answer.ok;
    if (refused) return;
    const markup = await answer.text();
    if (more.isConnected) landRest(more, list, markup);
  } catch {
    refused = !asking.signal.aborted;
  } finally {
    deregister();
    more.removeAttribute("aria-busy");
    more.textContent = idle;
    if (refused && more.isConnected) sayRefused(REST_UNREAD);
  }
}

/**
 * The rest of a section's cards land in its list and Show all goes, its focus to the first card
 * it brought a press can open, or else to the section's heading. Nothing left past the cards
 * shown is the rest too: the records went since they were drawn.
 *
 * @param {HTMLButtonElement} more @param {Element} list @param {string} markup
 */
function landRest(more, list, markup) {
  const cards = document.createElement("template");
  cards.innerHTML = markup;
  const brought = [...cards.content.children];
  const held = document.activeElement === more;
  const heading = more.closest(".record-links")?.querySelector(SECTION_HEADING_SELECTOR);
  list.append(cards.content);
  more.remove();
  const next = brought.find((card) => card instanceof HTMLButtonElement) ?? heading;
  if (held && next instanceof HTMLElement) next.focus();
}

/** @param {string} sentence */
function sayRefused(sentence) {
  const said = { sentence, refused: true };
  document.dispatchEvent(new CustomEvent(PROMPT_BAR_MESSAGE_EVENT, { detail: said }));
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

    const more = target.closest(SHOW_ALL_SELECTOR);
    if (more instanceof HTMLButtonElement) {
      void showAll(more);
      return;
    }

    const card = target.closest(CARD_SELECTOR);
    if (card !== null) openCard(card);
  });
}

// The rules above are exercised in Bun against structural doubles, which is only possible
// where evaluating this module does not need a document.
if (typeof document !== "undefined") installRecordView();
