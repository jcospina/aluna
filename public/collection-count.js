// @ts-check

/**
 * The shell's half of the count sidecar (CONTEXT.md, "Count sidecar").
 *
 * Three transports write the records region and all three come through here: htmx, for the
 * View's own one-shot load; the committed-records refresh, after a create; and the search
 * controller. Each hands its response to the same split.
 */

export const COLLECTION_COUNT_SIDECAR_PREFIX = "<!--aluna:count:";
export const COLLECTION_COUNT_SIDECAR_SUFFIX = "-->";
export const COLLECTION_COUNT_LABEL_ATTR = "data-capability-count-label";

/** The records region's own marker — the only swap target a count may arrive for. */
const RECORDS_REGION_SELECTOR = '[data-content-region="records"]';

/** `<capability>-records`, the id `capabilityRecordsRegionId` builds. */
const RECORDS_REGION_ID_SUFFIX = "-records";

/**
 * The two routes the platform writes a sidecar on, asked of the region's own capability.
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
    path === `/capability/${capabilityId}/read` || path === `/capability/${capabilityId}/search`
  );
}

/**
 * Take the count off the head of a records response.
 *
 * `sentence` is `undefined` when the response carries no sidecar — a fragment that is not
 * a records answer at all — and the label is left exactly as it was, which is what keeps a
 * failed refresh honest: the number stays stale for exactly as long as the records it
 * describes do. An empty string is a sidecar that says there is nothing to say, which is
 * what clears a label after the last record is deleted.
 *
 * @param {string} html
 * @returns {{ sentence: string | undefined, records: string }}
 */
export function splitCollectionCount(html) {
  if (typeof html !== "string" || !html.startsWith(COLLECTION_COUNT_SIDECAR_PREFIX)) {
    return { sentence: undefined, records: html };
  }
  const end = html.indexOf(COLLECTION_COUNT_SIDECAR_SUFFIX, COLLECTION_COUNT_SIDECAR_PREFIX.length);
  // An unterminated sidecar is the whole response: an open comment swallows everything
  // after it anyway, so there are no records in there to render, and the label says
  // nothing rather than keeping a number this answer did not confirm.
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
 * Write one sentence into the count label of the collection this region belongs to.
 * `textContent`, so what lands is read as words and never as markup.
 *
 * Off a browser there is no label to write, which is how the pure refresh seam stays
 * executable in Bun.
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
 * Read one `htmx:beforeSwap` and, if it is a records answer, take the count off it.
 * `serverResponse` is rewritten in place, so htmx swaps the records alone and the comment
 * never reaches the DOM. Exported so the transport every collection's *first* load goes
 * through is executable without a browser.
 *
 * **Only the region's own read answers with a count.** The platform writes a sidecar on
 * `read` and `search` and nowhere else, so on a mutation's answer position zero belongs to
 * the generated Handler — and a comment is not executable markup, so the fragment enforcer
 * passes one straight through. Without a check here a Handler could author its create form
 * with `hx-target` on the records region and open that create's answer with a forged
 * sidecar, putting any sentence it liked into platform chrome.
 *
 * Aiming at the records region is therefore not enough, because the aim is the Handler's
 * to choose. What it cannot choose is the request: the sidecar is honoured only for a GET
 * of `/capability/<id>/read` or `/search` for the capability whose region this is. A
 * mutation is never that, and neither is another capability's read.
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
