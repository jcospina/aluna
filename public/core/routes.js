// @ts-check

/**
 * Every address the shell asks for, built in one place.
 *
 * The server renders these into markup and the browser builds the same ones for its own requests,
 * so a prefix changed on one side leaves some links working and others 404. Ids are
 * `[a-z][a-z0-9_]*` so the encoding is a no-op today; it is here because nothing enforces that on
 * a job id.
 */

export const CAPABILITY_PATH_PREFIX = "/capability";
const CAPABILITY_DELETION_PATH_PREFIX = "/capability-deletion";
const BUILD_PATH_PREFIX = "/build";

/** A capability's own address — the View the window opens on. */
export function capabilityUrl(/** @type {string} */ capabilityId) {
  return `${CAPABILITY_PATH_PREFIX}/${encodeURIComponent(capabilityId)}`;
}

/** One Action on a capability, the address the router dispatches. */
export function capabilityActionUrl(
  /** @type {string} */ capabilityId,
  /** @type {string} */ action,
) {
  return `${capabilityUrl(capabilityId)}/${encodeURIComponent(action)}`;
}

/** Where a capability's logo is read from, keyed by the incarnation that drew it. */
export function capabilityLogoUrl(
  /** @type {string} */ capabilityId,
  /** @type {string} */ incarnationId,
) {
  return `${capabilityUrl(capabilityId)}/${encodeURIComponent(incarnationId)}/logo.svg`;
}

/** Where a capability's logo attempt is reported. */
export function capabilityLogoAttemptUrl(
  /** @type {string} */ capabilityId,
  /** @type {string} */ incarnationId,
) {
  return `${capabilityUrl(capabilityId)}/${encodeURIComponent(incarnationId)}/logo-attempt`;
}

/** The deletion confirmation and its preflight. */
export function capabilityDeletionUrl(/** @type {string} */ capabilityId) {
  return `${CAPABILITY_DELETION_PATH_PREFIX}/${encodeURIComponent(capabilityId)}`;
}

/** A running build's event stream. */
export function buildStreamUrl(/** @type {string} */ jobId) {
  return `${BUILD_PATH_PREFIX}/${encodeURIComponent(jobId)}/stream`;
}

/** The address a run is cancelled at. */
export function buildCancelUrl(/** @type {string} */ jobId) {
  return `${BUILD_PATH_PREFIX}/${encodeURIComponent(jobId)}/cancel`;
}
