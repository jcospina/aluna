// Tests for the registry access module (Epic 2.1). Each case runs against a
// throwaway db (openDatabase + runMigrations) so the real data file is never
// touched. The headline guarantees: a valid row written through the access
// module reads back deep-equal — version and artifacts_path intact — through
// the read-only connection; an invalid row writes nothing; and the registry
// table stays lean (exactly the ten spec'd columns, ARCH §6.3).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase, type PlatformDatabase } from "../db.ts";
import { runMigrations } from "../migrations.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilityRow,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "./spec.ts";
import { getCapability, insertCapability, listCapabilities, REGISTRY_TABLE } from "./store.ts";

const NOTES_INCARNATION_ID = "11111111-1111-4111-8111-111111111111";

// A complete, valid registry row — the M2 demo's notes capability. Fresh per
// call so tests can tweak copies without sharing state.
function notesRow(overrides: Partial<CapabilityRow> = {}): CapabilityRow {
  return {
    id: "notes",
    label: "Notes",
    incarnation_id: NOTES_INCARNATION_ID,
    version: 1,
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
    artifacts_path: `capabilities/notes/${NOTES_INCARNATION_ID}/v1/`,
    prompt_context: "Stores the user's text notes.",
    ...overrides,
  };
}

describe("capability registry store", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omni-crud-registry-"));
    conns = openDatabase(join(dir, "test.db"));
    runMigrations(conns.readwrite);
  });

  afterEach(() => {
    conns.readwrite.close();
    conns.readonly.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a valid row round-trips deep-equal, version and artifacts_path intact", () => {
    const row = notesRow();
    insertCapability(row, conns.readwrite);

    // Read back through the *read-only* connection — the write landed in the
    // shared file and the read path convention (ARCH §7) really serves it.
    const fetched = getCapability("notes", conns.readonly);
    expect(fetched).toEqual(row);
    expect(fetched?.version).toBe(1);
    expect(fetched?.incarnation_id).toBe(NOTES_INCARNATION_ID);
    expect(fetched?.artifacts_path).toBe(`capabilities/notes/${NOTES_INCARNATION_ID}/v1/`);
  });

  test("get-by-id returns null for an unknown capability", () => {
    expect(getCapability("recipes", conns.readonly)).toBeNull();
  });

  test("list-all returns every row, deterministically ordered by id", () => {
    const notes = notesRow();
    const recipes = notesRow({
      id: "recipes",
      label: "Recipes",
      incarnation_id: "22222222-2222-4222-8222-222222222222",
      artifacts_path: "capabilities/recipes/22222222-2222-4222-8222-222222222222/v1/",
      prompt_context: "Stores the user's recipes.",
    });

    // Insert out of order; the list comes back in id order regardless.
    insertCapability(recipes, conns.readwrite);
    insertCapability(notes, conns.readwrite);

    expect(listCapabilities(conns.readonly)).toEqual([notes, recipes]);
  });

  test("list-all on an empty registry is an empty list", () => {
    expect(listCapabilities(conns.readonly)).toEqual([]);
  });

  test("an invalid spec is rejected loudly and writes nothing", () => {
    const invalid = notesRow({
      schema: {
        fields: [
          {
            name: "tags",
            label: "Tags",
            // @ts-expect-error — only string[] is admitted; number[] remains outside the pantry.
            type: "number[]",
            required: false,
            lifecycle: "active",
          },
        ],
      },
    });

    expect(() => insertCapability(invalid, conns.readwrite)).toThrow();
    expect(listCapabilities(conns.readonly)).toEqual([]);
  });

  test("stored rows fail closed instead of synthesizing a missing required-fields contract", () => {
    insertCapability(notesRow(), conns.readwrite);
    conns.readwrite.run(`UPDATE ${REGISTRY_TABLE} SET behavioral_errors = '[]' WHERE id = 'notes'`);

    expect(() => getCapability("notes", conns.readonly)).toThrow();
  });

  test("a duplicate id throws — duplicates are the resolver's to deflect, not the store's", () => {
    insertCapability(notesRow(), conns.readwrite);
    expect(() => insertCapability(notesRow(), conns.readwrite)).toThrow();
  });

  test("the registry row stays lean and carries the capability incarnation", () => {
    const columns = conns.readonly
      .query(`SELECT name FROM pragma_table_info('${REGISTRY_TABLE}') ORDER BY cid`)
      .all() as { name: string }[];

    expect(columns.map((column) => column.name)).toEqual([
      "id",
      "label",
      "version",
      "schema",
      "ui_intent",
      "behavior",
      "tools",
      "artifacts_path",
      "prompt_context",
      "behavioral_errors",
      "incarnation_id",
      "read_dependencies",
    ]);
  });
});
