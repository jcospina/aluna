import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type PlatformDatabase } from "../persistence/db.ts";
import { runMigrations } from "../persistence/migrations.ts";
import {
  getIntentResolutionMetrics,
  intentResolutionMetrics,
  intentResolutionMetricsSchema,
  listIntentResolutionMetrics,
  writeIntentResolutionMetrics,
} from "./intent-resolution-store.ts";

describe("best-effort intent resolution metrics", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omni-crud-resolution-metrics-"));
    conns = openDatabase(join(dir, "test.db"));
    runMigrations(conns.readwrite);
  });

  afterEach(() => {
    conns.readwrite.close();
    conns.readonly.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("stores content-free resolver classification, timing, usage, and catalog binding", () => {
    const metrics = intentResolutionMetrics({
      promptJobId: "prompt-reject",
      resolver: {
        intent: { type: "reject", confidence: 0.72, targetCapability: null },
        model: "gpt-5",
        durationMs: 18,
        usage: { inputTokens: 11, outputTokens: 3, totalTokens: 14 },
        catalogFingerprint: `sha256:${"a".repeat(64)}`,
      },
    });

    writeIntentResolutionMetrics(metrics, conns.readwrite);

    expect(getIntentResolutionMetrics("prompt-reject", conns.readonly)).toMatchObject(metrics);
    expect(listIntentResolutionMetrics(conns.readonly)).toHaveLength(1);
    const columns = conns.readonly
      .query("SELECT name FROM pragma_table_info('intent_resolution_metrics') ORDER BY cid")
      .all() as { name: string }[];
    expect(columns.map(({ name }) => name)).toEqual([
      "prompt_job_id",
      "outcome",
      "resolver_measurement",
      "created_at",
    ]);
  });

  test("is keyed by prompt job and rejects prompt/user content fields", () => {
    const metrics = intentResolutionMetrics({
      promptJobId: "prompt-once",
      resolver: {
        intent: { type: "data_query", confidence: 0.9, targetCapability: "notes" },
        model: "gpt-5",
        durationMs: 5,
        usage: { totalTokens: 8 },
        catalogFingerprint: `sha256:${"b".repeat(64)}`,
      },
    });
    writeIntentResolutionMetrics(metrics, conns.readwrite);

    expect(() => writeIntentResolutionMetrics(metrics, conns.readwrite)).toThrow();
    expect(() =>
      intentResolutionMetricsSchema.parse({
        ...metrics,
        prompt: "show me private notes",
      }),
    ).toThrow();
  });
});
