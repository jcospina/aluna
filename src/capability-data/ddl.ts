// Deterministic DDL derivation for capability data tables — Module 2, Epic 2.2
// (ARCH §3, §6.3 "Data Tables", §7 "Writes", PLAN decision 8, ADR-0004).
//
// The AI authors only the validated capability spec. The platform owns table
// names, platform columns, and SQL generation, so generated code never writes
// SQL and the gate can apply the same statements to either the real db or a
// scratch in-memory db.

import type { Database } from "bun:sqlite";

import {
  type CapabilitySpec,
  capabilitySpecSchema,
  type FieldType,
  PLATFORM_COLUMNS,
} from "../registry/index.ts";

export const CAPABILITY_TABLE_PREFIX = "cap_";

export const SQLITE_TYPE_BY_FIELD_TYPE = {
  string: "TEXT",
  number: "REAL",
  boolean: "INTEGER",
  datetime: "TEXT",
  date: "TEXT",
  "string[]": "TEXT",
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
  // One `ALTER TABLE … ADD COLUMN` per genuinely new field, in candidate schema
  // order. Empty when nothing changed the physical column set (hide, reactivate,
  // label, requiredness, presentation, behavior — none of which touch DDL).
  readonly statements: readonly string[];
}

/**
 * Derive the additive migration for one evolution (ARCH §3, §6.3 "Data Tables",
 * §9.3; PLAN decisions 2, 21 + the change-fact matrix's `new_active_field` row;
 * ADR-0006). Platform-derived DDL is additive-only: a genuinely new field derives a
 * nullable `ADD COLUMN` (no `NOT NULL`, so every historical row reads it back as
 * `null`), while hide/reactivate touch no DDL — a soft-hidden column is never
 * dropped, so reactivation reuses the original column and its stored values.
 *
 * Existing field identity/type is immutable (candidate validation froze it upstream),
 * and this stage fails closed if a committed column is missing or re-typed rather than
 * ever emitting a destructive or in-place-altering statement: the additive-only
 * guarantee is a platform invariant, not a downstream hope.
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

  // Defense in depth: every committed column must survive unchanged. A missing or
  // re-typed column is a destructive difference the platform never performs, even
  // though validation should already have rejected it before this stage.
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
  if (fieldType === "string[]") {
    parts.push(
      `CHECK (${sqlIdentifier(name)} IS NULL OR (json_valid(${sqlIdentifier(name)}) AND json_type(${sqlIdentifier(name)}) = 'array'))`,
    );
  }
  return parts.join(" ");
}

function sqlIdentifier(identifier: string): string {
  return `"${identifier}"`;
}
