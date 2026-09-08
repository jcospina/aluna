// @ts-check

/**
 * The client's half of the tile an admitted build stands on the desk: press it for the story,
 * take it down when the stream ends (`renderProvisionalLogo`, `src/server/http/fragments.ts`).
 */

/**
 * The attribute a provisional tile is keyed by. A reload may forget the tile: it is
 * presentation only, and registry rehydration says what stands on the desk.
 */
export const PROVISIONAL_LOGO_ATTRIBUTE = "data-provisional-logo";

/**
 * The region the in-flight narration streams into. It lives inside the window, so a build
 * opens the window at submit; pinned against `desk-window.js`'s own name for it.
 */
export const BUILD_NARRATION_REGION_ID = "spec-build-output";

/** One build's subscriber, the node every lifecycle event for that build comes from. */
const BUILD_SUBSCRIBER_SELECTOR = "[data-build-job-id]";

/**
 * The DOM facts this module needs and no more. Structural on purpose, so a test double
 * satisfies it as well as a `Document` and the rule runs in Bun without a browser.
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
 * Take one build's tile off the ground. Idempotent, and silent about a build that never stood
 * one up: an evolution, a deflection and anything refused before admission remove nothing.
 * @param {LogoRoot} root
 * @param {string | undefined | null} buildId
 * @returns {boolean} whether a tile was actually taken down
 */
export function removeProvisionalLogo(root, buildId) {
  if (!buildId) return false;
  // Matched by attribute value, not by a selector built from the id: the id is a string this
  // module did not author, and reading the attribute back needs no escaping to be safe.
  const tile = [...root.querySelectorAll(`[${PROVISIONAL_LOGO_ATTRIBUTE}]`)].find(
    (node) => node.getAttribute(PROVISIONAL_LOGO_ATTRIBUTE) === buildId,
  );
  if (tile === undefined) return false;
  tile.remove();
  return true;
}

/**
 * Bring the in-flight story back into view. A window put away mid-build ends the build
 * (`leaving-a-run.js`) and takes this tile with it, so no tile points at a story that is gone.
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
 * The build a lifecycle event belongs to. `closest` answers on a detached node too, which the
 * terminal presentation needs: it may have replaced the subscriber's contents already.
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

  // `htmx:sseClose` covers every real ending: `message` when the server finishes the stream,
  // `nodeReplaced`/`nodeMissing` when the subscriber leaves — commonly another logo pressed.
  root.addEventListener?.(
    // `htmx:sseError` is absent: the extension reconnects after it and a native EventSource
    // fires `error` on every drop, so a blip would orphan a tile that only activation restores.
    "htmx:sseClose",
    /** @param {LogoEvent} event */ (event) => {
      removeProvisionalLogo(root, buildIdFromEvent(event.target));
    },
  );
}

if (typeof document !== "undefined") startDeskLogos(document);
