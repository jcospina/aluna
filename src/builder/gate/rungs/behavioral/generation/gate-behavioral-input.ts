import type { Database } from "bun:sqlite";
import { sqlIdentifier } from "../../../../../platform/persistence/sql-identifier.ts";
import {
  activeSpecFields,
  type CapabilitySpec,
  type FileFamily,
  isFileFieldType,
  type SpecField,
} from "../../../../../registry/index.ts";
import { deriveCapabilityTableDdl, FILE_CLEAR_VALUE } from "../../../../../runtime/data/index.ts";
import type { CapabilityInput } from "../../../../../runtime/router/index.ts";
import { mintScratchFile } from "../../../gate-scratch-files.ts";
import { tokenFileName } from "../../../gate-scratch-names.ts";

export type BehavioralScalar = string | number | boolean | readonly string[] | null;

interface BehavioralFieldValue {
  readonly field: string;
  readonly value: BehavioralScalar;
}

interface BehavioralInputValue {
  readonly field: string;
  readonly value: string | null;
}

/**
 * Materialize model-authored field/value pairs into a record, normalized as
 * {@link inputValuesToHandlerInput} shapes handler input. A `null` asserts absence, not a list.
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

/**
 * The form's submission for a case, before any file exists: a file field carries its token, or
 * `""` for none, and a submitted file field the case leaves out posts `""`, as the wire reads it.
 */
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
    const value = entry.value ?? "";
    const existing = grouped.get(entry.field);
    if (existing) existing.push(value);
    else grouped.set(entry.field, [value]);
  }
  for (const name of submittedFieldNames) {
    const field = fieldsByName.get(name);
    if (field && isFileFieldType(field.type) && !grouped.has(name)) grouped.set(name, [""]);
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

/**
 * A case's submission as 7.1/08's control posts it: a family token becomes a pending scratch file,
 * and an empty one clears the file an update's record holds or leaves an empty field empty.
 */
export function scratchFormInput(
  spec: CapabilitySpec,
  input: CapabilityInput,
  database: Database,
  recordId?: string,
): CapabilityInput {
  const values = { ...input.values };
  for (const field of activeSpecFields(spec.schema.fields)) {
    const token = values[field.name];
    if (!isFileFieldType(field.type) || typeof token !== "string") continue;
    if (token !== "") {
      const name = tokenFileName(token);
      values[field.name] = mintScratchFile(
        database,
        spec,
        field,
        name,
        null,
        token as FileFamily,
      ).key;
    } else if (recordId !== undefined && holdsFile(spec, field, recordId, database)) {
      values[field.name] = FILE_CLEAR_VALUE;
    }
  }
  return { values, submittedFields: input.submittedFields };
}

function holdsFile(
  spec: CapabilitySpec,
  field: SpecField,
  recordId: string,
  database: Database,
): boolean {
  const table = sqlIdentifier(deriveCapabilityTableDdl(spec).tableName);
  const row = database
    .query(`SELECT ${sqlIdentifier(field.name)} AS "held" FROM ${table} WHERE "id" = ?`)
    .get(recordId) as { held: unknown } | null;
  return row !== null && row.held !== null;
}
