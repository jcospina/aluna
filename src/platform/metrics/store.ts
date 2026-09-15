// The generation-metrics access module (ARCH §6.3, §6.2; PLAN flow step 8).
//
// One row per generation, recording what the system did to build itself — distinct from the event
// log, which is M7's record of what the user did. Every build, every failed build and every
// deflection writes exactly one row, so latency and capability conclusions come from querying it.
//
// The writer is callable with partial knowledge (PLAN decision 6): the optional groups map to
// nullable columns, so "did not get that far" is stored as honest absence rather than a fabricated
// zero. The insert rides `db` and reads default to `dbReadonly`; both sides validate the row shape.

import type { Database } from "bun:sqlite";
import { z } from "zod";
import { intentTypeSchema } from "../../pipeline/intent/index.ts";
import type { GateRungName } from "../gate-rungs.ts";
import { db, dbReadonly } from "../persistence/db.ts";
import { GENERATION_METRICS_TABLE } from "../persistence/table-names.ts";
import type { TokenUsage } from "../provider/index.ts";
import {
  type FailureStage,
  type GenerationFailure,
  gateRungOutcomeSchema,
  generationFailureSchema,
  tokenUsageSchema,
  unitAttemptSummarySchema,
} from "./shared-schema.ts";

/**
 * The metrics table, created by platform migration 0004. A fixed platform constant, never user
 * input, so interpolating it into the SQL below is safe.
 */
export { GENERATION_METRICS_TABLE } from "../persistence/table-names.ts";

/**
 * `success` committed a capability; `failure` stopped at a stage or rung (failure is data, ARCH
 * §6.2); `deflected` classified the prompt as something M2 does not act on (PLAN decision 6).
 */
export const GENERATION_OUTCOMES = ["success", "failure", "deflected"] as const;
export const generationOutcomeSchema = z.enum(GENERATION_OUTCOMES);
export type GenerationOutcome = z.infer<typeof generationOutcomeSchema>;

// The intent classification behind this generation, present on every row — a deflection's whole
// point is to log its classification, and the overlap target says which capability it touched.
const generationIntentSchema = z.strictObject({
  type: intentTypeSchema,
  confidence: z.number().min(0).max(1),
  targetCapability: z.string().min(1).nullable(),
});
export type GenerationIntent = z.infer<typeof generationIntentSchema>;

// The PLAN step-8 timing breakdown. Every leg is optional: a deflection omits the group, a failed
// build fills only what it reached. `testGenMs` and `testRunMs` are what M8 weighs the tier by.
const generationTimingsSchema = z.strictObject({
  specGenMs: z.number().nonnegative().optional(),
  migrationMs: z.number().nonnegative().optional(),
  codeGenMs: z.number().nonnegative().optional(),
  presentationGenMs: z.number().nonnegative().optional(),
  testGenMs: z.number().nonnegative().optional(),
  testRunMs: z.number().nonnegative().optional(),
  totalMs: z.number().nonnegative().optional(),
});
export type GenerationTimings = z.infer<typeof generationTimingsSchema>;

/**
 * The writer's input. Everything past the always-known identity/intent/model block is optional, so
 * the writer is callable with partial knowledge (deflection, failed build).
 */
export const generationMetricsSchema = z
  .strictObject({
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
    // Absent only when no capability lifetime exists — a deflection, or a failure before a
    // generated spec can be accepted.
    incarnationId: z.string().uuid().nullish(),
    usage: tokenUsageSchema.optional(),
    timings: generationTimingsSchema.optional(),
    gateRungs: z.array(gateRungOutcomeSchema).readonly().optional(),
    unitAttempts: z.array(unitAttemptSummarySchema).readonly().optional(),
    failure: generationFailureSchema.optional(),
  })
  .superRefine((metrics, ctx) => {
    if ((metrics.capabilityId == null) !== (metrics.incarnationId == null)) {
      ctx.addIssue({
        code: "custom",
        message: "capabilityId and incarnationId must be present together",
        path: [metrics.capabilityId == null ? "capabilityId" : "incarnationId"],
      });
    }
  });
export type GenerationMetrics = z.infer<typeof generationMetricsSchema>;

/**
 * The written shape plus the platform-stamped `createdAt` (ARCH §6.3), validated on the way out so
 * a hand-edited or drifted row fails loudly at the read site rather than three queries later.
 */
export const storedGenerationMetricsSchema = generationMetricsSchema.extend({
  createdAt: z.string().min(1),
});
export type StoredGenerationMetrics = z.infer<typeof storedGenerationMetricsSchema>;

// The flat row as SQLite stores it: scalars per column, the structured groups serialized to JSON
// text. Mirrors the StoredRow shape the registry store uses.
interface StoredRow {
  id: string;
  created_at: string;
  outcome: string;
  capability_id: string | null;
  incarnation_id: string | null;
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
  presentation_gen_ms: number | null;
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
  "incarnation_id",
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
  "presentation_gen_ms",
  "test_gen_ms",
  "test_run_ms",
  "total_ms",
  "gate_rungs",
  "unit_attempts",
  "failed_stage",
  "failed_rung",
  "failed_message",
].join(", ");

// Columns the writer sets explicitly. `created_at` is omitted on insert so the column default
// (datetime('now')) stamps it, the way the migrations ledger's `applied_at` is stamped.
const INSERT_COLUMNS = ROW_COLUMNS.replace("created_at, ", "");
const INSERT_PLACEHOLDERS = INSERT_COLUMNS.split(", ")
  .map(() => "?")
  .join(", ");

function nullish<T>(value: T | undefined): T | null {
  return value ?? null;
}

/**
 * Write one row through the read-write connection. An invalid record throws (ZodError) and writes
 * nothing; a duplicate id throws, because one row per generation is the invariant.
 */
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
      nullish(valid.incarnationId),
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
      nullish(timings?.presentationGenMs),
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

/**
 * Fetch one metrics row by generation id, or null when it doesn't exist. Reads
 * ride the read-only connection by convention — the M8 query surface.
 */
export function getGenerationMetrics(
  id: string,
  database: Database = dbReadonly,
): StoredGenerationMetrics | null {
  const stored = database
    .query(`SELECT ${ROW_COLUMNS} FROM ${GENERATION_METRICS_TABLE} WHERE id = ?`)
    .get(id) as StoredRow | null;

  return stored ? parseStoredRow(stored) : null;
}

/**
 * List every metrics row, newest first then by id — the experiment's dataset
 * Ordered deterministically so M8's queries see a stable order.
 */
export function listGenerationMetrics(database: Database = dbReadonly): StoredGenerationMetrics[] {
  const rows = database
    .query(`SELECT ${ROW_COLUMNS} FROM ${GENERATION_METRICS_TABLE} ORDER BY created_at DESC, id`)
    .all() as StoredRow[];

  return rows.map(parseStoredRow);
}

// Rehydrate a flat stored row and re-validate it. An optional group is reassembled only when a
// column of it is populated, so a deflection reads back without an empty timings husk.
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
    ...(stored.incarnation_id !== null ? { incarnationId: stored.incarnation_id } : {}),
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
    ...(stored.presentation_gen_ms !== null
      ? { presentationGenMs: stored.presentation_gen_ms }
      : {}),
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
