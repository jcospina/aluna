// The direct terminal admission row.
//
// Every other row in this store opens `running` and is later closed. A lease-head stale
// refusal is written terminal on its first and only write, because nothing ever ran. For a
// new capability refused before incarnation assignment it also has no incarnation at all,
// and the store's placeholder for that absence must never escape into a caller's hands.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FIRST_INCARNATION_ID } from "../../registry/incarnations.test-support.ts";
import type { PlatformDatabase } from "../persistence/db.ts";
import {
  createScratchDbEnv,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../persistence/scratch-db.test-support.ts";
import {
  generationLifecycleSchema,
  getGenerationLifecycle,
  listGenerationLifecycles,
  reconcileRunningGenerationLifecycles,
  writeStaleGenerationAdmission,
} from "./lifecycle-store.ts";

const NOTES_INCARNATION_ID = FIRST_INCARNATION_ID;
const STALE_STAGES = [
  { stage: "spec_generation", state: "skipped" as const },
  { stage: "activation", state: "skipped" as const },
];

describe("direct stale admission rows", () => {
  let env: ScratchDbEnv;
  let conns: PlatformDatabase;

  beforeEach(() => {
    env = createScratchDbEnv("omni-crud-stale-admission-");
    conns = env.conns;
  });

  afterEach(() => {
    teardownScratchDbEnv(env);
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
