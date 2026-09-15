// The sentences a collection's count label says, and the sidecar that carries them
// (CONTEXT.md, "Count sidecar" and "Empty collection").
//
// Platform-owned collection chrome, like the search rail and the empty state beside it:
// no generated artifact changes for it, and no spec, registry or `ui_intent` field
// declares it (PLAN decision 32). The label is `.caps`, the role the design system gives
// labels, counts and kickers (`design/design-system.md`, "The window and the collection").

import {
  COLLECTION_COUNT_LABEL_ATTR,
  COLLECTION_COUNT_SIDECAR_PREFIX,
  COLLECTION_COUNT_SIDECAR_SUFFIX,
} from "#shell/shell-dom.js";
import { escapeHtml } from "../../server/http/html.ts";
import type { RenderableCapability } from "../fields/field-renderer.ts";
import { pluralNoun } from "./plural-noun.ts";

// The sidecar's wire format, declared in the module that parses it. A prefix changed on one side
// only parks the comment in the DOM and freezes the count at a stale number without erroring.
export {
  COLLECTION_COUNT_LABEL_ATTR,
  COLLECTION_COUNT_SIDECAR_PREFIX,
  COLLECTION_COUNT_SIDECAR_SUFFIX,
} from "#shell/shell-dom.js";

/** The count label's element id, paired with `capabilityRecordsRegionId`. */
export function capabilityCountLabelId(capabilityId: string): string {
  return `${capabilityId}-count`;
}

/**
 * What the collection says. Empty at zero, because the platform empty state already speaks for a
 * collection with nothing in it. The noun is the capability's own when {@link pluralNoun} allows.
 */
export function collectionCountSentence(count: number, noun: string): string {
  if (count <= 0) return "";
  return withNoun(written(count), count, noun);
}

/**
 * What a filtered collection says: how many matched, of how many there are (PLAN decision 32).
 * Neither number is stated alone, so a search that found nothing cannot read as a bare collection.
 */
export function filteredCollectionCountSentence(
  matched: number,
  total: number,
  noun: string,
): string {
  if (total <= 0) return "";
  // The two numbers are read one after the other, not in one transaction, so a delete between
  // them can hand this more matched than there are. A pair that cannot both be true says nothing,
  // and neither does a number that is not a whole one — `NaN` fails both comparisons below.
  if (!Number.isInteger(matched) || !Number.isInteger(total)) return "";
  if (matched < 0 || matched > total) return "";
  return withNoun(`${written(matched)} of ${written(total)}`, total, noun);
}

/** A number the way a person reads one. */
function written(count: number): string {
  return count.toLocaleString("en-US");
}

/**
 * `lead`, followed by the capability's own noun declined by `governing` — or `lead` alone when
 * {@link pluralNoun} declines. Declined once is declined at every count, so the shape holds.
 */
function withNoun(lead: string, governing: number, noun: string): string {
  const plural = pluralNoun(noun);
  if (plural === undefined) return lead;
  return governing === 1 ? `${lead} ${noun}` : `${lead} ${plural}`;
}

/** The empty label the collection chrome carries. The count arrives into it. */
export function renderCollectionCountLabel(capability: RenderableCapability): string {
  return (
    `<p class="capability-count caps" id="${escapeHtml(capabilityCountLabelId(capability.id))}"` +
    ` ${COLLECTION_COUNT_LABEL_ATTR}></p>`
  );
}

/**
 * The sidecar carrying one sentence at the head of a records response, as an HTML comment:
 * `:empty` ignores comments (Selectors L3). An empty sentence clears the label, not the sidecar.
 */
export function renderCollectionCountSidecar(sentence: string): string {
  return `${COLLECTION_COUNT_SIDECAR_PREFIX}${encodeSidecarPayload(sentence)}${COLLECTION_COUNT_SIDECAR_SUFFIX}`;
}

/**
 * Percent-encoding, plus `-` on top of it. `encodeURIComponent` already removes `>`, and
 * escaping the hyphen removes the only other way a payload could end the comment early.
 */
function encodeSidecarPayload(sentence: string): string {
  return encodeURIComponent(sentence).replaceAll("-", "%2D");
}
