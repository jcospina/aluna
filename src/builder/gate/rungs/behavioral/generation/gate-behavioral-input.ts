import type { Database } from "bun:sqlite";
import { sqlIdentifier } from "../../../../../platform/persistence/sql-identifier.ts";
import {
  activeFileFields,
  activeSpecFields,
  type CapabilitySpec,
  type FileFamily,
  isFileFieldType,
  isFileListFieldType,
  type SpecField,
} from "../../../../../registry/index.ts";
import {
  deriveCapabilityTableDdl,
  FILE_CLEAR_VALUE,
  FILE_REMOVE_PREFIX,
} from "../../../../../runtime/data/index.ts";
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
 * {@link inputValuesToHandlerInput} shapes handler input. A `null` asserts absence, not a list; a
 * `file[]`'s tokens gather into its list as a `string[]`'s values do.
 */
export function fieldValuesToRecord(
  fields: readonly SpecField[],
  values: readonly BehavioralFieldValue[],
): Record<string, BehavioralScalar> {
  const listFields = new Set(
    fields
      .filter((field) => field.type === "string[]" || isFileListFieldType(field.type))
      .map((field) => field.name),
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
 * A `file[]` carries its tokens in order, one entry each, and none for a `null`.
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

  const shaped = (type: string | undefined, submitted: readonly string[]) => {
    if (type === "string[]") return submitted;
    if (type !== undefined && isFileListFieldType(type)) return submitted.filter(Boolean);
    return submitted[0] ?? "";
  };
  return {
    values: Object.fromEntries(
      [...grouped].map(([fieldName, submitted]) => [
        fieldName,
        shaped(fieldsByName.get(fieldName)?.type, submitted),
      ]),
    ),
    submittedFields: new Set(submittedFieldNames),
  };
}

/**
 * A case's submission as the form's photo control posts it: a family token becomes a pending
 * scratch file, and an empty one clears the file an update's record holds or leaves an empty
 * field empty. A `file[]`'s tokens each become one, and none clears the list the same way.
 */
export function scratchFormInput(
  spec: CapabilitySpec,
  input: CapabilityInput,
  database: Database,
  recordId?: string,
): CapabilityInput {
  const values = { ...input.values };
  for (const field of activeFileFields(spec.schema.fields)) {
    const tokens = tokensOf(field, values[field.name]);
    if (tokens === undefined) continue;
    const keys = scratchKeys(spec, field, tokens, database, recordId);
    values[field.name] = isFileListFieldType(field.type) ? keys : (keys[0] ?? "");
  }
  return { values, submittedFields: input.submittedFields };
}

/** The tokens a field's submission names, in order, or `undefined` when it names none at all. */
function tokensOf(field: SpecField, token: unknown): readonly string[] | undefined {
  if (isFileListFieldType(field.type)) return Array.isArray(token) ? token : undefined;
  return typeof token === "string" ? [token].filter(Boolean) : undefined;
}

/**
 * A pending scratch file per token, in order. A `file`'s none clears what an update's record holds;
 * a list's tokens take the place of every file the record holds, each named as removed.
 */
function scratchKeys(
  spec: CapabilitySpec,
  field: SpecField,
  tokens: readonly string[],
  database: Database,
  recordId: string | undefined,
): readonly string[] {
  const minted = tokens.map(
    (token) =>
      mintScratchFile(database, spec, field, tokenFileName(token), null, token as FileFamily).key,
  );
  const held = recordId === undefined ? null : heldColumn(spec, field, recordId, database);
  if (isFileListFieldType(field.type)) {
    const keys = typeof held === "string" ? (JSON.parse(held) as { key: string }[]) : [];
    return [...minted, ...keys.map(({ key }) => `${FILE_REMOVE_PREFIX}${key}`)];
  }
  if (minted.length > 0) return minted;
  return held === null ? [] : [FILE_CLEAR_VALUE];
}

/** What an update's record holds in `field`'s column, as stored, or `null` for nothing. */
function heldColumn(
  spec: CapabilitySpec,
  field: SpecField,
  recordId: string,
  database: Database,
): unknown {
  const table = sqlIdentifier(deriveCapabilityTableDdl(spec).tableName);
  const row = database
    .query(`SELECT ${sqlIdentifier(field.name)} AS "held" FROM ${table} WHERE "id" = ?`)
    .get(recordId) as { held: unknown } | null;
  return row?.held ?? null;
}
