// @ts-check

/** @typedef {(input: string, init?: RequestInit) => Promise<Response>} SearchRequest */
/** @typedef {"idle" | "loading" | "results" | "no-matches" | "error"} SearchState */

export const DEFAULT_SEARCH_DEBOUNCE_MS = 300;

/**
 * Transfer the shared records region from its one-shot HTMX read to native-fetch
 * search ownership. HTMX's public trigger API creates the bubbling, detailed abort
 * event its body-level listener expects; removing the attributes also prevents a
 * not-yet-started load trigger from becoming a second writer.
 *
 * @param {Element} region
 * @param {{ trigger(node: Element, eventName: string): void } | undefined} htmx
 */
export function handOffRecordsRegionToSearch(region, htmx) {
  htmx?.trigger(region, "htmx:abort");
  region.removeAttribute("hx-get");
  region.removeAttribute("hx-trigger");
}

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
 *   queryChanged?: (rawQuery: string) => void,
 *   cancelExternalRead?: () => void,
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
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @type {AbortController | undefined} */
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

  /** @param {AbortController} controller @param {number} ownGeneration */
  function requestIsObsolete(controller, ownGeneration) {
    return controller.signal.aborted || ownGeneration !== generation;
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

  /** @param {string} html @param {string} query @param {AbortController} controller @param {number} ownGeneration */
  function acceptResponse(html, query, controller, ownGeneration) {
    if (requestIsObsolete(controller, ownGeneration)) return;
    options.render(html);
    options.state(completedState(query, html));
  }

  /** @param {unknown} error @param {AbortController} controller @param {number} ownGeneration */
  function handleRequestError(error, controller, ownGeneration) {
    if (requestIsObsolete(controller, ownGeneration)) return;
    options.state("error");
    throw error;
  }

  /** @param {string} rawQuery */
  async function execute(rawQuery) {
    timer = undefined;
    const { query, url } = requestTarget(rawQuery);
    const ownGeneration = generation;
    const controller = new AbortController();
    activeRequest = controller;

    try {
      acceptResponse(await requestHtml(url, controller.signal), query, controller, ownGeneration);
    } catch (error) {
      handleRequestError(error, controller, ownGeneration);
    } finally {
      if (activeRequest === controller) activeRequest = undefined;
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
      return "Searching…";
    case "results":
      return "Search results updated.";
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
  const htmx =
    /** @type {Window & { htmx?: { process(node: Element): void, trigger(node: Element, eventName: string): void } }} */ (
      window
    ).htmx;
  const controller = createDebouncedCapabilitySearch({
    readUrl,
    searchUrl,
    delayMs,
    render: (html) => {
      region.innerHTML = html;
      htmx?.process(region);
    },
    state: (state) => applySearchState(form, region, state),
    queryChanged: (rawQuery) => {
      if (clear instanceof HTMLButtonElement) clear.hidden = rawQuery.length === 0;
    },
    cancelExternalRead: () => {
      // The data-free View starts one HTMX read on load. Once a person searches,
      // native fetch owns this region; abort an in-flight initial read and remove
      // its one-shot trigger so a late canonical response cannot overwrite results.
      handOffRecordsRegionToSearch(region, htmx);
    },
  });
  controllers.set(form, controller);
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
}

if (typeof document !== "undefined") installSearchChrome();
