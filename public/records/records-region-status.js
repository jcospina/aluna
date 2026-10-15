// @ts-check

/**
 * The status a capability's records region is in, and the sentence it says about each.
 *
 * A search and a post-save re-read replace the same rows and write the same
 * `[data-capability-search-status]` element, so the vocabulary is one vocabulary. Only the failure
 * differs, and it differs for a reason: the person who just saved a record did not search for
 * anything, and telling them a search failed would be untrue. Both sentences live here, where
 * they can be read together, rather than one in each controller.
 */

import { RECORDS_UNREAD_ATTR } from "../core/shell-dom.js";

/** The records region's own marker. */
const RECORDS_REGION_SELECTOR = '[data-content-region="records"]';

/** @typedef {"idle" | "loading" | "results" | "no-matches" | "error"} RecordsRegionState */
/** @typedef {"search" | "refresh"} RecordsRegionAct */

/** @param {RecordsRegionState} state @param {RecordsRegionAct} act @returns {string} */
export function recordsRegionStatusMessage(state, act) {
  switch (state) {
    case "loading":
      return "I’m searching…";
    case "results":
      return "I updated the results.";
    case "error":
      return act === "search"
        ? "I couldn’t search just now. Try again."
        : "I couldn’t refresh that just now. Try again.";
    case "no-matches":
      return "I couldn’t find a match. Try another word.";
    case "idle":
      return "";
    default:
      throw new Error(`Unhandled records region state: ${String(state)}`);
  }
}

/**
 * @param {HTMLFormElement} form
 * @param {Element} region
 * @param {RecordsRegionState} state
 * @param {RecordsRegionAct} act
 */
export function applyRecordsRegionState(form, region, state, act) {
  form.dataset.searchState = state;
  region.setAttribute("aria-busy", state === "loading" ? "true" : "false");
  const collection = form.closest(".capability-collection");
  if (collection instanceof HTMLElement) collection.dataset.searchState = state;
  const status = collection?.querySelector("[data-capability-search-status]");
  if (status instanceof HTMLElement) status.textContent = recordsRegionStatusMessage(state, act);
}

/** @param {string} searchUrl @param {string} query */
export function searchUrlWithQuery(searchUrl, query) {
  const separator = searchUrl.includes("?") ? "&" : "?";
  return `${searchUrl}${separator}q=${encodeURIComponent(query)}`;
}

/**
 * @param {Element} region
 * @returns {HTMLFormElement | null}
 */
export function searchFormForRegion(region) {
  const collection = region.closest(".capability-collection");
  const form = collection?.querySelector("[data-capability-search]");
  return form instanceof HTMLFormElement ? form : null;
}

/**
 * A read that failed with nothing to show for it leaves the region still unread, and a collection
 * that says nothing is no better than one that says it is empty. A refusal swapped in speaks itself.
 *
 * @param {Element} region
 * @returns {boolean} whether the failure was said
 */
function sayUnansweredReadFailed(region) {
  if (region.querySelector(`:scope > [${RECORDS_UNREAD_ATTR}]`) === null) return false;
  const form = searchFormForRegion(region);
  if (!form) return false;
  applyRecordsRegionState(form, region, "error", "refresh");
  return true;
}

function installRecordsRegionStatus() {
  // An abort is neither: a region released mid-read is being replaced or read again.
  for (const failed of ["htmx:sendError", "htmx:responseError"]) {
    document.addEventListener(failed, (event) => {
      const region = event.target;
      if (region instanceof Element && region.matches(RECORDS_REGION_SELECTOR)) {
        sayUnansweredReadFailed(region);
      }
    });
  }
}

if (typeof document !== "undefined") installRecordsRegionStatus();
