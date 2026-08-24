// @ts-check

/**
 * The content region owns everything its content started.
 *
 * A region is any element marked `data-content-region`. Whatever its content starts —
 * an in-flight fetch, a search controller's debounce timer, an htmx read holding a
 * server read token — registers a release here, anchored to the node that started it.
 * There are exactly two ways that release runs: the content is **replaced**, or the
 * region is **removed**. Both are the same fact seen from the DOM — the anchor left the
 * document — so there is one rule and no third path, and putting a window away is a
 * `releaseRegionContent(region)` call rather than a lifecycle of its own.
 *
 * Aborting the request is what releases the server's read token, so the client-side
 * release and the server-side release are one act rather than two mechanisms that have
 * to agree.
 *
 * Two moments report that one fact. htmx announces a node it is about to detach
 * (`htmx:beforeCleanupElement`), which is the only moment an htmx request can still be
 * aborted — htmx's own abort listener sits on `body` and reads the event as it bubbles
 * from a connected node. The MutationObserver is the guarantee behind it: an anchor that
 * has left the document is released whether or not anyone announced it. An entry runs at
 * most once, so the two can never disagree.
 */

export const CONTENT_REGION_SELECTOR = "[data-content-region]";

/**
 * Release a region's content from a script that cannot import this module — the shell's
 * classic-script glue in `app.js` replaces the content area's children directly. Dispatch
 * it on the region itself, before the replacement.
 */
export const RELEASE_REGION_EVENT = "aluna:release-region";

/** The class htmx puts on an element while its request is in flight. */
const HTMX_REQUEST_CLASS = "htmx-request";

/** htmx's own default; the running config wins where there is one. */
const HTMX_DISABLE_SELECTOR = "[hx-disable], [data-hx-disable]";

/** A region with no marker of its own still gets released; it just has no name to show. */
const UNNAMED_REGION = "—";

/**
 * The DOM facts a release scope needs, and nothing else. Structural on purpose: a real
 * `Element` satisfies it and so does a test double, which is what makes the rule
 * executable in Bun without a browser DOM.
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
 * The release scopes of every content region, as one registry. Keeping the entries in
 * one set rather than one set per region is what lets a removal be answered from a node
 * that is already detached, where walking up to find the region no longer works.
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
   * Register one release against the node that owns it. The anchor decides when it runs:
   * anchor the work to the content that started it, and anchor it to the region itself
   * only when it should outlive every swap the region holds.
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
   * Everything anchored at or under `node`. This is the replace-or-remove path taken
   * while the content is still connected, which is the only moment an htmx request can
   * be aborted.
   *
   * @param {ScopeAnchor} node
   */
  function releaseUnder(node) {
    for (const entry of [...entries]) {
      if (holds(node, entry.anchor)) run(entry);
    }
  }

  /** The guarantee: an anchor that has left the document took its work with it. */
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
 * Abort every htmx request in flight under `node`. htmx's abort listener is on `body`
 * and reads the event as it bubbles, so this only works while `node` is still connected —
 * which is exactly what `htmx:beforeCleanupElement` and an explicit pre-replacement
 * release provide.
 *
 * @param {Element} node
 */
function abortTransportIn(node) {
  const htmx =
    /** @type {Window & { htmx?: { trigger(node: Element, eventName: string): void } }} */ (window)
      .htmx;
  if (!htmx) return;
  const inFlight = [...node.querySelectorAll(`.${HTMX_REQUEST_CLASS}`)];
  if (node.classList.contains(HTMX_REQUEST_CLASS)) inFlight.unshift(node);
  for (const element of inFlight) htmx.trigger(element, "htmx:abort");
}

/** @returns {string} */
function htmxDisableSelector() {
  const htmx = /** @type {Window & { htmx?: { config?: { disableSelector?: string } } }} */ (window)
    .htmx;
  return htmx?.config?.disableSelector || HTMX_DISABLE_SELECTOR;
}

/**
 * Release a region's content: run every scope entry anchored at or under `node`, and
 * abort whatever transport that content still has open. Call it *before* replacing the
 * content or removing the region; the observer below catches anything that skipped it.
 *
 * The transport half only exists where a browser does, which is what lets the rule itself
 * be exercised in Bun against nodes that are not `Element`s.
 *
 * @param {ScopeAnchor} node
 */
export function releaseRegionContent(node) {
  registry.releaseUnder(node);
  if (typeof Element !== "undefined" && node instanceof Element) abortTransportIn(node);
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

  // htmx cleans an element up while it is still connected, and recurses into its
  // children. The first call releases the whole subtree, so the recursion that follows
  // costs a lookup and nothing more.
  document.addEventListener("htmx:beforeCleanupElement", (event) => {
    const node = event.target;
    if (!(node instanceof Element)) return;
    // Not every cleanup is a removal. htmx also cleans an element it is *keeping* — one
    // inside an `hx-disable` subtree, as it processes it — and releasing there would
    // abort a request whose region is still on screen.
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
