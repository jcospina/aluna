// The platform validation that runs before a generated Handler rather than inside it.
//
// Two of the platform's structural refusals depend on the submission alone: whether a choice value
// is one the field declares, and whether a string is longer than the field said it holds. Neither
// needs the stored row, and the platform authored the sentence, status and retarget for both.
//
// They used to be reachable only from `normalizeSpecFieldValues`, which runs from inside the
// mutation port and so from inside the Handler. Canonical state was safe either way; what was at
// the generated code's discretion was the answer, since a Handler catching the error and returning
// its own 200 would have turned a platform refusal into a silent success.
//
// What stays with the port is what cannot be answered here: the missing-required check needs the
// Handler's coercion, and the disabled-option check needs the value the record already holds.

import type { SpecField } from "../../../registry/index.ts";
import { assertDeclaredChoiceValues } from "../schema/choice-values.ts";
import { assertAdmittedStringLengths } from "../schema/string-lengths.ts";

/**
 * Refuse a submission the platform owns the answer to, before any generated code loads.
 *
 * @param values the parsed wire values — strings and string arrays, exactly as submitted
 */
export function assertSubmittedFieldValues(
  capabilityId: string,
  fields: readonly SpecField[],
  values: Readonly<Record<string, unknown>>,
  action: "create" | "update",
): void {
  // Stated in the order `normalizeSpecFieldValues` states them, so a submission that is
  // wrong twice is refused for the same reason wherever the check runs.
  assertDeclaredChoiceValues(capabilityId, fields, values, action);
  assertAdmittedStringLengths(capabilityId, fields, values, action);
}
