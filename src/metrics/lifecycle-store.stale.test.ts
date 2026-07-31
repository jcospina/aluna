// The direct terminal admission row — Module 4.8/03 (PLAN decision 28).
//
// Every other row in this store opens `running` and is later closed. A lease-head stale
// refusal is written terminal on its first and only write, because nothing ever ran. For a
// new capability refused before incarnation assignment it also has no incarnation at all,
// and the store's placeholder for that absence must never escape into a caller's hands.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase, type PlatformDatabase } from "../persistence/db.ts";
import { runMigrations } from "../persistence/migrations.ts";
import {
  generationLifecycleSchema,
  getGenerationLifecycle,
  listGenerationLifecycles,
  reconcileRunningGenerationLifecycles,
  writeStaleGenerationAdmission,
} from "./lifecycle-store.ts";

const NOTES_INCARNATION_ID = "11111111-1111-4111-8111-111111111111";
const STALE_STAGES = [
  { stage: "spec_generation", state: "skipped" as const },
  { stage: "activation", state: "skipped" as const },
];

describe("direct stale admission rows", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omni-crud-stale-admission-"));
    conns = openDatabase(join(dir, "test.db"));
    runMigrations(conns.readwrite);
  });

  afterEach(() => {
    conns.readwrite.close();
    conns.readonly.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("an evolution refusal is filed under its expected incarnation", () => {
    writeStaleGenerationAdmission(
      {
        buildId: "build-stale-evolution",
        incarnationId: NOTES_INCARNATION_ID,
        capabilityId: "notes",
        stages: STALE_STAGES,
      },
      conns.readwrite,
    );

    expect(
      getGenerationLifecycle("build-stale-evolution", NOTES_INCARNATION_ID, conns.readonly),
    ).toMatchObject({
      lifecycleStatus: "failed",
      outcome: "stale",
      incarnationId: NOTES_INCARNATION_ID,
      capabilityId: "notes",
    });
  });

  test("a new-capability refusal round-trips an absent incarnation as null", () => {
    writeStaleGenerationAdmission(
      { buildId: "build-stale-new", incarnationId: null, stages: STALE_STAGES },
      conns.readwrite,
    );

    // The physical placeholder never escapes the store: a caller addresses the row with
    // null and reads null back, through both the keyed read and the list.
    expect(getGenerationLifecycle("build-stale-new", null, conns.readonly)).toMatchObject({
      lifecycleStatus: "failed",
      outcome: "stale",
      incarnationId: null,
      capabilityId: null,
    });
    expect(listGenerationLifecycles(conns.readonly)).toMatchObject([
      { buildId: "build-stale-new", incarnationId: null },
    ]);
  });

  test("boot reconciliation leaves a refused admission alone", () => {
    writeStaleGenerationAdmission(
      { buildId: "build-stale-boot", incarnationId: null, stages: STALE_STAGES },
      conns.readwrite,
    );

    // It was never `running`, so startup recovery has nothing of its to interrupt.
    expect(reconcileRunningGenerationLifecycles(conns.readwrite)).toBe(0);
    expect(getGenerationLifecycle("build-stale-boot", null, conns.readonly)?.outcome).toBe("stale");
  });

  test("only a stale refusal may omit its incarnation", () => {
    expect(() =>
      generationLifecycleSchema.parse({
        buildId: "build-invalid",
        incarnationId: null,
        capabilityId: null,
        lifecycleStatus: "failed",
        outcome: "gate_failed",
        resolver: null,
        measurement: null,
        stages: [],
      }),
    ).toThrow(/omit its incarnation/);
  });
});
