// @ts-check

/** @typedef {(input: string, init?: RequestInit) => Promise<Response>} RefreshRequest */

export const RECORDS_REFRESH_START_EVENT = "aluna:records-refresh-start";

/** @typedef {"create" | "update" | "delete"} MutationKind */

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
      return "Searching…";
    case "results":
      return "Search results updated.";
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
 * @param {Element} region
 * @param {string} query
 */
function startRefresh(region, query) {
  region.dispatchEvent(new CustomEvent(RECORDS_REFRESH_START_EVENT, { bubbles: true }));
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
 * }} input
 * @returns {Promise<{ region: T, query: string }>}
 */
export async function refreshCommittedRecords({
  region,
  readUrl,
  searchUrl,
  activeQuery,
  request = fetch,
  process,
}) {
  const target = committedRecordsRefreshTarget({ readUrl, searchUrl, activeQuery });
  if (isDomElement(region)) startRefresh(region, target.query);
  try {
    const response = await request(target.url, { headers: { "HX-Request": "true" } });
    if (!response.ok) {
      throw new Error(`Committed records refresh failed with status ${response.status}`);
    }
    const html = await response.text();
    region.innerHTML = html;
    process?.(region);
    if (isDomElement(region)) finishRefresh(region, target.query, html);
    return { region, query: target.query };
  } catch (error) {
    if (isDomElement(region)) failRefresh(region);
    throw error;
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
