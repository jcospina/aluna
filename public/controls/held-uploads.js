// @ts-check

/**
 * What each file control holds that no save has claimed, and the uploads still travelling to it
 * (Module 7 PLAN decisions 19 and 32). A key an upload answered with is the form's to give back:
 * once its control holds it no longer, or the control leaves the page, the key goes to the
 * pending-only route at once instead of waiting for a desk load's sweep. A key a committed save
 * holds is forgotten here. One whose save the page never heard back from still goes, and the route
 * leaves it alone if that save committed. The leave warning (7.3/03) asks `holdsUpload` whether a
 * form has anything to lose.
 */

import { holds, registerRegionRelease } from "../core/region-scope.js";
import { FILE_DISCARD_PATH } from "../core/shell-dom.js";

/**
 * The control's element, as much of it as the bookkeeping reads.
 *
 * @typedef {import("../core/region-scope.js").ScopeAnchor} Host
 * @typedef {Pick<Host, "contains">} Scope
 * @typedef {{
 *   held: Set<string>,
 *   arriving: Set<string>,
 *   travelling: Set<object>,
 *   unwatch: (() => void) | null,
 * }} Holding
 * @typedef {{ ok: boolean, status: number }} Answer
 * @typedef {{
 *   send?: (keys: string[]) => Promise<Answer>,
 *   watch?: typeof registerRegionRelease,
 *   schedule?: (run: () => void, ms: number) => void,
 * }} HeldUploadsOptions
 */

/**
 * Keys per request. A body sent as the page goes shares the browser's 64 KiB keepalive budget with
 * every other one in flight, and 200 keys is about 8 KB.
 */
export const DISCARD_BATCH_KEYS = 200;

/** The waits before each retry of a discard the network or the server failed. */
export const DISCARD_RETRY_DELAYS_MS = Object.freeze([1_000, 5_000]);

/** @param {string[]} keys @returns {Promise<Answer>} */
function sendDiscard(keys) {
  return fetch(FILE_DISCARD_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ keys }),
    credentials: "same-origin",
    keepalive: true,
  });
}

/**
 * Move what `holding` heard its control take from arriving to held, forget what a save took, and
 * answer the keys the control holds no longer that no save took.
 *
 * @param {Holding} holding @param {readonly string[]} current @param {readonly string[]} saved
 */
function settleHolding(holding, current, saved) {
  for (const key of current) if (holding.arriving.delete(key)) holding.held.add(key);
  const gone = [...holding.held].filter((key) => !current.includes(key) && !saved.includes(key));
  for (const key of [...holding.held]) {
    if (saved.includes(key) || gone.includes(key)) holding.held.delete(key);
  }
  return gone;
}

/** @param {HeldUploadsOptions} [options] */
export function createHeldUploads(options = {}) {
  const send = options.send ?? sendDiscard;
  const watch = options.watch ?? registerRegionRelease;
  const schedule = options.schedule ?? ((run, ms) => void setTimeout(run, ms));
  /** @type {Map<Host, Holding>} */
  const holdings = new Map();
  /** @type {Set<string>} */
  let batch = new Set();

  /** @param {Host} host */
  function holdingOf(host) {
    let holding = holdings.get(host);
    if (!holding) {
      holding = { held: new Set(), arriving: new Set(), travelling: new Set(), unwatch: null };
      holdings.set(host, holding);
    }
    return holding;
  }

  /** @param {Host} host */
  function forgetIfEmpty(host) {
    const holding = holdings.get(host);
    if (!holding || holding.held.size + holding.arriving.size + holding.travelling.size > 0) return;
    holding.unwatch?.();
    holdings.delete(host);
  }

  /**
   * Send `keys`, and again after each delay while the network or the server fails. A refusal of the
   * request itself would only be refused again; the desk-load sweep is the backstop.
   *
   * @param {string[]} keys @param {number} attempt
   */
  function deliver(keys, attempt) {
    const retry = () => {
      const delay = DISCARD_RETRY_DELAYS_MS[attempt];
      if (delay !== undefined) schedule(() => deliver(keys, attempt + 1), delay);
    };
    Promise.resolve()
      .then(() => send(keys))
      .then((answer) => {
        if (!(answer?.status < 500)) retry();
      }, retry);
  }

  /** Every key let go of in one task goes out together. @param {Iterable<string>} keys */
  function discard(keys) {
    const first = batch.size === 0;
    for (const key of keys) batch.add(key);
    if (!first || batch.size === 0) return;
    queueMicrotask(() => {
      const all = [...batch];
      batch = new Set();
      for (let at = 0; at < all.length; at += DISCARD_BATCH_KEYS) {
        deliver(all.slice(at, at + DISCARD_BATCH_KEYS), 0);
      }
    });
  }

  /** @param {Host} host */
  function letGo(host) {
    const holding = holdings.get(host);
    if (!holding) return;
    discard([...holding.held, ...holding.arriving]);
    holding.held.clear();
    holding.arriving.clear();
    forgetIfEmpty(host);
  }

  /**
   * Give the keys back once the control is off the page. A region asks before it swaps, while the
   * control is still connected, and the read it waits on can fail and leave it standing, so a
   * connected control is watched again rather than let go of.
   *
   * @param {Host} host @param {Holding} holding
   */
  function watchHost(host, holding) {
    if (holding.unwatch) return;
    holding.unwatch = watch(host, "held upload", () => {
      holding.unwatch = null;
      if (host.isConnected) watchHost(host, holding);
      else letGo(host);
    });
  }

  return {
    /**
     * An upload set off from `host`: what `holdsUpload` counts until the returned call says it
     * settled.
     *
     * @param {Host} host
     */
    travelling(host) {
      const request = {};
      holdingOf(host).travelling.add(request);
      return () => {
        holdings.get(host)?.travelling.delete(request);
        forgetIfEmpty(host);
      };
    },

    /**
     * The upload route answered `host` with `key`. A control that never comes to hold it, because
     * a later pick took its place first, gives it back once the answer has been heard.
     *
     * @param {Host} host @param {string} key
     */
    arrived(host, key) {
      const holding = holdingOf(host);
      holding.arriving.add(key);
      watchHost(host, holding);
      schedule(() => {
        if (!holding.arriving.delete(key)) return;
        discard([key]);
        forgetIfEmpty(host);
      }, 0);
    },

    /**
     * What `host` holds now and holds as saved, by admitted key. A key it held that it holds no
     * longer, and no save took, is given back; one a save took is forgotten.
     *
     * @param {Host} host @param {readonly string[]} current @param {readonly string[]} saved
     */
    heard(host, current, saved) {
      const holding = holdings.get(host);
      if (!holding) return;
      discard(settleHolding(holding, current, saved));
      forgetIfEmpty(host);
    },

    /**
     * A save of the form `scope` committed: whatever its controls held is the record's now. A key
     * still arriving was not held, so the save did not carry it.
     *
     * @param {Scope} scope
     */
    claimed(scope) {
      for (const [host, holding] of holdings) {
        if (!holds(scope, host)) continue;
        holding.held.clear();
        forgetIfEmpty(host);
      }
    },

    /**
     * Whether a control in `scope` holds an upload no save has claimed, or is still sending one.
     *
     * @param {Scope} scope
     */
    holdsUpload(scope) {
      for (const [host, holding] of holdings) {
        const any = holding.held.size + holding.arriving.size + holding.travelling.size > 0;
        if (any && holds(scope, host)) return true;
      }
      return false;
    },
  };
}

/** The page's one bookkeeping, which the file controls report to. */
export const heldUploads = createHeldUploads();

/** @param {Scope} scope */
export const holdsUpload = (scope) => heldUploads.holdsUpload(scope);
