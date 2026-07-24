// Tests for the deterministic spec -> DDL mapper (Epic 2.2). These pin the SQL
// the platform derives from a validated spec and prove the same statements apply
// to both the real-db shape and the gate's scratch in-memory database.

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
  PLATFORM_COLUMNS,
} from "../registry/index.ts";
import {
  applyAdditiveCapabilityMigration,
  applyCapabilityTableDdl,
  CAPABILITY_TABLE_PREFIX,
  deriveAdditiveCapabilityMigration,
  deriveCapabilityTableDdl,
  SQLITE_TYPE_BY_FIELD_TYPE,
} from "./index.ts";

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
      {
        action: "update",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["title", "done"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
    ],
    tools: ["create", "read", "update", "delete", "search"],
    read_dependencies: { create: [], read: [], update: [], delete: [], search: [] },
    prompt_context: "Stores notes with optional amount metadata.",
    ...overrides,
  };

  if (overrides.schema && !overrides.ui_intent) {
    return {
      ...spec,
      ui_intent: {
        ...spec.ui_intent,
        item: {
          ...spec.ui_intent.item,
          shows: spec.schema.fields
            .filter((field) => field.lifecycle === "active")
            .map((field) => field.name),
        },
        detail: {
          shows: spec.schema.fields
            .filter((field) => field.lifecycle === "active")
            .map((field) => field.name),
        },
      },
    };
  }

  return spec;
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
    columns: tableColumns(database, tableName),
  };
}

function applyStatements(database: Database, statements: readonly string[]): void {
  for (const statement of statements) {
    database.exec(statement);
  }
}

describe("capability table DDL mapper", () => {
  test("derives deterministic CREATE TABLE DDL from the same spec", () => {
    const first = deriveCapabilityTableDdl(notesSpec());
    const second = deriveCapabilityTableDdl(notesSpec());

    expect(first).toEqual(second);
    expect(first.statements.join("\n")).toMatchSnapshot("notes capability DDL");
  });

  test("prefixes the table and emits the platform-owned trio first", () => {
    const database = new Database(":memory:");
    try {
      const ddl = applyCapabilityTableDdl(notesSpec(), database);

      expect(ddl.tableName).toBe(`${CAPABILITY_TABLE_PREFIX}notes`);
      expect(
        tableColumns(database, ddl.tableName)
          .slice(0, 3)
          .map((column) => column.name),
      ).toEqual([...PLATFORM_COLUMNS]);
    } finally {
      database.close();
    }
  });

  test("maps every user field to a physically nullable SQLite column", () => {
    const database = new Database(":memory:");
    try {
      const ddl = applyCapabilityTableDdl(notesSpec(), database);
      const columns = tableColumns(database, ddl.tableName);

      expect(columns.map((column) => column.name)).toEqual([
        ...PLATFORM_COLUMNS,
        "title",
        "amount",
        "done",
        "logged_at",
      ]);
      expect(columns.slice(0, 3)).toMatchObject([
        { name: "id", type: "TEXT", notnull: 1, pk: 1 },
        { name: "created_at", type: "TEXT", notnull: 1, dflt_value: "datetime('now')" },
        { name: "extra", type: "TEXT", notnull: 1, dflt_value: "'{}'" },
      ]);
      expect(columns.slice(3)).toMatchObject([
        { name: "title", type: SQLITE_TYPE_BY_FIELD_TYPE.string, notnull: 0 },
        { name: "amount", type: SQLITE_TYPE_BY_FIELD_TYPE.number, notnull: 0 },
        { name: "done", type: SQLITE_TYPE_BY_FIELD_TYPE.boolean, notnull: 0 },
        { name: "logged_at", type: SQLITE_TYPE_BY_FIELD_TYPE.datetime, notnull: 0 },
      ]);
    } finally {
      database.close();
    }
  });

  test("maps a date field to a TEXT column, like datetime but a distinct pantry type", () => {
    const database = new Database(":memory:");
    try {
      const spec = notesSpec({
        schema: {
          fields: [
            { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
            { name: "done", label: "Done", type: "boolean", required: true, lifecycle: "active" },
            {
              name: "scheduled_on",
              label: "Scheduled on",
              type: "date",
              required: false,
              lifecycle: "active",
            },
          ],
        },
      });
      const ddl = applyCapabilityTableDdl(spec, database);
      const scheduledOn = tableColumns(database, ddl.tableName).find(
        (column) => column.name === "scheduled_on",
      );
      expect(SQLITE_TYPE_BY_FIELD_TYPE.date).toBe("TEXT");
      expect(scheduledOn?.type).toBe(SQLITE_TYPE_BY_FIELD_TYPE.date);
    } finally {
      database.close();
    }
  });

  test("maps string[] to nullable JSON-array TEXT storage", () => {
    const database = new Database(":memory:");
    try {
      const spec = notesSpec({
        schema: {
          fields: [
            {
              name: "tags",
              label: "Tags",
              type: "string[]",
              required: false,
              lifecycle: "active",
            },
          ],
        },
        ui_intent: {
          form: { list_inputs: [{ field: "tags", mode: "repeatable" }] },
          item: { direction: "A tag-forward note.", shows: ["tags"] },
          collection: { layout: "feed" },
          detail: { shows: ["tags"] },
        },
        behavioral_errors: [],
      });
      const ddl = applyCapabilityTableDdl(spec, database);
      expect(tableColumns(database, ddl.tableName)).toContainEqual(
        expect.objectContaining({ name: "tags", type: "TEXT", notnull: 0 }),
      );
      expect(tableSchema(database, ddl.tableName).sql).toContain(
        `CHECK ("tags" IS NULL OR (json_valid("tags") AND json_type("tags") = 'array'))`,
      );
    } finally {
      database.close();
    }
  });

  test("emits only additive statements", () => {
    const ddl = deriveCapabilityTableDdl(notesSpec());
    expect(ddl.statements).toHaveLength(1);

    const statement = ddl.statements[0];
    expect(statement?.startsWith("CREATE TABLE IF NOT EXISTS")).toBe(true);
    for (const destructiveToken of ["DROP", "RENAME", "DELETE", "UPDATE"]) {
      expect(statement?.toUpperCase().includes(destructiveToken)).toBe(false);
    }
  });

  test("the same DDL produces identical schemas on file-backed and scratch connections", () => {
    const dir = mkdtempSync(join(tmpdir(), "omni-crud-ddl-"));
    const fileDatabase = new Database(join(dir, "test.db"), { create: true, readwrite: true });
    const scratchDatabase = new Database(":memory:");

    try {
      const ddl = deriveCapabilityTableDdl(notesSpec());
      applyStatements(fileDatabase, ddl.statements);
      applyStatements(scratchDatabase, ddl.statements);

      expect(tableSchema(fileDatabase, ddl.tableName)).toEqual(
        tableSchema(scratchDatabase, ddl.tableName),
      );
    } finally {
      fileDatabase.close();
      scratchDatabase.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// A committed field with its lifecycle flipped — the hide/reactivate transitions.
function withLifecycle(
  spec: CapabilitySpec,
  fieldName: string,
  lifecycle: "active" | "inactive",
): CapabilitySpec {
  return notesSpec({
    schema: {
      fields: spec.schema.fields.map((field) =>
        field.name === fieldName ? { ...field, lifecycle } : field,
      ),
    },
  });
}

// The committed spec with one new active field appended — the `new_active_field`
// row the additive migration turns into a nullable ADD COLUMN.
function withNewField(
  spec: CapabilitySpec,
  field: CapabilitySpec["schema"]["fields"][number],
): CapabilitySpec {
  return notesSpec({ schema: { fields: [...spec.schema.fields, field] } });
}

describe("additive capability migration", () => {
  test("a new active field derives exactly one nullable ADD COLUMN", () => {
    const committed = notesSpec();
    const candidate = withNewField(committed, {
      name: "mood",
      label: "Mood",
      type: "string",
      required: false,
      lifecycle: "active",
    });

    const migration = deriveAdditiveCapabilityMigration(committed, candidate);

    expect(migration.tableName).toBe(`${CAPABILITY_TABLE_PREFIX}notes`);
    expect(migration.statements).toEqual(['ALTER TABLE "cap_notes" ADD COLUMN "mood" TEXT;']);
    // Additive-only: nothing destructive, and no NOT NULL (so historical rows read null).
    const statement = migration.statements[0] ?? "";
    expect(statement.toUpperCase()).not.toContain("NOT NULL");
    for (const destructiveToken of ["DROP", "RENAME", "DELETE ", "UPDATE "]) {
      expect(statement.toUpperCase()).not.toContain(destructiveToken);
    }
  });

  test("historical rows read the added column back as null", () => {
    const database = new Database(":memory:");
    try {
      const committed = notesSpec();
      applyCapabilityTableDdl(committed, database);
      database.run('INSERT INTO "cap_notes" ("id", "title", "done") VALUES (?, ?, ?)', [
        "note-1",
        "before the field existed",
        1,
      ]);

      const candidate = withNewField(committed, {
        name: "mood",
        label: "Mood",
        type: "string",
        required: false,
        lifecycle: "active",
      });
      applyAdditiveCapabilityMigration(
        deriveAdditiveCapabilityMigration(committed, candidate),
        database,
      );

      expect(database.query('SELECT "mood" FROM "cap_notes" WHERE "id" = ?').get("note-1")).toEqual(
        { mood: null },
      );
    } finally {
      database.close();
    }
  });

  test("a new string[] field keeps the nullable JSON-array CHECK", () => {
    const committed = notesSpec();
    // An active string[] field also declares its closed list-input mode — a valid
    // candidate the DDL deriver still reduces to one nullable ADD COLUMN.
    const activeNames = [...committed.schema.fields.map((field) => field.name), "tags"];
    const candidate = notesSpec({
      schema: {
        fields: [
          ...committed.schema.fields,
          { name: "tags", label: "Tags", type: "string[]", required: false, lifecycle: "active" },
        ],
      },
      ui_intent: {
        form: { list_inputs: [{ field: "tags", mode: "repeatable" }] },
        item: { direction: "A title-forward card with tags.", shows: activeNames },
        collection: { layout: "feed" },
        detail: { shows: activeNames },
      },
    });

    const migration = deriveAdditiveCapabilityMigration(committed, candidate);

    expect(migration.statements).toEqual([
      `ALTER TABLE "cap_notes" ADD COLUMN "tags" TEXT CHECK ("tags" IS NULL OR (json_valid("tags") AND json_type("tags") = 'array'));`,
    ]);
  });

  test("multiple new fields add columns in candidate schema order", () => {
    const committed = notesSpec();
    const candidate = notesSpec({
      schema: {
        fields: [
          ...committed.schema.fields,
          { name: "mood", label: "Mood", type: "string", required: false, lifecycle: "active" },
          { name: "score", label: "Score", type: "number", required: false, lifecycle: "active" },
        ],
      },
    });

    const migration = deriveAdditiveCapabilityMigration(committed, candidate);

    expect(migration.statements).toEqual([
      'ALTER TABLE "cap_notes" ADD COLUMN "mood" TEXT;',
      'ALTER TABLE "cap_notes" ADD COLUMN "score" REAL;',
    ]);
  });
});

describe("additive migration: lifecycle transitions and the fail-closed guard", () => {
  test("hide and reactivate perform no DDL and preserve the stored column value", () => {
    const database = new Database(":memory:");
    try {
      const committed = notesSpec();
      applyCapabilityTableDdl(committed, database);
      database.run(
        'INSERT INTO "cap_notes" ("id", "title", "amount", "done") VALUES (?, ?, ?, ?)',
        ["note-1", "keep me", 5, 1],
      );

      // Soft-hide is lifecycle-only: no DDL, so the column and its value are untouched.
      const hidden = withLifecycle(committed, "amount", "inactive");
      const hideMigration = deriveAdditiveCapabilityMigration(committed, hidden);
      expect(hideMigration.statements).toEqual([]);
      applyAdditiveCapabilityMigration(hideMigration, database);
      expect(
        database.query('SELECT "amount" FROM "cap_notes" WHERE "id" = ?').get("note-1"),
      ).toEqual({ amount: 5 });

      // Reactivation reuses the original column and its stored value — still no DDL.
      const reactivated = withLifecycle(hidden, "amount", "active");
      const reactivateMigration = deriveAdditiveCapabilityMigration(hidden, reactivated);
      expect(reactivateMigration.statements).toEqual([]);
      applyAdditiveCapabilityMigration(reactivateMigration, database);
      expect(
        database.query('SELECT "amount" FROM "cap_notes" WHERE "id" = ?').get("note-1"),
      ).toEqual({ amount: 5 });
    } finally {
      database.close();
    }
  });

  test("a field-label change touches no columns", () => {
    const committed = notesSpec();
    const relabeled = notesSpec({
      schema: {
        fields: committed.schema.fields.map((field) =>
          field.name === "amount" ? { ...field, label: "Total" } : field,
        ),
      },
    });

    expect(deriveAdditiveCapabilityMigration(committed, relabeled).statements).toEqual([]);
  });

  test("fails closed rather than dropping or retyping a committed column", () => {
    const committed = notesSpec();
    const dropped = notesSpec({
      schema: { fields: committed.schema.fields.filter((field) => field.name !== "amount") },
    });
    const retyped = notesSpec({
      schema: {
        fields: committed.schema.fields.map((field) =>
          field.name === "amount" ? { ...field, type: "string" } : field,
        ),
      },
    });

    expect(() => deriveAdditiveCapabilityMigration(committed, dropped)).toThrow(
      /drop committed column "amount"/,
    );
    expect(() => deriveAdditiveCapabilityMigration(committed, retyped)).toThrow(
      /change the type of committed column "amount"/,
    );
  });
});
