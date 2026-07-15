// Tests for the generation-metrics store (Epic 2.7). Each case runs against a
// throwaway db (openDatabase + runMigrations) so the real data file is never
// touched. The headline guarantees: a complete build row round-trips deep-equal
// through the read-only connection; the writer is callable with partial knowledge
// (a deflection writes intent + tokens with no build timings; a failed build writes
// everything up to the failing rung, recording which rung failed); absent token
// counts are stored as NULL, not a fabricated zero; an invalid row writes nothing;
// and the table stays exactly the columns ARCH §6.3 / PLAN step 8 call for.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase, type PlatformDatabase } from "../db.ts";
import { runMigrations } from "../migrations.ts";
import {
  GENERATION_METRICS_TABLE,
  type GenerationMetrics,
  getGenerationMetrics,
  listGenerationMetrics,
  sumTokenUsage,
  writeGenerationMetrics,
} from "./store.ts";

const NOTES_INCARNATION_ID = "11111111-1111-4111-8111-111111111111";

// A complete, valid success row — one full build of the notes capability. Fresh
// per call so tests can tweak copies without sharing state.
function buildMetrics(overrides: Partial<GenerationMetrics> = {}): GenerationMetrics {
  return {
    id: "build-notes-1",
    outcome: "success",
    model: "gpt-5",
    intent: { type: "new_capability", confidence: 1, targetCapability: null },
    usage: { inputTokens: 1200, outputTokens: 800, totalTokens: 2000 },
    capabilityId: "notes",
    incarnationId: NOTES_INCARNATION_ID,
    timings: {
      specGenMs: 1500.5,
      migrationMs: 3.2,
      codeGenMs: 2200,
      presentationGenMs: 900,
      testGenMs: 1100,
      testRunMs: 40.7,
      totalMs: 5800,
    },
    gateRungs: [
      { rung: "structural", status: "passed", durationMs: 12 },
      { rung: "smoke", status: "passed", durationMs: 8 },
      { rung: "behavioral", status: "passed", durationMs: 1150 },
    ],
    unitAttempts: [
      {
        kind: "handler",
        name: "create",
        attempts: 2,
        durationMs: 1200,
        usage: { inputTokens: 300, outputTokens: 200, totalTokens: 500 },
      },
      {
        kind: "handler",
        name: "read",
        attempts: 1,
        durationMs: 1000,
        usage: { inputTokens: 250, outputTokens: 150, totalTokens: 400 },
      },
    ],
    ...overrides,
  };
}

function openMetricsDatabase(): { dir: string; conns: PlatformDatabase } {
  const dir = mkdtempSync(join(tmpdir(), "omni-crud-metrics-"));
  const conns = openDatabase(join(dir, "test.db"));
  runMigrations(conns.readwrite);
  return { dir, conns };
}

function closeMetricsDatabase(dir: string, conns: PlatformDatabase): void {
  conns.readwrite.close();
  conns.readonly.close();
  rmSync(dir, { recursive: true, force: true });
}

describe("generation-metrics store — round-trips and partial writes", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = openMetricsDatabase());
  });

  afterEach(() => {
    closeMetricsDatabase(dir, conns);
  });

  test("a complete build row round-trips deep-equal through the read-only connection", () => {
    const metrics = buildMetrics();
    writeGenerationMetrics(metrics, conns.readwrite);

    // Read back through the *read-only* connection — the M8 query surface — proving
    // the write landed in the shared file (ARCH §7).
    const fetched = getGenerationMetrics("build-notes-1", conns.readonly);
    expect(fetched).toEqual({ ...metrics, createdAt: fetched?.createdAt ?? "" });
    expect(fetched?.createdAt).toBeTruthy();
  });

  test("a deflection writes intent + tokens with no build timings (partial knowledge)", () => {
    // PLAN decision 6: an extend/ui/query/reject prompt is classified, logged, and
    // built nothing. The writer is called with only the always-known fields.
    writeGenerationMetrics(
      {
        id: "build-deflect",
        outcome: "deflected",
        model: "gpt-5",
        intent: { type: "extend_capability", confidence: 0.92, targetCapability: "notes" },
        usage: { inputTokens: 400, outputTokens: 30, totalTokens: 430 },
      },
      conns.readwrite,
    );

    const fetched = getGenerationMetrics("build-deflect", conns.readonly);
    expect(fetched).toEqual({
      id: "build-deflect",
      outcome: "deflected",
      model: "gpt-5",
      intent: { type: "extend_capability", confidence: 0.92, targetCapability: "notes" },
      usage: { inputTokens: 400, outputTokens: 30, totalTokens: 430 },
      createdAt: fetched?.createdAt ?? "",
    });
    // No build happened: every build-only group is absent, not an empty husk.
    expect(fetched?.timings).toBeUndefined();
    expect(fetched?.gateRungs).toBeUndefined();
    expect(fetched?.unitAttempts).toBeUndefined();
    expect(fetched?.failure).toBeUndefined();
  });

  test("a gate failure records which rung failed", () => {
    writeGenerationMetrics(
      {
        id: "build-fail-gate",
        outcome: "failure",
        model: "gpt-5",
        intent: { type: "new_capability", confidence: 1, targetCapability: null },
        capabilityId: "expenses",
        incarnationId: "22222222-2222-4222-8222-222222222222",
        usage: { inputTokens: 900, outputTokens: 500, totalTokens: 1400 },
        timings: {
          specGenMs: 1400,
          migrationMs: 3,
          codeGenMs: 1800,
          presentationGenMs: 700,
          testGenMs: 1000,
          testRunMs: 30,
        },
        gateRungs: [
          { rung: "structural", status: "passed", durationMs: 10 },
          { rung: "smoke", status: "failed", durationMs: 6, error: "create handler threw" },
        ],
        failure: { stage: "gate", rung: "smoke", message: "create handler threw" },
      },
      conns.readwrite,
    );

    const fetched = getGenerationMetrics("build-fail-gate", conns.readonly);
    expect(fetched?.outcome).toBe("failure");
    expect(fetched?.failure).toEqual({
      stage: "gate",
      rung: "smoke",
      message: "create handler threw",
    });
    // The per-rung detail survives so M8 can see exactly where it stopped.
    expect(fetched?.gateRungs).toEqual([
      { rung: "structural", status: "passed", durationMs: 10 },
      { rung: "smoke", status: "failed", durationMs: 6, error: "create handler threw" },
    ]);
  });
});

describe("generation-metrics store — failed builds and token accounting", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = openMetricsDatabase());
  });

  afterEach(() => {
    closeMetricsDatabase(dir, conns);
  });

  test("a build that fails before the gate writes everything up to the failing stage", () => {
    // Unit generation exhausted the bounded fix loop: spec + migration + code-gen are
    // recorded, but the build never reached presentation-gen, the behavioral tier, or the gate.
    writeGenerationMetrics(
      {
        id: "build-units-fail",
        outcome: "failure",
        model: "gpt-5",
        intent: { type: "new_capability", confidence: 1, targetCapability: null },
        capabilityId: "todos",
        incarnationId: "33333333-3333-4333-8333-333333333333",
        usage: { inputTokens: 700, outputTokens: 400, totalTokens: 1100 },
        timings: { specGenMs: 1300, migrationMs: 2, codeGenMs: 1900 },
        unitAttempts: [
          {
            kind: "handler",
            name: "create",
            attempts: 2,
            durationMs: 1900,
            usage: { inputTokens: 400, outputTokens: 250, totalTokens: 650 },
          },
        ],
        failure: { stage: "unit_generation", message: "create did not pass after 2 attempt(s)." },
      },
      conns.readwrite,
    );

    const fetched = getGenerationMetrics("build-units-fail", conns.readonly);
    expect(fetched?.timings).toEqual({ specGenMs: 1300, migrationMs: 2, codeGenMs: 1900 });
    // No gate rung was reached, so the failure carries a stage but no rung.
    expect(fetched?.failure).toEqual({
      stage: "unit_generation",
      message: "create did not pass after 2 attempt(s).",
    });
    expect(fetched?.gateRungs).toBeUndefined();
  });

  test("an absent token count is stored as NULL, never a fabricated zero", () => {
    // A spec-gen failure before any usage resolved: the writer is given no usage.
    writeGenerationMetrics(
      {
        id: "build-no-tokens",
        outcome: "failure",
        model: "gpt-5",
        intent: { type: "new_capability", confidence: 1, targetCapability: null },
        failure: { stage: "spec_gen", message: "model output did not conform to the spec schema" },
      },
      conns.readwrite,
    );

    const raw = conns.readonly
      .query(
        `SELECT input_tokens, output_tokens, total_tokens FROM ${GENERATION_METRICS_TABLE} WHERE id = ?`,
      )
      .get("build-no-tokens") as {
      input_tokens: number | null;
      output_tokens: number | null;
      total_tokens: number | null;
    };
    expect(raw.input_tokens).toBeNull();
    expect(raw.output_tokens).toBeNull();
    expect(raw.total_tokens).toBeNull();

    // And it reads back as absent usage, not zeros.
    expect(getGenerationMetrics("build-no-tokens", conns.readonly)?.usage).toBeUndefined();
  });

  test("partially-reported token counts keep the unreported figure NULL", () => {
    writeGenerationMetrics(
      buildMetrics({
        id: "build-partial-tokens",
        usage: { inputTokens: 500, outputTokens: undefined, totalTokens: undefined },
      }),
      conns.readwrite,
    );

    expect(getGenerationMetrics("build-partial-tokens", conns.readonly)?.usage).toEqual({
      inputTokens: 500,
      outputTokens: undefined,
      totalTokens: undefined,
    });
  });
});

describe("generation-metrics store — reads, listing, and invariants", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = openMetricsDatabase());
  });

  afterEach(() => {
    closeMetricsDatabase(dir, conns);
  });

  test("get-by-id returns null for an unknown generation", () => {
    expect(getGenerationMetrics("nope", conns.readonly)).toBeNull();
  });

  test("list returns every row written, through the read-only connection", () => {
    writeGenerationMetrics(buildMetrics({ id: "build-a" }), conns.readwrite);
    writeGenerationMetrics(
      buildMetrics({
        id: "build-b",
        capabilityId: "recipes",
        incarnationId: "22222222-2222-4222-8222-222222222222",
      }),
      conns.readwrite,
    );

    // Ordered created_at DESC then id; same-second inserts can land either order, so
    // assert membership rather than a flakey timestamp ordering.
    const ids = listGenerationMetrics(conns.readonly)
      .map((row) => row.id)
      .sort();
    expect(ids).toEqual(["build-a", "build-b"]);
  });

  test("list on an empty store is an empty list", () => {
    expect(listGenerationMetrics(conns.readonly)).toEqual([]);
  });

  test("an invalid row is rejected loudly and writes nothing", () => {
    expect(() =>
      writeGenerationMetrics(
        buildMetrics({
          intent: { type: "new_capability", confidence: 1.5, targetCapability: null },
        }),
        conns.readwrite,
      ),
    ).toThrow();
    expect(listGenerationMetrics(conns.readonly)).toEqual([]);
  });

  test("a capability metrics row requires the build id and incarnation identity together", () => {
    expect(() =>
      writeGenerationMetrics(buildMetrics({ incarnationId: null }), conns.readwrite),
    ).toThrow();
    expect(() =>
      writeGenerationMetrics(
        buildMetrics({ id: "build-missing-capability", capabilityId: null }),
        conns.readwrite,
      ),
    ).toThrow();
    expect(listGenerationMetrics(conns.readonly)).toEqual([]);
  });

  test("a duplicate generation id throws — one row per generation is the invariant", () => {
    writeGenerationMetrics(buildMetrics(), conns.readwrite);
    expect(() => writeGenerationMetrics(buildMetrics(), conns.readwrite)).toThrow();
  });

  test("the metrics row covers exactly the PLAN step-8 columns", () => {
    const columns = conns.readonly
      .query(`SELECT name FROM pragma_table_info('${GENERATION_METRICS_TABLE}') ORDER BY cid`)
      .all() as { name: string }[];

    expect(columns.map((column) => column.name)).toEqual([
      "id",
      "created_at",
      "outcome",
      "capability_id",
      "intent_type",
      "intent_confidence",
      "intent_target_capability",
      "model",
      "input_tokens",
      "output_tokens",
      "total_tokens",
      "spec_gen_ms",
      "migration_ms",
      "code_gen_ms",
      "html_gen_ms",
      "test_gen_ms",
      "test_run_ms",
      "total_ms",
      "gate_rungs",
      "unit_attempts",
      "failed_stage",
      "failed_rung",
      "failed_message",
      "presentation_gen_ms",
      "incarnation_id",
    ]);
  });
});

describe("sumTokenUsage", () => {
  test("sums reported counts across provider calls", () => {
    expect(
      sumTokenUsage([
        { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        { inputTokens: 20, outputTokens: 7, totalTokens: 27 },
      ]),
    ).toEqual({ inputTokens: 30, outputTokens: 12, totalTokens: 42 });
  });

  test("keeps a figure undefined unless at least one call reported it", () => {
    expect(
      sumTokenUsage([
        { inputTokens: 10, outputTokens: undefined, totalTokens: undefined },
        { inputTokens: undefined, outputTokens: undefined, totalTokens: 5 },
      ]),
    ).toEqual({ inputTokens: 10, outputTokens: undefined, totalTokens: 5 });
  });

  test("all-absent usages sum to all-undefined, not zero", () => {
    expect(
      sumTokenUsage([{ inputTokens: undefined, outputTokens: undefined, totalTokens: undefined }]),
    ).toEqual({ inputTokens: undefined, outputTokens: undefined, totalTokens: undefined });
  });
});
