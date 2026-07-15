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

export type CapabilityDataColumnValue = string | number | boolean | readonly string[] | null;

export interface CapabilityDataRow {
  readonly id: string;
  readonly created_at: string;
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

const PLATFORM_POPULATED_COLUMNS = new Set(["id", "created_at", "extra"]);

export function createCapabilityDataTool(
  spec: CapabilitySpec,
  databases: PlatformDatabase = { readwrite: db, readonly: dbReadonly },
): CapabilityDataTool {
  const parsed = capabilitySpecSchema.parse(spec);
  const { tableName } = deriveCapabilityTableDdl(parsed);
  const quotedTable = sqlIdentifier(tableName);
  const fields = activeSpecFields(parsed.schema.fields);
  const allowedInsertFields = new Set(fields.map((field) => field.name));

  return {
    insert(values) {
      const normalized = normalizeInsertValues(parsed.id, fields, allowedInsertFields, values);
      const columns = ["id", ...fields.map((field) => field.name)];
      const sqlValues: SqlValue[] = [randomUUID()];

      for (const field of fields) {
        sqlValues.push(normalized[field.name] ?? null);
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
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|([+-])(\d{2}):(\d{2}))?$/.exec(
      value,
    );
  if (!match) return false;

  const [, date, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = match;
  if (!date || !isValidDate(date)) return false;

  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = secondText === undefined ? 0 : Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  const validOffset =
    offsetHourText === undefined || offsetHour < 14 || (offsetHour === 14 && offsetMinute === 0);
  return (
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 14 &&
    offsetMinute <= 59 &&
    validOffset &&
    !Number.isNaN(Date.parse(value))
  );
}

function isValidDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;

  const daysByMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (daysByMonth[month - 1] ?? 0);
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function normalizeStoredRow(
  fields: readonly SpecField[],
  row: StoredCapabilityRow,
): CapabilityDataRow {
  const id = readStringColumn("id", row.id);
  const createdAt = readStringColumn("created_at", row.created_at);
  assertStoredExtra(row.extra);
  const normalized: Record<string, CapabilityDataColumnValue> = {
    id,
    created_at: createdAt,
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

function assertStoredExtra(value: unknown): void {
  const text = readStringColumn("extra", value);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error('Expected "extra" to contain a JSON object.');
  }
  if (!isPlainObject(parsed)) {
    throw new Error('Expected "extra" to contain a JSON object.');
  }
}

function readStringColumn(name: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new Error(`Expected text value for column "${name}".`);
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sqlIdentifier(identifier: string): string {
  return `"${identifier}"`;
}
