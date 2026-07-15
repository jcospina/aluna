// Capability-scoped data tool — Module 2, Epic 2.2 (ARCH §3, §7; ADR-0004).
//
// Generated handlers receive this object already bound to one capability. The
// call surface has no table/capability argument: the table name is closed over at
// construction time, writes ride the injected read-write connection, and reads
// ride the injected read-only connection. That keeps safety a construction fact,
// including for the gate's scratch database.

import { randomUUID } from "node:crypto";

import { db, dbReadonly, type PlatformDatabase } from "../db.ts";
import {
  activeSpecFields,
  type CapabilitySpec,
  capabilitySpecSchema,
  type FieldType,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
  type SpecField,
} from "../registry/index.ts";
import { deriveCapabilityTableDdl } from "./ddl.ts";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type CapabilityDataColumnValue =
  | string
  | number
  | boolean
  | readonly string[]
  | JsonObject
  | null;

export interface CapabilityDataRow {
  readonly id: string;
  readonly created_at: string;
  readonly extra: JsonObject;
  readonly [field: string]: CapabilityDataColumnValue;
}

export type CapabilityInsertValues = Record<string, unknown>;

export interface CapabilityDataTool {
  insert(values: CapabilityInsertValues): CapabilityDataRow;
  select(): CapabilityDataRow[];
}

export class CapabilityDataValidationError extends Error {
  override readonly name: string = "CapabilityDataValidationError";
}

export class MissingRequiredFieldsError extends CapabilityDataValidationError {
  override readonly name = "MissingRequiredFieldsError";
  readonly action = "create";
  readonly code = MISSING_REQUIRED_FIELDS_ERROR_CODE;
  readonly fields: readonly string[];

  constructor(capabilityId: string, fields: readonly string[]) {
    super(`Missing required fields for capability "${capabilityId}": ${fields.join(", ")}.`);
    this.fields = [...fields];
  }
}

type SqlValue = string | number | null;

interface StoredCapabilityRow {
  id: unknown;
  created_at: unknown;
  extra: unknown;
  [column: string]: unknown;
}

const PLATFORM_POPULATED_COLUMNS = new Set(["id", "created_at"]);

export function createCapabilityDataTool(
  spec: CapabilitySpec,
  databases: PlatformDatabase = { readwrite: db, readonly: dbReadonly },
): CapabilityDataTool {
  const parsed = capabilitySpecSchema.parse(spec);
  const { tableName } = deriveCapabilityTableDdl(parsed);
  const quotedTable = sqlIdentifier(tableName);
  const fields = activeSpecFields(parsed.schema.fields);
  const allowedInsertFields = new Set([...fields.map((field) => field.name), "extra"]);

  return {
    insert(values) {
      const normalized = normalizeInsertValues(parsed.id, fields, allowedInsertFields, values);
      const columns = ["id", ...fields.map((field) => field.name)];
      const sqlValues: SqlValue[] = [randomUUID()];

      for (const field of fields) {
        sqlValues.push(normalized.fields[field.name] ?? null);
      }

      if (normalized.extra !== undefined) {
        columns.push("extra");
        sqlValues.push(normalized.extra);
      }

      const placeholders = columns.map(() => "?").join(", ");
      const quotedColumns = columns.map(sqlIdentifier).join(", ");
      const stored = databases.readwrite
        .query(`INSERT INTO ${quotedTable} (${quotedColumns}) VALUES (${placeholders}) RETURNING *`)
        .get(...sqlValues) as StoredCapabilityRow;

      return normalizeStoredRow(fields, stored);
    },
    select() {
      const rows = databases.readonly
        .query(`SELECT * FROM ${quotedTable} ORDER BY "created_at" DESC, "id" DESC`)
        .all() as StoredCapabilityRow[];

      return rows.map((row) => normalizeStoredRow(fields, row));
    },
  };
}

function normalizeInsertValues(
  capabilityId: string,
  fields: readonly SpecField[],
  allowedInsertFields: Set<string>,
  values: CapabilityInsertValues,
): { fields: Record<string, SqlValue>; extra?: string } {
  if (!isPlainObject(values)) {
    throw new CapabilityDataValidationError(
      `Capability "${capabilityId}" insert values must be an object.`,
    );
  }

  validateInsertKeys(capabilityId, allowedInsertFields, values);

  return {
    fields: normalizeSpecFieldValues(capabilityId, fields, values),
    extra: values.extra === undefined ? undefined : serializeExtra(values.extra),
  };
}

function validateInsertKeys(
  capabilityId: string,
  allowedInsertFields: Set<string>,
  values: Record<string, unknown>,
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

function normalizeSpecFieldValues(
  capabilityId: string,
  fields: readonly SpecField[],
  values: Record<string, unknown>,
): Record<string, SqlValue> {
  const normalized: Record<string, SqlValue> = {};
  const missing = fields
    .filter((field) => field.required && isMissingRequiredValue(field, values[field.name]))
    .map((field) => field.name);
  if (missing.length > 0) {
    throw new MissingRequiredFieldsError(capabilityId, missing);
  }

  for (const field of fields) {
    const raw = values[field.name];
    if (raw === undefined || raw === null) {
      normalized[field.name] = null;
      continue;
    }

    normalized[field.name] = normalizeFieldValue(field.name, field.type, raw);
  }

  return normalized;
}

function isMissingRequiredValue(field: SpecField, value: unknown): boolean {
  if (value === undefined || value === null) return true;
  switch (field.type) {
    case "string":
      return typeof value !== "string" || value.trim().length === 0;
    case "number":
      return typeof value !== "number" || !Number.isFinite(value);
    case "boolean":
      return typeof value !== "boolean";
    case "date":
      return typeof value !== "string" || !isValidDate(value);
    case "datetime":
      return typeof value !== "string" || !isValidDatetime(value);
    case "string[]":
      return !Array.isArray(value) || !value.some(isNonBlankString);
  }
}

function normalizeFieldValue(name: string, type: FieldType, value: unknown): SqlValue {
  switch (type) {
    case "string":
      return normalizeString(name, value);
    case "datetime":
      return normalizeDatetime(name, value);
    case "date":
      return normalizeDate(name, value);
    case "number":
      return normalizeNumber(name, value);
    case "boolean":
      return normalizeBoolean(name, value);
    case "string[]":
      return JSON.stringify(normalizeStringList(name, value));
  }
}

function normalizeString(name: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new CapabilityDataValidationError(`Field "${name}" must be a string.`);
  }
  return value;
}

function normalizeDatetime(name: string, value: unknown): string {
  if (typeof value !== "string" || !isValidDatetime(value)) {
    throw new CapabilityDataValidationError(`Field "${name}" must be a valid datetime.`);
  }
  return value;
}

function normalizeDate(name: string, value: unknown): string {
  if (typeof value !== "string" || !isValidDate(value)) {
    throw new CapabilityDataValidationError(`Field "${name}" must be a valid date.`);
  }
  return value;
}

function normalizeNumber(name: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CapabilityDataValidationError(`Field "${name}" must be a finite number.`);
  }
  return value;
}

function normalizeBoolean(name: string, value: unknown): number {
  if (typeof value !== "boolean") {
    throw new CapabilityDataValidationError(`Field "${name}" must be a boolean.`);
  }
  return value ? 1 : 0;
}

function normalizeStringList(name: string, value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new CapabilityDataValidationError(`Field "${name}" must be a string array.`);
  }

  const normalized: string[] = [];
  for (const element of value) {
    if (typeof element !== "string") {
      throw new CapabilityDataValidationError(`Field "${name}" must contain only strings.`);
    }
    if (isNonBlankString(element)) normalized.push(element);
  }
  return normalized;
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDatetime(value: string): boolean {
  return value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

function isValidDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function serializeExtra(value: unknown): string {
  if (!isPlainObject(value)) {
    throw new CapabilityDataValidationError('Field "extra" must be a JSON object.');
  }

  assertJsonValue(value, "extra", new WeakSet<object>());

  try {
    return JSON.stringify(value);
  } catch (error) {
    throw new CapabilityDataValidationError(
      `Field "extra" must be JSON-serializable: ${error instanceof Error ? error.message : error}`,
    );
  }
}

function normalizeStoredRow(
  fields: readonly SpecField[],
  row: StoredCapabilityRow,
): CapabilityDataRow {
  const id = readStringColumn("id", row.id);
  const createdAt = readStringColumn("created_at", row.created_at);
  const extra = parseExtra(row.extra);
  const normalized: Record<string, CapabilityDataColumnValue> = {
    id,
    created_at: createdAt,
    extra,
  };

  for (const field of fields) {
    const raw = row[field.name];
    normalized[field.name] = normalizeStoredFieldValue(field.name, field.type, raw);
  }

  return normalized as CapabilityDataRow;
}

function normalizeStoredFieldValue(
  name: string,
  type: FieldType,
  value: unknown,
): string | number | boolean | readonly string[] | null {
  if (value === null) return null;

  switch (type) {
    case "string":
    case "datetime":
    case "date":
      return readStringColumn(name, value);
    case "number":
      if (typeof value !== "number") {
        throw new Error(`Expected numeric value for column "${name}".`);
      }
      return value;
    case "boolean":
      if (value !== 0 && value !== 1) {
        throw new Error(`Expected SQLite boolean 0/1 for column "${name}".`);
      }
      return value === 1;
    case "string[]":
      return parseStoredStringList(name, value);
  }
}

function parseStoredStringList(name: string, value: unknown): readonly string[] {
  const text = readStringColumn(name, value);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Expected column "${name}" to contain a JSON string array.`);
  }
  if (!Array.isArray(parsed) || !parsed.every(isNonBlankString)) {
    throw new Error(`Expected column "${name}" to contain a JSON string array.`);
  }
  return parsed;
}

function parseExtra(value: unknown): JsonObject {
  const text = readStringColumn("extra", value);
  const parsed = JSON.parse(text) as unknown;
  if (!isPlainObject(parsed)) {
    throw new Error('Expected "extra" to contain a JSON object.');
  }
  assertJsonValue(parsed, "extra", new WeakSet<object>());
  return parsed as JsonObject;
}

function readStringColumn(name: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new Error(`Expected text value for column "${name}".`);
  }
  return value;
}

function assertJsonValue(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
): asserts value is JsonValue {
  if (isJsonPrimitive(value)) return;
  if (typeof value !== "object" || value === null) {
    throw new CapabilityDataValidationError(`Field "${path}" must be JSON-serializable.`);
  }

  assertJsonContainer(value, path, seen);
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  return typeof value === "number" && Number.isFinite(value);
}

function assertJsonContainer(value: object, path: string, seen: WeakSet<object>): void {
  if (seen.has(value)) {
    throw new CapabilityDataValidationError(`Field "${path}" must not contain cycles.`);
  }
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) {
        assertJsonValue(item, `${path}[${index}]`, seen);
      }
      return;
    }

    if (!isPlainObject(value)) {
      throw new CapabilityDataValidationError(`Field "${path}" must be JSON-serializable.`);
    }

    for (const [key, child] of Object.entries(value)) {
      assertJsonValue(child, `${path}.${key}`, seen);
    }
  } finally {
    seen.delete(value);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sqlIdentifier(identifier: string): string {
  return `"${identifier}"`;
}
