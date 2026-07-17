// Tests for the capability-scoped data tool (Epic 2.2). They prove scoping is a
// construction property, not a convention: once a tool is created for one spec,
// its public surface has no table/capability argument, writes ride the injected
// read-write connection, and reads ride the injected read-only connection.
//
// The oversized "capability data tool" group is split into sibling describes by
// concern; the shared spec builders and database harness live in
// `tool.test-support.ts`.

// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: one data-port regression suite stays grouped by concern.

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { MISSING_REQUIRED_FIELDS_ERROR_CODE } from "../registry/index.ts";
import {
  applyCapabilityTableDdl,
  createCapabilityMutationPort,
  createCapabilityQueryPort,
  MissingRequiredFieldsError,
  materializeCapabilityActionRecord,
  normalizeSearchText,
} from "./index.ts";
import {
  createCapabilityDataTool,
  notesSpec,
  recipesSpec,
  requirednessSpec,
  stringListSpec,
  withFileDatabase,
} from "./tool.test-support.ts";

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: split query-port cases share one compact file-database harness.
describe("split capability data ports", () => {
  test("mutation authority is capability-bound while the query port can join capabilities", () => {
    withFileDatabase((databases) => {
      const notes = notesSpec();
      const recipes = recipesSpec();
      applyCapabilityTableDdl(notes, databases.readwrite);
      applyCapabilityTableDdl(recipes, databases.readwrite);

      const notesMutation = createCapabilityMutationPort(notes, databases.readwrite);
      const recipesMutation = createCapabilityMutationPort(recipes, databases.readwrite);
      const note = materializeCapabilityActionRecord(
        notesMutation.create({ text: "Soup notes", pinned: false }),
      );
      recipesMutation.create({ title: "Soup" });
      const query = createCapabilityQueryPort(databases.readonly, {
        target: notes,
        dependencies: [recipes],
      });

      expect(Object.keys(notesMutation)).toEqual(["create"]);
      expect(notesMutation.create.length).toBe(1);
      expect(() => notesMutation.create({ title: "Not a notes field" })).toThrow(
        /Unknown field "title" for capability "notes"/,
      );
      expect(
        query.records({
          sql: `SELECT n."id" AS "target_id", r."title" AS "recipe_title"
                FROM "cap_notes" n CROSS JOIN "cap_recipes" r
                WHERE n."id" = ?`,
          parameters: [note.id],
          result: [{ alias: "recipe_title", type: "string" }],
        }),
      ).toMatchObject([
        { record: { fields: { text: "Soup notes" } }, values: { recipe_title: "Soup" } },
      ]);
    });
  });

  test("Action scope admits only the target and declared dependency tables", () => {
    withFileDatabase((databases) => {
      const notes = notesSpec();
      const recipes = recipesSpec();
      const hidden = notesSpec({ id: "hidden", label: "Hidden" });
      for (const spec of [notes, recipes, hidden]) {
        applyCapabilityTableDdl(spec, databases.readwrite);
      }
      const notesMutation = createCapabilityMutationPort(notes, databases.readwrite);
      const recipesMutation = createCapabilityMutationPort(recipes, databases.readwrite);
      notesMutation.create({ text: "Soup notes", pinned: false });
      recipesMutation.create({ title: "Soup" });
      const query = createCapabilityQueryPort(databases.readonly, {
        target: notes,
        dependencies: [recipes],
      });

      expect(
        query.records({
          sql: 'SELECT n."id" AS "target_id", r."title" AS "recipe_title" FROM "cap_notes" n CROSS JOIN "cap_recipes" r',
          result: [{ alias: "recipe_title", type: "string" }],
        }),
      ).toMatchObject([
        { record: { fields: { text: "Soup notes" } }, values: { recipe_title: "Soup" } },
      ]);
      expect(() =>
        query.all({
          sql: 'SELECT "id" FROM "cap_hidden"',
          result: [{ alias: "id", type: "string" }],
        }),
      ).toThrow(/undeclared capability table.*cap_hidden/);
    });
  });

  test("a copied reader can still read a declared field after its dependency soft-hides it", () => {
    withFileDatabase((databases) => {
      const notes = notesSpec();
      const recipes = recipesSpec();
      recipes.schema.fields.push({
        name: "summary",
        label: "Summary",
        type: "string",
        required: false,
        lifecycle: "active",
      });
      recipes.ui_intent.item.shows = ["title", "summary"];
      recipes.ui_intent.detail.shows = ["title", "summary"];
      applyCapabilityTableDdl(notes, databases.readwrite);
      applyCapabilityTableDdl(recipes, databases.readwrite);
      createCapabilityMutationPort(recipes, databases.readwrite).create({ title: "Soup" });
      const hiddenRecipes = recipesSpec();
      hiddenRecipes.schema.fields = recipes.schema.fields.map((field) =>
        field.name === "title" ? { ...field, lifecycle: "inactive" } : field,
      );
      hiddenRecipes.ui_intent.item.shows = ["summary"];
      hiddenRecipes.ui_intent.detail.shows = ["summary"];
      hiddenRecipes.behavioral_errors = [];
      const query = createCapabilityQueryPort(databases.readonly, {
        target: notes,
        dependencies: [hiddenRecipes],
      });

      expect(
        query.all({
          sql: 'SELECT "title" FROM "cap_recipes"',
          result: [{ alias: "title", type: "string" }],
        }),
      ).toEqual([{ title: "Soup" }]);
    });
  });

  test("record queries rehydrate full target rows, restore order, and fail closed on bad ids", () => {
    withFileDatabase((databases) => {
      const notes = notesSpec({
        schema: {
          fields: [
            ...notesSpec().schema.fields,
            {
              name: "added_later",
              label: "Added later",
              type: "string",
              required: false,
              lifecycle: "active",
            },
            {
              name: "retired",
              label: "Retired",
              type: "string",
              required: false,
              lifecycle: "inactive",
            },
          ],
        },
        ui_intent: {
          ...notesSpec().ui_intent,
          detail: { shows: ["text", "added_later"] },
        },
      });
      const recipes = recipesSpec();
      applyCapabilityTableDdl(notes, databases.readwrite);
      applyCapabilityTableDdl(recipes, databases.readwrite);
      const mutation = createCapabilityMutationPort(notes, databases.readwrite);
      const first = materializeCapabilityActionRecord(
        mutation.create({ text: "First", pinned: false, added_later: "new value" }),
      );
      const second = materializeCapabilityActionRecord(
        mutation.create({ text: "Second", pinned: true, added_later: "also new" }),
      );
      const foreign = materializeCapabilityActionRecord(
        createCapabilityMutationPort(recipes, databases.readwrite).create({ title: "Soup" }),
      );
      databases.readwrite.run('UPDATE "cap_notes" SET "retired" = ?, "extra" = ? WHERE "id" = ?', [
        "secret",
        '{"private":true}',
        first.id,
      ]);
      const query = createCapabilityQueryPort(databases.readonly, { target: notes });

      const rows = query.records({
        sql: 'SELECT "id" AS "target_id", "text" AS "selected_text" FROM "cap_notes" ORDER BY CASE "id" WHEN ? THEN 0 ELSE 1 END',
        parameters: [second.id],
        result: [{ alias: "selected_text", type: "string" }],
      });
      expect(rows.map(({ record }) => record.fields.text)).toEqual(["Second", "First"]);
      expect(rows[1]?.record.fields.added_later).toBe("new value");
      expect(rows[1]?.record.fields).not.toHaveProperty("retired");
      expect(rows[1]?.record.fields).not.toHaveProperty("extra");
      expect(rows[1]?.record).not.toHaveProperty("id");
      expect(rows[0]?.values).toEqual({ selected_text: "Second" });

      expect(() =>
        query.records({
          sql: 'SELECT "id" AS "target_id" FROM "cap_notes" UNION ALL SELECT "id" FROM "cap_notes"',
        }),
      ).toThrow(/duplicate target ids/);
      expect(() =>
        query.records({
          sql: "SELECT ? AS target_id",
          parameters: [foreign.id],
        }),
      ).toThrow(/missing or foreign target id/);
    });
  });

  test("platform search normalization ignores case and accents", () => {
    for (const variant of ["cafe", "CAFE", "CaFe", "Café", "Cáfé", "Cafe\u0301"]) {
      expect(normalizeSearchText(variant)).toBe("cafe");
    }
    expect(normalizeSearchText("ÅNGSTRÖM")).toBe("angstrom");
    expect(normalizeSearchText("façade")).toBe("facade");
    for (const value of ["हिंदी", "क़िला", "がくせい", "เก่ง", "Hawaiʻi"]) {
      expect(normalizeSearchText(value)).toBe(value.normalize("NFKC").toLocaleLowerCase("und"));
    }
    withFileDatabase((databases) => {
      const notes = notesSpec();
      notes.schema.fields.push({
        name: "details",
        label: "Details",
        type: "string",
        required: false,
        lifecycle: "active",
      });
      applyCapabilityTableDdl(notes, databases.readwrite);
      const row = materializeCapabilityActionRecord(
        createCapabilityMutationPort(notes, databases.readwrite).create({
          text: "CAFÉ ÅNGSTRÖM",
          pinned: false,
          details: "Afternoon",
        }),
      );
      createCapabilityMutationPort(notes, databases.readwrite).create({
        text: "Jupiter",
        pinned: false,
        details: "",
      });
      const query = createCapabilityQueryPort(databases.readonly, { target: notes });

      expect(
        query.all({
          sql: "SELECT platform_search_normalize(?) AS normalized",
          parameters: ["Cafe\u0301 a\u030angstro\u0308m"],
          result: [{ alias: "normalized", type: "string" }],
        }),
      ).toEqual([{ normalized: "cafe angstrom" }]);
      expect(
        query.all({
          sql: "SELECT platform_search_normalize(?) AS normalized",
          parameters: [""],
          result: [{ alias: "normalized", type: "string" }],
        }),
      ).toEqual([{ normalized: "" }]);
      expect(
        query.records({
          sql: 'SELECT "id" AS "target_id" FROM "cap_notes" WHERE platform_search_normalize("text") = platform_search_normalize(?)',
          parameters: ["cafe angstrom"],
        }),
      ).toHaveLength(1);
      expect(
        query.records({
          sql: 'SELECT "id" AS "target_id" FROM "cap_notes" WHERE instr(platform_search_normalize("text"), platform_search_normalize(?)) > 0 OR instr(platform_search_normalize("details"), platform_search_normalize(?)) > 0',
          parameters: ["cafe", "cafe"],
        }),
      ).toHaveLength(1);
      expect(
        databases.readonly
          .query('SELECT lower("text") = lower(?) AS matches FROM "cap_notes" WHERE "id" = ?')
          .get("cafe angstrom", row.id),
      ).toEqual({ matches: 0 });
    });
  });

  test("a write through the query port fails at the physically read-only connection", () => {
    withFileDatabase((databases) => {
      const spec = notesSpec();
      applyCapabilityTableDdl(spec, databases.readwrite);
      const query = createCapabilityQueryPort(databases.readonly, { target: spec });

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
      const mutation = createCapabilityMutationPort(spec, databases.readwrite);
      const query = createCapabilityQueryPort(databases.readonly, { target: spec });
      mutation.create({ text: "Declared only", pinned: true });

      const projected = query.all({
        sql: 'SELECT "text", "pinned" FROM "cap_notes"',
        result: [{ alias: "text", type: "string" }],
      });
      expect(projected).toHaveLength(1);
      expect(Object.keys(projected[0] ?? {})).toEqual(["text"]);
      expect(projected[0]).toMatchObject({ text: "Declared only" });
      expect(projected[0]).not.toHaveProperty("pinned");
      expect(projected[0]).not.toHaveProperty("extra");

      expect(() =>
        query.all({
          sql: 'SELECT "text" AS "different" FROM "cap_notes"',
          result: [{ alias: "text", type: "string" }],
        }),
      ).toThrow(/missing declared alias "text"/);
      expect(() =>
        query.all({
          sql: 'SELECT "text" AS "value", "pinned" AS "value" FROM "cap_notes"',
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
          sql: 'SELECT "text" FROM "cap_notes"',
          result: [
            { alias: "id", type: "string" },
            { alias: "id", type: "string" },
          ],
        }),
      ).toThrow(/Duplicate query result alias "id"/);

      expect(() =>
        query.all({
          sql: 'SELECT "text" FROM "cap_notes"',
          result: [{ alias: "text", type: "invented" as "string" }],
        }),
      ).toThrow(/Invalid query result type "invented"/);
    });
  });

  test("target internals and ambient schema readers never cross the Handler query interface", () => {
    withFileDatabase((databases) => {
      const spec = notesSpec({
        schema: {
          fields: [
            ...notesSpec().schema.fields,
            {
              name: "retired_note",
              label: "Retired note",
              type: "string",
              required: false,
              lifecycle: "inactive",
            },
          ],
        },
      });
      applyCapabilityTableDdl(spec, databases.readwrite);
      const query = createCapabilityQueryPort(databases.readonly, { target: spec });

      for (const sql of [
        'SELECT "id" AS "leak" FROM "cap_notes"',
        'SELECT "extra" AS "leak" FROM "cap_notes"',
        'SELECT "retired_note" AS "leak" FROM "cap_notes"',
      ]) {
        expect(() => query.all({ sql, result: [{ alias: "leak", type: "string" }] })).toThrow(
          /protected target column/,
        );
      }
      for (const sql of [
        'SELECT * FROM pragma_table_info("cap_notes")',
        'SELECT * FROM pragma_table_xinfo("cap_notes")',
      ]) {
        expect(() => query.all({ sql, result: [{ alias: "name", type: "string" }] })).toThrow(
          /schema and ambient virtual tables/,
        );
      }
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
