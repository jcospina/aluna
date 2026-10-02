// @ts-check

/**
 * What each file control holds that no save has claimed, and the uploads still travelling to it
 * (Module 7 PLAN decisions 19 and 32). A key an upload answered with is the form's to give back:
 * once its control holds it no longer, or the control leaves the page, the key goes to the
 * pending-only route at once instead of waiting for a desk load's sweep. A key a committed save
 * holds is forgotten here. A key a save is still carrying is the save's: a leave neither asks about
 * it nor sends it, so a save the server committed keeps its file, and one it never did leaves the
 * key to the desk-load sweep. The leave question (7.3/03) asks `uploadsIn` what a form would lose.
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
 *   carried: Set<string>,
 *   arriving: Set<string>,
 *   travelling: Map<object, () => void>,
 *   unwatch: (() => void) | null,
 * }} Holding
 * @typedef {"saved" | "refused" | "unknown"} SaveOutcome
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

/** @param {Holding} holding */
const lossOf = (holding) => holding.held.size + holding.arriving.size + holding.travelling.size;

/** @returns {Holding} */
const emptyHolding = () => ({
  held: new Set(),
  carried: new Set(),
  arriving: new Set(),
  travelling: new Map(),
  unwatch: null,
});

/** What `holding` holds goes out with a save. @param {Holding} holding */
function carry(holding) {
  for (const key of holding.held) holding.carried.add(key);
  holding.held.clear();
}

/** A save ended: what it carried is the form's again, or no longer anything of the form's. */
function landCarried(/** @type {Holding} */ holding, /** @type {boolean} */ handBack) {
  if (handBack) for (const key of holding.carried) holding.held.add(key);
  holding.carried.clear();
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
  /** @type {Map<Scope, { gone: boolean, unwatch: () => void }>} the forms a save is out from */
  const saves = new Map();

  /** @param {Host} host */
  function holdingOf(host) {
    const holding = holdings.get(host) ?? emptyHolding();
    holdings.set(host, holding);
    return holding;
  }

  /** @param {Host} host */
  function forgetIfEmpty(host) {
    const holding = holdings.get(host);
    if (!holding || lossOf(holding) + holding.carried.size > 0) return;
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
    holding.carried.clear();
    forgetIfEmpty(host);
  }

  /** @param {Scope} scope @returns {[Host, Holding][]} */
  const holdingsIn = (scope) => [...holdings].filter(([host]) => holds(scope, host));

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
     * An upload set off from `host`: what `uploadsIn` counts until the returned call says it
     * settled, and what `abort` stops if the form is let go of first.
     *
     * @param {Host} host @param {() => void} [abort]
     */
    travelling(host, abort = () => {}) {
      const request = {};
      holdingOf(host).travelling.set(request, abort);
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
      for (const [host, holding] of holdingsIn(scope)) {
        holding.held.clear();
        holding.carried.clear();
        forgetIfEmpty(host);
      }
    },

    /**
     * A save of the form `scope` went out carrying what its controls hold, until `sent` says how
     * it ended. A form the region takes away meanwhile is noted, since its abort reads as unknown.
     *
     * @param {Scope & Host} scope
     */
    sending(scope) {
      if (saves.has(scope)) return;
      for (const [, holding] of holdingsIn(scope)) carry(holding);
      const save = { gone: false, unwatch: () => {} };
      save.unwatch = watch(scope, "save carrying uploads", () => {
        save.gone = true;
      });
      saves.set(scope, save);
    },

    /**
     * How the save of `scope` ended. A refused one, or one unheard from by a form still standing,
     * hands its keys back to the form, which gives them to the route once it is off the page. A
     * committed one keeps them, and so does one cut off by its form going: the sweep decides.
     *
     * @param {Scope} scope @param {SaveOutcome} outcome
     */
    sent(scope, outcome) {
      const save = saves.get(scope);
      saves.delete(scope);
      save?.unwatch();
      const handBack = outcome === "refused" || (outcome === "unknown" && !save?.gone);
      for (const [host, holding] of holdingsIn(scope)) {
        landCarried(holding, handBack);
        forgetIfEmpty(host);
      }
    },

    /**
     * Give back everything the controls in `scope` hold and stop what they are still sending, the
     * moment a leave is confirmed. A key a save is carrying stays the save's.
     *
     * @param {Scope} scope
     */
    letGo(scope) {
      for (const [host, holding] of holdingsIn(scope)) {
        for (const abort of holding.travelling.values()) abort();
        holding.travelling.clear();
        discard([...holding.held, ...holding.arriving]);
        holding.held.clear();
        holding.arriving.clear();
        forgetIfEmpty(host);
      }
    },

    /**
     * How many uploads a control in `scope` holds that no save has claimed or is carrying,
     * counting the ones still on their way.
     *
     * @param {Scope} scope
     */
    uploadsIn(scope) {
      return holdingsIn(scope).reduce((sum, [, holding]) => sum + lossOf(holding), 0);
    },
  };
}

/** The page's one bookkeeping, which the file controls report to. */
export const heldUploads = createHeldUploads();

/** @param {Scope} scope */
export const holdsUpload = (scope) => heldUploads.uploadsIn(scope) > 0;
