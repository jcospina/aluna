// Tests for the migration apply stage (Epic 2.5, issue 03). They prove the
// builder derives DDL through the deterministic mapper, applies it in a rollback
// scope that downstream failures can still unwind, and captures timing for the
// future metrics row.

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { deriveCapabilityTableDdl } from "../capability-data/index.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../registry/index.ts";
import { applyCapabilityMigration, withCapabilityMigrationTransaction } from "./migration.ts";

interface TableColumn {
  readonly cid: number;
  readonly name: string;
  readonly type: string;
  readonly notnull: 0 | 1;
  readonly dflt_value: string | null;
  readonly pk: number;
  readonly hidden: number;
}

function notesSpec(overrides: Partial<CapabilitySpec> = {}): CapabilitySpec {
  const spec: CapabilitySpec = {
    id: "notes",
    label: "Notes",
    schema: {
      fields: [
        { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
        { name: "amount", label: "Amount", type: "number", required: false, lifecycle: "active" },
        { name: "done", label: "Done", type: "boolean", required: true, lifecycle: "active" },
        {
          name: "logged_at",
          label: "Logged at",
          type: "datetime",
          required: false,
          lifecycle: "active",
        },
      ],
    },
    ui_intent: {
      form: { list_inputs: [] },
      item: {
        direction: "A text-forward card that emphasizes the note text.",
        shows: ["title", "amount", "done", "logged_at"],
      },
      collection: { layout: "feed" },
      detail: { shows: ["title", "amount", "done", "logged_at"] },
    },
    behavior: "Required title, optional amount and log time, newest records first.",
    behavioral_errors: [
      {
        action: "create",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["title", "done"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
    ],
    tools: ["create", "read"],
    prompt_context: "Stores notes with optional amount metadata.",
    ...overrides,
  };

  if (overrides.schema && !overrides.ui_intent) {
    return {
      ...spec,
      ui_intent: {
        ...spec.ui_intent,
        detail: { shows: spec.schema.fields.map((field) => field.name) },
      },
    };
  }

  return spec;
}

function tableExists(database: Database, tableName: string): boolean {
  return Boolean(
    database.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName),
  );
}

function tableColumns(database: Database, tableName: string): TableColumn[] {
  return database.query(`PRAGMA table_xinfo("${tableName}")`).all() as TableColumn[];
}

function tableSchema(database: Database, tableName: string) {
  const row = database
    .query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { sql: string } | null;
  if (!row) throw new Error(`missing table ${tableName}`);

  return {
    sql: row.sql,
    columns: tableColumns(database, tableName).map((column) => ({
      name: column.name,
      type: column.type,
      notnull: column.notnull,
      dflt_value: column.dflt_value,
      pk: column.pk,
      hidden: column.hidden,
    })),
  };
}

function capabilityTables(database: Database): string[] {
  const rows = database
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'cap_%'")
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

describe("capability migration apply stage", () => {
  test("derives through the deterministic mapper, applies the schema, and captures duration", () => {
    const database = new Database(":memory:");
    try {
      const spec = notesSpec();
      const expectedDdl = deriveCapabilityTableDdl(spec);

      const migration = applyCapabilityMigration({ database, spec });

      expect(migration.ddl).toEqual(expectedDdl);
      expect(migration.tableName).toBe(expectedDdl.tableName);
      expect(Number.isFinite(migration.durationMs)).toBe(true);
      expect(migration.durationMs).toBeGreaterThanOrEqual(0);
      expect(tableSchema(database, migration.tableName)).toMatchSnapshot("applied notes schema");
    } finally {
      database.close();
    }
  });

  test("commits the capability table only after downstream work succeeds", async () => {
    const database = new Database(":memory:");
    try {
      const result = await withCapabilityMigrationTransaction(
        { database, spec: notesSpec() },
        async (migration) => {
          expect(tableExists(database, migration.tableName)).toBe(true);
          await Promise.resolve();
          return "commit-ready";
        },
      );

      expect(result.value).toBe("commit-ready");
      expect(tableExists(database, result.migration.tableName)).toBe(true);
    } finally {
      database.close();
    }
  });

  test("rolls back the applied table when a later gate fails", async () => {
    const database = new Database(":memory:");
    let captured: ReturnType<typeof applyCapabilityMigration> | undefined;

    try {
      await expect(
        withCapabilityMigrationTransaction({ database, spec: notesSpec() }, async (migration) => {
          captured = migration;
          expect(tableExists(database, migration.tableName)).toBe(true);
          await Promise.resolve();
          throw new Error("signature gate failed");
        }),
      ).rejects.toThrow("signature gate failed");

      expect(captured).toBeDefined();
      expect(captured?.durationMs).toBeGreaterThanOrEqual(0);
      expect(capabilityTables(database)).toEqual([]);
      expect(tableExists(database, "cap_notes")).toBe(false);
    } finally {
      database.close();
    }
  });
});
