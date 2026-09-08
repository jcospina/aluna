// @ts-check

/**
 * The content region owns everything its content started: a fetch, a debounce timer, an htmx
 * read holding a server read token, each anchored to the node that started it.
 */

export const CONTENT_REGION_SELECTOR = "[data-content-region]";

/**
 * Release a region's content from a script that cannot import this module — `app.js`'s
 * classic-script glue. Dispatch it on the region itself, before the replacement.
 */
export const RELEASE_REGION_EVENT = "aluna:release-region";

/** The class htmx puts on an element while its request is in flight. */
const HTMX_REQUEST_CLASS = "htmx-request";

/** htmx's own default; the running config wins where there is one. */
const HTMX_DISABLE_SELECTOR = "[hx-disable], [data-hx-disable]";

/** A region with no marker of its own still gets released; it just has no name to show. */
const UNNAMED_REGION = "—";

/**
 * The DOM facts a release scope needs, and nothing else. Structural on purpose, so a test double
 * satisfies it as well as an `Element` and the rule runs in Bun without a browser DOM.
 *
 * @typedef {{
 *   readonly isConnected: boolean,
 *   contains(other: never): boolean,
 *   closest(selector: string): { getAttribute(name: string): string | null } | null,
 * }} ScopeAnchor
 */

/** @typedef {{ readonly region: string, readonly label: string }} ScopeEntryReport */

/**
 * @typedef {object} ScopeEntry
 * @property {ScopeAnchor} anchor
 * @property {string} label
 * @property {string} region
 * @property {() => void} release
 * @property {boolean} armed
 */

/**
 * `contains` is declared against the DOM's own signature, so asking it about a scope
 * anchor is the one place this file has to insist the two are the same thing.
 *
 * @param {ScopeAnchor} node
 * @param {ScopeAnchor} other
 */
function holds(node, other) {
  return node === other || node.contains(/** @type {never} */ (other));
}

/** @param {ScopeAnchor} anchor @returns {string} */
function regionNameOf(anchor) {
  const region = anchor.closest(CONTENT_REGION_SELECTOR);
  return region?.getAttribute("data-content-region") || UNNAMED_REGION;
}

/**
 * The release scopes of every content region as one registry, so a removal can be answered from
 * a node already detached, where walking up to find the region no longer works.
 */
export function createRegionReleaseRegistry() {
  /** @type {Set<ScopeEntry>} */
  const entries = new Set();

  /** @param {ScopeEntry} entry */
  function run(entry) {
    if (!entries.delete(entry)) return;
    entry.release();
  }

  /**
   * Register one release against the node that owns it: anchor it to the content that started
   * the work, or to the region itself when it should outlive every swap the region holds.
   *
   * @param {ScopeAnchor} anchor
   * @param {string} label what the developer preview shows
   * @param {() => void} release
   * @returns {() => void} deregister, for work that finished on its own terms
   */
  function register(anchor, label, release) {
    /** @type {ScopeEntry} */
    const entry = {
      anchor,
      label,
      region: regionNameOf(anchor),
      release,
      // Work registered against a node that is not on the page yet must not be swept
      // away before its content arrives. It arms the first time the anchor is connected.
      armed: anchor.isConnected,
    };
    entries.add(entry);
    return () => {
      entries.delete(entry);
    };
  }

  /**
   * Everything anchored at or under `node`, taken while the content is still connected — the
   * only moment an htmx request can be aborted.
   *
   * @param {ScopeAnchor} node
   */
  function releaseUnder(node) {
    for (const entry of [...entries]) {
      if (holds(node, entry.anchor)) run(entry);
    }
  }

  /**
   * The guarantee: an anchor that has left the document took its work with it, announced or
   * not. An entry runs at most once, so this and `releaseUnder` can never disagree.
   */
  function sweep() {
    // The common case by far: the page mutates constantly — every ink redraw is a child
    // list change — and holds nothing to release.
    if (entries.size === 0) return;
    for (const entry of [...entries]) {
      if (!entry.armed) {
        entry.armed = entry.anchor.isConnected;
        continue;
      }
      if (!entry.anchor.isConnected) run(entry);
    }
  }

  /** @returns {readonly ScopeEntryReport[]} */
  function report() {
    return [...entries].map(({ region, label }) => ({ region, label }));
  }

  return {
    register,
    releaseUnder,
    report,
    sweep,
    get size() {
      return entries.size;
    },
  };
}

/** The shell's one registry. */
const registry = createRegionReleaseRegistry();

/**
 * @param {ScopeAnchor} anchor
 * @param {string} label
 * @param {() => void} release
 * @returns {() => void}
 */
export function registerRegionRelease(anchor, label, release) {
  return registry.register(anchor, label, release);
}

/** What every region's live scope holds right now — the developer preview reads this. */
export function regionScopeReport() {
  return registry.report();
}

/**
 * Which nodes under `node` have an htmx request in flight, `node` included. Stated as a rule
 * because an `instanceof Element` guard once hid this branch from a DOM-free test suite.
 *
 * @template {{ classList: { contains(name: string): boolean }, querySelectorAll(selector: string): Iterable<T> }} T
 * @param {T} node
 * @param {(element: T, eventName: string) => void} trigger
 * @returns {T[]} everything that was aborted, in the order it was
 */
export function abortTransportUnder(node, trigger) {
  const inFlight = [...node.querySelectorAll(`.${HTMX_REQUEST_CLASS}`)];
  if (node.classList.contains(HTMX_REQUEST_CLASS)) inFlight.unshift(node);
  for (const element of inFlight) trigger(element, "htmx:abort");
  return inFlight;
}

/**
 * Abort every htmx request in flight under `node`. htmx's abort listener sits on `body` and
 * reads the event as it bubbles, so this works only while `node` is still connected.
 *
 * @param {ScopeAnchor} node
 */
function abortTransportIn(node) {
  const htmx =
    /** @type {{ htmx?: { trigger(node: never, eventName: string): void } } | undefined} */ (
      globalThis.window
    )?.htmx;
  const target = /** @type {never} */ (node);
  if (!htmx || !canBeAborted(target)) return;
  abortTransportUnder(target, (element, eventName) => htmx.trigger(element, eventName));
}

/**
 * Whether a node carries the two DOM facts the abort reads off it. Structural rather than
 * `instanceof Element`, so a test can satisfy it; no htmx means no transport to abort.
 * @param {{ classList?: unknown, querySelectorAll?: unknown }} node
 */
function canBeAborted(node) {
  return typeof node.querySelectorAll === "function" && typeof node.classList === "object";
}

/** @returns {string} */
function htmxDisableSelector() {
  const htmx = /** @type {Window & { htmx?: { config?: { disableSelector?: string } } }} */ (window)
    .htmx;
  return htmx?.config?.disableSelector || HTMX_DISABLE_SELECTOR;
}

/**
 * Release a region's content: run every entry anchored at or under `node` and abort its
 * transport, which is also what frees the server's read token. Call it before the replacement.
 *
 * @param {ScopeAnchor} node
 */
export function releaseRegionContent(node) {
  registry.releaseUnder(node);
  abortTransportIn(node);
}

/**
 * Start watching `root`. Called once from module evaluation, the way the ink system is
 * started once from its own.
 *
 * @param {Element} root
 */
export function startRegionScopes(root) {
  document.addEventListener(RELEASE_REGION_EVENT, (event) => {
    if (event.target instanceof Element) releaseRegionContent(event.target);
  });

  // htmx cleans an element up while it is still connected and recurses into its children; the
  // first call releases the whole subtree, so the recursion costs a lookup and nothing more.
  document.addEventListener("htmx:beforeCleanupElement", (event) => {
    const node = event.target;
    if (!(node instanceof Element)) return;
    // Not every cleanup is a removal: htmx also cleans an element it is keeping — one inside an
    // `hx-disable` subtree — and releasing there would abort a request still on screen.
    if (node.closest(htmxDisableSelector()) !== null) return;
    releaseRegionContent(node);
  });

  new MutationObserver((records) => {
    for (const record of records) {
      if (record.removedNodes.length === 0) continue;
      registry.sweep();
      return;
    }
  }).observe(root, { childList: true, subtree: true });
}

if (typeof document !== "undefined") startRegionScopes(document.body);
