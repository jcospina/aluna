// The sentences a collection's count label says, and the sidecar that carries them
// (CONTEXT.md, "Count sidecar" and "Empty collection").
//
// Platform-owned collection chrome, like the search rail and the empty state beside it:
// no generated artifact changes for it, and no spec, registry or `ui_intent` field
// declares it (PLAN decision 32). The label is `.caps`, the role the design system gives
// labels, counts and kickers (`design/design-system.md`, "The window and the collection").

import { escapeHtml } from "../../server/http/html.ts";
import type { RenderableCapability } from "../fields/field-renderer.ts";

/** The attribute the shell finds the collection's count label by. */
export const COLLECTION_COUNT_LABEL_ATTR = "data-capability-count-label";

export const COLLECTION_COUNT_SIDECAR_PREFIX = "<!--aluna:count:";
export const COLLECTION_COUNT_SIDECAR_SUFFIX = "-->";

/** The count label's element id, paired with `capabilityRecordsRegionId`. */
export function capabilityCountLabelId(capabilityId: string): string {
  return `${capabilityId}-count`;
}

/**
 * What the collection says. Empty at zero, because the platform empty state already
 * speaks for a collection with nothing in it.
 *
 * The noun is the capability's own ("22 notes", not "22 records"), the way every other
 * piece of desk copy uses it — but only when the platform can put it in the plural
 * without getting it wrong. {@link pluralNoun} declines far more often than English
 * pluralization rules would, and a declined noun leaves the bare number, which is true
 * in every language.
 */
export function collectionCountSentence(count: number, noun: string): string {
  if (count <= 0) return "";
  return withNoun(written(count), count, noun);
}

/**
 * What a *filtered* collection says: how many matched, and how many there are.
 *
 * A matched number alone is a number that reads as the whole truth and is not — the same
 * honesty rule decision 17 applies to a spoken answer, applied to a rendered one (PLAN
 * decision 32). So neither number is ever stated without the other, and zero matched is
 * stated as zero matched beside a total that is not zero, which is the case this exists
 * for: a search that found nothing must never read as a capability that holds nothing.
 *
 * The total governs the noun, because the noun belongs to the collection rather than to
 * the search: "1 of 22 entries", "0 of 1 entry".
 *
 * A total of zero says nothing at all. That collection is bare, not filtered, and what a
 * bare collection says is the platform empty state — one fact, stated once.
 */
export function filteredCollectionCountSentence(
  matched: number,
  total: number,
  noun: string,
): string {
  if (total <= 0) return "";
  // The two numbers are taken one after the other, not in one transaction
  // (`src/runtime/router/wire/collection-count.ts`), so a delete landing between them can
  // hand this more matched than there are. A pair that cannot both be true is not a
  // number to repair into a plausible one: the label says nothing, and the next read —
  // one keystroke or one refresh away — says it properly.
  if (matched < 0 || matched > total) return "";
  return withNoun(`${written(matched)} of ${written(total)}`, total, noun);
}

/** A number the way a person reads one. */
function written(count: number): string {
  return count.toLocaleString("en-US");
}

/**
 * `lead`, followed by the capability's own noun declined by `governing` — or `lead` alone,
 * when {@link pluralNoun} will not put that noun in the plural without getting it wrong.
 *
 * Declined once is declined at every count, so the label never changes shape: a collection
 * that says "22" must not say "1 메모" when it empties down to one.
 */
function withNoun(lead: string, governing: number, noun: string): string {
  const plural = pluralNoun(noun);
  if (plural === undefined) return lead;
  return governing === 1 ? `${lead} ${noun}` : `${lead} ${plural}`;
}

/**
 * Nouns English does not count. None of them is what the generation contract asks for —
 * "the singular common noun for one stored record" — but a model reaches for one now and
 * then, and "7 datas" is the platform speaking badly in its own chrome.
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
 * The plural of a capability's noun, or `undefined` when the platform will not guess.
 *
 * The generation contract asks for "the singular common noun for one stored record,
 * lowercase" (`src/builder/spec/spec-gen.ts`), but the schema admits any single line of up
 * to 32 characters in any script, and a model follows the language the person prompted in.
 * So this declines wherever English has more than one answer — a noun ending in `f`/`fe`
 * (leaf/chief), in `o` (potato/photo), or already in `s` (series, or a model that emitted
 * a plural) — and declines outright for anything that is not plain Latin letters, rather
 * than glue an English `s` onto 메모 or مذكرة.
 *
 * What it cannot tell is whether Latin letters are *English* letters: a German capability's
 * "Aufgabe" is pluralized as English. That is the one wrong answer left in here, and it is
 * wrong in the same way "add your first Aufgabe above" already is — the desk has always put
 * this noun into English copy.
 */
function pluralNoun(noun: string): string | undefined {
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
 * The sidecar that carries one sentence at the head of a records response.
 *
 * It is an HTML comment on purpose. The shell strips it before the records land, and a
 * comment is the one thing that degrades to nothing if a path ever failed to: browsers do
 * not count comments when matching `:empty` (Selectors L3), so a sidecar left in the
 * records region cannot silently take the platform empty state away.
 *
 * An empty sentence is not the absence of a sidecar: it is the instruction to clear the
 * label, which is what a collection emptied by a delete needs.
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
