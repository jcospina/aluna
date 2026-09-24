// Deterministic DDL derivation for capability data tables
// (ARCH §3, §6.3 "Data Tables", §7 "Writes", PLAN decision 8, ADR-0004).
//
// The AI authors only the validated capability spec. The platform owns table
// names, platform columns, and SQL generation, so generated code never writes
// SQL and the gate can apply the same statements to either the real db or a
// scratch in-memory db.

import type { Database } from "bun:sqlite";
import { sqlIdentifier } from "../../../platform/persistence/sql-identifier.ts";
import { CAPABILITY_TABLE_PREFIX } from "../../../platform/persistence/table-names.ts";

import {
  type CapabilitySpec,
  capabilitySpecSchema,
  type FieldType,
  PLATFORM_COLUMNS,
} from "../../../registry/index.ts";

export { CAPABILITY_TABLE_PREFIX } from "../../../platform/persistence/table-names.ts";

export const SQLITE_TYPE_BY_FIELD_TYPE = {
  string: "TEXT",
  number: "REAL",
  boolean: "INTEGER",
  datetime: "TEXT",
  date: "TEXT",
  choice: "TEXT",
  "string[]": "TEXT",
  file: "TEXT",
} as const satisfies Record<FieldType, "TEXT" | "REAL" | "INTEGER">;

export interface CapabilityTableDdl {
  readonly tableName: string;
  readonly statements: readonly string[];
}

export function deriveCapabilityTableDdl(spec: CapabilitySpec): CapabilityTableDdl {
  const parsed = capabilitySpecSchema.parse(spec);
  const tableName = `${CAPABILITY_TABLE_PREFIX}${parsed.id}`;
  const columns = [
    ...platformColumnDefinitions(),
    ...parsed.schema.fields.map((field) => columnDefinition(field.name, field.type)),
  ];

  return {
    tableName,
    statements: [
      `CREATE TABLE IF NOT EXISTS ${sqlIdentifier(tableName)} (${columns.join(", ")}) STRICT;`,
    ],
  };
}

export function applyCapabilityTableDdl(
  spec: CapabilitySpec,
  database: Database,
): CapabilityTableDdl {
  const ddl = deriveCapabilityTableDdl(spec);
  for (const statement of ddl.statements) {
    database.exec(statement);
  }
  return ddl;
}

/** The additive-only DDL one evolution derives from the committed→candidate spec. */
export interface AdditiveCapabilityMigration {
  readonly tableName: string;
  // One `ALTER TABLE … ADD COLUMN` per genuinely new field, in candidate schema order. Empty
  // when nothing changed the physical column set (hide, reactivate, label, requiredness).
  readonly statements: readonly string[];
}

/**
 * Derive the additive migration for one evolution (ARCH §3, §6.3, §9.3; PLAN decisions 2, 21;
 * ADR-0006). A new field derives a nullable `ADD COLUMN`; hide and reactivate touch no DDL.
 */
export function deriveAdditiveCapabilityMigration(
  committed: CapabilitySpec,
  candidate: CapabilitySpec,
): AdditiveCapabilityMigration {
  const parsed = capabilitySpecSchema.parse(candidate);
  if (parsed.id !== committed.id) {
    throw new Error("Additive migration requires a stable capability id.");
  }
  const tableName = `${CAPABILITY_TABLE_PREFIX}${parsed.id}`;
  const committedTypes = new Map(committed.schema.fields.map((field) => [field.name, field.type]));

  // Defense in depth: every committed column must survive unchanged, though validation should
  // already have rejected a missing or re-typed one before this stage.
  for (const [name, type] of committedTypes) {
    const candidateField = parsed.schema.fields.find((field) => field.name === name);
    if (!candidateField) {
      throw new Error(`Additive migration cannot drop committed column "${name}".`);
    }
    if (candidateField.type !== type) {
      throw new Error(`Additive migration cannot change the type of committed column "${name}".`);
    }
  }

  const statements = parsed.schema.fields
    .filter((field) => !committedTypes.has(field.name))
    .map(
      (field) =>
        `ALTER TABLE ${sqlIdentifier(tableName)} ADD COLUMN ${columnDefinition(field.name, field.type)};`,
    );

  return { tableName, statements };
}

/** Apply a derived additive migration; a no-column evolution executes nothing. */
export function applyAdditiveCapabilityMigration(
  migration: AdditiveCapabilityMigration,
  database: Database,
): void {
  for (const statement of migration.statements) {
    database.exec(statement);
  }
}

function platformColumnDefinitions(): string[] {
  const [id, createdAt, extra] = PLATFORM_COLUMNS;

  return [
    `${sqlIdentifier(id)} TEXT PRIMARY KEY`,
    `${sqlIdentifier(createdAt)} TEXT NOT NULL DEFAULT (datetime('now'))`,
    `${sqlIdentifier(extra)} TEXT NOT NULL DEFAULT ('{}') CHECK (json_valid(${sqlIdentifier(extra)}))`,
  ];
}

function columnDefinition(name: string, fieldType: FieldType): string {
  const parts = [sqlIdentifier(name), SQLITE_TYPE_BY_FIELD_TYPE[fieldType]];
  if (fieldType === "boolean") {
    parts.push(`CHECK (${sqlIdentifier(name)} IS NULL OR ${sqlIdentifier(name)} IN (0, 1))`);
  }
  const shape = JSON_SHAPE_BY_FIELD_TYPE[fieldType];
  if (shape !== null) parts.push(jsonShapeCheck(name, shape));
  // A choice gets plain TEXT and deliberately no `IN (…)` CHECK: option values are append-only
  // and SQLite cannot alter a column constraint, so a CHECK at birth would freeze the vocabulary.
  return parts.join(" ");
}

/**
 * The JSON a TEXT column holding structured data must parse as. A file reference is the object
 * `{key, kind, mime, size, name}` (PLAN decision 20), held the way a `string[]` column holds its
 * array. Total over the pantry, so a new type states its shape or states that it has none.
 */
const JSON_SHAPE_BY_FIELD_TYPE = {
  string: null,
  number: null,
  boolean: null,
  datetime: null,
  date: null,
  choice: null,
  "string[]": "array",
  file: "object",
} as const satisfies Record<FieldType, "array" | "object" | null>;

function jsonShapeCheck(name: string, shape: "array" | "object"): string {
  const column = sqlIdentifier(name);
  return `CHECK (${column} IS NULL OR (json_valid(${column}) AND json_type(${column}) = '${shape}'))`;
}
