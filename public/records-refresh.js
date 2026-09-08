// @ts-check

/**
 * Re-reading a capability's committed records into the region they occupy: a create asks for the
 * region again rather than splicing a row, and honours the collection's active query.
 */

import { applyCollectionCount, splitCollectionCount } from "./collection-count.js";
import {
  createRecordsRegionRequestCoordinator,
  recordsRegionRequestCoordinator,
} from "./records-region-requests.js";
import { applyRecordsRegionState, searchUrlWithQuery } from "./records-region-status.js";
import { releaseRegionContent } from "./region-scope.js";

/** @typedef {(input: string, init?: RequestInit) => Promise<Response>} RefreshRequest */

export const RECORDS_REFRESH_START_EVENT = "aluna:records-refresh-start";

/**
 * @param {{ readUrl: string, searchUrl?: string, activeQuery?: string }} input
 * @returns {{ url: string, query: string }}
 */
export function committedRecordsRefreshTarget({ readUrl, searchUrl, activeQuery }) {
  const query = activeQuery?.trim() ?? "";
  if (query === "" || !searchUrl) return { url: readUrl, query: "" };
  return { url: searchUrlWithQuery(searchUrl, query), query };
}

/**
 * @param {Element} region
 * @returns {HTMLFormElement | null}
 */
function searchFormForRegion(region) {
  const collection = region.closest(".capability-collection");
  const form = collection?.querySelector("[data-capability-search]");
  return form instanceof HTMLFormElement ? form : null;
}

/** @param {Element} region */
function activeSearchQuery(region) {
  const input = searchFormForRegion(region)?.querySelector("[data-capability-search-input]");
  return input instanceof HTMLInputElement ? input.value : "";
}

/**
 * Take the region for this refresh: the View's one-shot load or a search still settling leaves
 * through the region rule, so there is no hand-off of its own.
 *
 * @param {Element} region
 * @param {string} query
 */
function startRefresh(region, query) {
  region.dispatchEvent(new CustomEvent(RECORDS_REFRESH_START_EVENT, { bubbles: true }));
  releaseRegionContent(region);
  const form = searchFormForRegion(region);
  if (form) applyRecordsRegionState(form, region, query === "" ? "idle" : "loading", "refresh");
}

/**
 * @param {Element} region
 * @param {string} query
 * @param {string} html
 */
function finishRefresh(region, query, html) {
  const form = searchFormForRegion(region);
  if (!form) {
    region.setAttribute("aria-busy", "false");
    return;
  }
  applyRecordsRegionState(
    form,
    region,
    query === "" ? "idle" : html.trim() === "" ? "no-matches" : "results",
    "refresh",
  );
}

/** @param {Element} region */
function failRefresh(region) {
  const form = searchFormForRegion(region);
  if (form) {
    applyRecordsRegionState(form, region, "error", "refresh");
    return;
  }
  region.setAttribute("aria-busy", "false");
}

/**
 * @param {unknown} value
 * @returns {value is Element}
 */
function isDomElement(value) {
  return typeof Element !== "undefined" && value instanceof Element;
}

/**
 * @param {Element | undefined} region
 * @param {(() => import("./records-region-requests.js").RecordsRegionRequestClaim) | undefined} claimRequest
 */
function claimRefreshRequest(region, claimRequest) {
  if (claimRequest) return claimRequest();
  if (region) return recordsRegionRequestCoordinator(region).claim();
  return createRecordsRegionRequestCoordinator().claim();
}

/**
 * @param {RefreshRequest} request
 * @param {string} url
 * @param {AbortSignal} signal
 */
async function requestRefreshHtml(request, url, signal) {
  const response = await request(url, {
    headers: { "HX-Request": "true" },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Committed records refresh failed with status ${response.status}`);
  }
  return response.text();
}

/**
 * Land one answer: the count is split off the head of the response, the records go in, and the
 * count follows into its label. One read produces both, so the number cannot be out of step.
 *
 * @template {{ innerHTML: string }} T
 * @param {{
 *   region: T,
 *   domRegion: Element | undefined,
 *   html: string,
 *   process: ((region: T) => void) | undefined,
 *   query: string,
 * }} input
 */
function applyRefreshedResponse({ region, domRegion, html, process, query }) {
  // These lines are the search controller's `acceptResponse` too, deliberately apart: there
  // `render` and `count` are injected, and here the region may be a bare `{ innerHTML }`.
  const { sentence, records } = splitCollectionCount(html);
  region.innerHTML = records;
  process?.(region);
  if (domRegion) {
    applyCollectionCount(domRegion, sentence);
    finishRefresh(domRegion, query, records);
  }
}

/**
 * Refresh a committed records region without hiding failures behind HTMX's promise resolution.
 * A pure seam, so the post-mutation degraded path is executable in Bun without a browser DOM.
 *
 * @template {{ innerHTML: string }} T
 * @param {{
 *   region: T,
 *   readUrl: string,
 *   searchUrl?: string,
 *   activeQuery?: string,
 *   request?: RefreshRequest,
 *   process?: (region: T) => void,
 *   claimRequest?: () => import("./records-region-requests.js").RecordsRegionRequestClaim,
 * }} input
 * @returns {Promise<{ applied: boolean, region: T, query: string }>}
 */
export async function refreshCommittedRecords({
  region,
  readUrl,
  searchUrl,
  activeQuery,
  request = fetch,
  process,
  claimRequest,
}) {
  const target = committedRecordsRefreshTarget({ readUrl, searchUrl, activeQuery });
  const domRegion = isDomElement(region) ? region : undefined;
  /* Claimed after the region is taken, not before: the release runs over everything the
   * region still holds, and a claim made first would be the first thing it aborted. */
  if (domRegion) startRefresh(domRegion, target.query);
  const claim = claimRefreshRequest(domRegion, claimRequest);
  try {
    const html = await requestRefreshHtml(request, target.url, claim.signal);
    if (!claim.isCurrent()) return { applied: false, region, query: target.query };
    applyRefreshedResponse({ region, domRegion, html, process, query: target.query });
    return { applied: true, region, query: target.query };
  } catch (error) {
    if (!claim.isCurrent()) return { applied: false, region, query: target.query };
    if (domRegion) failRefresh(domRegion);
    throw error;
  } finally {
    claim.release();
  }
}

/**
 * @template {HTMLFormElement} T
 * @param {{
 *   form: T,
 *   request?: RefreshRequest,
 *   process?: (region: HTMLElement) => void,
 * }} input
 */
export async function refreshCommittedRecordsForMutation({ form, request, process }) {
  const region = document.getElementById(form.dataset.recordsTargetId ?? "");
  const readUrl = form.dataset.readUrl;
  if (!(region instanceof HTMLElement) || !readUrl) return null;
  return refreshCommittedRecords({
    region,
    readUrl,
    searchUrl: form.dataset.searchUrl,
    activeQuery: activeSearchQuery(region),
    request,
    process,
  });
}
