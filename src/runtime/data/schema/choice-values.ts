// What a choice field admits on the way in, and what it stores.
//
// Two refusals, in order: a value the field never declared, and a value it declared but
// has stopped offering. Each looks at the whole submission at once, so one answer names
// every field offending in the same way — a submission wrong in both ways earns the first
// refusal and its fields, and the second only once those are fixed. Both are
// platform-owned and both run before canonical state moves, so a generated Handler
// receives an admitted value and never becomes a second enum validator.

import {
  admittedChoiceValues,
  isChoiceFieldType,
  type SpecField,
  selectableChoiceValues,
} from "../../../registry/index.ts";
import {
  CapabilityDataValidationError,
  ChoiceDisabledError,
  InvalidChoiceError,
} from "../internal.ts";

type ChoiceField = Pick<SpecField, "name" | "type" | "values">;

/**
 * Refuse the whole submission if any choice field carries a value it may not.
 *
 * `held` is what the record already stores. It matters for exactly one case: a row that
 * was standing on an option before that option was disabled keeps it. Saving an unrelated
 * field resubmits that value, and refusing it would either clear the row or block the
 * edit; the controls draw the same line from the other side by never marking a record's
 * own value unchoosable.
 */
/**
 * The half of the choice contract that depends on the submission alone.
 *
 * Split out because it can be answered *before* a generated Handler runs: whether a value
 * is one the field declares is a fact about the spec and the wire, with nothing held about
 * the record. The other half — whether a declared option is still open — has to know what
 * the row is already standing on, so it stays with the mutation port.
 */
export function assertDeclaredChoiceValues(
  capabilityId: string,
  fields: readonly ChoiceField[],
  values: Readonly<Record<string, unknown>>,
  action: "create" | "update",
): void {
  const undeclared = fields
    .filter((field) => isUndeclaredChoiceValue(field, values[field.name]))
    .map((field) => field.name);
  if (undeclared.length > 0) {
    throw new InvalidChoiceError(capabilityId, undeclared, action);
  }
}

export function assertAdmittedChoiceValues(
  capabilityId: string,
  fields: readonly ChoiceField[],
  values: Readonly<Record<string, unknown>>,
  held: Readonly<Record<string, unknown>>,
  action: "create" | "update",
): void {
  assertDeclaredChoiceValues(capabilityId, fields, values, action);

  const retired = fields
    .filter((field) => isRefusedDisabledValue(field, values[field.name], held[field.name]))
    .map((field) => field.name);
  if (retired.length > 0) {
    throw new ChoiceDisabledError(capabilityId, retired, action);
  }
}

/**
 * Whether a submitted value names something this choice field never declared. A blank
 * submission is "no selection", not an undeclared value: an optional choice normalizes it
 * to `null`, and a required one has already failed the missing-required check.
 */
function isUndeclaredChoiceValue(field: ChoiceField, value: unknown): boolean {
  if (!isChoiceFieldType(field.type)) return false;
  if (value === undefined || value === null) return false;
  if (typeof value !== "string") return true;
  if (value.trim().length === 0) return false;
  return !admittedChoiceValues(field).has(value);
}

/**
 * Whether a submitted value names an option this field no longer offers. Everything that
 * is not a declared choice value has already been answered above, so what is left is only
 * whether the option is still open — and whether this record was already standing on it.
 */
function isRefusedDisabledValue(field: ChoiceField, value: unknown, held: unknown): boolean {
  if (!isChoiceFieldType(field.type)) return false;
  if (typeof value !== "string" || value.trim().length === 0) return false;
  if (!admittedChoiceValues(field).has(value)) return false;
  if (selectableChoiceValues(field).has(value)) return false;
  return held !== value;
}

/**
 * A choice stores one declared value or nothing at all: an empty submission is the
 * absence of a selection, which is the same `null` an unfilled text field stores. The
 * admitted-set check has already run over the whole submission, so anything arriving here
 * that is not blank is a value the field declares.
 */
export function normalizeChoiceValue(field: ChoiceField, value: unknown): string | null {
  if (typeof value !== "string") {
    throw new CapabilityDataValidationError(`Field "${field.name}" must be a string.`);
  }
  if (value.trim().length === 0) return null;
  if (!admittedChoiceValues(field).has(value)) {
    // Reached only through the platform's own fixture encoder — the live write path
    // refuses the whole submission before it gets here. A plain validation error rather
    // than the typed one: nothing on this path has a capability id to name, and nothing
    // is answering a request, so the shape the router turns into a 422 has no business
    // being thrown from inside a build.
    throw new CapabilityDataValidationError(
      `Field "${field.name}" cannot store the undeclared choice value "${value}".`,
    );
  }
  return value;
}
