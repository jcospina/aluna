// @ts-check

/**
 * Opening a record and leaving it. A card press asks the desk to open the card's own record at its
 * record address, whose route draws the form with the records linking to it, as a pasted address
 * and an answer link do (ADR-0010). There is no modal, no focus trap and no page-wide inertness —
 * an ordinary view swap (design D2).
 */

import { registerRegionRelease, releaseRegionContent } from "../core/region-scope.js";
import { capabilityUrl, recordAddress } from "../core/routes.js";
import {
  BUSY_LABEL_ATTRIBUTE,
  CARD_CAPABILITY_ATTRIBUTE,
  CARD_RECORD_ATTRIBUTE,
  focusLanded,
  PUT_WINDOW_AWAY_EVENT,
  RECORD_BACK_ATTRIBUTE,
  RECORD_ID_FIELD,
  RECORD_LINKS_REST_ATTRIBUTE,
  RECORD_TITLE_ATTRIBUTE,
  WINDOW_TOOK_CAPABILITY_EVENT,
} from "../core/shell-dom.js";
import {
  deskHistory,
  forgetRecord,
  isAnotherPlace,
  markRecordExit,
  mayNameAgain,
  movesSoFar,
  nameRecord,
  OPEN_THE_RECORD_EVENT,
  RECORD_NOT_THERE,
  recordFromAddress,
  wayBack,
} from "../desk/desk-address.js";
import { PROMPT_BAR_MESSAGE_EVENT } from "../desk/prompt-bar.js";
import { isBeingAsked } from "../desk/window/addressed-window.js";
import { hasUnsavedChanges } from "./unsaved-changes.js";

const CARD_SELECTOR = `.capability-item[${CARD_CAPABILITY_ATTRIBUTE}]`;
const SHOW_ALL_SELECTOR = `[${RECORD_LINKS_REST_ATTRIBUTE}]`;
const SECTION_RECORDS_SELECTOR = ".record-links__records";
const SECTION_HEADING_SELECTOR = ".record-links__heading";
const RECORD_VIEW_SELECTOR = "[data-record-view]";
const BUSY_ATTR = "data-record-leaving";
const BACK_SELECTOR = `[${RECORD_BACK_ATTRIBUTE}], [data-record-cancel]`;
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
 * Claim the one exit a record view gets at a time: a second press while the place it returns to
 * is on its way would read twice, swap twice and restore focus twice.
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
      // The record is gone from the collection, asked of the region so another capability's
      // control cannot answer.
      focusCollectionStart(records.closest(".capability-collection"));
    },
    { once: true },
  );
}

/**
 * The start of a collection's keyboard order, its create trigger, while nobody has claimed focus.
 *
 * @param {Element | null} collection
 */
function focusCollectionStart(collection) {
  const trigger = collection?.querySelector(".capability-collection__new");
  if (trigger instanceof HTMLElement && focusIsUnclaimed()) trigger.focus();
}

/**
 * Leave the record the way its back control names: read the place it returns to afresh, a list
 * unfiltered and a record with any name a save refreshed, and let go of what the record holds as
 * that draws over it. Exported because a committed update or delete ends the same way Back does.
 *
 * @param {HTMLElement} view
 * @param {{ deleted?: boolean }} [how] whether a confirmed delete took the record
 * @returns {Promise<boolean>} whether the way out drew, rather than stopping or being overtaken
 */
export function leaveRecordView(view, { deleted = false } = {}) {
  const surface = view.closest(SURFACE_SELECTOR);
  const region = view.closest(CONTENT_REGION_SELECTOR);
  const capabilityId = surface instanceof HTMLElement ? surface.dataset.activeCapabilityId : null;
  const transport = htmx();
  if (!capabilityId || !region || !transport) return Promise.resolve(false);
  const own = capabilityUrl(capabilityId);
  const way = wayBack(own, recordOf(view, capabilityId), deskHistory(), isBeingAsked);
  /* Pressed while a navigation of the person's own still lands over the record, it yields to it. */
  if (way === null || !claimRecordExit(view)) return Promise.resolve(false);
  const itemTargetId = view.dataset.itemTargetId;
  const leaving = { from: movesSoFar(), deleted, said: false };
  return readTheWayBack(transport, region, view, waysBack(way, own), leaving).then((drew) => {
    releaseRecordExit(view);
    landAfterLeaving(region, view, capabilityId, itemTargetId);
    return drew;
  });
}

/**
 * The record address of the record a view holds, by the id its forms post.
 *
 * @param {Element} view @param {string} capabilityId
 * @returns {string | null}
 */
function recordOf(view, capabilityId) {
  const id = view.querySelector(`input[name="${RECORD_ID_FIELD}"]`)?.getAttribute("value");
  return id ? recordAddress(capabilityId, id.toLowerCase()) : null;
}

/**
 * What the way out reads, in turn, while what it reads has gone: the place it names, then that
 * record's list, stepping back onto the record's entry as a Back onto it does (design D14), then
 * the record's own list.
 *
 * @param {import("../desk/desk-address.js").WayBack} way @param {string} own
 * @returns {{ to: string, onto: string }[]}
 */
function waysBack({ address, onto }, own) {
  const named = recordFromAddress(address);
  const ways = [{ to: address, onto }];
  if (named !== null) ways.push({ to: capabilityUrl(named.capability), onto });
  if (ways.every(({ to }) => isAnotherPlace(to, own))) ways.push({ to: own, onto: own });
  return ways;
}

/**
 * How a way out goes: the person's moves when it was pressed, whether it leaves a record a delete
 * took, and whether the bar has said why a place was not there.
 *
 * @typedef {{ from: number, deleted: boolean, said: boolean }} Leaving
 */

/**
 * Read the first of `ways` into the window as the record's way out, until the person moves on. A
 * place gone is not drawn, and the next is read in its place, the bar saying why once; with none
 * left, the window goes, as a Back onto a gone capability takes it. Any other refusal leaves the
 * record standing, the bar saying why, unless a delete took the record: that is read past too.
 *
 * @param {Htmx} transport @param {Element} region @param {HTMLElement} view
 * @param {{ to: string, onto: string }[]} ways @param {Leaving} leaving
 * @returns {Promise<boolean>} whether one of them drew
 */
async function readTheWayBack(transport, region, view, ways, leaving) {
  if (movesSoFar() !== leaving.from) return false;
  const [way, ...rest] = ways;
  if (way === undefined) {
    document.dispatchEvent(new CustomEvent(PUT_WINDOW_AWAY_EVENT));
    return false;
  }
  const unmark = markRecordExit(way.to, way.onto);
  const { source, done, held, drew } = askingElement(region, view, leaving);
  const context = { source, target: region, swap: "innerHTML" };
  // A severed connection rejects and leaves the view standing. The mark comes off either way.
  await transport.ajax("GET", way.to, context).catch(() => undefined);
  unmark();
  done();
  const refused = held();
  if (refused === null) return drew();
  const goesOn = refused.status === 404 || leaving.deleted;
  if (refused.sentence !== "" && !(goesOn && leaving.said)) sayRefused(refused.sentence);
  if (!goesOn) return false;
  const said = leaving.said || refused.sentence !== "";
  return readTheWayBack(transport, region, view, rest, { ...leaving, said });
}

/**
 * What holds a way out over a record changed since it was pressed: typing after a save, or after a
 * Back with nothing to ask about, is not drawn over. The record stays, and says nothing.
 *
 * @param {HTMLElement} view @returns {{ status: number, sentence: string } | null}
 */
function typedSince(view) {
  return hasUnsavedChanges(/** @type {never} */ (view)) ? { status: 0, sentence: "" } : null;
}

/**
 * A read's answer the way out holds rather than draws: anything but a success, a place gone (404)
 * or briefly unreadable (409) among them, with the sentence its refusal says, if it says one.
 *
 * @param {{ status?: number, responseText?: string } | undefined} xhr
 * @returns {{ status: number, sentence: string } | null}
 */
function heldAnswer(xhr) {
  const status = xhr?.status ?? 0;
  if (status >= 200 && status < 300) return null;
  return { status, sentence: refusalOf(xhr?.responseText ?? "") };
}

/**
 * The sentence an answer's platform refusal or notice says, as its "not found" does, or nothing. A
 * 404 with nothing in it is a record the capability has no view for, whose list opens unremarked.
 *
 * @param {string} markup
 */
function refusalOf(markup) {
  const drawn = document.createElement("template");
  drawn.innerHTML = markup;
  const refusal =
    drawn.content.querySelector('[data-role="error"][data-error-code]') ??
    drawn.content.querySelector(".notice");
  return refusal?.textContent?.trim() ?? "";
}

/**
 * Put the keyboard where the way out landed: on the first field of a record, as opening one does;
 * on the card of the record just left, in its own list; or at the start of another list.
 *
 * @param {Element} region @param {HTMLElement} view
 * @param {string} capabilityId @param {string | undefined} itemTargetId
 */
function landAfterLeaving(region, view, capabilityId, itemTargetId) {
  const arrived = region.querySelector(RECORD_VIEW_SELECTOR);
  if (arrived !== null && arrived !== view) {
    if (focusIsUnclaimed()) focusLanded(region);
    return;
  }
  const landed = region.querySelector(`:scope > ${SURFACE_SELECTOR}`);
  const elsewhere = landed?.getAttribute("data-active-capability-id");
  if (elsewhere && elsewhere !== capabilityId) focusCollectionStart(landed);
  else focusReturnedRecord(region, itemTargetId);
}

/** The latest title asked for, by record, so an older answer arriving last is not taken. */
const retitling = new Map();

/**
 * Leave a record a committed save changed. The save can rename it, and
 * the old name would stand in an entry that may name it again, or wherever the person went instead
 * of the way out: the title is then read again from its address, written on the view if it stands,
 * and the desk hears the window changed hands, so the record standing names its way back afresh.
 *
 * @param {HTMLElement} view
 */
export function leaveSavedRecordView(view) {
  const address = addressOf(view);
  const again = address !== null && mayNameAgain(address);
  void leaveRecordView(view).then((drew) => {
    if (address !== null && (again || !drew)) retitle(address, view);
  });
}

/** @param {string} address @param {HTMLElement} view the view of it, if it still stands */
function retitle(address, view) {
  const asked = Symbol(address);
  retitling.set(address, asked);
  void fetch(address, { headers: { "HX-Request": "true" } })
    .then((answer) => (answer.ok ? answer.text() : ""))
    .then((markup) => {
      const drawn = document.createElement("template");
      drawn.innerHTML = markup;
      const titled = drawn.content.querySelector(`[${RECORD_TITLE_ATTRIBUTE}]`);
      const title = titled?.getAttribute(RECORD_TITLE_ATTRIBUTE) ?? "";
      if (retitling.get(address) !== asked || title === "") return;
      if (view.isConnected) view.setAttribute(RECORD_TITLE_ATTRIBUTE, title);
      nameRecord(address, title);
      const detail = { navigated: false };
      document.dispatchEvent(new CustomEvent(WINDOW_TOOK_CAPABILITY_EVENT, { detail }));
    })
    .catch(() => undefined)
    .finally(() => {
      if (retitling.get(address) === asked) retitling.delete(address);
    });
}

/**
 * A confirmed delete took the record, so a way back to an entry naming it goes to its list.
 *
 * @param {HTMLElement} view
 */
export function forgetDeleted(view) {
  const address = addressOf(view);
  if (address !== null) forgetRecord(address);
}

/** @param {HTMLElement} view @returns {string | null} the address of the record it holds */
function addressOf(view) {
  const capabilityId = view.closest(SURFACE_SELECTOR)?.getAttribute("data-active-capability-id");
  return capabilityId ? recordOf(view, capabilityId) : null;
}

/**
 * The element the way out asks from: its own, inside the window so a refusal is drawn there, and
 * not the region, where htmx would queue it behind a press still being answered. Once anything
 * else has swapped into the window, a press, a build, a question, or the person has moved since
 * `from`, what comes back is not its to draw or say. Nor is any answer but a success, a place gone
 * (404) or briefly unreadable (409) among them: it is held, with the sentence the server gave it.
 *
 * @param {Element} region @param {HTMLElement} view @param {Leaving} leaving
 * @returns {{ source: HTMLElement, done: () => void, drew: () => boolean,
 *   held: () => { status: number, sentence: string } | null }}
 */
function askingElement(region, view, { from, deleted }) {
  const source = document.createElement("span");
  source.hidden = true;
  region.append(source);
  let changedHands = false;
  /** @type {{ status: number, sentence: string } | null} */
  let kept = null;
  let drawing = false;
  const overtaken = () => changedHands || !view.isConnected || movesSoFar() !== from;
  /**
   * @param {Event} event
   * @returns {{ requestConfig?: { elt?: unknown }, shouldSwap?: boolean,
   *   xhr?: { status?: number, responseText?: string } }}
   */
  const detailOf = (event) => /** @type {CustomEvent} */ (event).detail ?? {};
  /** @param {Event} event */
  const swapped = (event) => {
    if (event.target === region && detailOf(event).requestConfig?.elt !== source) {
      changedHands = true;
    }
  };
  /** @param {{ status?: number, responseText?: string } | undefined} xhr */
  const holding = (xhr) => heldAnswer(xhr) ?? (deleted ? null : typedSince(view));
  /** @param {Event} event */
  const swapping = (event) => {
    const { requestConfig, xhr } = detailOf(event);
    if (requestConfig?.elt !== source) return;
    if (!overtaken()) kept = holding(xhr);
    drawing = !overtaken() && kept === null;
    /* What the record holds is let go only as the way out draws over it: one that stops leaves
     * the record standing with all of it working. */
    if (drawing) {
      releaseRegionContent(view);
      return;
    }
    /** @type {CustomEvent<{ shouldSwap?: boolean }>} */ (event).detail.shouldSwap = false;
    event.stopPropagation();
  };
  /** @param {Event} event */
  const unheard = (event) => {
    if (overtaken() || kept !== null) event.stopPropagation();
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
  return { source, done, held: () => (overtaken() ? null : kept), drew: () => drawing };
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
      void leaveRecordView(view);
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
