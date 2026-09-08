// @ts-check

/**
 * Every swap target fails loudly: ADR-0002 leaves the server blind to whether a region is on
 * screen, so the client owes the named target. `region-scope.js` keeps most of that promise.
 */

/**
 * The two events whose target the client is on the hook for (ADR-0002). htmx's SSE extension
 * drops a message whose listener has left the document, and says nothing; this raises instead.
 */
export const GUARDED_SWAP_EVENTS = Object.freeze(["commit", "fragment"]);

/** What a raised swap-target failure announces itself with before it throws. */
export const MISSING_SWAP_TARGET_EVENT = "aluna:missing-swap-target";

/** The listener nodes an SSE connection swaps through. */
const SWAP_LISTENER_SELECTOR = "[sse-swap], [data-sse-swap]";

/**
 * The DOM facts a swap target has to answer for, and nothing else. Structural on purpose, so a
 * test double satisfies it as well as an `Element` and the rule runs in Bun without a browser.
 *
 * @typedef {{
 *   readonly isConnected: boolean,
 *   getAttribute(name: string): string | null,
 * }} SwapTarget
 */

/**
 * The connection a named event arrives on — the element carrying `sse-connect`. It can carry
 * `sse-swap` itself as well as hold listeners under it, a shape htmx supports.
 *
 * @typedef {SwapTarget & {
 *   querySelectorAll(selector: string): Iterable<SwapTarget>,
 * }} SwapConnection
 */

/**
 * Where a listener's swap lands, decided by htmx and asked of it rather than reproduced.
 * @typedef {(listener: SwapTarget) => SwapTarget | null | undefined} SwapTargetResolver
 */

/** A `commit` or `fragment` that arrived with nowhere to land. */
export class MissingSwapTargetError extends Error {
  /**
   * @param {string} eventName
   * @param {string} reason
   */
  constructor(eventName, reason) {
    super(
      `The \`${eventName}\` swap found no target: ${reason}. ` +
        "A swap that lands nowhere is indistinguishable from a build that produced nothing.",
    );
    this.name = "MissingSwapTargetError";
    this.eventName = eventName;
    this.reason = reason;
  }
}

/**
 * Every listener node a named event swaps through: the connection when it carries `sse-swap`,
 * and every descendant that does — htmx registers all of them, so a guard on the first is deaf.
 *
 * @param {SwapConnection} connection
 * @param {string} eventName
 * @returns {SwapTarget[]}
 */
export function findSwapListeners(connection, eventName) {
  const candidates = [connection, ...connection.querySelectorAll(SWAP_LISTENER_SELECTOR)];
  // `sse-swap` is a comma-separated list, split the way the extension splits it: `commit` must
  // never be answered by the developer panel's `commit-preview`.
  return candidates.filter((node) => {
    const attribute = node.getAttribute("sse-swap") ?? node.getAttribute("data-sse-swap") ?? "";
    return attribute.split(",").some((name) => name.trim() === eventName);
  });
}

/**
 * Find where every listener for one arriving swap lands, or raise. There is no third
 * answer, and no listener at all is one of the two ways to have nowhere to land.
 *
 * @param {SwapConnection} connection
 * @param {string} eventName
 * @param {SwapTargetResolver} resolveTarget
 * @returns {SwapTarget[]}
 */
export function requireSwapTargets(connection, eventName, resolveTarget) {
  const listeners = findSwapListeners(connection, eventName);
  if (listeners.length === 0) {
    throw new MissingSwapTargetError(eventName, "the stream carries no listener for it");
  }

  return listeners.map((listener) => {
    const target = resolveTarget(listener);
    if (!target?.isConnected) {
      throw new MissingSwapTargetError(eventName, "its named target has left the document");
    }
    return target;
  });
}

/** @param {unknown} error */
function announceMissingSwapTarget(error) {
  if (typeof document === "undefined" || typeof CustomEvent === "undefined") return;
  document.dispatchEvent(new CustomEvent(MISSING_SWAP_TARGET_EVENT, { detail: { error } }));
}

/**
 * Guard one open connection. The check swaps nothing, so order against htmx's own listener does
 * not matter: `htmx:sseOpen` fires after registering on a first connect and before on a reconnect.
 *
 * @param {SwapConnection} connection
 * @param {{ addEventListener(type: string, listener: () => void): void }} source
 * @param {SwapTargetResolver} resolveTarget
 */
export function guardSwapTargets(connection, source, resolveTarget) {
  for (const eventName of GUARDED_SWAP_EVENTS) {
    source.addEventListener(eventName, () => {
      try {
        requireSwapTargets(connection, eventName, resolveTarget);
      } catch (error) {
        announceMissingSwapTarget(error);
        throw error;
      }
    });
  }
}

/**
 * Reimplementing this would mean `hx-target`'s inheritance and htmx's extended selectors
 * (`closest`, `find`, `next`, `previous`, `this`), and any drift is a false alarm or a silence.
 * @typedef {{ getTarget(listener: Element): Element | null | undefined }} HtmxInternalApi
 */

/** @type {HtmxInternalApi | null} */
let borrowedApi = null;

/**
 * htmx's own `getTarget`, borrowed rather than reimplemented. Defining an extension is how htmx
 * hands out its internal API — the SSE extension holds the same object.
 *
 * @returns {SwapTargetResolver}
 */
export function htmxSwapTargetResolver() {
  if (borrowedApi === null) {
    const htmx = /** @type {Window & { htmx?: { defineExtension?: Function } }} */ (window).htmx;
    htmx?.defineExtension?.("aluna-swap-target", {
      /** @param {HtmxInternalApi} api */
      init: (api) => {
        borrowedApi = api;
      },
    });
  }

  const api = borrowedApi;
  if (api === null) {
    // The guard cannot agree with htmx about where a swap lands without asking it; degrading
    // to a guess is the failure mode this file exists to prevent.
    throw new Error("The swap-target guard could not borrow htmx's target resolution.");
  }

  return (listener) => api.getTarget(/** @type {Element} */ (listener));
}

/**
 * Start guarding every SSE connection the shell opens. The resolver is borrowed per connection
 * rather than at startup, so this never depends on htmx having finished loading.
 *
 * @param {Document} root
 * @param {() => SwapTargetResolver} borrowResolver
 */
export function startSwapTargetGuard(root, borrowResolver = htmxSwapTargetResolver) {
  /** A reconnect builds a fresh EventSource; `onopen` can fire twice on the same one. */
  const guarded = new WeakSet();

  root.addEventListener("htmx:sseOpen", (event) => {
    const connection = /** @type {SwapConnection | null} */ (event.target);
    const source = /** @type {CustomEvent<{ source?: EventTarget }>} */ (event).detail?.source;
    if (typeof connection?.querySelectorAll !== "function") return;
    if (typeof source?.addEventListener !== "function") return;
    if (guarded.has(source)) return;
    guarded.add(source);
    guardSwapTargets(connection, source, borrowResolver());
  });
}

if (typeof document !== "undefined") startSwapTargetGuard(document);
