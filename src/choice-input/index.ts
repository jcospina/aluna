// The platform's shared choice-field helpers — the counterpart to `list-input/`.
//
// One lookup for the authored presentation of an active choice field, and one refusal for
// a submitted value the field never declared. Both are platform-owned: a generated
// Handler receives an already-admitted value and never becomes a second enum validator.

import type { ChoiceInputIntent, UiFormIntent } from "../registry/index.ts";

/**
 * Resolve the closed authored presentation for one active choice field. Validated specs
 * always contain the entry; hand-built render projections fail loudly if they dropped
 * form intent between the registry and the platform module.
 */
export function choiceInputForField(form: UiFormIntent, fieldName: string): ChoiceInputIntent {
  const entry = form.choice_inputs.find((candidate) => candidate.field === fieldName);
  if (!entry) throw new Error(`Missing choice input presentation for active field "${fieldName}".`);
  return entry;
}
