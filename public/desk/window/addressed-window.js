// @ts-check

/**
 * Filling the window an address opened (design D14, ADR-0010). A record that is not there leaves
 * its capability open: the address becomes the collection's and the collection is asked for, the
 * server's own answer having already said so on the prompt bar. An address answers only for the
 * window as it opened it: once anything else has opened the window or a record in it, what comes
 * back is not its to settle, and it is neither swapped in nor said.
 */

import { recordAddress } from "../../core/routes.js";
import {
  focusFirstField,
  RECORD_ID_FIELD,
  WINDOW_TOOK_CAPABILITY_EVENT,
} from "../../core/shell-dom.js";
import {
  capabilityAddress,
  correctUnfilledAddress,
  DESK_ADDRESS,
  recordFromAddress,
} from "../desk-address.js";
import { PROMPT_BAR_MESSAGE_EVENT } from "../prompt-bar.js";

/**
 * A window an address stood up, as much of it as filling it asks for.
 *
 * @typedef {{
 *   region: Element,
 *   current(): boolean,
 *   putAway(): void,
 * }} AddressedWindow
 */

/**
 * How a request ended: refused or not, its status, whether the window was still the address's
 * when it was answered, and whether it drew a refusal in the window.
 *
 * @typedef {{ refused: boolean, status: number, current: boolean | null, drew: boolean }} Heard
 */

/**
 * An htmx request event's detail. `elt` is whatever the event fires on, the swap target for a
 * swap's events, so a request is told by the element that asked, `requestConfig.elt`.
 *
 * @typedef {{
 *   requestConfig?: { elt?: unknown },
 *   xhr?: { status?: number },
 *   shouldSwap?: boolean,
 * }} HeardRequest
 */

/** The two endings htmx gives a request that never filled anything. */
const REFUSALS = ["htmx:responseError", "htmx:sendError"];

/** The endings after which nothing more is heard of a request, a swap that threw included. */
const ENDINGS = ["htmx:afterRequest", "htmx:onLoadError"];

/** How many addresses the desk has answered, so an ask answers only while its address is the last. */
let answered = 0;

/**
 * The ask filling the window now, so a render of the same place (a hash change, which arrives as
 * a traversal) is answered by the ask already under way rather than a second one.
 *
 * @type {{ pathname: string, live(): boolean } | null}
 */
let filling = null;

/**
 * An address answered by what the window already shows: any ask still in flight is now for an
 * address the person has moved past, as much as if a newer window had opened.
 */
export function stayPut() {
  answered += 1;
}

/**
 * Open the window an address names and ask for what it names. Nothing is pushed: the address is
 * already right.
 *
 * @param {{ id: string, record?: string }} asked
 * @param {() => AddressedWindow} open stands the window up, or gives back the one standing
 */
export function fillAddressedWindow(asked, open) {
  const collection = capabilityAddress(asked.id);
  const wanted = asked.record === undefined ? collection : recordAddress(asked.id, asked.record);
  if (filling?.pathname === wanted && filling.live()) return;
  answered += 1;
  const window_ = open();
  /* Outside the window, so a refusal speaks on the prompt bar (`public/app.js`). */
  const fromTheDesk = document.body;
  if (asked.record === undefined) {
    void ask(window_, collection, fromTheDesk).then((heard) => settle(collection, window_, heard));
    return;
  }
  const address = recordAddress(asked.id, asked.record);
  void ask(window_, address, fromTheDesk).then((heard) => {
    if (heard.status !== 404 || !heard.current) {
      if (settle(address, window_, heard)) focusLanded(window_.region);
      return;
    }
    correctUnfilledAddress(address, collection);
    /* Into the same window, asked from inside it as a record view's own way back asks, so the
     * prompt bar keeps the notice the record's answer has just put there. */
    const same = open();
    void ask(same, collection, same.region).then((again) => settle(collection, same, again));
  });
}

/**
 * The record's first field, once what the swap brought has mounted, as a press focuses it, and
 * only where the person has not since put focus somewhere else.
 *
 * @param {Element} region
 */
function focusLanded(region) {
  queueMicrotask(() => {
    const active = document.activeElement;
    if (active === null || active === document.body || region.contains(active)) {
      focusFirstField(region);
    }
  });
}

/**
 * Leave the window filled; keep what it held before, if a refusal came over a capability the
 * person was reading; or take it and its address away. A refusal never fills it, even one drawn
 * inside it, and neither does an answer that brought nothing.
 *
 * @param {string} pathname @param {AddressedWindow} window_ @param {Heard} heard
 * @returns {boolean} whether the window stands filled with what was asked for
 */
function settle(pathname, window_, heard) {
  if (!heard.current) return false;
  const { region } = window_;
  if (!heard.refused && region.childNodes.length > 0) return true;
  const shown = heard.drew ? null : addressOfWhatItShows(region);
  if (shown !== null) {
    /* The bar goes back to what the window holds, and its name follows it there as it follows
     * any change of hands (`desk-window.js`). */
    correctUnfilledAddress(pathname, shown);
    const detail = { navigated: false };
    document.dispatchEvent(new CustomEvent(WINDOW_TOOK_CAPABILITY_EVENT, { detail }));
    return false;
  }
  if (heard.drew) sayDrawnRefusal(region);
  window_.putAway();
  correctUnfilledAddress(pathname, DESK_ADDRESS);
  return false;
}

/**
 * The address of the capability or record the window shows, or null where it shows none of
 * either: an empty window, or what the success it was waiting for would have replaced anyway.
 *
 * @param {Element} region
 * @returns {string | null}
 */
function addressOfWhatItShows(region) {
  const surface = region.querySelector(":scope > [data-active-capability-id]");
  const id = surface?.getAttribute("data-active-capability-id");
  if (!id) return null;
  const record = recordInWindow(region);
  return record === null ? capabilityAddress(id) : recordAddress(id, record);
}

/**
 * A refusal drawn in the window, as one asked from inside it is (`public/app.js`), goes with the
 * window, so its sentence moves to the prompt bar first. The swap left nothing else there.
 *
 * @param {Element} region
 */
function sayDrawnRefusal(region) {
  const refusal = region.querySelector('[data-role="error"][data-error-code]');
  const sentence = refusal?.textContent?.trim();
  if (!sentence) return;
  const detail = { sentence, refused: true };
  document.dispatchEvent(new CustomEvent(PROMPT_BAR_MESSAGE_EVENT, { detail }));
}

/**
 * Ask for one address into the window from a hidden element of the ask's own, placed in `within`,
 * and hear how it ended. Its own element, because htmx queues a second request from one element
 * and a press listens to its logo's endings. The ask owns its endings: its refusal goes no further,
 * so nothing else puts the window away first, and an answer arriving after the window changed
 * hands is not swapped in or said.
 *
 * @param {AddressedWindow} window_ @param {string} pathname @param {Element} within
 * @returns {Promise<Heard>}
 */
function ask(window_, pathname, within) {
  const source = document.createElement("span");
  source.hidden = true;
  within.append(source);
  const { region } = window_;
  const holding = recordInWindow(region);
  const mine = answered;
  let changedHands = false;
  /** @type {Heard} */
  const heard = { refused: false, status: 0, current: null, drew: false };
  /* Anything else swapped into the window since, or a record opened in it, is the person's, as
   * much as a newer window or a newer address is. */
  const live = () =>
    window_.current() && mine === answered && !changedHands && recordInWindow(region) === holding;
  filling = { pathname, live };
  /** @param {Event} event @returns {HeardRequest | null} */
  const ours = (event) => {
    const detail = /** @type {CustomEvent<HeardRequest>} */ (event).detail;
    return detail?.requestConfig?.elt === source ? detail : null;
  };
  /** @param {Event} event */
  const swapping = (event) => {
    const detail = ours(event);
    if (detail === null) return;
    heard.current = live();
    if (heard.current) return;
    detail.shouldSwap = false;
    event.stopPropagation();
  };
  /** @param {Event} event */
  const swapped = (event) => {
    const detail = ours(event);
    /* Counted once it has swapped: an answer another ask turned away never changed anything. */
    if (detail === null) changedHands ||= event.target === region;
    else if ((detail.xhr?.status ?? 0) >= 400) heard.drew = true;
  };
  /** @param {Event} event */
  const refused = (event) => {
    const detail = ours(event);
    if (detail === null) return;
    event.stopPropagation();
    Object.assign(heard, { refused: true, status: detail.xhr?.status ?? 0 });
    heard.current ??= live();
  };
  /** @type {[EventTarget, string, (event: Event) => void][]} */
  const listening = [
    [region, "htmx:beforeSwap", swapping],
    [region, "htmx:afterSwap", swapped],
    ...REFUSALS.map(
      (type) =>
        /** @type {[EventTarget, string, (event: Event) => void]} */ ([source, type, refused]),
    ),
  ];
  for (const [node, type, run] of listening) node.addEventListener(type, run);
  return new Promise((resolve) => {
    const detach = () => {
      for (const [node, type, run] of listening) node.removeEventListener(type, run);
      for (const type of ENDINGS) source.removeEventListener(type, finish);
    };
    /** @param {Event} [ended] */
    const finish = (ended) => {
      if (cutShort(ended)) heard.refused = true;
      heard.current ??= live();
      detach();
      /* After htmx has finished with it: a source gone mid-ending is told its ending twice. */
      queueMicrotask(() => source.remove());
      if (filling?.live === live) filling = null;
      resolve(heard);
    };
    for (const type of ENDINGS) source.addEventListener(type, finish);
    const context = { source, target: region, swap: "innerHTML" };
    Promise.resolve(htmx()?.ajax?.("GET", pathname, context)).then(
      () => finish(),
      () => finish(),
    );
  });
}

/**
 * Whether a request ended without an answer. A severed or aborted one ends before it says so:
 * htmx sends `htmx:afterRequest` first, unsuccessful, and only then `htmx:sendError`.
 *
 * @param {Event | undefined} ended
 * @returns {boolean}
 */
function cutShort(ended) {
  const detail = /** @type {CustomEvent<{ successful?: boolean }> | undefined} */ (ended)?.detail;
  return ended?.type === "htmx:afterRequest" && detail?.successful !== true;
}

/** @returns {{ ajax?: (verb: string, path: string, context: object) => Promise<unknown> } | undefined} */
function htmx() {
  return /** @type {{ htmx?: { ajax?: (v: string, p: string, c: object) => Promise<unknown> } }} */ (
    /** @type {unknown} */ (window)
  ).htmx;
}

/**
 * The record whose view the window holds, by the id its forms post, or null where the window
 * holds no record view. Card templates are inert, so a collection's records are never read here.
 *
 * @param {{ querySelector(selector: string): unknown } | null | undefined} region
 * @returns {string | null}
 */
export function recordInWindow(region) {
  const field = /** @type {{ getAttribute(name: string): string | null } | null | undefined} */ (
    region?.querySelector(`[data-record-view] input[name="${RECORD_ID_FIELD}"]`)
  );
  return field?.getAttribute("value")?.toLowerCase() ?? null;
}

/**
 * Where the bar belongs while capability `id` stands in the window: the record address it names,
 * spelled as the desk spells it, while that record's view is what the window holds or is being asked
 * for (its collection's records can land first), and otherwise the collection's.
 *
 * @param {string} pathname the address in the bar
 * @param {string} id
 * @param {{ querySelector(selector: string): unknown } | null | undefined} region
 * @returns {string}
 */
export function windowAddress(pathname, id, region) {
  const addressed = recordFromAddress(pathname);
  if (addressed?.capability !== id) return capabilityAddress(id);
  const record = recordAddress(id, addressed.record);
  const asking = filling?.pathname === record && filling.live();
  return addressed.record === recordInWindow(region) || asking ? record : capabilityAddress(id);
}
