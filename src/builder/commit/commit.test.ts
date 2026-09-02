// Registry commit tests for the Module 4.5 publication boundary. Artifact bytes
// must already be a complete verified final snapshot before a registry pointer can
// consume them.

import type { Database } from "bun:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { applyCapabilityTableDdl } from "../../capability-data/index.ts";
import {
  openDatabase,
  type PlatformDatabase,
  withWriteTransaction,
} from "../../platform/persistence/db.ts";
import { runMigrations } from "../../platform/persistence/migrations.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  getCapability,
  insertCapability,
  logoSeedSchema,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../../registry/index.ts";
import { publishCapabilitySnapshot } from "../artifacts/artifact-lifecycle.ts";
import { gateInput, generatedUnitsFor } from "../gate/gate.test-support.ts";
import { type CapabilityGateResult, runCapabilityGate } from "../gate/gate.ts";
import type { GeneratedUnit } from "../units/units.ts";
import { commitCapability, FIRST_CAPABILITY_VERSION } from "./commit.ts";

const INCARNATION_ID = "11111111-1111-4111-8111-111111111111";

function notesSpec(overrides: Partial<CapabilitySpec> = {}): CapabilitySpec {
  return {
    id: "notes",
    label: "Notes",
    subject: "an open notebook",
    ground: "grass_green",
    companion: "coral_orange",
    noun: "note",
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
      form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
      item: { direction: "A text-forward card that emphasizes the note text.", shows: ["text"] },
      collection: { layout: "feed" },
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
        seed: 184206,
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

describe("commitCapability — the logo's inputs at birth", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omni-crud-commit-logo-"));
    conns = openDatabase(join(dir, "test.db"));
    runMigrations(conns.readwrite);
    applyCapabilityTableDdl(notesSpec(), conns.readwrite);
  });

  afterEach(() => {
    conns.readwrite.close();
    conns.readonly.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("v1 is born with a minted seed and a logo nobody has ordered yet", () => {
    const root = join(dir, "artifacts");
    const result = commitCapability({
      spec: notesSpec(),
      publication: publish(root),
      database: conns.readwrite,
    });

    // The seed is the record of what drew the artwork. It is stored rather than
    // derived from the capability's name or its place on the desk, either of which
    // can move without the drawing changing.
    expect(logoSeedSchema.safeParse(result.row.seed).success).toBe(true);
    expect(result.row.subject).toBe("an open notebook");
    expect(result.row.ground).toBe("grass_green");
    expect(result.row.noun).toBe("note");
    // Nothing has been ordered at commit: the request is the last step, after the
    // gate, and a build that never reaches it costs nothing (ADR-0007 L10).
    expect(result.row.logo).toEqual({ status: "absent", attempts: 0 });
    expect(getCapability("notes", conns.readonly)?.seed).toBe(result.row.seed);
  });

  test("two incarnations of the same id draw independent seeds", () => {
    // Delete-and-recreate is the only route to a different logo, so the recreated
    // capability must not inherit the seed that drew the old one.
    const first = commitCapability({
      spec: notesSpec(),
      publication: publish(join(dir, "artifacts-a")),
      database: conns.readwrite,
    });
    conns.readwrite.run("DELETE FROM capability_registry WHERE id = 'notes'");
    const second = commitCapability({
      spec: notesSpec(),
      publication: publish(join(dir, "artifacts-b")),
      database: conns.readwrite,
    });

    expect(second.row.seed).not.toBe(first.row.seed);
  });
});
