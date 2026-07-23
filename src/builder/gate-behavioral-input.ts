import { activeSpecFields, type CapabilitySpec, type SpecField } from "../registry/index.ts";
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

/**
 * Materialize model-authored field/value pairs into a record, normalized by the
 * spec's field types the same way {@link inputValuesToHandlerInput} shapes the
 * handler input: a `string[]` field collects every entry into one list (a single
 * scalar becomes a one-element list), so setup seeding and expected-row matching
 * compare against the same list representation the data ports store. A `null`
 * stays `null` — it asserts the field's absence, not an empty list.
 */
export function fieldValuesToRecord(
  fields: readonly SpecField[],
  values: readonly BehavioralFieldValue[],
): Record<string, BehavioralScalar> {
  const listFields = new Set(
    fields.filter((field) => field.type === "string[]").map((field) => field.name),
  );
  const record: Record<string, BehavioralScalar> = {};
  for (const entry of values) {
    if (!listFields.has(entry.field) || entry.value === null) {
      record[entry.field] = entry.value;
      continue;
    }
    const existing = record[entry.field];
    const list = Array.isArray(existing) ? [...existing] : [];
    if (Array.isArray(entry.value)) list.push(...entry.value);
    else list.push(String(entry.value));
    record[entry.field] = list;
  }
  return record;
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
