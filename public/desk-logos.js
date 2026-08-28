// @ts-check

/**
 * The client's half of the tile an admitted build stands on the desk: press it to get the
 * story back, and take it down when the build's stream ends. The server renders the tile
 * and sends it out of band; what it is and why it is keyed by the build id is written
 * down there (`renderProvisionalLogo`, `src/web/fragments.ts`).
 *
 * A reload may forget the tile. That is correct: it is presentation only, and registry
 * rehydration remains the source of truth for what stands on the desk.
 */

/** The attribute a provisional tile is keyed by. */
export const PROVISIONAL_LOGO_ATTRIBUTE = "data-provisional-logo";

/**
 * The region the in-flight narration streams into. It lives inside the window now, so
 * it exists only while a window does — which is exactly right: a build opens the
 * window at submit, because a window that does not exist cannot hold the story of its
 * own construction. Pinned against `desk-window.js`'s own name for it.
 */
export const BUILD_NARRATION_REGION_ID = "spec-build-output";

/** One build's subscriber, the node every lifecycle event for that build comes from. */
const BUILD_SUBSCRIBER_SELECTOR = "[data-build-job-id]";

/**
 * The DOM facts this module needs and no more — a root it can look through, and nodes it
 * can remove or bring into view. Structural on purpose, the way the swap-target guard's
 * target is: a real `Document` satisfies it and so does a test double, which is what lets
 * the rule run in Bun without a browser.
 *
 * @typedef {{ target?: unknown, detail?: { type?: string } }} LogoEvent
 * @typedef {{ getAttribute(name: string): string | null, remove(): void }} RemovableNode
 * @typedef {{
 *   scrollIntoView?: (options?: { block: "nearest" }) => void,
 *   focus?: () => void,
 *   hasAttribute?: (name: string) => boolean,
 *   setAttribute?: (name: string, value: string) => void,
 * }} RevealableNode
 * @typedef {{
 *   querySelectorAll(selector: string): Iterable<RemovableNode & RevealableNode>,
 *   getElementById?: (id: string) => RevealableNode | null,
 *   addEventListener?: (type: string, listener: (event: LogoEvent) => void) => void,
 * }} LogoRoot
 */

/**
 * Take one build's tile off the ground. Idempotent, and silent about a build that never
 * stood one up: an evolution, a deflection and anything refused before admission all
 * reach a terminal with nothing to remove.
 * @param {LogoRoot} root
 * @param {string | undefined | null} buildId
 * @returns {boolean} whether a tile was actually taken down
 */
export function removeProvisionalLogo(root, buildId) {
  if (!buildId) return false;
  // Matched by attribute value rather than by a selector built from the id: a build id
  // is a string this module did not author, and a selector assembled from one has to be
  // escaped correctly to be safe. Reading the attribute back needs no escaping at all.
  const tile = [...root.querySelectorAll(`[${PROVISIONAL_LOGO_ATTRIBUTE}]`)].find(
    (node) => node.getAttribute(PROVISIONAL_LOGO_ATTRIBUTE) === buildId,
  );
  if (tile === undefined) return false;
  tile.remove();
  return true;
}

/**
 * Bring the in-flight story back into view. The narration streams into the window's
 * content region, so the tile is the way back to it from anywhere on the desk while
 * that window is up — and a window put away mid-build asks first and then ends the build
 * (`leaving-a-run.js`), which takes this tile down with it, so there is never a tile
 * pointing at a story that is gone.
 * @param {LogoRoot} root
 * @param {string} buildId
 */
export function revealBuildNarration(root, buildId) {
  const subscriber = [...root.querySelectorAll(BUILD_SUBSCRIBER_SELECTOR)].find(
    (node) => node.getAttribute("data-build-job-id") === buildId,
  );
  const target = subscriber ?? root.getElementById?.(BUILD_NARRATION_REGION_ID) ?? null;
  if (target === null) return;
  target.scrollIntoView?.({ block: "nearest" });
  // The region is not a control, so it carries no tab stop of its own. Give it one for the
  // duration, so the press lands somewhere a screen reader follows rather than nowhere.
  if (target.hasAttribute?.("tabindex") === false) target.setAttribute?.("tabindex", "-1");
  target.focus?.();
}

/**
 * The build a lifecycle event belongs to, read off the subscriber the event came from.
 * `closest` answers on a detached node too, which matters: the terminal presentation may
 * already have replaced the subscriber's contents by the time this runs.
 * @param {unknown} eventTarget
 * @returns {string | undefined}
 */
export function buildIdFromEvent(eventTarget) {
  const node =
    /** @type {{ closest?: (selector: string) => { getAttribute(name: string): string | null } | null }} */ (
      eventTarget
    );
  if (typeof node?.closest !== "function") return undefined;
  return node.closest(BUILD_SUBSCRIBER_SELECTOR)?.getAttribute("data-build-job-id") ?? undefined;
}

/**
 * Wire the tile's two obligations onto a document.
 * @param {LogoRoot} root
 */
export function startDeskLogos(root) {
  root.addEventListener?.(
    "click",
    /** @param {LogoEvent} event */ (event) => {
      const node =
        /** @type {{ closest?: (selector: string) => { getAttribute(name: string): string | null } | null }} */ (
          event.target
        );
      if (typeof node?.closest !== "function") return;
      const buildId = node
        .closest(`[${PROVISIONAL_LOGO_ATTRIBUTE}]`)
        ?.getAttribute(PROVISIONAL_LOGO_ATTRIBUTE);
      if (buildId) revealBuildNarration(root, buildId);
    },
  );

  // The terminal cleanup path. `htmx:sseClose` covers every real ending: `message` for a
  // stream the server finished (activation and refusal alike), and `nodeReplaced` or
  // `nodeMissing` for one whose subscriber left the document — the commonest being
  // ordinary, pressing another capability's logo while a build runs.
  //
  // `htmx:sseError` is deliberately not here. It is not terminal: the extension fires it
  // and then schedules a reconnect, and a native EventSource fires `error` on every
  // transient drop while it retries itself. Taking the tile down on one would let a proxy
  // blip orphan the tile of a build that is still running, and nothing puts it back —
  // only activation appends a logo.
  root.addEventListener?.(
    "htmx:sseClose",
    /** @param {LogoEvent} event */ (event) => {
      removeProvisionalLogo(root, buildIdFromEvent(event.target));
    },
  );
}

if (typeof document !== "undefined") startDeskLogos(document);
