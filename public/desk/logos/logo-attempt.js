// @ts-check

/**
 * The client's half of the one-attempt rule: a faceless tile arms one load-triggered POST
 * that claims a paid generation (ADR-0007). `renderCapabilityLogo` holds the server's half.
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
 * Back once restored an htmx DOM snapshot and re-fired every `hx-trigger="load"` inside it,
 * so a few taps spent all three generations; 5.6/03 dropped `hx-push-url` (design D14).
 *
 * @param {{ addEventListener(type: string, listener: (event: { target?: unknown }) => void): void }} root
 */
export function startLogoAttemptDisarm(root) {
  root.addEventListener("htmx:beforeRequest", (event) => {
    disarmLogoAttempt(event.target);
  });
}

if (typeof document !== "undefined") startLogoAttemptDisarm(document);
