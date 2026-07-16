import { randomUUID } from "node:crypto";

import { db, type PlatformDatabase } from "../db.ts";
import {
  activeSpecFields,
  type CapabilitySpec,
  capabilitySpecSchema,
  type SpecField,
} from "../registry/index.ts";
import { deriveCapabilityTableDdl } from "./ddl.ts";
import { sqlIdentifier } from "./internal.ts";
import {
  type CapabilityActionRecord,
  type CapabilityDataRow,
  CapabilityDataValidationError,
  createCapabilityActionRecord,
  isPlainObject,
  normalizeSpecFieldValues,
  normalizeStoredRow,
  type SqlValue,
  type StoredCapabilityRow,
} from "./tool.ts";

export type CapabilityCreateValues = Record<string, unknown>;
export type CapabilityUpdateValues = Record<string, unknown>;

export interface CapabilityMutationPort {
  create(values: CapabilityCreateValues): CapabilityActionRecord;
}

export interface CapabilityUpdateMutationPort {
  update(values: CapabilityUpdateValues): CapabilityActionRecord;
}

export interface CapabilityDeleteMutationPort {
  delete(): void;
}

export const RECORD_NOT_FOUND_ERROR_CODE = "record_not_found";

export class RecordNotFoundError extends CapabilityDataValidationError {
  override readonly name = "RecordNotFoundError";
  readonly code = RECORD_NOT_FOUND_ERROR_CODE;

  constructor(
    readonly capabilityId: string,
    readonly action: "update" | "delete",
  ) {
    super(`Record not found for ${action} in capability "${capabilityId}".`);
  }
}

const PLATFORM_POPULATED_COLUMNS = new Set(["id", "created_at", "extra"]);

export function createCapabilityMutationPort(
  spec: CapabilitySpec,
  database = db,
): CapabilityMutationPort {
  const parsed = capabilitySpecSchema.parse(spec);
  const { tableName } = deriveCapabilityTableDdl(parsed);
  const quotedTable = sqlIdentifier(tableName);
  const fields = activeSpecFields(parsed.schema.fields);
  const allowedInsertFields = new Set(fields.map((field) => field.name));

  return {
    create(values) {
      const normalized = normalizeInsertValues(parsed.id, fields, allowedInsertFields, values);
      const columns = ["id", ...fields.map((field) => field.name)];
      const sqlValues: SqlValue[] = [randomUUID()];
      for (const field of fields) sqlValues.push(normalized[field.name] ?? null);

      const placeholders = columns.map(() => "?").join(", ");
      const quotedColumns = columns.map(sqlIdentifier).join(", ");
      const stored = database
        .query(`INSERT INTO ${quotedTable} (${quotedColumns}) VALUES (${placeholders}) RETURNING *`)
        .get(...sqlValues) as StoredCapabilityRow;
      return createCapabilityActionRecord(normalizeStoredRow(fields, stored));
    },
  };
}

export function createCapabilityUpdateMutationPort(
  spec: CapabilitySpec,
  recordTarget: string,
  submittedFields: ReadonlySet<string>,
  database = db,
): CapabilityUpdateMutationPort {
  const parsed = capabilitySpecSchema.parse(spec);
  const input: BoundUpdateAuthority = {
    capabilityId: parsed.id,
    quotedTable: sqlIdentifier(deriveCapabilityTableDdl(parsed).tableName),
    target: validateBoundRecordTarget(recordTarget),
    fields: activeSpecFields(parsed.schema.fields),
    fieldsByName: new Map(parsed.schema.fields.map((field) => [field.name, field])),
    submittedFields: new Set(submittedFields),
    database,
  };
  validateBoundSubmittedFields(input.capabilityId, input.fieldsByName, input.submittedFields);

  return {
    update(values) {
      if (!isPlainObject(values)) {
        throw new CapabilityDataValidationError(
          `Capability "${parsed.id}" update values must be an object.`,
        );
      }
      validateUpdateKeys(parsed.id, input.fieldsByName, input.submittedFields, values);
      const update = () => createCapabilityActionRecord(updateBoundTarget(input, values));
      return database.inTransaction ? update() : database.transaction(update)();
    },
  };
}

export function createCapabilityDeleteMutationPort(
  spec: CapabilitySpec,
  recordTarget: string,
  database = db,
): CapabilityDeleteMutationPort {
  const parsed = capabilitySpecSchema.parse(spec);
  const target = validateBoundRecordTarget(recordTarget);
  const quotedTable = sqlIdentifier(deriveCapabilityTableDdl(parsed).tableName);

  return {
    delete() {
      const deleted = database
        .query(`DELETE FROM ${quotedTable} WHERE "id" = ? RETURNING "id"`)
        .get(target);
      if (!deleted) throw new RecordNotFoundError(parsed.id, "delete");
    },
  };
}

interface BoundUpdateAuthority {
  readonly capabilityId: string;
  readonly quotedTable: string;
  readonly target: string;
  readonly fields: readonly SpecField[];
  readonly fieldsByName: ReadonlyMap<string, SpecField>;
  readonly submittedFields: ReadonlySet<string>;
  readonly database: PlatformDatabase["readwrite"];
}

function updateBoundTarget(
  authority: BoundUpdateAuthority,
  values: CapabilityUpdateValues,
): CapabilityDataRow {
  const stored = authority.database
    .query(`SELECT * FROM ${authority.quotedTable} WHERE "id" = ?`)
    .get(authority.target) as StoredCapabilityRow | null;
  if (!stored) throw new RecordNotFoundError(authority.capabilityId, "update");

  const current = normalizeStoredRow(authority.fields, stored);
  const merged: Record<string, unknown> = Object.fromEntries(
    authority.fields.map((field) => [field.name, current[field.name]]),
  );
  for (const field of authority.fields) {
    if (!authority.submittedFields.has(field.name)) continue;
    merged[field.name] = submittedUpdateValue(field, values);
  }

  const normalized = normalizeSpecFieldValues(
    authority.capabilityId,
    authority.fields,
    merged,
    "update",
  );
  if (authority.submittedFields.size === 0) return current;
  return persistBoundUpdate(authority, normalized);
}

function persistBoundUpdate(
  authority: BoundUpdateAuthority,
  normalized: Readonly<Record<string, SqlValue>>,
): CapabilityDataRow {
  const submitted = authority.fields.filter((field) => authority.submittedFields.has(field.name));
  const assignments = submitted.map((field) => `${sqlIdentifier(field.name)} = ?`).join(", ");
  const sqlValues = submitted.map((field) => normalized[field.name] ?? null);
  const updated = authority.database
    .query(`UPDATE ${authority.quotedTable} SET ${assignments} WHERE "id" = ? RETURNING *`)
    .get(...sqlValues, authority.target) as StoredCapabilityRow | null;
  if (!updated) throw new RecordNotFoundError(authority.capabilityId, "update");
  return normalizeStoredRow(authority.fields, updated);
}

function normalizeInsertValues(
  capabilityId: string,
  fields: readonly SpecField[],
  allowedInsertFields: ReadonlySet<string>,
  values: CapabilityCreateValues,
): Record<string, SqlValue> {
  if (!isPlainObject(values)) {
    throw new CapabilityDataValidationError(
      `Capability "${capabilityId}" insert values must be an object.`,
    );
  }
  validateInsertKeys(capabilityId, allowedInsertFields, values);
  return normalizeSpecFieldValues(capabilityId, fields, values);
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

function validateBoundRecordTarget(recordTarget: string): string {
  if (typeof recordTarget !== "string" || recordTarget.trim().length === 0) {
    throw new CapabilityDataValidationError(
      "A target-bound mutation requires a nonblank record id.",
    );
  }
  return recordTarget;
}

function validateBoundSubmittedFields(
  capabilityId: string,
  fieldsByName: ReadonlyMap<string, SpecField>,
  submittedFields: ReadonlySet<string>,
): void {
  for (const name of submittedFields) {
    if (fieldsByName.get(name)?.lifecycle !== "active") {
      throw new CapabilityDataValidationError(
        `Submitted field "${name}" is not active for capability "${capabilityId}".`,
      );
    }
  }
}

function validateUpdateKeys(
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

function submittedUpdateValue(field: SpecField, values: CapabilityUpdateValues): unknown {
  if (!Object.hasOwn(values, field.name) || values[field.name] === undefined) {
    if (field.type === "boolean") return false;
    if (field.type === "string[]") return [];
    return null;
  }

  const value = values[field.name];
  if (value === "" && !field.required && field.type !== "string[]") return null;
  return value;
}
