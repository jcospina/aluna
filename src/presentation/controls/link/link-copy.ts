// The Link control's words (`design/controls.html` § Links).
// Product copy says connect, never link. Every phrase is built from what the registry stores: the
// record noun is singular and takes `’s`, and a field label is never pluralised or given an article.

import type { SpecField } from "../../../registry/index.ts";

/** What one field is, inside a sentence: "every book’s author". */
export function everyRecordsField(noun: string, field: Pick<SpecField, "label">): string {
  return `every ${noun}’s ${labelInSentence(field.label)}`;
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

/** What an empty linked field says, around the target's record noun: "Choose the author…". */
export function chooseTargetRecord(targetNoun: string): string {
  return `Choose the ${targetNoun}…`;
}

/** The line under a linked field holding text that no record of the target holds. */
export function unmatchedTargetLine(targetNoun: string): string {
  return `I could not find this ${targetNoun}, mind picking one?`;
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
