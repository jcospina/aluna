// Tests for the capability-scoped data tool (Epic 2.2). They prove scoping is a
// construction property, not a convention: once a tool is created for one spec,
// its public surface has no table/capability argument, writes ride the injected
// read-write connection, and reads ride the injected read-only connection.

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase, type PlatformDatabase } from "../db.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../registry/index.ts";
import {
  applyCapabilityTableDdl,
  createCapabilityDataTool,
  MissingRequiredFieldsError,
} from "./index.ts";

function notesSpec(overrides: Partial<CapabilitySpec> = {}): CapabilitySpec {
  return {
    id: "notes",
    label: "Notes",
    schema: {
      fields: [
        { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
        { name: "pinned", label: "Pinned", type: "boolean", required: false, lifecycle: "active" },
      ],
    },
    ui_intent: {
      form: { list_inputs: [] },
      item: { direction: "A text-forward card that emphasizes the note text.", shows: ["text"] },
      collection: { layout: "feed" },
      detail: { shows: ["text"] },
    },
    behavior: "Text is required. Newest notes appear first.",
    behavioral_errors: [
      {
        action: "create",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["text"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
    ],
    tools: ["create", "read"],
    read_dependencies: { create: [], read: [] },
    prompt_context: "Stores the user's text notes.",
    ...overrides,
  };
}

function recipesSpec(): CapabilitySpec {
  return notesSpec({
    id: "recipes",
    label: "Recipes",
    schema: {
      fields: [
        { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
      ],
    },
    ui_intent: {
      form: { list_inputs: [] },
      item: {
        direction: "A text-forward card that emphasizes the recipe title.",
        shows: ["title"],
      },
      collection: { layout: "feed" },
      detail: { shows: ["title"] },
    },
    behavioral_errors: [
      {
        action: "create",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["title"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
    ],
    prompt_context: "Stores the user's recipes.",
  });
}

function requirednessSpec(): CapabilitySpec {
  const fields: CapabilitySpec["schema"]["fields"] = [
    { name: "title", label: "Entry", type: "string", required: true, lifecycle: "active" },
    { name: "count", label: "Count", type: "number", required: true, lifecycle: "active" },
    { name: "enabled", label: "Enabled", type: "boolean", required: true, lifecycle: "active" },
    { name: "due_on", label: "Due on", type: "date", required: true, lifecycle: "active" },
    {
      name: "happens_at",
      label: "Happens at",
      type: "datetime",
      required: true,
      lifecycle: "active",
    },
    { name: "note", label: "Note", type: "string", required: false, lifecycle: "active" },
    {
      name: "retired_note",
      label: "Retired note",
      type: "string",
      required: true,
      lifecycle: "inactive",
    },
  ];
  const required = ["title", "count", "enabled", "due_on", "happens_at"];
  return notesSpec({
    schema: { fields },
    ui_intent: {
      form: { list_inputs: [] },
      item: { direction: "Show the entry and its count.", shows: ["title", "count"] },
      collection: { layout: "feed" },
      detail: { shows: ["title", "count", "enabled", "due_on", "happens_at", "note"] },
    },
    behavioral_errors: [
      {
        action: "create",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: required,
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
    ],
  });
}

function stringListSpec(): CapabilitySpec {
  return notesSpec({
    schema: {
      fields: [
        { name: "tags", label: "Tags", type: "string[]", required: true, lifecycle: "active" },
        {
          name: "aliases",
          label: "Aliases",
          type: "string[]",
          required: false,
          lifecycle: "active",
        },
      ],
    },
    ui_intent: {
      form: {
        list_inputs: [
          { field: "tags", mode: "repeatable" },
          { field: "aliases", mode: "repeatable" },
        ],
      },
      item: { direction: "Show tags in their submitted order.", shows: ["tags"] },
      collection: { layout: "feed" },
      detail: { shows: ["tags", "aliases"] },
    },
    behavioral_errors: [
      {
        action: "create",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["tags"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
    ],
  });
}

function withFileDatabase(run: (databases: PlatformDatabase) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "omni-crud-tool-"));
  const databases = openDatabase(join(dir, "test.db"));

  try {
    run(databases);
  } finally {
    closeQuietly(databases.readwrite);
    closeQuietly(databases.readonly);
    rmSync(dir, { recursive: true, force: true });
  }
}

function closeQuietly(database: Database): void {
  try {
    database.close();
  } catch {
    // Some tests deliberately close one side early to prove which connection a
    // tool method uses.
  }
}

describe("capability data tool", () => {
  test("exposes only capability-scoped insert and select methods", () => {
    withFileDatabase((databases) => {
      const spec = notesSpec();
      applyCapabilityTableDdl(spec, databases.readwrite);

      const tool = createCapabilityDataTool(spec, databases);

      expect(Object.keys(tool).sort()).toEqual(["insert", "select"]);
      expect(tool.insert.length).toBe(1);
      expect(tool.select.length).toBe(0);
    });
  });

  test("a tool constructed for one capability cannot read or write another capability table", () => {
    withFileDatabase((databases) => {
      const notes = notesSpec();
      const recipes = recipesSpec();
      applyCapabilityTableDdl(notes, databases.readwrite);
      applyCapabilityTableDdl(recipes, databases.readwrite);

      const notesTool = createCapabilityDataTool(notes, databases);
      const recipesTool = createCapabilityDataTool(recipes, databases);

      recipesTool.insert({ title: "Soup" });
      expect(notesTool.select()).toEqual([]);

      notesTool.insert({ text: "Buy coffee" });
      expect(recipesTool.select()).toMatchObject([{ title: "Soup" }]);
      expect(() => notesTool.insert({ title: "Not a notes field" })).toThrow(
        /Unknown field "title" for capability "notes"/,
      );
    });
  });

  test("insert uses the read-write connection without touching the read-only connection", () => {
    withFileDatabase((databases) => {
      const spec = notesSpec();
      applyCapabilityTableDdl(spec, databases.readwrite);
      databases.readonly.close();

      const tool = createCapabilityDataTool(spec, databases);

      expect(tool.insert({ text: "Still writes" })).toMatchObject({
        text: "Still writes",
      });
    });
  });

  test("select uses the read-only connection without touching the read-write connection", () => {
    withFileDatabase((databases) => {
      const spec = notesSpec();
      applyCapabilityTableDdl(spec, databases.readwrite);
      const tool = createCapabilityDataTool(spec, databases);
      tool.insert({ text: "Read through readonly" });
      databases.readwrite.close();

      expect(tool.select()).toMatchObject([{ text: "Read through readonly" }]);
    });
  });

  test("insert then select exposes only handler-safe platform columns and active fields", () => {
    withFileDatabase((databases) => {
      const spec = notesSpec();
      applyCapabilityTableDdl(spec, databases.readwrite);
      const tool = createCapabilityDataTool(spec, databases);

      const inserted = tool.insert({ text: "Hello", pinned: true });
      const rows = tool.select();

      expect(inserted.id).toBeTruthy();
      expect(inserted.created_at).toBeTruthy();
      expect(inserted).not.toHaveProperty("extra");
      expect(rows).toEqual([inserted]);
      expect(rows[0]).toMatchObject({
        text: "Hello",
        pinned: true,
      });
      expect(databases.readwrite.query('SELECT "extra" FROM "cap_notes"').get()).toEqual({
        extra: "{}",
      });
    });
  });

  test("handlers cannot write the platform-owned extra column", () => {
    withFileDatabase((databases) => {
      const spec = notesSpec();
      applyCapabilityTableDdl(spec, databases.readwrite);
      const tool = createCapabilityDataTool(spec, databases);

      expect(() =>
        tool.insert({
          text: "With metadata",
          extra: { source: "test" },
        }),
      ).toThrow(/platform-populated/);
      expect(tool.select()).toEqual([]);
    });
  });

  test("the same round-trip works against a shared in-memory scratch database pair", () => {
    const name = randomUUID().replaceAll("-", "_");
    const uri = `file:${name}?mode=memory&cache=shared`;
    const readwrite = new Database(uri, { create: true, readwrite: true });
    const readonly = new Database(uri, { readonly: true });
    const databases = { readwrite, readonly };

    try {
      const spec = notesSpec();
      applyCapabilityTableDdl(spec, readwrite);
      const tool = createCapabilityDataTool(spec, databases);

      tool.insert({ text: "Scratch note" });

      expect(tool.select()).toMatchObject([{ text: "Scratch note" }]);
    } finally {
      readonly.close();
      readwrite.close();
    }
  });

  test("required field violations surface clearly and write nothing", () => {
    withFileDatabase((databases) => {
      const spec = notesSpec();
      applyCapabilityTableDdl(spec, databases.readwrite);
      const tool = createCapabilityDataTool(spec, databases);

      expect(() => tool.insert({ pinned: false })).toThrow(MissingRequiredFieldsError);
      try {
        tool.insert({ pinned: false });
      } catch (error) {
        expect(error).toMatchObject({
          action: "create",
          code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
          fields: ["text"],
        });
      }
      expect(tool.select()).toEqual([]);
    });
  });

  test("requiredness is total by type and names every missing active required field", () => {
    withFileDatabase((databases) => {
      const spec = requirednessSpec();
      applyCapabilityTableDdl(spec, databases.readwrite);
      const tool = createCapabilityDataTool(spec, databases);
      const valid = {
        title: "  Keep my spacing  ",
        count: 0,
        enabled: false,
        due_on: "2026-07-14",
        happens_at: "2026-07-14T10:30:00.000Z",
      };

      for (const [values, expectedFields] of [
        [{ ...valid, title: "   " }, ["title"]],
        [{ ...valid, due_on: "" }, ["due_on"]],
        [{ note: "optional" }, ["title", "count", "enabled", "due_on", "happens_at"]],
      ] as const) {
        try {
          tool.insert(values);
          throw new Error("expected requiredness failure");
        } catch (error) {
          expect(error).toMatchObject({
            code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
            fields: expectedFields,
          });
        }
      }
      expect(tool.select()).toEqual([]);

      expect(tool.insert(valid)).toMatchObject({
        title: "  Keep my spacing  ",
        count: 0,
        enabled: false,
      });
      expect(tool.insert({ ...valid, enabled: true })).toMatchObject({ enabled: true });
    });
  });

  test("date and datetime validation rejects impossible calendar values", () => {
    withFileDatabase((databases) => {
      const spec = requirednessSpec();
      applyCapabilityTableDdl(spec, databases.readwrite);
      const tool = createCapabilityDataTool(spec, databases);
      const valid = {
        title: "Entry",
        count: 1,
        enabled: true,
        due_on: "0001-01-01",
        happens_at: "2000-02-29T23:59:59.999+14:00",
      };

      expect(tool.insert(valid)).toMatchObject(valid);
      for (const values of [
        { ...valid, due_on: "1900-02-29" },
        { ...valid, happens_at: "2026-02-30T10:00" },
        { ...valid, happens_at: "2026-07-15" },
        { ...valid, happens_at: "2026-07-15T10:00+14:01" },
      ]) {
        expect(() => tool.insert(values)).toThrow(MissingRequiredFieldsError);
      }
      expect(tool.select()).toHaveLength(1);
    });
  });

  test("string lists discard blank placeholders and JSON round-trip text, order, and commas", () => {
    withFileDatabase((databases) => {
      const spec = stringListSpec();
      applyCapabilityTableDdl(spec, databases.readwrite);
      const tool = createCapabilityDataTool(spec, databases);

      const inserted = tool.insert({
        tags: ["  first  ", "", "   ", "one,two", "last"],
        aliases: [],
      });
      expect(inserted).toMatchObject({
        tags: ["  first  ", "one,two", "last"],
        aliases: [],
      });
      expect(tool.select()).toMatchObject([
        { tags: ["  first  ", "one,two", "last"], aliases: [] },
      ]);
      expect(databases.readwrite.query('SELECT "tags", "aliases" FROM "cap_notes"').get()).toEqual({
        tags: '["  first  ","one,two","last"]',
        aliases: "[]",
      });
    });
  });

  test("required string lists reject empty or blank-only values while historical null stays readable", () => {
    withFileDatabase((databases) => {
      const spec = stringListSpec();
      applyCapabilityTableDdl(spec, databases.readwrite);
      const tool = createCapabilityDataTool(spec, databases);

      for (const tags of [undefined, [], ["", "   "]]) {
        try {
          tool.insert({ tags, aliases: [] });
          throw new Error("expected requiredness failure");
        } catch (error) {
          expect(error).toMatchObject({
            code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
            fields: ["tags"],
          });
        }
      }

      databases.readwrite.run(
        'INSERT INTO "cap_notes" ("id", "tags", "aliases") VALUES (?, NULL, NULL)',
        ["historical-null-list"],
      );
      expect(tool.select()).toMatchObject([
        { id: "historical-null-list", tags: null, aliases: null },
      ]);
    });
  });

  test("inactive fields keep physical values but stay outside mutations and runtime rows", () => {
    withFileDatabase((databases) => {
      const spec = requirednessSpec();
      applyCapabilityTableDdl(spec, databases.readwrite);
      expect(spec.schema.fields.find((field) => field.name === "retired_note")?.lifecycle).toBe(
        "inactive",
      );

      databases.readwrite.run(
        `INSERT INTO "cap_notes" ("id", "title", "count", "enabled", "due_on", "happens_at", "retired_note") VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ["historical", "Visible", 1, 1, "2026-07-14", "2026-07-14T10:30:00.000Z", "still stored"],
      );
      const tool = createCapabilityDataTool(spec, databases);
      const row = tool.select()[0];
      expect(row).toMatchObject({ title: "Visible", count: 1, enabled: true });
      expect(row).not.toHaveProperty("retired_note");
      expect(
        databases.readwrite
          .query('SELECT "retired_note" FROM "cap_notes" WHERE "id" = ?')
          .get("historical"),
      ).toEqual({ retired_note: "still stored" });
      expect(() =>
        tool.insert({
          title: "New",
          count: 1,
          enabled: true,
          due_on: "2026-07-15",
          happens_at: "2026-07-15T10:30:00.000Z",
          retired_note: "cannot mutate",
        }),
      ).toThrow(/Unknown field "retired_note"/);
    });
  });

  test("historical nulls in logically required columns remain readable", () => {
    withFileDatabase((databases) => {
      const spec = requirednessSpec();
      applyCapabilityTableDdl(spec, databases.readwrite);
      databases.readwrite.run('INSERT INTO "cap_notes" ("id") VALUES (?)', ["legacy-null"]);

      expect(createCapabilityDataTool(spec, databases).select()).toMatchObject([
        {
          id: "legacy-null",
          title: null,
          count: null,
          enabled: null,
          due_on: null,
          happens_at: null,
        },
      ]);
    });
  });

  test("platform-populated columns and invalid field values are rejected before SQLite sees them", () => {
    withFileDatabase((databases) => {
      const spec = notesSpec();
      applyCapabilityTableDdl(spec, databases.readwrite);
      const tool = createCapabilityDataTool(spec, databases);

      expect(() => tool.insert({ id: "custom", text: "Nope" })).toThrow(/platform-populated/);
      expect(() => tool.insert({ text: "Nope", pinned: "yes" })).toThrow(
        /Field "pinned" must be a boolean/,
      );
      expect(() => tool.insert({ text: "Nope", extra: { bad: undefined } })).toThrow(
        /platform-populated/,
      );
      expect(tool.select()).toEqual([]);
    });
  });
});
