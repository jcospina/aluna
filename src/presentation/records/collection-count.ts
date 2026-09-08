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
  // them can hand this more matched than there are. A pair that cannot both be true says nothing.
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

/**
 * Nouns English does not count. The generation contract asks for a singular common noun, but a
 * model reaches for one of these now and then, and "7 datas" is the platform speaking badly.
 */
const UNCOUNTABLE = new Set([
  "advice",
  "baggage",
  "data",
  "equipment",
  "evidence",
  "feedback",
  "furniture",
  "homework",
  "information",
  "luggage",
  "news",
  "research",
  "software",
]);

/** English plurals with one answer. Anything with two is declined below. */
const IRREGULAR_PLURALS = new Map([
  ["child", "children"],
  ["foot", "feet"],
  ["goose", "geese"],
  ["man", "men"],
  ["mouse", "mice"],
  ["person", "people"],
  ["tooth", "teeth"],
  ["woman", "women"],
]);

/**
 * The plural of a capability's noun, or `undefined` when the platform will not guess: a noun in
 * `f`/`fe`/`o`/`s`, or anything outside plain Latin letters, rather than an `s` glued onto 메모.
 */
function pluralNoun(noun: string): string | undefined {
  // Latin letters are not necessarily English letters: a German "Aufgabe" is pluralized as
  // English, which is the one wrong answer left and the one "add your first Aufgabe" already is.
  if (!/^[A-Za-z]+(?: [A-Za-z]+)*$/.test(noun)) return undefined;
  const words = noun.split(" ");
  const last = words.at(-1) ?? "";
  const plural = pluralWord(last.toLowerCase());
  if (plural === undefined) return undefined;
  // Keep the capability's own casing on every word but the one that changed.
  return [...words.slice(0, -1), matchCase(last, plural)].join(" ");
}

function pluralWord(word: string): string | undefined {
  const irregular = IRREGULAR_PLURALS.get(word);
  if (irregular !== undefined) return irregular;
  if (UNCOUNTABLE.has(word)) return undefined;
  if (/(?:ss|sh|ch|x|z)$/.test(word)) return `${word}es`;
  if (/(?:s|f|o)$/.test(word) || word.endsWith("fe")) return undefined;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/** A noun the model capitalized keeps its capital when it changes to the plural. */
function matchCase(original: string, plural: string): string {
  const first = original.at(0);
  if (first === undefined || first !== first.toUpperCase()) return plural;
  return plural.charAt(0).toUpperCase() + plural.slice(1);
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
