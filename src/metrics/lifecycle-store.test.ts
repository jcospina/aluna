import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase, type PlatformDatabase } from "../db.ts";
import { runMigrations } from "../migrations.ts";
import {
  finalizeGenerationLifecycleFailure,
  finalizeGenerationLifecycleSuccess,
  getGenerationLifecycle,
  reconcileRunningGenerationLifecycles,
  startGenerationLifecycle,
  updateGenerationLifecycleIdentity,
} from "./lifecycle-store.ts";

const NOTES_INCARNATION_ID = "11111111-1111-4111-8111-111111111111";

describe("durable generation lifecycle", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omni-crud-lifecycle-metrics-"));
    conns = openDatabase(join(dir, "test.db"));
    runMigrations(conns.readwrite);
  });

  afterEach(() => {
    conns.readwrite.close();
    conns.readonly.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const start = (buildId = "build-lifecycle") =>
    startGenerationLifecycle(
      {
        buildId,
        incarnationId: NOTES_INCARNATION_ID,
        resolver: {
          intent: { type: "new_capability", confidence: 0.98, targetCapability: null },
          model: "gpt-5",
          durationMs: 12,
          usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
          catalogFingerprint: "sha256:catalog",
        },
      },
      conns.readwrite,
    );

  test("start throws on duplicate admission and stores content-free running state", () => {
    start();
    expect(() => start()).toThrow();
    expect(
      getGenerationLifecycle("build-lifecycle", NOTES_INCARNATION_ID, conns.readonly),
    ).toMatchObject({
      lifecycleStatus: "running",
      outcome: null,
      capabilityId: null,
      stages: [],
      resolver: { durationMs: 12, catalogFingerprint: "sha256:catalog" },
    });
  });

  test("identity can be enriched after spec and success participates in caller rollback", () => {
    start();
    updateGenerationLifecycleIdentity(
      "build-lifecycle",
      NOTES_INCARNATION_ID,
      "notes",
      conns.readwrite,
    );
    expect(() =>
      conns.readwrite.transaction(() => {
        finalizeGenerationLifecycleSuccess(
          {
            buildId: "build-lifecycle",
            incarnationId: NOTES_INCARNATION_ID,
            outcome: "activated",
            stages: [{ stage: "spec", state: "generated" }],
            measurement: { model: "gpt-5", timings: { totalMs: 30 } },
          },
          conns.readwrite,
        );
        throw new Error("pointer CAS failed");
      })(),
    ).toThrow("pointer CAS failed");
    expect(
      getGenerationLifecycle("build-lifecycle", NOTES_INCARNATION_ID, conns.readonly),
    ).toMatchObject({ lifecycleStatus: "running", outcome: null, capabilityId: "notes" });

    finalizeGenerationLifecycleSuccess(
      {
        buildId: "build-lifecycle",
        incarnationId: NOTES_INCARNATION_ID,
        outcome: "activated",
        stages: [
          { stage: "handler", state: "generated", unit: { kind: "handler", name: "create" } },
          { stage: "behavioral", state: "executed", test: { kind: "suite", name: "crud" } },
        ],
        measurement: { model: "gpt-5", usage: { totalTokens: 12 } },
      },
      conns.readwrite,
    );
    expect(
      getGenerationLifecycle("build-lifecycle", NOTES_INCARNATION_ID, conns.readonly),
    ).toMatchObject({ lifecycleStatus: "success", outcome: "activated" });
  });

  test("failure finalizes independently and boot reconciliation interrupts abandoned work", () => {
    start("build-failed");
    finalizeGenerationLifecycleFailure(
      {
        buildId: "build-failed",
        incarnationId: NOTES_INCARNATION_ID,
        outcome: "gate_failed",
        stages: [{ stage: "behavioral", state: "executed" }],
        measurement: {
          model: "gpt-5",
          failure: { stage: "gate", rung: "behavioral", message: "assertion failed" },
        },
      },
      conns.readwrite,
    );
    expect(
      getGenerationLifecycle("build-failed", NOTES_INCARNATION_ID, conns.readonly),
    ).toMatchObject({ lifecycleStatus: "failed", outcome: "gate_failed" });

    start("build-abandoned");
    expect(reconcileRunningGenerationLifecycles(conns.readwrite)).toBe(1);
    expect(
      getGenerationLifecycle("build-abandoned", NOTES_INCARNATION_ID, conns.readonly),
    ).toMatchObject({ lifecycleStatus: "interrupted", outcome: "interrupted" });
  });
});
