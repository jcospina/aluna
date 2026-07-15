// Tests for the capability-scoped data tool (Epic 2.2). They prove scoping is a
// construction property, not a convention: once a tool is created for one spec,
// its public surface has no table/capability argument, writes ride the injected
// read-write connection, and reads ride the injected read-only connection.
//
// The oversized "capability data tool" group is split into sibling describes by
// concern; the shared spec builders and database harness live in
// `tool.test-support.ts`.

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { MISSING_REQUIRED_FIELDS_ERROR_CODE } from "../registry/index.ts";
import {
  applyCapabilityTableDdl,
  createCapabilityDataPorts,
  createCapabilityQueryPort,
  MissingRequiredFieldsError,
} from "./index.ts";
import {
  createCapabilityDataTool,
  notesSpec,
  recipesSpec,
  requirednessSpec,
  stringListSpec,
  withFileDatabase,
} from "./tool.test-support.ts";

describe("split capability data ports", () => {
  test("mutation authority is capability-bound while the query port can join capabilities", () => {
    withFileDatabase((databases) => {
      const notes = notesSpec();
      const recipes = recipesSpec();
      applyCapabilityTableDdl(notes, databases.readwrite);
      applyCapabilityTableDdl(recipes, databases.readwrite);

      const notesPorts = createCapabilityDataPorts(notes, databases);
      const recipesPorts = createCapabilityDataPorts(recipes, databases);
      const note = notesPorts.mutation.create({ text: "Soup notes", pinned: false });
      recipesPorts.mutation.create({ title: "Soup" });

      expect(Object.keys(notesPorts.mutation)).toEqual(["create"]);
      expect(notesPorts.mutation.create.length).toBe(1);
      expect(() => notesPorts.mutation.create({ title: "Not a notes field" })).toThrow(
        /Unknown field "title" for capability "notes"/,
      );
      expect(
        notesPorts.query.all({
          sql: `SELECT n."id" AS "note_id", r."title" AS "recipe_title"
                FROM "cap_notes" n CROSS JOIN "cap_recipes" r
                WHERE n."id" = ?`,
          parameters: [note.id],
          result: [
            { alias: "note_id", type: "string" },
            { alias: "recipe_title", type: "string" },
          ],
        }),
      ).toEqual([{ note_id: note.id, recipe_title: "Soup" }]);
    });
  });

  test("a write through the query port fails at the physically read-only connection", () => {
    withFileDatabase((databases) => {
      const spec = notesSpec();
      applyCapabilityTableDdl(spec, databases.readwrite);
      const query = createCapabilityQueryPort(databases.readonly);

      expect(() =>
        query.all({
          sql: 'INSERT INTO "cap_notes" ("id", "text") VALUES (?, ?)',
          parameters: ["query-write", "must fail"],
          result: [],
        }),
      ).toThrow(/readonly|read-only/i);
      expect(
        databases.readwrite.query('SELECT COUNT(*) AS "count" FROM "cap_notes"').get(),
      ).toEqual({ count: 0 });
    });
  });

  test("closed ordered descriptors discard extras and reject missing, duplicate, and invalid values", () => {
    withFileDatabase((databases) => {
      const spec = notesSpec();
      applyCapabilityTableDdl(spec, databases.readwrite);
      const { mutation, query } = createCapabilityDataPorts(spec, databases);
      mutation.create({ text: "Declared only", pinned: true });

      const projected = query.all({
        sql: 'SELECT * FROM "cap_notes"',
        result: [
          { alias: "text", type: "string" },
          { alias: "id", type: "string" },
        ],
      });
      expect(projected).toHaveLength(1);
      expect(Object.keys(projected[0] ?? {})).toEqual(["text", "id"]);
      expect(projected[0]).toMatchObject({ text: "Declared only" });
      expect(projected[0]).not.toHaveProperty("pinned");
      expect(projected[0]).not.toHaveProperty("extra");

      expect(() =>
        query.all({
          sql: 'SELECT "id" FROM "cap_notes"',
          result: [{ alias: "text", type: "string" }],
        }),
      ).toThrow(/missing declared alias "text"/);
      expect(() =>
        query.all({
          sql: 'SELECT "id" AS "value", "text" AS "value" FROM "cap_notes"',
          result: [{ alias: "value", type: "string" }],
        }),
      ).toThrow(/duplicate declared alias "value"/);
      expect(() =>
        query.all({
          sql: 'SELECT "pinned" FROM "cap_notes"',
          result: [{ alias: "pinned", type: "string" }],
        }),
      ).toThrow(/invalid value for declared alias "pinned"/);
      expect(() =>
        query.all({
          sql: 'SELECT "id" FROM "cap_notes"',
          result: [
            { alias: "id", type: "string" },
            { alias: "id", type: "string" },
          ],
        }),
      ).toThrow(/Duplicate query result alias "id"/);
    });
  });
});

describe("capability data tool — scoped surface & connection routing", () => {
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
});

describe("capability data tool — platform columns & rejected values", () => {
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

describe("capability data tool — requiredness", () => {
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
});

describe("capability data tool — temporal & string-list values", () => {
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
});

describe("capability data tool — inactive fields & historical nulls", () => {
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
});
