// The generation-metrics access module — Module 2, Epic 2.7 (ARCH §6.3
// "Generation Metrics", §6.2, PLAN flow step 8).
//
// One row per generation, recording what the *system* did to build itself —
// distinct from the event log (M7's record of what the *user* did). This is the
// store the PoC exists to fill (ARCH §6.3): latency and capability conclusions
// come from querying it, not guessing. Every build, every failed build, and every
// deflection writes exactly one row here.
//
// The writer is callable with **partial knowledge** (PLAN flow step 8, decision
// 6): a deflection writes intent + model/tokens with no build timings; a failed
// build writes everything up to the failing rung. The optional groups
// (`timings`, `gateRungs`, `unitAttempts`, `failure`) map to nullable columns, so
// "didn't get that far" is stored as honest absence (NULL), never a fabricated
// zero.
//
// Access follows the platform's data access model (ARCH §3, §7): the insert rides
// `db`, the single constrained write path; reads default to `dbReadonly`, the read
// path on which a write is physically impossible — M8's future query surface. Both
// sides of the round-trip validate against the Zod row shape (the registry's
// discipline): a malformed metrics row can neither enter nor come back out unnoticed.

import type { Database } from "bun:sqlite";
import { z } from "zod";

import type { GateRungName, GateRungOutcome, GateRungStatus } from "../builder/index.ts";
import { db, dbReadonly } from "../db.ts";
import { intentTypeSchema } from "../intent-resolver/index.ts";
import type { TokenUsage } from "../provider/index.ts";

// The metrics table, created by platform migration 0004 (src/migrations.ts). A
// fixed platform constant (never user input), so interpolating it into the SQL
// below is safe — same convention as the registry and the migrations ledger.
export const GENERATION_METRICS_TABLE = "generation_metrics";

// The terminal outcome of a generation. `success` committed a capability;
// `failure` attempted a build and stopped at a stage/rung (failure is data, ARCH
// §6.2); `deflected` classified the prompt as something M2 does not act on (PLAN
// decision 6) and built nothing.
export const GENERATION_OUTCOMES = ["success", "failure", "deflected"] as const;
export const generationOutcomeSchema = z.enum(GENERATION_OUTCOMES);
export type GenerationOutcome = z.infer<typeof generationOutcomeSchema>;

// The pipeline stage a failure stopped at. Gate failures additionally name the
// rung (`failure.rung`); the non-gate stages fail before any rung runs.
export const FAILURE_STAGES = [
  "spec_gen",
  "migration",
  "unit_generation",
  "gate",
  "commit",
] as const;
export const failureStageSchema = z.enum(FAILURE_STAGES);
export type FailureStage = z.infer<typeof failureStageSchema>;

// Rung name/status enums kept faithful to the gate's own vocabulary. The
// `satisfies` guards turn a future rename in the gate into a compile error here,
// so the metrics schema can never silently drift from what it records. A new rung
// (like M3's `design-lint`) must be added here too, or its outcome fails validation
// on write; `assertAllRungNames` below makes that a compile error, not a runtime one.
const GATE_RUNG_NAMES = [
  "structural",
  "smoke",
  "behavioral",
  "design-lint",
] as const satisfies readonly GateRungName[];

// Exhaustiveness guard: every GateRungName must appear in GATE_RUNG_NAMES above, so adding
// a rung to the gate without recording it here is a compile error rather than a metrics
// write that throws at runtime.
type ListedRungName = (typeof GATE_RUNG_NAMES)[number];
const assertAllRungNames: (name: GateRungName) => ListedRungName = (name) => name;
void assertAllRungNames;
const GATE_RUNG_STATUSES = [
  "passed",
  "failed",
  "skipped",
] as const satisfies readonly GateRungStatus[];
const gateRungNameSchema = z.enum(GATE_RUNG_NAMES);
const gateRungStatusSchema = z.enum(GATE_RUNG_STATUSES);

// One rung's verdict, mirroring the gate's GateRungOutcome. Stored inside the
// `gate_rungs` JSON column: the per-rung structural/smoke/behavioral durations and
// any failure detail live here, while the headline test-gen/test-run timings get
// their own columns (PLAN step 8) for M8 to query directly.
const gateRungOutcomeSchema = z.strictObject({
  rung: gateRungNameSchema,
  status: gateRungStatusSchema,
  durationMs: z.number().nonnegative(),
  error: z.string().optional(),
  reason: z.string().optional(),
});

// Token counts for the generation. Each is `number | undefined` at the contract
// (TokenUsage): not every provider reports every figure, so the writer stores a
// missing count as SQL NULL rather than fabricating a zero (provider/contract.ts).
const tokenUsageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
});

// The intent classification behind this generation (PLAN decision 6). Present on
// every row — a deflection's whole point is to log its classification. Carries the
// overlap target so extend/ui deflections record which capability they touched.
const generationIntentSchema = z.strictObject({
  type: intentTypeSchema,
  confidence: z.number().min(0).max(1),
  targetCapability: z.string().min(1).nullable(),
});
export type GenerationIntent = z.infer<typeof generationIntentSchema>;

// The PLAN step-8 timing breakdown. Every leg is optional: a deflection omits the
// group entirely, a failed build fills only the legs it reached. `codeGenMs` is the
// handler (.ts) generation; `htmlGenMs` is the presentation-gen leg — M2's view (.html)
// generation, since M3 the item-renderer generation (the `html_gen_ms` column is kept as
// the presentation-gen slot so M8 compares the semantic stage across artifact contracts,
// ADR-0005). `testGenMs` and `testRunMs` are the behavioral tier's generation and
// execution — the two columns that let M8 weigh the behavioral tier against the no-test
// baseline.
const generationTimingsSchema = z.strictObject({
  specGenMs: z.number().nonnegative().optional(),
  migrationMs: z.number().nonnegative().optional(),
  codeGenMs: z.number().nonnegative().optional(),
  htmlGenMs: z.number().nonnegative().optional(),
  testGenMs: z.number().nonnegative().optional(),
  testRunMs: z.number().nonnegative().optional(),
  totalMs: z.number().nonnegative().optional(),
});
export type GenerationTimings = z.infer<typeof generationTimingsSchema>;

// One unit's fix-loop summary (PLAN decision 5: "every attempt recorded in
// metrics"). `attempts` is the total tries that unit took — anything above one
// means the bounded type-check fix loop kicked in. Stored as the `unit_attempts`
// JSON column.
const unitAttemptSummarySchema = z.strictObject({
  kind: z.enum(["handler", "item-renderer"]),
  name: z.string().min(1),
  attempts: z.number().int().positive(),
  durationMs: z.number().nonnegative(),
  usage: tokenUsageSchema,
});
export type UnitAttemptSummary = z.infer<typeof unitAttemptSummarySchema>;

// Which stage (and, for the gate, which rung) a failed build stopped at — the
// "failure is data" record (ARCH §6.2). `message` is the developer-facing reason;
// it never reaches a user.
const generationFailureSchema = z.strictObject({
  stage: failureStageSchema,
  rung: gateRungNameSchema.optional(),
  message: z.string().optional(),
});
export type GenerationFailure = z.infer<typeof generationFailureSchema>;

// The metrics row as a caller assembles it — the writer's input. Everything past
// the always-known identity/intent/model block is optional so the writer is
// callable with partial knowledge (deflection, failed build).
export const generationMetricsSchema = z.strictObject({
  // A stable generation id. The build job's id in the real pipeline; any unique
  // string in tests. One row per generation, so this is the primary key.
  id: z.string().min(1),
  outcome: generationOutcomeSchema,
  // The single globally configured model the generation ran against (provider
  // config, ARCH §4). Always known — it is config, available even on early failure.
  model: z.string().min(1),
  intent: generationIntentSchema,
  // The capability this generation built or targeted, when known. Null on a
  // deflection or a build that failed before a spec named one.
  capabilityId: z.string().min(1).nullish(),
  usage: tokenUsageSchema.optional(),
  timings: generationTimingsSchema.optional(),
  gateRungs: z.array(gateRungOutcomeSchema).readonly().optional(),
  unitAttempts: z.array(unitAttemptSummarySchema).readonly().optional(),
  failure: generationFailureSchema.optional(),
});
export type GenerationMetrics = z.infer<typeof generationMetricsSchema>;

// What a stored row reads back as: the written shape plus the platform-stamped
// `createdAt` (the uniform timestamp, ARCH §6.3). Validated on the way out so a
// hand-edited or drifted row fails loudly at the read site, not three queries later.
export const storedGenerationMetricsSchema = generationMetricsSchema.extend({
  createdAt: z.string().min(1),
});
export type StoredGenerationMetrics = z.infer<typeof storedGenerationMetricsSchema>;

// The flat row as SQLite stores it: scalars per column, the structured groups
// (gate rungs, unit attempts) serialized to JSON text. Mirrors the StoredRow shape
// the registry store uses.
interface StoredRow {
  id: string;
  created_at: string;
  outcome: string;
  capability_id: string | null;
  intent_type: string;
  intent_confidence: number;
  intent_target_capability: string | null;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  spec_gen_ms: number | null;
  migration_ms: number | null;
  code_gen_ms: number | null;
  html_gen_ms: number | null;
  test_gen_ms: number | null;
  test_run_ms: number | null;
  total_ms: number | null;
  gate_rungs: string | null;
  unit_attempts: string | null;
  failed_stage: string | null;
  failed_rung: string | null;
  failed_message: string | null;
}

const ROW_COLUMNS = [
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
].join(", ");

// Columns the writer sets explicitly. `created_at` is omitted on insert so the
// column default (datetime('now')) stamps it — the same pattern as the migrations
// ledger's `applied_at`.
const INSERT_COLUMNS = ROW_COLUMNS.replace("created_at, ", "");
const INSERT_PLACEHOLDERS = INSERT_COLUMNS.split(", ")
  .map(() => "?")
  .join(", ");

function nullish<T>(value: T | undefined): T | null {
  return value ?? null;
}

// Write one generation-metrics row through the read-write connection. The input is
// validated first — an invalid record throws (ZodError) and writes nothing, the
// loud failure the build's metrics step leans on. A duplicate id throws the
// primary-key violation: one row per generation is the invariant, so reaching that
// is a bug.
export function writeGenerationMetrics(
  metrics: GenerationMetrics,
  database: Database = db,
): GenerationMetrics {
  const valid = generationMetricsSchema.parse(metrics);
  const usage = valid.usage;
  const timings = valid.timings;

  database.run(
    `INSERT INTO ${GENERATION_METRICS_TABLE} (${INSERT_COLUMNS}) VALUES (${INSERT_PLACEHOLDERS})`,
    [
      valid.id,
      valid.outcome,
      nullish(valid.capabilityId),
      valid.intent.type,
      valid.intent.confidence,
      valid.intent.targetCapability,
      valid.model,
      nullish(usage?.inputTokens),
      nullish(usage?.outputTokens),
      nullish(usage?.totalTokens),
      nullish(timings?.specGenMs),
      nullish(timings?.migrationMs),
      nullish(timings?.codeGenMs),
      nullish(timings?.htmlGenMs),
      nullish(timings?.testGenMs),
      nullish(timings?.testRunMs),
      nullish(timings?.totalMs),
      valid.gateRungs ? JSON.stringify(valid.gateRungs) : null,
      valid.unitAttempts ? JSON.stringify(valid.unitAttempts) : null,
      nullish(valid.failure?.stage),
      nullish(valid.failure?.rung),
      nullish(valid.failure?.message),
    ],
  );

  return valid;
}

// Fetch one metrics row by generation id, or null when it doesn't exist. Reads
// ride the read-only connection by convention (ARCH §7) — the M8 query surface.
export function getGenerationMetrics(
  id: string,
  database: Database = dbReadonly,
): StoredGenerationMetrics | null {
  const stored = database
    .query(`SELECT ${ROW_COLUMNS} FROM ${GENERATION_METRICS_TABLE} WHERE id = ?`)
    .get(id) as StoredRow | null;

  return stored ? parseStoredRow(stored) : null;
}

// List every metrics row, newest first then by id — the experiment's dataset
// (ARCH §6.3). Ordered deterministically so M8's queries see a stable order.
export function listGenerationMetrics(database: Database = dbReadonly): StoredGenerationMetrics[] {
  const rows = database
    .query(`SELECT ${ROW_COLUMNS} FROM ${GENERATION_METRICS_TABLE} ORDER BY created_at DESC, id`)
    .all() as StoredRow[];

  return rows.map(parseStoredRow);
}

// Rehydrate a flat stored row into the structured record and re-validate it.
// Reassembles the optional groups only when at least one of their columns is
// populated, so a deflection (no timings) reads back without an empty timings
// husk — the write/read round-trip is shape-stable.
function parseStoredRow(stored: StoredRow): StoredGenerationMetrics {
  const usage = buildUsage(stored);
  const timings = buildTimings(stored);
  const failure = buildFailure(stored);

  return storedGenerationMetricsSchema.parse({
    id: stored.id,
    createdAt: stored.created_at,
    outcome: stored.outcome,
    model: stored.model,
    intent: {
      type: stored.intent_type,
      confidence: stored.intent_confidence,
      targetCapability: stored.intent_target_capability,
    },
    ...(stored.capability_id !== null ? { capabilityId: stored.capability_id } : {}),
    ...(usage ? { usage } : {}),
    ...(timings ? { timings } : {}),
    ...(stored.gate_rungs !== null ? { gateRungs: JSON.parse(stored.gate_rungs) } : {}),
    ...(stored.unit_attempts !== null ? { unitAttempts: JSON.parse(stored.unit_attempts) } : {}),
    ...(failure ? { failure } : {}),
  });
}

function buildUsage(stored: StoredRow): TokenUsage | undefined {
  if (
    stored.input_tokens === null &&
    stored.output_tokens === null &&
    stored.total_tokens === null
  ) {
    return undefined;
  }
  return {
    inputTokens: stored.input_tokens ?? undefined,
    outputTokens: stored.output_tokens ?? undefined,
    totalTokens: stored.total_tokens ?? undefined,
  };
}

function buildTimings(stored: StoredRow): GenerationTimings | undefined {
  const timings: GenerationTimings = {
    ...(stored.spec_gen_ms !== null ? { specGenMs: stored.spec_gen_ms } : {}),
    ...(stored.migration_ms !== null ? { migrationMs: stored.migration_ms } : {}),
    ...(stored.code_gen_ms !== null ? { codeGenMs: stored.code_gen_ms } : {}),
    ...(stored.html_gen_ms !== null ? { htmlGenMs: stored.html_gen_ms } : {}),
    ...(stored.test_gen_ms !== null ? { testGenMs: stored.test_gen_ms } : {}),
    ...(stored.test_run_ms !== null ? { testRunMs: stored.test_run_ms } : {}),
    ...(stored.total_ms !== null ? { totalMs: stored.total_ms } : {}),
  };
  return Object.keys(timings).length > 0 ? timings : undefined;
}

function buildFailure(stored: StoredRow): GenerationFailure | undefined {
  if (stored.failed_stage === null) return undefined;
  return {
    stage: stored.failed_stage as FailureStage,
    ...(stored.failed_rung !== null ? { rung: stored.failed_rung as GateRungName } : {}),
    ...(stored.failed_message !== null ? { message: stored.failed_message } : {}),
  };
}

// Sum token usage across the generation's provider calls (spec-gen, each unit,
// behavioral test-gen) into the single per-row total the metrics record stores.
// A figure stays absent unless at least one call reported it — the same honest
// "undefined, not zero" rule the contract sets (provider/contract.ts).
export function sumTokenUsage(usages: readonly TokenUsage[]): TokenUsage {
  return {
    inputTokens: sumOptional(usages.map((usage) => usage.inputTokens)),
    outputTokens: sumOptional(usages.map((usage) => usage.outputTokens)),
    totalTokens: sumOptional(usages.map((usage) => usage.totalTokens)),
  };
}

function sumOptional(values: readonly (number | undefined)[]): number | undefined {
  let seen = false;
  let sum = 0;
  for (const value of values) {
    if (value !== undefined) {
      seen = true;
      sum += value;
    }
  }
  return seen ? sum : undefined;
}

export type { GateRungOutcome };
