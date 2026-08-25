// @ts-check

/**
 * Every swap target fails loudly.
 *
 * ADR-0002's transport contract is untouched: `commit` and `fragment` keep addressing a
 * stable named target, and the server still knows nothing about whether a region is on
 * screen. The obligation sits here — **the client guarantees the named target exists
 * whenever a swap can be in flight** — and the content region's release rule
 * (`region-scope.js`) keeps most of that promise by cancelling what a departing region
 * started, so nothing can normally arrive at a region that has gone.
 *
 * This is the residual case, made audible instead of assumed away. htmx's SSE extension
 * drops a message whose listener node has left the document, and it drops it in silence:
 * the listener is unregistered and nothing is said. A swap that lands nowhere is
 * indistinguishable from a build that produced nothing — which is the one outcome that is
 * not allowed. Here the same moment raises.
 */

/** The two events whose target the client is on the hook for (ADR-0002). */
export const GUARDED_SWAP_EVENTS = Object.freeze(["commit", "fragment"]);

/** What a raised swap-target failure announces itself with before it throws. */
export const MISSING_SWAP_TARGET_EVENT = "aluna:missing-swap-target";

/** The listener nodes an SSE connection swaps through. */
const SWAP_LISTENER_SELECTOR = "[sse-swap], [data-sse-swap]";

/**
 * The DOM facts a swap target has to answer for, and nothing else. Structural on purpose,
 * the way the release scope's anchor is: a real `Element` satisfies it and so does a test
 * double, which is what lets the rule run in Bun without a browser.
 *
 * @typedef {{
 *   readonly isConnected: boolean,
 *   getAttribute(name: string): string | null,
 * }} SwapTarget
 */

/**
 * The connection a named event arrives on — the element carrying `sse-connect`. It can
 * carry `sse-swap` itself as well as holding listeners under it, which is a shape htmx
 * supports and the window is likely to use once page assembly collapses to one anchor.
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
 * Every listener node a named event swaps through: the connection itself when it carries
 * `sse-swap`, and every descendant that does. All of them, because htmx registers all of
 * them — a guard that checked only the first would leave the rest silent.
 *
 * `sse-swap` takes a comma-separated list, so the name is matched the way the extension
 * itself splits it rather than by string containment: `commit` must never be answered by
 * the developer panel's `commit-preview`.
 *
 * @param {SwapConnection} connection
 * @param {string} eventName
 * @returns {SwapTarget[]}
 */
export function findSwapListeners(connection, eventName) {
  const candidates = [connection, ...connection.querySelectorAll(SWAP_LISTENER_SELECTOR)];
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
 * Guard one open connection: every `commit` and `fragment` that arrives must find where
 * it lands. The check reads the DOM and swaps nothing, so it holds the same answer
 * whether it runs before or after htmx's own listener on the same source — which matters,
 * because the extension fires `htmx:sseOpen` *before* re-registering its listeners on a
 * reconnect and after registering them on a first connect.
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
 * @typedef {{ getTarget(listener: Element): Element | null | undefined }} HtmxInternalApi
 */

/** @type {HtmxInternalApi | null} */
let borrowedApi = null;

/**
 * htmx's own `getTarget`, borrowed rather than reimplemented. Defining an extension is
 * how htmx hands out its internal API — the SSE extension holds the same object — so the
 * guard asks the exact function that decides where a swap lands.
 *
 * Reimplementing it would mean reimplementing `hx-target`'s inheritance from ancestors
 * and htmx's extended selector syntax (`closest`, `find`, `next`, `previous`, `this`, …),
 * and every drift between the two shows up as one of only two things: an alarm on a
 * healthy swap, or silence on a broken one. Both are worse than not guarding at all.
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
    // The guard cannot agree with htmx about where a swap lands without asking it. Saying
    // so is the one honest option; degrading to a guess is the failure mode this file
    // exists to prevent.
    throw new Error("The swap-target guard could not borrow htmx's target resolution.");
  }

  return (listener) => api.getTarget(/** @type {Element} */ (listener));
}

/**
 * Start guarding every SSE connection the shell opens. Called once from module
 * evaluation, the way the release scope is started from its own. The resolver is borrowed
 * per connection rather than at startup, so this never depends on whether htmx has
 * finished loading by the time this module runs.
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
