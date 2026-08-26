// @ts-check

/**
 * The client's half of the one-attempt rule.
 *
 * A faceless tile arms a single load-triggered POST that claims a paid generation
 * (ADR-0007). The server side of that rule is written down in `renderCapabilityLogo`
 * (`src/web/fragments.ts`): only a fresh desk render or a newly activated tile arms one,
 * and the markup an attempt answers with is always inert.
 *
 * That leaves one arming source the server cannot reach — **htmx's history cache**. The
 * logo button carries `hx-push-url`, so opening a capability snapshots the desk's DOM
 * under the previous URL, and Back restores that snapshot and re-processes it, firing
 * every `hx-trigger="load"` it contains. If the snapshot was taken while an attempt was
 * still in flight — and an attempt can run for the better part of a minute — the restored
 * tile is still armed, and Back spends another one. A few taps would spend all three.
 *
 * So the tile disarms itself the moment its request starts. The live DOM is what htmx
 * snapshots, so a tile that has already fired can never be restored armed. This is the
 * same idiom `app.js` uses for the records region's one-shot load: take the attributes
 * off once the request they describe is on its way.
 */

/** What the tile carries. Kept in step with `renderCapabilityLogo`. */
export const LOGO_ATTEMPT_URL_MARKER = "/logo-attempt";

/**
 * @typedef {{
 *   getAttribute(name: string): string | null,
 *   removeAttribute(name: string): void,
 * }} ArmedTile
 */

/**
 * Take the arming attributes off one tile. Idempotent, and silent about anything that is
 * not an armed logo attempt — every other htmx request on the desk passes through here.
 *
 * @param {unknown} node
 * @returns {boolean} whether this node was an armed attempt and is now disarmed
 */
export function disarmLogoAttempt(node) {
  const tile = /** @type {ArmedTile | null} */ (node);
  if (typeof tile?.getAttribute !== "function") return false;
  if (typeof tile.removeAttribute !== "function") return false;
  const url = tile.getAttribute("hx-post");
  if (url === null || !url.endsWith(LOGO_ATTEMPT_URL_MARKER)) return false;
  if (tile.getAttribute("hx-trigger") === null) return false;
  // Both, not just the trigger: a restored snapshot carrying `hx-post` with no trigger is
  // inert, but leaving it there would let any later processing pass re-arm it.
  tile.removeAttribute("hx-trigger");
  tile.removeAttribute("hx-post");
  return true;
}

/**
 * Disarm every attempt as its request begins.
 *
 * @param {{ addEventListener(type: string, listener: (event: { target?: unknown }) => void): void }} root
 */
export function startLogoAttemptDisarm(root) {
  root.addEventListener("htmx:beforeRequest", (event) => {
    disarmLogoAttempt(event.target);
  });
}

if (typeof document !== "undefined") startLogoAttemptDisarm(document);
