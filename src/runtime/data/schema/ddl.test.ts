// Tests for the deterministic spec -> DDL mapper, judged by what the derived table does: which
// values it stores and reads back, and which it refuses.

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { sqlIdentifier } from "../../../platform/persistence/sql-identifier.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  FULL_CAPABILITY_TOOLS,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
  PLATFORM_COLUMNS,
} from "../../../registry/index.ts";
import {
  applyAdditiveCapabilityMigration,
  applyCapabilityTableDdl,
  CAPABILITY_TABLE_PREFIX,
  deriveAdditiveCapabilityMigration,
  deriveCapabilityTableDdl,
} from "../index.ts";
import { tableColumns } from "./table-shape.test-support.ts";

function notesSpec(overrides: Partial<CapabilitySpec> = {}): CapabilitySpec {
  const spec: CapabilitySpec = {
    id: "notes",
    label: "Notes",
    subject: "an open notebook",
    ground: "grass_green",
    companion: "coral_orange",
    noun: "note",
    plural_noun: "notes",
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
      form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
      item: {
        direction: "A text-forward card that emphasizes the note text.",
        shows: ["title", "amount", "done", "logged_at"],
      },
      collection: { layout: "feed" },
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
    tools: [...FULL_CAPABILITY_TOOLS],
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
      },
    };
  }

  return spec;
}

/** A `string[]` column: null or a JSON array is stored, anything else is refused. */
function expectJsonArrayColumn(database: Database, tableName: string, column: string): void {
  const insert = (id: string, value: string | null) =>
    database.run(
      `INSERT INTO ${sqlIdentifier(tableName)} ("id", ${sqlIdentifier(column)}) VALUES (?, ?)`,
      [id, value],
    );
  insert("empty", null);
  insert("listed", JSON.stringify(["a", "b"]));
  expect(
    database
      .query(
        `SELECT ${sqlIdentifier(column)} AS "value" FROM ${sqlIdentifier(tableName)} ORDER BY "id"`,
      )
      .all(),
  ).toEqual([{ value: null }, { value: JSON.stringify(["a", "b"]) }]);
  expect(() => insert("object", JSON.stringify({ a: 1 }))).toThrow();
  expect(() => insert("text", "not json")).toThrow();
}

describe("capability table DDL mapper", () => {
  test("derives deterministic CREATE TABLE DDL from the same spec", () => {
    const first = deriveCapabilityTableDdl(notesSpec());
    const second = deriveCapabilityTableDdl(notesSpec());

    expect(first).toEqual(second);
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

  test("maps every user field to a physically nullable column that keeps its value's kind", () => {
    const database = new Database(":memory:");
    try {
      const ddl = applyCapabilityTableDdl(notesSpec(), database);
      const table = sqlIdentifier(ddl.tableName);

      expect(tableColumns(database, ddl.tableName).map((column) => column.name)).toEqual([
        ...PLATFORM_COLUMNS,
        "title",
        "amount",
        "done",
        "logged_at",
      ]);
      database.run(`INSERT INTO ${table} ("id") VALUES ('bare')`);
      const bare = database.query(`SELECT * FROM ${table} WHERE "id" = 'bare'`).get() as Record<
        string,
        unknown
      >;
      expect(bare).toMatchObject({ title: null, amount: null, done: null, logged_at: null });
      expect(bare.created_at).toBeString();
      expect(JSON.parse(String(bare.extra))).toEqual({});

      const full = { title: "Soup", amount: 1.5, done: 1, logged_at: "2026-09-26T10:00:00Z" };
      database.run(
        `INSERT INTO ${table} ("id", "title", "amount", "done", "logged_at") VALUES ('full', ?, ?, ?, ?)`,
        [full.title, full.amount, full.done, full.logged_at],
      );
      expect(
        database
          .query(`SELECT "title", "amount", "done", "logged_at" FROM ${table} WHERE "id" = 'full'`)
          .get(),
      ).toEqual(full);

      const refused = (column: string, value: string | number) => () =>
        database.run(`INSERT INTO ${table} ("id", ${sqlIdentifier(column)}) VALUES ('x', ?)`, [
          value,
        ]);
      expect(refused("amount", "a lot")).toThrow();
      expect(refused("done", 2)).toThrow();
      expect(refused("done", 0.5)).toThrow();
      expect(() => database.run(`INSERT INTO ${table} ("id") VALUES ('bare')`)).toThrow();
    } finally {
      database.close();
    }
  });
});

describe("capability table DDL mapper — typed storage", () => {
  test("maps a date field to the column storage datetime uses, keeping the day verbatim", () => {
    const database = new Database(":memory:");
    try {
      const committed = notesSpec();
      const spec = notesSpec({
        schema: {
          fields: [
            ...committed.schema.fields,
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
      const columns = tableColumns(database, ddl.tableName);
      const typeOf = (name: string) => columns.find((column) => column.name === name)?.type;

      expect(typeOf("scheduled_on")).toBeString();
      expect(typeOf("scheduled_on")).toBe(typeOf("logged_at"));
      database.run(
        `INSERT INTO ${sqlIdentifier(ddl.tableName)} ("id", "scheduled_on") VALUES ('day', ?)`,
        ["2026-09-26"],
      );
      expect(
        database
          .query(`SELECT "scheduled_on" FROM ${sqlIdentifier(ddl.tableName)} WHERE "id" = 'day'`)
          .get(),
      ).toEqual({ scheduled_on: "2026-09-26" });
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
          form: {
            list_inputs: [{ field: "tags", mode: "repeatable" }],
            choice_inputs: [],
            long_text: [],
            guidance: [],
          },
          item: { direction: "A tag-forward note.", shows: ["tags"] },
          collection: { layout: "feed" },
        },
        behavioral_errors: [],
      });
      const ddl = applyCapabilityTableDdl(spec, database);
      expectJsonArrayColumn(database, ddl.tableName, "tags");
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
    expect(migration.statements).toHaveLength(1);
    // Additive-only: nothing destructive, and no NOT NULL (so historical rows read null).
    const statement = migration.statements[0] ?? "";
    expect(statement.toUpperCase()).toContain("ADD COLUMN");
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
        form: {
          list_inputs: [{ field: "tags", mode: "repeatable" }],
          choice_inputs: [],
          long_text: [],
          guidance: [],
        },
        item: { direction: "A title-forward card with tags.", shows: activeNames },
        collection: { layout: "feed" },
      },
    });

    const database = new Database(":memory:");
    try {
      applyCapabilityTableDdl(committed, database);
      const migration = deriveAdditiveCapabilityMigration(committed, candidate);
      expect(migration.statements).toHaveLength(1);
      applyAdditiveCapabilityMigration(migration, database);
      expectJsonArrayColumn(database, migration.tableName, "tags");
    } finally {
      database.close();
    }
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

    const database = new Database(":memory:");
    try {
      const ddl = applyCapabilityTableDdl(committed, database);
      applyAdditiveCapabilityMigration(
        deriveAdditiveCapabilityMigration(committed, candidate),
        database,
      );
      expect(tableColumns(database, ddl.tableName).map((column) => column.name)).toEqual([
        ...PLATFORM_COLUMNS,
        ...candidate.schema.fields.map((field) => field.name),
      ]);
      expect(
        tableColumns(database, ddl.tableName).find((column) => column.name === "score")?.type,
      ).toBe(
        tableColumns(database, ddl.tableName).find((column) => column.name === "amount")?.type,
      );
    } finally {
      database.close();
    }
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

  test("fails closed rather than dropping or retyping a committed column or moving its table", () => {
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
    expect(() =>
      deriveAdditiveCapabilityMigration(committed, notesSpec({ id: "journal" })),
    ).toThrow();
  });
});
