// @ts-check

import { applyCollectionCount, splitCollectionCount } from "./collection-count.js";
import { RECORDS_REFRESH_START_EVENT } from "./records-refresh.js";
import {
  createRecordsRegionRequestCoordinator,
  recordsRegionRequestCoordinator,
} from "./records-region-requests.js";
import { registerRegionRelease, releaseRegionContent } from "./region-scope.js";

/** @typedef {(input: string, init?: RequestInit) => Promise<Response>} SearchRequest */
/** @typedef {"idle" | "loading" | "results" | "no-matches" | "error"} SearchState */

export const DEFAULT_SEARCH_DEBOUNCE_MS = 300;

/**
 * Create the request/state core for one capability search field. The browser adapter
 * below supplies the DOM work; keeping timing and race handling here makes debounce,
 * canonical-read restoration, and route isolation executable without a browser DOM.
 *
 * @param {{
 *   readUrl: string,
 *   searchUrl: string,
 *   render: (html: string) => void,
 *   state: (state: SearchState) => void,
 *   count?: (sentence: string | undefined) => void,
 *   queryChanged?: (rawQuery: string) => void,
 *   cancelExternalRead?: () => void,
 *   claimRequest?: () => import("./records-region-requests.js").RecordsRegionRequestClaim,
 *   request?: SearchRequest,
 *   delayMs?: number,
 *   schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>,
 *   cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void,
 * }} options
 */
export function createDebouncedCapabilitySearch(options) {
  const request = options.request ?? fetch;
  const delayMs = options.delayMs ?? DEFAULT_SEARCH_DEBOUNCE_MS;
  const schedule = options.schedule ?? setTimeout;
  const cancelSchedule = options.cancelSchedule ?? clearTimeout;
  const localCoordinator = createRecordsRegionRequestCoordinator();
  const claimRequest = options.claimRequest ?? localCoordinator.claim;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @type {import("./records-region-requests.js").RecordsRegionRequestClaim | undefined} */
  let activeRequest;
  let generation = 0;

  function cancelPendingWork() {
    if (timer !== undefined) cancelSchedule(timer);
    timer = undefined;
    activeRequest?.abort();
    activeRequest = undefined;
    options.cancelExternalRead?.();
    generation += 1;
  }

  /** @param {string} rawQuery */
  function requestTarget(rawQuery) {
    const query = rawQuery.trim();
    return {
      query,
      url: query === "" ? options.readUrl : searchUrlWithQuery(options.searchUrl, query),
    };
  }

  /** @param {import("./records-region-requests.js").RecordsRegionRequestClaim} claim @param {number} ownGeneration */
  function requestIsObsolete(claim, ownGeneration) {
    return !claim.isCurrent() || ownGeneration !== generation;
  }

  /** @param {string} query @param {string} html @returns {SearchState} */
  function completedState(query, html) {
    if (query === "") return "idle";
    return html.trim() === "" ? "no-matches" : "results";
  }

  /** @param {string} url @param {AbortSignal} signal */
  async function requestHtml(url, signal) {
    const response = await request(url, {
      headers: { "HX-Request": "true" },
      signal,
    });
    if (!response.ok) throw new Error(`Search refresh failed with status ${response.status}`);
    return response.text();
  }

  /** @param {string} html @param {string} query @param {import("./records-region-requests.js").RecordsRegionRequestClaim} claim @param {number} ownGeneration */
  function acceptResponse(html, query, claim, ownGeneration) {
    if (requestIsObsolete(claim, ownGeneration)) return;
    // A search answers with both numbers — how many matched and how many there are — so
    // the label never presents a filtered number as the whole truth, and a search that
    // matched nothing says so beside a total that is not zero. Restoring the canonical
    // read brings the plain count back.
    const { sentence, records } = splitCollectionCount(html);
    options.render(records);
    options.count?.(sentence);
    options.state(completedState(query, records));
  }

  /** @param {unknown} error @param {import("./records-region-requests.js").RecordsRegionRequestClaim} claim @param {number} ownGeneration */
  function handleRequestError(error, claim, ownGeneration) {
    if (requestIsObsolete(claim, ownGeneration)) return;
    options.state("error");
    throw error;
  }

  /** @param {string} rawQuery */
  async function execute(rawQuery) {
    timer = undefined;
    const { query, url } = requestTarget(rawQuery);
    const ownGeneration = generation;
    const claim = claimRequest();
    activeRequest = claim;

    try {
      acceptResponse(await requestHtml(url, claim.signal), query, claim, ownGeneration);
    } catch (error) {
      handleRequestError(error, claim, ownGeneration);
    } finally {
      claim.release();
      if (activeRequest === claim) activeRequest = undefined;
    }
  }

  /** Debounce typing, aborting and invalidating any older in-flight response. @param {string} rawQuery */
  function update(rawQuery) {
    cancelPendingWork();
    options.queryChanged?.(rawQuery);
    options.state("loading");
    timer = schedule(() => {
      void execute(rawQuery).catch(() => undefined);
    }, delayMs);
  }

  /** Submit immediately (Enter) or restore canonical read immediately (Clear). @param {string} rawQuery */
  async function searchNow(rawQuery) {
    cancelPendingWork();
    options.queryChanged?.(rawQuery);
    options.state("loading");
    await execute(rawQuery);
  }

  return { dispose: cancelPendingWork, searchNow, update };
}

/** @param {string} searchUrl @param {string} query */
function searchUrlWithQuery(searchUrl, query) {
  const separator = searchUrl.includes("?") ? "&" : "?";
  return `${searchUrl}${separator}q=${encodeURIComponent(query)}`;
}

/** @param {HTMLFormElement} form @param {HTMLElement} region @param {SearchState} state */
function applySearchState(form, region, state) {
  form.dataset.searchState = state;
  region.setAttribute("aria-busy", state === "loading" ? "true" : "false");
  const collection = form.closest(".capability-collection");
  if (collection instanceof HTMLElement) collection.dataset.searchState = state;
  const status = collection?.querySelector("[data-capability-search-status]");
  if (!(status instanceof HTMLElement)) return;
  status.textContent = searchStatusMessage(state);
}

/** @param {SearchState} state @returns {string} */
function searchStatusMessage(state) {
  switch (state) {
    case "loading":
      return "I’m searching…";
    case "results":
      return "I updated the results.";
    case "error":
      return "I couldn’t search just now. Try again.";
    case "no-matches":
      return "I couldn’t find a match. Try another word.";
    case "idle":
      return "";
    default:
      return assertNever(state);
  }
}

/** @param {never} value @returns {never} */
function assertNever(value) {
  throw new Error(`Unhandled search state: ${String(value)}`);
}

/** @type {WeakMap<HTMLFormElement, ReturnType<typeof createDebouncedCapabilitySearch>>} */
const controllers = new WeakMap();

/** @param {HTMLFormElement} form */
function controllerFor(form) {
  const existing = controllers.get(form);
  if (existing) return existing;
  const region = document.getElementById(form.dataset.recordsRegionId ?? "");
  const readUrl = form.dataset.readUrl;
  const searchUrl = form.dataset.searchUrl;
  if (!(region instanceof HTMLElement) || !readUrl || !searchUrl) return null;
  const clear = form.querySelector("[data-capability-search-clear]");
  const delayMs = Number(form.dataset.searchDebounceMs) || DEFAULT_SEARCH_DEBOUNCE_MS;
  const htmx = /** @type {Window & { htmx?: { process(node: Element): void } }} */ (window).htmx;
  const controller = createDebouncedCapabilitySearch({
    readUrl,
    searchUrl,
    delayMs,
    claimRequest: recordsRegionRequestCoordinator(region).claim,
    render: (html) => {
      region.innerHTML = html;
      htmx?.process(region);
    },
    count: (sentence) => applyCollectionCount(region, sentence),
    state: (state) => applySearchState(form, region, state),
    queryChanged: (rawQuery) => {
      if (clear instanceof HTMLButtonElement) clear.hidden = rawQuery.length === 0;
    },
    cancelExternalRead: () => {
      // The data-free View starts one read into this region when it lands. Once a person
      // searches, that read is content the region no longer wants, so it leaves the way
      // every other piece of a region's work leaves — through the region rule.
      //
      // Nothing hand-strips the View's `hx-trigger="load"` any more, and nothing has to:
      // htmx arms a `load` trigger only where `firstInitCompleted` is unset, and that is
      // the one key `deInitNode` keeps. So the trigger arms once per element lifetime,
      // and the `htmx.process(region)` each rendered result runs cannot re-arm it into a
      // second writer. A platform test pins that guard in the vendored build.
      releaseRegionContent(region);
    },
  });
  controllers.set(form, controller);
  // The controller is the region's, not the form's: its debounce timer and its in-flight
  // request outlive the swap that takes the form away unless the region releases them.
  // Dropping the WeakMap entry with it means a re-rendered form gets a fresh controller
  // rather than a disposed one.
  registerRegionRelease(form, "search controller", () => {
    controllers.delete(form);
    controller.dispose();
  });
  return controller;
}

function installSearchChrome() {
  document.addEventListener("input", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.matches("[data-capability-search-input]")) {
      return;
    }
    const form = input.closest("[data-capability-search]");
    if (form instanceof HTMLFormElement) controllerFor(form)?.update(input.value);
  });

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches("[data-capability-search]")) return;
    event.preventDefault();
    const input = form.querySelector("[data-capability-search-input]");
    if (input instanceof HTMLInputElement) {
      void controllerFor(form)
        ?.searchNow(input.value)
        .catch(() => undefined);
    }
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const clear = target.closest("[data-capability-search-clear]");
    if (!(clear instanceof HTMLButtonElement)) return;
    const form = clear.closest("[data-capability-search]");
    const input = form?.querySelector("[data-capability-search-input]");
    if (!(form instanceof HTMLFormElement) || !(input instanceof HTMLInputElement)) return;
    input.value = "";
    void controllerFor(form)
      ?.searchNow("")
      .then(() => input.focus())
      .catch(() => input.focus());
  });

  document.addEventListener(RECORDS_REFRESH_START_EVENT, (event) => {
    const region = event.target;
    if (!(region instanceof HTMLElement)) return;
    const form = region
      .closest(".capability-collection")
      ?.querySelector("[data-capability-search]");
    if (form instanceof HTMLFormElement) controllers.get(form)?.dispose();
  });
}

if (typeof document !== "undefined") installSearchChrome();
