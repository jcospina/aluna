import { activeSpecFields, type CapabilitySpec } from "../registry/index.ts";
import type { CapabilityInput } from "../router/index.ts";

export type BehavioralScalar = string | number | boolean | readonly string[] | null;

interface BehavioralFieldValue {
  readonly field: string;
  readonly value: BehavioralScalar;
}

interface BehavioralInputValue {
  readonly field: string;
  readonly value: string;
}

export function fieldValuesToRecord(
  values: readonly BehavioralFieldValue[],
): Record<string, BehavioralScalar> {
  return Object.fromEntries(values.map((entry) => [entry.field, entry.value]));
}

export function inputValuesToHandlerInput(
  spec: CapabilitySpec,
  values: readonly BehavioralInputValue[],
  submittedFieldNames: readonly string[] = activeSpecFields(spec.schema.fields).map(
    (field) => field.name,
  ),
): CapabilityInput {
  const fields = activeSpecFields(spec.schema.fields);
  const fieldsByName = new Map(fields.map((field) => [field.name, field]));
  const grouped = new Map<string, string[]>();
  for (const entry of values) {
    const existing = grouped.get(entry.field);
    if (existing) existing.push(entry.value);
    else grouped.set(entry.field, [entry.value]);
  }

  return {
    values: Object.fromEntries(
      [...grouped].map(([fieldName, submitted]) => [
        fieldName,
        fieldsByName.get(fieldName)?.type === "string[]" ? submitted : (submitted[0] ?? ""),
      ]),
    ),
    submittedFields: new Set(submittedFieldNames),
  };
}
