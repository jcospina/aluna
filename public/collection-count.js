// @ts-check

/**
 * The shell's half of the count sidecar (CONTEXT.md, "Count sidecar"). Three transports write
 * the records region — htmx's one-shot load, the post-create refresh, the search controller.
 */

import { capabilityActionUrl } from "./routes.js";
import {
  COLLECTION_COUNT_LABEL_ATTR,
  COLLECTION_COUNT_SIDECAR_PREFIX,
  COLLECTION_COUNT_SIDECAR_SUFFIX,
} from "./shell-dom.js";

export {
  COLLECTION_COUNT_LABEL_ATTR,
  COLLECTION_COUNT_SIDECAR_PREFIX,
  COLLECTION_COUNT_SIDECAR_SUFFIX,
} from "./shell-dom.js";

/** The records region's own marker — the only swap target a count may arrive for. */
const RECORDS_REGION_SELECTOR = '[data-content-region="records"]';

/** `<capability>-records`, the id `capabilityRecordsRegionId` builds. */
const RECORDS_REGION_ID_SUFFIX = "-records";

/**
 * The two routes the platform writes a sidecar on, asked of the region's own capability. A
 * Handler picks its own `hx-target`, so only the verb and path can expose a forged sidecar.
 *
 * @param {{ verb?: string, path?: string } | undefined} requestConfig
 * @param {string} regionId
 */
function readsThisRegion(requestConfig, regionId) {
  if (requestConfig?.verb?.toLowerCase() !== "get") return false;
  if (!regionId.endsWith(RECORDS_REGION_ID_SUFFIX)) return false;
  const capabilityId = regionId.slice(0, -RECORDS_REGION_ID_SUFFIX.length);
  const path = String(requestConfig.path ?? "").split(/[?#]/)[0];
  return (
    path === capabilityActionUrl(capabilityId, "read") ||
    path === capabilityActionUrl(capabilityId, "search")
  );
}

/**
 * Take the count off the head of a records response. `undefined` is no sidecar, so the label
 * keeps its stale number; an empty string is a sidecar that clears the label.
 *
 * @param {string} html
 * @returns {{ sentence: string | undefined, records: string }}
 */
export function splitCollectionCount(html) {
  if (typeof html !== "string" || !html.startsWith(COLLECTION_COUNT_SIDECAR_PREFIX)) {
    return { sentence: undefined, records: html };
  }
  const end = html.indexOf(COLLECTION_COUNT_SIDECAR_SUFFIX, COLLECTION_COUNT_SIDECAR_PREFIX.length);
  // An unterminated sidecar is the whole response: an open comment swallows everything after
  // it, so there are no records to render and the label says nothing rather than a stale number.
  if (end === -1) return { sentence: "", records: "" };
  return {
    sentence: decodeSidecarPayload(html.slice(COLLECTION_COUNT_SIDECAR_PREFIX.length, end)),
    records: html.slice(end + COLLECTION_COUNT_SIDECAR_SUFFIX.length),
  };
}

/**
 * A payload that will not decode says nothing rather than something untrue.
 *
 * @param {string} payload
 * @returns {string}
 */
function decodeSidecarPayload(payload) {
  try {
    return decodeURIComponent(payload);
  } catch {
    return "";
  }
}

/**
 * Write one sentence into this collection's count label. `textContent`, so it lands as words
 * and never as markup; off a browser there is no label, which keeps the refresh seam in Bun.
 *
 * @param {Element} region
 * @param {string | undefined} sentence
 */
export function applyCollectionCount(region, sentence) {
  if (sentence === undefined || typeof HTMLElement === "undefined") return;
  const label = region
    .closest(".capability-collection")
    ?.querySelector(`[${COLLECTION_COUNT_LABEL_ATTR}]`);
  if (label instanceof HTMLElement) label.textContent = sentence;
}

/** @typedef {{ verb?: string, path?: string }} SwapRequestConfig */
/**
 * @typedef {{
 *   serverResponse?: unknown,
 *   target?: unknown,
 *   shouldSwap?: boolean,
 *   requestConfig?: SwapRequestConfig,
 * }} SwapDetail
 */

/**
 * Take the count off one `htmx:beforeSwap`, rewriting `serverResponse` in place so the comment
 * never reaches the DOM. Exported so a collection's first load is executable without a browser.
 *
 * @param {SwapDetail | undefined} detail
 * @param {unknown} eventTarget
 * @returns {boolean} whether a count was taken off this answer
 */
export function readCollectionCountFromSwap(detail, eventTarget) {
  if (typeof detail?.serverResponse !== "string" || detail.shouldSwap === false) return false;
  const region = detail.target instanceof Element ? detail.target : eventTarget;
  if (!(region instanceof Element) || !region.matches(RECORDS_REGION_SELECTOR)) return false;
  if (!readsThisRegion(detail.requestConfig, region.id)) return false;
  const { sentence, records } = splitCollectionCount(detail.serverResponse);
  if (sentence === undefined) return false;
  detail.serverResponse = records;
  applyCollectionCount(region, sentence);
  return true;
}

function installCollectionCount() {
  document.addEventListener("htmx:beforeSwap", (event) => {
    readCollectionCountFromSwap(
      /** @type {CustomEvent<SwapDetail>} */ (event).detail,
      event.target,
    );
  });
}

if (typeof document !== "undefined") installCollectionCount();
