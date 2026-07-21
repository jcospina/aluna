// Registry commit tests for the Module 4.5 publication boundary. Artifact bytes
// must already be a complete verified final snapshot before a registry pointer can
// consume them.

import type { Database } from "bun:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
import { publishCapabilitySnapshot } from "./artifact-lifecycle.ts";
import { commitCapability, FIRST_CAPABILITY_VERSION } from "./commit.ts";
import { gateInput, generatedUnitsFor } from "./gate.test-support.ts";
import { type CapabilityGateResult, runCapabilityGate } from "./gate.ts";
import type { GeneratedUnit } from "./units.ts";

const INCARNATION_ID = "11111111-1111-4111-8111-111111111111";

function notesSpec(overrides: Partial<CapabilitySpec> = {}): CapabilitySpec {
  return {
    id: "notes",
    label: "Notes",
    schema: {
      fields: [
        { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
        {
          name: "pinned",
          label: "Pinned",
          type: "boolean",
          required: false,
          lifecycle: "active",
        },
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
      {
        action: "update",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["text"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
    ],
    tools: ["create", "read", "update", "delete", "search"],
    read_dependencies: { create: [], read: [], update: [], delete: [], search: [] },
    prompt_context: "Stores the user's text notes.",
    ...overrides,
  };
}

function notesUnits(): GeneratedUnit[] {
  return [...generatedUnitsFor(notesSpec())];
}

let tierOffGate: CapabilityGateResult;

beforeAll(async () => {
  const units = notesUnits();
  const handlers = Object.fromEntries(
    units.filter((unit) => unit.kind === "handler").map((unit) => [unit.name, unit.content]),
  );
  const itemRenderer = units.find((unit) => unit.kind === "item-renderer")?.content;
  if (!itemRenderer) throw new Error("Expected the item renderer fixture.");
  tierOffGate = await runCapabilityGate(
    gateInput({
      spec: notesSpec(),
      handlers,
      itemRenderer,
      behavioralTier: { enabled: false },
    }),
  );
});

function publish(root: string, incarnationId = INCARNATION_ID) {
  return publishCapabilitySnapshot({
    buildId: `build-${incarnationId}`,
    spec: notesSpec(),
    incarnationId,
    version: FIRST_CAPABILITY_VERSION,
    units: notesUnits(),
    gate: tierOffGate,
    artifactsRoot: root,
  });
}

function capTableExists(database: Database, tableName: string): boolean {
  return (
    database
      .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName) !== null
  );
}

describe("commitCapability — verified publication boundary", () => {
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

  test("registers version 1 only after the complete published snapshot verifies", () => {
    const root = join(dir, "artifacts");
    const publication = publish(root);
    const result = commitCapability({
      spec: notesSpec(),
      publication,
      database: conns.readwrite,
    });

    expect(result.version).toBe(FIRST_CAPABILITY_VERSION);
    expect(result.incarnationId).toBe(INCARNATION_ID);
    expect(result.artifactsPath).toBe(`${root}/notes/${INCARNATION_ID}/v1/`);
    expect(result.snapshotVerified).toBe(true);
    expect(result.buildId).toBe(`build-${INCARNATION_ID}`);
    expect(result.files).toEqual([
      "create.ts",
      "delete.ts",
      "item.ts",
      "read.ts",
      "search.ts",
      "snapshot.json",
      "spec.json",
      "update.ts",
    ]);
    for (const file of result.files) {
      expect(existsSync(resolve(root, "notes", INCARNATION_ID, "v1", file))).toBe(true);
    }

    const row = getCapability("notes", conns.readonly);
    expect(row).not.toBeNull();
    expect(row?.incarnation_id).toBe(INCARNATION_ID);
    expect(row?.version).toBe(1);
    expect(row?.artifacts_path).toBe(result.artifactsPath);
    expect(row?.tools).toEqual(["create", "read", "update", "delete", "search"]);
  });

  test("reverification rejects tampered published bytes before registry insertion", () => {
    const publication = publish(join(dir, "artifacts"));
    writeFileSync(join(publication.directory, "create.ts"), "tampered");

    expect(() =>
      commitCapability({ spec: notesSpec(), publication, database: conns.readwrite }),
    ).toThrow(/failed content verification/);
    expect(getCapability("notes", conns.readonly)).toBeNull();
  });

  test("rejects a registry pointer that does not resolve to the verified final directory", () => {
    const publication = publish(join(dir, "artifacts"));
    (publication as { artifactsPath: string }).artifactsPath = join(dir, "wrong");

    expect(() =>
      commitCapability({
        spec: notesSpec(),
        publication,
        database: conns.readwrite,
      }),
    ).toThrow(/evidence changed after issuance/);
    expect(getCapability("notes", conns.readonly)).toBeNull();
  });

  test("rejects a same-id registry spec that differs from authoritative spec.json", () => {
    const publication = publish(join(dir, "artifacts"));

    expect(() =>
      commitCapability({
        spec: notesSpec({ label: "Different Notes" }),
        publication,
        database: conns.readwrite,
      }),
    ).toThrow(/identity does not match/);
    expect(getCapability("notes", conns.readonly)).toBeNull();
  });

  test("a SQLite rollback leaves no row/table but retains a complete published candidate", async () => {
    const root = join(dir, "artifacts");
    const publication = publish(root);

    await expect(
      withWriteTransaction(conns.readwrite, () => {
        applyCapabilityTableDdl(notesSpec(), conns.readwrite);
        commitCapability({ spec: notesSpec(), publication, database: conns.readwrite });
        throw new Error("downstream boom after commit");
      }),
    ).rejects.toThrow("downstream boom after commit");

    expect(getCapability("notes", conns.readonly)).toBeNull();
    expect(capTableExists(conns.readwrite, "cap_notes")).toBe(false);
    expect(existsSync(join(publication.directory, "snapshot.json"))).toBe(true);
    expect(existsSync(join(publication.directory, "spec.json"))).toBe(true);
  });

  test("a duplicate registry id leaves the prior row untouched and the new candidate complete", () => {
    const root = join(dir, "artifacts");
    insertCapability(
      {
        ...notesSpec(),
        incarnation_id: INCARNATION_ID,
        version: 1,
        artifacts_path: `capabilities/notes/${INCARNATION_ID}/v1/`,
      },
      conns.readwrite,
    );
    const secondIncarnation = "22222222-2222-4222-8222-222222222222";
    const publication = publish(root, secondIncarnation);

    expect(() =>
      commitCapability({ spec: notesSpec(), publication, database: conns.readwrite }),
    ).toThrow();

    expect(getCapability("notes", conns.readonly)?.artifacts_path).toBe(
      `capabilities/notes/${INCARNATION_ID}/v1/`,
    );
    expect(existsSync(join(publication.directory, "snapshot.json"))).toBe(true);
  });
});
