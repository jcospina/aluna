// @ts-check

/**
 * Re-reading a capability's committed records into the region they already occupy.
 *
 * The one place a mutation's aftermath meets the read path: a committed create asks for
 * the region again rather than splicing a row in by hand, so what the user sees after a
 * mutation is what the server actually holds. Search is part of that — a refresh honours
 * the query the collection is filtered by, so a create under an active search does not
 * silently widen it.
 *
 * Kept as a pure seam over `region.innerHTML` so the degraded paths (a failed refresh, a
 * response that lost its claim) are executable in Bun without a browser DOM.
 */

import { applyCollectionCount, splitCollectionCount } from "./collection-count.js";
import {
  createRecordsRegionRequestCoordinator,
  recordsRegionRequestCoordinator,
} from "./records-region-requests.js";
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
  const separator = searchUrl.includes("?") ? "&" : "?";
  return { url: `${searchUrl}${separator}q=${encodeURIComponent(query)}`, query };
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
 * @param {HTMLFormElement} form
 * @param {Element} region
 * @param {"idle" | "loading" | "results" | "no-matches" | "error"} state
 */
function applyRefreshState(form, region, state) {
  form.dataset.searchState = state;
  region.setAttribute("aria-busy", state === "loading" ? "true" : "false");
  const collection = form.closest(".capability-collection");
  if (collection instanceof HTMLElement) collection.dataset.searchState = state;
  const status = collection?.querySelector("[data-capability-search-status]");
  if (status instanceof HTMLElement) status.textContent = refreshStatusMessage(state);
}

/** @param {"idle" | "loading" | "results" | "no-matches" | "error"} state */
function refreshStatusMessage(state) {
  switch (state) {
    case "loading":
      return "I’m searching…";
    case "results":
      return "I updated the results.";
    case "error":
      return "I couldn’t refresh that just now. Try again.";
    case "no-matches":
      return "I couldn’t find a match. Try another word.";
    case "idle":
      return "";
    default:
      throw new Error(`Unhandled refresh state: ${String(state)}`);
  }
}

/**
 * Take the region for this refresh: whatever was reading into it — the View's own
 * one-shot load, a search still settling — leaves through the region rule. There is no
 * hand-off of its own, because one rule already owns everything a region's content
 * started.
 *
 * @param {Element} region
 * @param {string} query
 */
function startRefresh(region, query) {
  region.dispatchEvent(new CustomEvent(RECORDS_REFRESH_START_EVENT, { bubbles: true }));
  releaseRegionContent(region);
  const form = searchFormForRegion(region);
  if (form) applyRefreshState(form, region, query === "" ? "idle" : "loading");
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
  applyRefreshState(
    form,
    region,
    query === "" ? "idle" : html.trim() === "" ? "no-matches" : "results",
  );
}

/** @param {Element} region */
function failRefresh(region) {
  const form = searchFormForRegion(region);
  if (form) {
    applyRefreshState(form, region, "error");
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
 * Land one answer: the count is split off the head of the response, then the records go
 * in and the count follows them into its label. One read produces both, so there is no
 * second request for the number to be out of step with.
 *
 * The last three lines are the search controller's `acceptResponse` as well, and they stay
 * apart on purpose: there, `render` and `count` are injected so the timing core runs with
 * no DOM at all, and here the region may be a bare `{ innerHTML }` with no label to write.
 * What the two genuinely share — the split and the write — they already import.
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
  const { sentence, records } = splitCollectionCount(html);
  region.innerHTML = records;
  process?.(region);
  if (domRegion) {
    applyCollectionCount(domRegion, sentence);
    finishRefresh(domRegion, query, records);
  }
}

/**
 * Refresh a committed records region without hiding failures behind HTMX's
 * promise resolution. Keeping this seam pure makes the post-mutation degraded path
 * executable in Bun without a browser DOM.
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
