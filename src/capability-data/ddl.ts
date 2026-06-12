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
    ...parsed.schema.fields.map((field) =>
      columnDefinition(field.name, SQLITE_TYPE_BY_FIELD_TYPE[field.type], field.required),
    ),
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

function platformColumnDefinitions(): string[] {
  const [id, createdAt, extra] = PLATFORM_COLUMNS;

  return [
    `${sqlIdentifier(id)} TEXT PRIMARY KEY`,
    `${sqlIdentifier(createdAt)} TEXT NOT NULL DEFAULT (datetime('now'))`,
    `${sqlIdentifier(extra)} TEXT NOT NULL DEFAULT ('{}') CHECK (json_valid(${sqlIdentifier(extra)}))`,
  ];
}

function columnDefinition(name: string, type: string, required: boolean): string {
  const parts = [sqlIdentifier(name), type];
  if (required) parts.push("NOT NULL");
  if (type === SQLITE_TYPE_BY_FIELD_TYPE.boolean) {
    parts.push(`CHECK (${sqlIdentifier(name)} IN (0, 1))`);
  }
  return parts.join(" ");
}

function sqlIdentifier(identifier: string): string {
  return `"${identifier}"`;
}
