// The Link control's words (`design/controls.html` § Links), and the build's sentence about the
// fields it connects. Product copy says connect, never link. Every phrase is built from what the
// registry stores: the record noun is singular and takes `’s`, and a field label is never
// pluralised or given an article.

import type { SpecField } from "../../../registry/index.ts";
import type { MatchCounts } from "../../../runtime/data/links/matching-scan.ts";

/** What one field is, inside a sentence: "every book’s author". */
export function everyRecordsField(noun: string, field: Pick<SpecField, "label">): string {
  return `every ${noun}’s ${labelInSentence(field.label)}`;
}

/** A field a build connects, and the plural noun of the records it picks from. */
export interface ConnectedField {
  readonly field: Pick<SpecField, "label">;
  readonly targetPlural: string;
}

/**
 * What a build says while it connects fields: "I’m connecting every copy’s book to your books."
 * Nothing when it connects none.
 */
export function buildConnecting(noun: string, connected: readonly ConnectedField[]): string {
  const clauses = connected.map(
    ({ field, targetPlural }) => `${everyRecordsField(noun, field)} to your ${targetPlural}`,
  );
  const last = clauses.pop();
  if (last === undefined) return "";
  return `I’m connecting ${clauses.length > 0 ? `${clauses.join(", ")} and ${last}` : last}.`;
}

/** The chain's accessible name, and the chooser's heading after it. */
export function connectFieldName(noun: string, field: Pick<SpecField, "label">): string {
  return `Connect ${everyRecordsField(noun, field)}`;
}

export function chooserHeading(noun: string, field: Pick<SpecField, "label">): string {
  return `${connectFieldName(noun, field)} to…`;
}

/** The line under the heading, dropped when there is nothing to pick. */
export function chooserLine(noun: string, field: Pick<SpecField, "label">): string {
  return `Pick where ${everyRecordsField(noun, field)} comes from.`;
}

export const CHOOSER_EMPTY = "There’s nothing you can connect to yet.";

/** The broken chain's accessible name, inside a linked field. */
export function disconnectFieldName(noun: string, field: Pick<SpecField, "label">): string {
  return `Disconnect ${everyRecordsField(noun, field)}`;
}

/** What the broken chain asks first, in both record nouns: "Disconnect books from authors?" */
export function disconnectQuestion(sourcePlural: string, targetPlural: string): string {
  return `Disconnect ${sourcePlural} from ${targetPlural}?`;
}

/** The line under it, saying what every record keeps: "Books will still keep the author as text". */
export function disconnectDetail(sourcePlural: string, field: Pick<SpecField, "label">): string {
  return capitalized(`${sourcePlural} will still keep the ${labelInSentence(field.label)} as text`);
}

/** What an empty linked field says, around the target's record noun: "Choose the author…". */
export function chooseTargetRecord(targetNoun: string): string {
  return `Choose the ${targetNoun}…`;
}

/** The line under a linked field holding text that no record of the target holds. */
export function unmatchedTargetLine(targetNoun: string): string {
  return `I could not find this ${targetNoun}, mind picking one?`;
}

/**
 * What a save says under each linked field whose pick names no record: one forged, or one deleted
 * while the form was open, whether the person picked it or the field's text named it. Fields
 * picking from two kinds of record share a sentence naming neither.
 */
export function pickAgainLine(targetNouns: readonly string[]): string {
  const [noun] = targetNouns;
  if (noun === undefined || targetNouns.some((each) => each !== noun)) {
    return "I couldn’t find that anymore. Mind picking again?";
  }
  return `I couldn’t find that ${noun} anymore. Mind picking one again?`;
}

/** The one note atop the form while the names a field holds are matched. */
export function connectingNote(sourcePlural: string, targetPlural: string): string {
  return `Connecting your ${sourcePlural} to ${targetPlural}…`;
}

export type { MatchCounts };

/**
 * What the prompt bar says once the names are matched, in the source's record nouns and the
 * target's: "45 books found their author. 5 still need you to pick one." Nothing when no record
 * held a name, since nothing was matched.
 */
export function matchingReport(
  source: { readonly noun: string; readonly plural: string },
  targetNoun: string,
  { linked, unmatched }: MatchCounts,
): string {
  const found = (count: number) =>
    count === 1
      ? `${written(count)} ${source.noun} found its ${targetNoun}.`
      : `${written(count)} ${source.plural} found their ${targetNoun}.`;
  const need = (count: number) => (count === 1 ? "needs" : "need");
  if (linked === 0 && unmatched === 0) return "";
  if (linked === 0) {
    const all = unmatched === 1 ? "" : "All ";
    return `No ${source.noun} found its ${targetNoun} yet. ${all}${written(unmatched)} ${need(unmatched)} you to pick one.`;
  }
  if (unmatched === 0) return linked === 1 ? found(linked) : `All ${found(linked)}`;
  return `${found(linked)} ${written(unmatched)} still ${need(unmatched)} you to pick one.`;
}

/** The broken-link mark's accessible name: "Pick the author", naming each target it asks for. */
export function pickTargetMark(targetNouns: readonly string[]): string {
  const asked = [...new Set(targetNouns)].map((noun) => `the ${noun}`);
  const last = asked.pop() ?? "";
  return `Pick ${asked.length > 0 ? `${asked.join(", ")} and ${last}` : last}`;
}

function written(count: number): string {
  return count.toLocaleString("en-US");
}

export const SUGGESTED_GROUP = "Suggested";

/** A target named on its own, outside its capability's group: "Authors · Name". */
export function targetName(capabilityLabel: string, field: Pick<SpecField, "label">): string {
  return `${capabilityLabel} · ${field.label}`;
}

/**
 * A label as a sentence carries it: a first word written as a plain capitalised word is lowered,
 * hyphen or apostrophe and all (Follow-up), and any other spelling (ISBN, LinkedIn, Wi-Fi) is kept. A proper noun written
 * plainly (Spanish) is lowered too: nothing stored tells it apart from Title.
 */
export function labelInSentence(label: string): string {
  const [first = ""] = label.split(/\s/u, 1);
  if (!/^\p{Lu}\p{Ll}*(?:[-'’]\p{Ll}+)*$/u.test(first)) return label;
  return `${label.charAt(0).toLocaleLowerCase()}${label.slice(1)}`;
}

/** A sentence that opens on a phrase built for its middle. */
export function capitalized(sentence: string): string {
  return `${sentence.charAt(0).toLocaleUpperCase()}${sentence.slice(1)}`;
}
