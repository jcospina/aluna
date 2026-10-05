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

/** A capability id as the spec gate admits one (`SQL_NAME_PATTERN`). */
export const CAPABILITY_ID_PATTERN = "[a-z][a-z0-9_]*";

/**
 * A record id as its address spells it: the hyphenated UUID `randomUUID()` writes, in either case,
 * since the address compares it in lower case (ADR-0010). The server's route and the desk share it.
 */
export const RECORD_ID_PATTERN =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

const CAPABILITY_ID = new RegExp(`^${CAPABILITY_ID_PATTERN}$`);
const RECORD_ID = new RegExp(`^${RECORD_ID_PATTERN}$`);

/**
 * Whether two ids name a record an address can carry: the only ids `recordAddress` is given from
 * anything the wire or a page event says.
 *
 * @param {unknown} capabilityId @param {unknown} recordId
 * @returns {boolean}
 */
export function isAddressableRecord(capabilityId, recordId) {
  if (typeof capabilityId !== "string" || typeof recordId !== "string") return false;
  return CAPABILITY_ID.test(capabilityId) && RECORD_ID.test(recordId);
}

/** One record open in its capability's record view: the record address (ADR-0010). */
export function recordAddress(/** @type {string} */ capabilityId, /** @type {string} */ recordId) {
  return `${capabilityUrl(capabilityId)}/${encodeURIComponent(recordId)}`;
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
