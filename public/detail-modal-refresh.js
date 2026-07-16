// @ts-check

/** @typedef {(input: string, init?: RequestInit) => Promise<Response>} RefreshRequest */

/**
 * Refresh a committed records region without hiding read failures behind HTMX's
 * promise resolution. Keeping this seam pure makes the post-delete degraded path
 * executable in Bun without a browser DOM.
 *
 * @template {{ innerHTML: string }} T
 * @param {{
 *   region: T,
 *   readUrl: string,
 *   request?: RefreshRequest,
 *   process?: (region: T) => void,
 * }} input
 * @returns {Promise<T>}
 */
export async function refreshCommittedRecords({ region, readUrl, request = fetch, process }) {
  const response = await request(readUrl, { headers: { "HX-Request": "true" } });
  if (!response.ok) {
    throw new Error(`Committed read refresh failed with status ${response.status}`);
  }
  region.innerHTML = await response.text();
  process?.(region);
  return region;
}
