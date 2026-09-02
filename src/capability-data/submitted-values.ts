// The platform validation that runs *before* a generated Handler, not inside it.
//
// Two of the platform's structural refusals depend on the submission alone: whether a
// choice value is one the field declares, and whether a string is longer than the field
// said it holds. Neither needs the stored row, and neither is a capability's business —
// the platform authored the sentence, the status and the retarget for both.
//
// They used to be reachable only from `normalizeSpecFieldValues`, which runs from inside
// the mutation port — i.e. from inside the Handler, when it chooses to call it. Canonical
// state was safe either way, because the port is the only way to write; what was at the
// generated code's discretion was the *answer*: a Handler that caught the error and
// returned its own 200 would have turned a platform refusal into a silent success. Three
// documents said this ran before the Handler. Now it does.
//
// What stays with the port is what cannot be answered here: the missing-required check
// needs the Handler's coercion (a submitted boolean arrives as `"on"`), and the
// disabled-option check needs the value the record is already standing on.

import type { SpecField } from "../registry/index.ts";
import { assertDeclaredChoiceValues } from "./choice-values.ts";
import { assertAdmittedStringLengths } from "./string-lengths.ts";

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
