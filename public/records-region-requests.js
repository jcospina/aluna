// @ts-check

/**
 * One request-ownership module for a records region. Search, canonical reads, and
 * post-mutation refreshes all write the same DOM surface, so the newest claim is
 * the only response allowed to render. Aborting is an optimization; the ownership
 * check remains the integrity rule when a request adapter ignores AbortSignal.
 */

/** @typedef {{ abort: () => void, isCurrent: () => boolean, release: () => void, signal: AbortSignal }} RecordsRegionRequestClaim */

export function createRecordsRegionRequestCoordinator() {
  /** @type {AbortController | undefined} */
  let active;

  /** @returns {RecordsRegionRequestClaim} */
  function claim() {
    active?.abort();
    const controller = new AbortController();
    active = controller;
    return {
      abort: () => {
        controller.abort();
        if (active === controller) active = undefined;
      },
      isCurrent: () => active === controller && !controller.signal.aborted,
      release: () => {
        if (active === controller) active = undefined;
      },
      signal: controller.signal,
    };
  }

  return { claim };
}

/** @type {WeakMap<Element, ReturnType<typeof createRecordsRegionRequestCoordinator>>} */
const coordinators = new WeakMap();

/** @param {Element} region */
export function recordsRegionRequestCoordinator(region) {
  const existing = coordinators.get(region);
  if (existing) return existing;
  const coordinator = createRecordsRegionRequestCoordinator();
  coordinators.set(region, coordinator);
  return coordinator;
}

/**
 * Transfer a records region away from its one-shot HTMX read before any native
 * request claims it. This covers the initial load even when search has not yet
 * created its controller.
 * @param {Element} region
 * @param {{ trigger(node: Element, eventName: string): void } | undefined} htmx
 */
export function handOffRecordsRegionFromHtmx(region, htmx) {
  htmx?.trigger(region, "htmx:abort");
  region.removeAttribute("hx-get");
  region.removeAttribute("hx-trigger");
}
