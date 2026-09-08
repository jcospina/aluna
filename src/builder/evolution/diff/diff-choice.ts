// The choice field's own change facts — seven of them, over one field's options.
//
// They live apart from the rest of the matrix because a choice is the one field type that
// carries data of its own, so it is the one place where several independent things can
// move at once: what the field admits, what it still offers, how each option is worded and
// noted, the order and the groups they are drawn in, and which of the three controls draws
// them. `diff-engine.ts` calls this and unions the work; the mapping of each fact to its
// column stays there with every other row.

import {
  type CapabilitySpec,
  type ChoiceOption,
  isChoiceFieldType,
  type SpecField,
} from "../../../registry/index.ts";
import type { ChangeFact, ChangeFactKind } from "./diff-engine.ts";

/*
 * A choice fact is only the movement of a field that is a choice in both specs; anything else is
 * already a new_active_field or field_lifecycle fact. Comparison is by value, never by position.
 */
export function detectChoiceFacts(
  committed: CapabilitySpec,
  candidate: CapabilitySpec,
  facts: ChangeFact[],
): void {
  const candidateFields = choiceFieldsByName(candidate);
  for (const [field, before] of choiceFieldsByName(committed)) {
    const after = candidateFields.get(field);
    if (after === undefined) continue;
    detectChoiceOptionFacts(field, before, after, facts);
    if (!sameGrouping(before, after)) facts.push({ kind: "choice_option_groups", field });
  }
  detectChoicePresentationFacts(committed, candidate, facts);
}

function detectChoiceOptionFacts(
  field: string,
  before: SpecField,
  after: SpecField,
  facts: ChangeFact[],
): void {
  const committedOptions = before.values ?? [];
  const candidateOptions = after.values ?? [];
  const byValue = new Map(candidateOptions.map((option) => [option.value, option]));
  const committedValues = committedOptions.map(optionValue);

  // Validation refuses a removed or renamed value before the Diff runs, so every committed
  // option is here. A missing one would read as a relabel, a note change and a reorder at once.
  for (const option of committedOptions) {
    if (byValue.has(option.value)) continue;
    throw new Error(
      `Committed choice value "${option.value}" is missing from field "${field}"; ` +
        "a removal must be refused before the Diff runs.",
    );
  }

  if (!sameSet(committedValues, candidateOptions.map(optionValue))) {
    facts.push({ kind: "choice_values", field });
  }
  // The committed values in the order the candidate draws them, with anything appended
  // filtered out: an append is `choice_values`, and only a real reshuffle is this.
  const committed = new Set(committedValues);
  const reordered = candidateOptions.map(optionValue).filter((value) => committed.has(value));
  if (!sameSequence(committedValues, reordered)) {
    facts.push({ kind: "choice_option_order", field });
  }

  for (const [kind, read] of CHOICE_OPTION_FACETS) {
    if (committedOptions.some((option) => read(byValue.get(option.value)) !== read(option))) {
      facts.push({ kind, field });
    }
  }
}

/** The per-option facets that each buy their own column, read off one option at a time. */
const CHOICE_OPTION_FACETS = [
  ["choice_option_disabled", (option) => option?.disabled === true],
  ["choice_option_labels", (option) => option?.label],
  ["choice_option_notes", (option) => option?.note],
] as const satisfies readonly (readonly [
  ChangeFactKind,
  (option: ChoiceOption | undefined) => unknown,
])[];

/**
 * Whether two versions of one choice field group their options the same way — the same
 * headings in the same order, and every committed option standing under the same one.
 */
function sameGrouping(before: SpecField, after: SpecField): boolean {
  const heading = (group: { id: string; heading: string }) => `${group.id}\u0000${group.heading}`;
  if (!sameSequence((before.groups ?? []).map(heading), (after.groups ?? []).map(heading))) {
    return false;
  }
  const byValue = new Map((after.values ?? []).map((option) => [option.value, option]));
  return (before.values ?? []).every((option) => byValue.get(option.value)?.group === option.group);
}

/** Which of the three controls a choice draws as — form intent, and View work alone. */
function detectChoicePresentationFacts(
  committed: CapabilitySpec,
  candidate: CapabilitySpec,
  facts: ChangeFact[],
): void {
  const after = new Map(
    candidate.ui_intent.form.choice_inputs.map((entry) => [entry.field, entry.presentation]),
  );
  for (const entry of committed.ui_intent.form.choice_inputs) {
    const presentation = after.get(entry.field);
    if (presentation !== undefined && presentation !== entry.presentation) {
      facts.push({ kind: "choice_presentation", field: entry.field });
    }
  }
}

function choiceFieldsByName(spec: CapabilitySpec): Map<string, SpecField> {
  const fields = new Map<string, SpecField>();
  for (const field of spec.schema.fields) {
    if (isChoiceFieldType(field.type) && field.values !== undefined) {
      fields.set(field.name, field);
    }
  }
  return fields;
}

function optionValue(option: ChoiceOption): string {
  return option.value;
}

function sameSequence(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Order-blind equality, for a comparison about membership rather than arrangement. */
function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const held = new Set(right);
  return left.length === right.length && left.every((value) => held.has(value));
}
