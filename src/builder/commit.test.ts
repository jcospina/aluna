// Tests for the commit stage (Epic 2.5g) — the terminal "becomes real" step.
//
// Commit writes the version-1 artifacts to the capability's version directory and
// inserts the registry row pointing at them, inside the caller's open transaction.
// These tests drive it against a throwaway file db + temp artifacts dir, never the
// real data file, and prove both halves of "single atomic step": a clean commit
// lands the files plus a v1 row whose pointer they sit behind, and a rollback (a
// transaction that throws after commit) leaves nothing in the registry and no
// cap_<id> table — with the written files harmlessly orphaned, never half-registered.

import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { applyCapabilityTableDdl } from "../capability-data/index.ts";
import { openDatabase, type PlatformDatabase, withWriteTransaction } from "../db.ts";
import { runMigrations } from "../migrations.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  getCapability,
  insertCapability,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../registry/index.ts";
import { commitCapability, FIRST_CAPABILITY_VERSION } from "./commit.ts";
import type { GeneratedUnit } from "./units.ts";

const TOKENS = { inputTokens: 1, outputTokens: 1, totalTokens: 2 } as const;
const INCARNATION_ID = "11111111-1111-4111-8111-111111111111";

function notesSpec(overrides: Partial<CapabilitySpec> = {}): CapabilitySpec {
  return {
    id: "notes",
    label: "Notes",
    schema: {
      fields: [
        { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
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
    prompt_context: "Stores the user's text notes.",
    ...overrides,
  };
}

function handlerUnit(name: "create" | "read", content: string): GeneratedUnit {
  return {
    kind: "handler",
    name,
    filename: `${name}.ts`,
    content,
    attempts: [],
    durationMs: 0,
    usage: TOKENS,
  };
}

function itemRendererUnit(content: string): GeneratedUnit {
  return {
    kind: "item-renderer",
    name: "item",
    filename: "item.ts",
    content,
    attempts: [],
    durationMs: 0,
    usage: TOKENS,
  };
}

// The three M3 artifacts, with just enough content to assert they were written, in the
// order unit generation produces them (item renderer first, then the handlers).
function notesUnits(): GeneratedUnit[] {
  return [
    itemRendererUnit(
      "export default function renderItem(record: Record<string, unknown>): string { return String(record.text); }",
    ),
    handlerUnit(
      "create",
      "export default async function create() { return '<article></article>'; }",
    ),
    handlerUnit("read", "export default async function read() { return '<ul></ul>'; }"),
  ];
}

function capTableExists(database: Database, tableName: string): boolean {
  return (
    database
      .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName) !== null
  );
}

describe("commitCapability", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omni-crud-commit-"));
    conns = openDatabase(join(dir, "test.db"));
    runMigrations(conns.readwrite);
  });

  afterEach(() => {
    conns.readwrite.close();
    conns.readonly.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("commits version 1: writes the artifacts and inserts the row pointing at them", () => {
    const root = join(dir, "artifacts");
    const result = commitCapability({
      spec: notesSpec(),
      incarnationId: INCARNATION_ID,
      units: notesUnits(),
      database: conns.readwrite,
      artifactsRoot: root,
    });

    // Version 1, with the artifacts pointer the registry row will carry.
    expect(result.version).toBe(FIRST_CAPABILITY_VERSION);
    expect(result.incarnationId).toBe(INCARNATION_ID);
    expect(result.artifactsPath).toBe(`${root}/notes/${INCARNATION_ID}/v1/`);
    expect(result.files).toEqual(["item.ts", "create.ts", "read.ts"]);

    // The three artifacts really landed in the version directory, with their content.
    for (const file of result.files) {
      expect(existsSync(resolve(root, "notes", INCARNATION_ID, "v1", file))).toBe(true);
    }
    expect(readFileSync(resolve(root, "notes", INCARNATION_ID, "v1/create.ts"), "utf8")).toContain(
      "export default async function create",
    );
    expect(readFileSync(resolve(root, "notes", INCARNATION_ID, "v1/item.ts"), "utf8")).toContain(
      "export default function renderItem",
    );

    // The registry row is present at v1 with the pointer — a capability the router
    // can now resolve. Read back through the read-only connection (post-autocommit).
    const row = getCapability("notes", conns.readonly);
    expect(row).not.toBeNull();
    expect(row?.incarnation_id).toBe(INCARNATION_ID);
    expect(row?.version).toBe(1);
    expect(row?.artifacts_path).toBe(result.artifactsPath);
    expect(row?.label).toBe("Notes");
    expect(row?.tools).toEqual(["create", "read"]);
  });

  test("a rollback after commit leaves no row and no table, orphaning the written files for GC", async () => {
    const root = join(dir, "artifacts");

    // Compose commit the way the real pipeline does — inside the migration's open
    // transaction. A downstream throw rolls the whole thing back.
    await expect(
      withWriteTransaction(conns.readwrite, () => {
        applyCapabilityTableDdl(notesSpec(), conns.readwrite); // the migration, in-tx
        commitCapability({
          spec: notesSpec(),
          incarnationId: INCARNATION_ID,
          units: notesUnits(),
          database: conns.readwrite,
          artifactsRoot: root,
        });
        throw new Error("downstream boom after commit");
      }),
    ).rejects.toThrow("downstream boom after commit");

    // Nothing in the registry, and no cap_<id> table survived — a failed build never
    // creates a capability (ARCH §6.2 failure path).
    expect(getCapability("notes", conns.readonly)).toBeNull();
    expect(capTableExists(conns.readwrite, "cap_notes")).toBe(false);

    // The files written before the rollback are left orphaned for GC — never deleted
    // here, never half-registered.
    expect(existsSync(resolve(root, "notes", INCARNATION_ID, "v1/create.ts"))).toBe(true);
    expect(existsSync(resolve(root, "notes", INCARNATION_ID, "v1/item.ts"))).toBe(true);
  });

  test("a duplicate id throws the primary-key violation and adds no second row", () => {
    const root = join(dir, "artifacts");
    // A capability already registered at this id (the resolver's job is to prevent
    // this; reaching commit with a collision is a bug — it must fail loudly).
    insertCapability(
      {
        ...notesSpec(),
        incarnation_id: INCARNATION_ID,
        version: 1,
        artifacts_path: `capabilities/notes/${INCARNATION_ID}/v1/`,
      },
      conns.readwrite,
    );

    expect(() =>
      commitCapability({
        spec: notesSpec(),
        incarnationId: "22222222-2222-4222-8222-222222222222",
        units: notesUnits(),
        database: conns.readwrite,
        artifactsRoot: root,
      }),
    ).toThrow();

    // The pre-existing row is untouched (the failed insert wrote nothing); the files
    // commit wrote before the insert are orphaned.
    const row = getCapability("notes", conns.readonly);
    expect(row?.artifacts_path).toBe(`capabilities/notes/${INCARNATION_ID}/v1/`);
    expect(
      existsSync(resolve(root, "notes", "22222222-2222-4222-8222-222222222222", "v1/create.ts")),
    ).toBe(true);
  });
});
