// Split capability data ports — Module 4, Epic 4.2 (ARCH §3, §7; ADR-0004/0006).
//
// Canonical writes use a mutation port already bound to one capability. Free reads
// use a distinct arbitrary-SQL port backed only by the physically read-only SQLite
// connection. Live and Gate scratch execution construct these same interfaces.

import { dbReadonly } from "../db.ts";
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

export type CapabilityQueryParameter = string | number | bigint | boolean | null | Uint8Array;
export type CapabilityQueryResultType = FieldType;

export interface CapabilityQueryResultColumn {
  readonly alias: string;
  readonly type: CapabilityQueryResultType;
}

export interface CapabilityQueryInput {
  readonly sql: string;
  readonly parameters?: readonly CapabilityQueryParameter[];
  readonly result: readonly CapabilityQueryResultColumn[];
}

export type CapabilityQueryRow = Readonly<Record<string, CapabilityDataColumnValue>>;

export interface CapabilityQueryPort {
  all(input: CapabilityQueryInput): CapabilityQueryRow[];
}

export class CapabilityDataValidationError extends Error {
  override readonly name: string = "CapabilityDataValidationError";
}

export class MissingRequiredFieldsError extends CapabilityDataValidationError {
  override readonly name = "MissingRequiredFieldsError";
  readonly action: "create" | "update";
  readonly code = MISSING_REQUIRED_FIELDS_ERROR_CODE;
  readonly fields: readonly string[];

  constructor(
    capabilityId: string,
    fields: readonly string[],
    action: "create" | "update" = "create",
  ) {
    super(`Missing required fields for capability "${capabilityId}": ${fields.join(", ")}.`);
    this.action = action;
    this.fields = [...fields];
  }
}

export type SqlValue = string | number | null;

export interface StoredCapabilityRow {
  id: unknown;
  created_at: unknown;
  extra: unknown;
  [column: string]: unknown;
}

/**
 * Encode one already-selected spec field for platform-owned physical fixture writes.
 * Generated Handlers never receive this helper; canonical live writes still cross the
 * capability-bound mutation port. The Gate uses it only to seed synthetic inactive
 * compatibility columns that a copied reader may legally observe.
 */
export function encodeCapabilityFieldForStorage(
  field: Pick<SpecField, "name" | "type">,
  value: unknown,
): SqlValue {
  return value === null ? null : normalizeFieldValue(field.name, field.type, value);
}

export function createCapabilityQueryPort(database = dbReadonly): CapabilityQueryPort {
  return {
    all({ sql, parameters = [], result }) {
      validateResultDescriptor(result);
      const statement = database.query(sql);
      const values = statement.values(...parameters) as unknown[][];
      validateResultColumns(statement.columnNames, result, values);
      const rows = values.map((row) =>
        Object.fromEntries(statement.columnNames.map((column, index) => [column, row[index]])),
      );
      return rows.map((row, index) => projectQueryRow(row, result, index));
    },
  };
}

export function capabilityRowDescriptor(
  spec: CapabilitySpec,
): readonly CapabilityQueryResultColumn[] {
  const parsed = capabilitySpecSchema.parse(spec);
  return [
    { alias: "id", type: "string" },
    { alias: "created_at", type: "datetime" },
    ...activeSpecFields(parsed.schema.fields).map(({ name, type }) => ({ alias: name, type })),
  ];
}

export function selectCapabilityRows(
  spec: CapabilitySpec,
  query: CapabilityQueryPort,
): CapabilityDataRow[] {
  const parsed = capabilitySpecSchema.parse(spec);
  const { tableName } = deriveCapabilityTableDdl(parsed);
  return query.all({
    sql: `SELECT * FROM ${sqlIdentifier(tableName)} ORDER BY "created_at" DESC, "id" DESC`,
    result: capabilityRowDescriptor(parsed),
  }) as CapabilityDataRow[];
}

function validateResultDescriptor(result: readonly CapabilityQueryResultColumn[]): void {
  const seen = new Set<string>();
  for (const column of result) {
    if (!column.alias || column.alias.trim() !== column.alias) {
      throw new CapabilityDataValidationError("Query result aliases must be nonblank and trimmed.");
    }
    if (seen.has(column.alias)) {
      throw new CapabilityDataValidationError(`Duplicate query result alias "${column.alias}".`);
    }
    seen.add(column.alias);
  }
}

function validateResultColumns(
  actualColumns: readonly string[],
  result: readonly CapabilityQueryResultColumn[],
  values: readonly (readonly unknown[])[],
): void {
  if (values.some((row) => row.length !== actualColumns.length)) {
    const declaredDuplicate = result.find(({ alias }) => actualColumns.includes(alias));
    const alias = declaredDuplicate?.alias ?? "unknown";
    throw new CapabilityDataValidationError(
      `Query result contains duplicate declared alias "${alias}".`,
    );
  }
  for (const { alias } of result) {
    const count = actualColumns.filter((column) => column === alias).length;
    if (count === 0) {
      throw new CapabilityDataValidationError(`Query result is missing declared alias "${alias}".`);
    }
    if (count > 1) {
      throw new CapabilityDataValidationError(
        `Query result contains duplicate declared alias "${alias}".`,
      );
    }
  }
}

function projectQueryRow(
  row: Record<string, unknown>,
  result: readonly CapabilityQueryResultColumn[],
  rowIndex: number,
): CapabilityQueryRow {
  const projected: Array<readonly [string, CapabilityDataColumnValue]> = [];
  for (const { alias, type } of result) {
    try {
      projected.push([alias, normalizeQueryValue(alias, type, row[alias])]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CapabilityDataValidationError(
        `Query result row ${rowIndex} has an invalid value for declared alias "${alias}": ${message}`,
      );
    }
  }
  return Object.fromEntries(projected);
}

function normalizeQueryValue(
  alias: string,
  type: CapabilityQueryResultType,
  value: unknown,
): CapabilityDataColumnValue {
  if (value === null) return null;
  if (type === "date") {
    if (typeof value !== "string" || !isValidDate(value)) {
      throw new Error(`Expected date value for column "${alias}".`);
    }
    return value;
  }
  if (type === "datetime") {
    if (typeof value !== "string" || !isValidStoredDatetime(value)) {
      throw new Error(`Expected datetime value for column "${alias}".`);
    }
    return value;
  }
  return normalizeStoredFieldValue(alias, type, value);
}

function isValidStoredDatetime(value: string): boolean {
  if (isValidDatetime(value)) return true;
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const [, date, hour, minute, second] = match;
  return (
    date !== undefined &&
    isValidDate(date) &&
    Number(hour) <= 23 &&
    Number(minute) <= 59 &&
    Number(second) <= 59
  );
}

export function normalizeSpecFieldValues(
  capabilityId: string,
  fields: readonly SpecField[],
  values: Record<string, unknown>,
  action: "create" | "update" = "create",
): Record<string, SqlValue> {
  const normalized: Record<string, SqlValue> = {};
  const missing = fields
    .filter((field) => field.required && isMissingRequiredValue(field, values[field.name]))
    .map((field) => field.name);
  if (missing.length > 0) {
    throw new MissingRequiredFieldsError(capabilityId, missing, action);
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

export function normalizeStoredRow(
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

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function sqlIdentifier(identifier: string): string {
  return `"${identifier}"`;
}
