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

/** The region the in-flight narration streams into today; it moves into the window in 5.7. */
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
 * Bring the in-flight story back into view. The narration streams into the shell's content
 * region today and moves into the window in 5.7; either way the tile is the way back to it
 * from anywhere on the desk.
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

  // The one terminal cleanup path, and it does not ask which kind of ending this was.
  // `done` closes every stream the server finished — activation and refusal alike — but
  // htmx also closes one whose subscriber left the document, and it says so with
  // `nodeReplaced` or `nodeMissing` rather than `message`. Those are endings too: the sink
  // is gone, the server reads that as a cancellation, and a build whose story nobody can
  // see must not leave a tile claiming it is still being made. The commonest way to reach
  // one is ordinary — pressing another capability's logo while a build runs swaps the
  // region the subscriber lives in. Taking the tile down is idempotent and keyed by the
  // build id, so there is nothing to gain by being selective and an orphan to lose.
  for (const ending of ["htmx:sseClose", "htmx:sseError"]) {
    root.addEventListener?.(
      ending,
      /** @param {LogoEvent} event */ (event) => {
        removeProvisionalLogo(root, buildIdFromEvent(event.target));
      },
    );
  }
}

if (typeof document !== "undefined") startDeskLogos(document);
