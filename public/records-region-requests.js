// @ts-check

/**
 * Search, canonical reads, and post-mutation refreshes write one records region, so only the
 * newest claim renders. Aborting is an optimization; an adapter may ignore AbortSignal.
 */

import { registerRegionRelease } from "./region-scope.js";

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

/** @type {WeakMap<Element, { claim: () => RecordsRegionRequestClaim }>} */
const coordinators = new WeakMap();

/**
 * A claim doubles as a region release while in flight, so replacing or retiring the region
 * aborts it rather than resolving against a detached node, which frees the server's read token.
 *
 * @param {Element} region
 */
export function recordsRegionRequestCoordinator(region) {
  const existing = coordinators.get(region);
  if (existing) return existing;
  const core = createRecordsRegionRequestCoordinator();
  const coordinator = {
    /** @returns {RecordsRegionRequestClaim} */
    claim: () => {
      const claim = core.claim();
      const deregister = registerRegionRelease(region, "records read", claim.abort);
      return {
        ...claim,
        abort: () => {
          deregister();
          claim.abort();
        },
        release: () => {
          deregister();
          claim.release();
        },
      };
    },
  };
  coordinators.set(region, coordinator);
  return coordinator;
}
