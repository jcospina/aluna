// The values a Handler hands the mutation ports, judged before any field is: a key the platform
// populates, a key no field has, and on an edit a key for a field its form never submitted.

import { PLATFORM_COLUMNS, type SpecField } from "../../../../registry/index.ts";
import { CapabilityDataValidationError } from "../../internal.ts";
import { isPlainObject } from "../../tool.ts";

const PLATFORM_POPULATED_COLUMNS = new Set<string>(PLATFORM_COLUMNS);

/** A create's values as the Handler gave them, refused before any field is judged if malformed. */
export function insertValues(
  capabilityId: string,
  allowedInsertFields: ReadonlySet<string>,
  values: Record<string, unknown>,
): Record<string, unknown> {
  if (!isPlainObject(values)) {
    throw new CapabilityDataValidationError(
      `Capability "${capabilityId}" insert values must be an object.`,
    );
  }
  validateInsertKeys(capabilityId, allowedInsertFields, values);
  return { ...values };
}

function validateInsertKeys(
  capabilityId: string,
  allowedInsertFields: ReadonlySet<string>,
  values: Readonly<Record<string, unknown>>,
): void {
  for (const key of Object.keys(values)) {
    if (PLATFORM_POPULATED_COLUMNS.has(key)) {
      throw new CapabilityDataValidationError(
        `Column "${key}" is platform-populated and cannot be inserted by a handler.`,
      );
    }
    if (!allowedInsertFields.has(key)) {
      const fieldList = [...allowedInsertFields].sort().join(", ");
      throw new CapabilityDataValidationError(
        `Unknown field "${key}" for capability "${capabilityId}". Insert accepts only: ${fieldList}.`,
      );
    }
  }
}

export function validateBoundRecordTarget(recordTarget: string): string {
  if (typeof recordTarget !== "string" || recordTarget.trim().length === 0) {
    throw new CapabilityDataValidationError(
      "A target-bound mutation requires a nonblank record id.",
    );
  }
  return recordTarget;
}

export function validateUpdateKeys(
  capabilityId: string,
  fieldsByName: ReadonlyMap<string, SpecField>,
  submittedFields: ReadonlySet<string>,
  values: Readonly<Record<string, unknown>>,
): void {
  for (const key of Object.keys(values)) {
    if (PLATFORM_POPULATED_COLUMNS.has(key)) {
      throw new CapabilityDataValidationError(
        `Column "${key}" is platform-populated and cannot be updated by a handler.`,
      );
    }
    const field = fieldsByName.get(key);
    if (!field) {
      throw new CapabilityDataValidationError(
        `Unknown field "${key}" for capability "${capabilityId}".`,
      );
    }
    if (field.lifecycle !== "active") {
      throw new CapabilityDataValidationError(
        `Inactive field "${key}" cannot be updated for capability "${capabilityId}".`,
      );
    }
    if (!submittedFields.has(key)) {
      throw new CapabilityDataValidationError(
        `Field "${key}" was not submitted and cannot be updated for capability "${capabilityId}".`,
      );
    }
  }
}

export function submittedUpdateValue(field: SpecField, values: Record<string, unknown>): unknown {
  if (!Object.hasOwn(values, field.name) || values[field.name] === undefined) {
    if (field.type === "boolean") return false;
    if (field.type === "string[]") return [];
    return null;
  }

  const value = values[field.name];
  if (value === "" && !field.required && field.type !== "string[]") return null;
  return value;
}
