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
import { ownValue } from "./own-value.ts";

type ChoiceField = Pick<SpecField, "name" | "type" | "values">;

/**
 * The half of the choice contract that depends on the submission alone, so it can be answered
 * before a generated Handler runs. Whether a declared option is still open stays with the port.
 */
export function assertDeclaredChoiceValues(
  capabilityId: string,
  fields: readonly ChoiceField[],
  values: Readonly<Record<string, unknown>>,
  action: "create" | "update",
): void {
  const undeclared = fields
    .filter((field) => isUndeclaredChoiceValue(field, ownValue(values, field.name)))
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
    .filter((field) =>
      isRefusedDisabledValue(field, ownValue(values, field.name), ownValue(held, field.name)),
    )
    .map((field) => field.name);
  if (retired.length > 0) {
    throw new ChoiceDisabledError(capabilityId, retired, action);
  }
}

/**
 * Whether a submitted value names something this choice field never declared. A blank submission
 * is "no selection": an optional choice normalizes it to `null`, a required one already failed.
 */
function isUndeclaredChoiceValue(field: ChoiceField, value: unknown): boolean {
  if (!isChoiceFieldType(field.type)) return false;
  if (value === undefined || value === null) return false;
  if (typeof value !== "string") return true;
  if (value.trim().length === 0) return false;
  return !admittedChoiceValues(field).has(value);
}

/**
 * Whether a submitted value names an option this field no longer offers. Everything not a declared
 * value was answered above, so what is left is whether the option is open for this record.
 */
function isRefusedDisabledValue(field: ChoiceField, value: unknown, held: unknown): boolean {
  if (!isChoiceFieldType(field.type)) return false;
  if (typeof value !== "string" || value.trim().length === 0) return false;
  if (!admittedChoiceValues(field).has(value)) return false;
  if (selectableChoiceValues(field).has(value)) return false;
  return held !== value;
}

/**
 * A choice stores one declared value or nothing: an empty submission is the same `null` an
 * unfilled text field stores. The admitted-set check has already run over the whole submission.
 */
export function normalizeChoiceValue(field: ChoiceField, value: unknown): string | null {
  if (typeof value !== "string") {
    throw new CapabilityDataValidationError(`Field "${field.name}" must be a string.`);
  }
  if (value.trim().length === 0) return null;
  if (!admittedChoiceValues(field).has(value)) {
    // Reached only through the platform's own fixture encoder. A plain validation error rather
    // than the typed one: nothing here has a capability id to name or a request to answer.
    throw new CapabilityDataValidationError(
      `Field "${field.name}" cannot store the undeclared choice value "${value}".`,
    );
  }
  return value;
}
