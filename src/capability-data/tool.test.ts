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
import { applyCapabilityTableDdl, createCapabilityDataTool } from "./index.ts";

function notesSpec(overrides: Partial<CapabilitySpec> = {}): CapabilitySpec {
  return {
    id: "notes",
    label: "Notes",
    schema: {
      fields: [
        { name: "text", type: "string", required: true },
        { name: "pinned", type: "boolean", required: false },
      ],
    },
    ui_intent: { views: ["list", "create"] },
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
    prompt_context: "Stores the user's text notes.",
    ...overrides,
  };
}

function recipesSpec(): CapabilitySpec {
  return notesSpec({
    id: "recipes",
    label: "Recipes",
    schema: { fields: [{ name: "title", type: "string", required: true }] },
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
        extra: {},
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

  test("insert then select returns platform-populated columns and defaulted extra", () => {
    withFileDatabase((databases) => {
      const spec = notesSpec();
      applyCapabilityTableDdl(spec, databases.readwrite);
      const tool = createCapabilityDataTool(spec, databases);

      const inserted = tool.insert({ text: "Hello", pinned: true });
      const rows = tool.select();

      expect(inserted.id).toBeTruthy();
      expect(inserted.created_at).toBeTruthy();
      expect(inserted.extra).toEqual({});
      expect(rows).toEqual([inserted]);
      expect(rows[0]).toMatchObject({
        text: "Hello",
        pinned: true,
        extra: {},
      });
    });
  });

  test("insert accepts the explicit extra JSON escape hatch", () => {
    withFileDatabase((databases) => {
      const spec = notesSpec();
      applyCapabilityTableDdl(spec, databases.readwrite);
      const tool = createCapabilityDataTool(spec, databases);

      tool.insert({
        text: "With metadata",
        extra: { source: "test", nested: { priority: 1 }, tags: ["a", "b"] },
      });

      expect(tool.select()).toMatchObject([
        {
          text: "With metadata",
          extra: { source: "test", nested: { priority: 1 }, tags: ["a", "b"] },
        },
      ]);
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

      expect(tool.select()).toMatchObject([{ text: "Scratch note", extra: {} }]);
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

      expect(() => tool.insert({ pinned: false })).toThrow(
        /Missing required field "text" for capability "notes"/,
      );
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
        /Field "extra.bad" must be JSON-serializable/,
      );
      expect(tool.select()).toEqual([]);
    });
  });
});
