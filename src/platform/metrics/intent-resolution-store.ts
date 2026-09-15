// Best-effort measurements for prompt jobs that never become admitted builds.
//
// These rows are intentionally separate from durable generation lifecycle rows:
// completion never waits for this write, and losing it in a crash cannot imply that
// product mutation was lost or partially admitted.

import type { Database } from "bun:sqlite";
import { z } from "zod";
import { db, dbReadonly } from "../persistence/db.ts";
import { INTENT_RESOLUTION_METRICS_TABLE } from "../persistence/table-names.ts";
import {
  type CarriedResolverMeasurement,
  carriedResolverMeasurementSchema,
} from "./lifecycle-store.ts";

export { INTENT_RESOLUTION_METRICS_TABLE } from "../persistence/table-names.ts";

export const INTENT_RESOLUTION_OUTCOMES = ["completed", "cancelled", "expired"] as const;
export const intentResolutionOutcomeSchema = z.enum(INTENT_RESOLUTION_OUTCOMES);
export type IntentResolutionOutcome = z.infer<typeof intentResolutionOutcomeSchema>;

/**
 * What one question cost the person who asked it: the steps it took and the wall-clock it took
 * them (PLAN decision 33, ADR-0008). Two integers and no third field, so the pair that answers
 * decision 8 cannot grow a place to put a prompt, a statement or a row that was read.
 */
export const questionCostSchema = z.strictObject({
  stepsTaken: z.number().int().nonnegative(),
  elapsedMs: z.number().int().nonnegative(),
});
export type QuestionCost = z.infer<typeof questionCostSchema>;

export const intentResolutionMetricsSchema = z.strictObject({
  promptJobId: z.string().min(1),
  outcome: intentResolutionOutcomeSchema,
  resolver: carriedResolverMeasurementSchema,
  /** Absent on every row no read loop ran for, which is every row but a question's. */
  question: questionCostSchema.optional(),
});
export type IntentResolutionMetrics = z.infer<typeof intentResolutionMetricsSchema>;

export const storedIntentResolutionMetricsSchema = intentResolutionMetricsSchema.extend({
  createdAt: z.string().min(1),
});
export type StoredIntentResolutionMetrics = z.infer<typeof storedIntentResolutionMetricsSchema>;

interface StoredRow {
  prompt_job_id: string;
  outcome: string;
  resolver_measurement: string;
  steps_taken: number | null;
  elapsed_ms: number | null;
  created_at: string;
}

const ROW_COLUMNS =
  "prompt_job_id, outcome, resolver_measurement, steps_taken, elapsed_ms, created_at";

export function intentResolutionMetrics(input: {
  readonly promptJobId: string;
  readonly outcome?: IntentResolutionOutcome;
  readonly resolver: CarriedResolverMeasurement;
  readonly question?: QuestionCost;
}): IntentResolutionMetrics {
  return intentResolutionMetricsSchema.parse({
    promptJobId: input.promptJobId,
    outcome: input.outcome ?? "completed",
    resolver: input.resolver,
    ...(input.question ? { question: input.question } : {}),
  });
}

export function writeIntentResolutionMetrics(
  input: IntentResolutionMetrics,
  database: Database = db,
): IntentResolutionMetrics {
  const row = intentResolutionMetricsSchema.parse(input);
  database.run(
    `INSERT INTO ${INTENT_RESOLUTION_METRICS_TABLE}
       (prompt_job_id, outcome, resolver_measurement, steps_taken, elapsed_ms)
     VALUES (?, ?, ?, ?, ?)`,
    [
      row.promptJobId,
      row.outcome,
      JSON.stringify(row.resolver),
      row.question?.stepsTaken ?? null,
      row.question?.elapsedMs ?? null,
    ],
  );
  return row;
}

export function getIntentResolutionMetrics(
  promptJobId: string,
  database: Database = dbReadonly,
): StoredIntentResolutionMetrics | null {
  const stored = database
    .query(
      `SELECT ${ROW_COLUMNS} FROM ${INTENT_RESOLUTION_METRICS_TABLE}
       WHERE prompt_job_id = ?`,
    )
    .get(promptJobId) as StoredRow | null;
  return stored ? parseStoredRow(stored) : null;
}

export function listIntentResolutionMetrics(
  database: Database = dbReadonly,
): StoredIntentResolutionMetrics[] {
  const rows = database
    .query(
      `SELECT ${ROW_COLUMNS} FROM ${INTENT_RESOLUTION_METRICS_TABLE}
       ORDER BY created_at DESC, prompt_job_id`,
    )
    .all() as StoredRow[];
  return rows.map(parseStoredRow);
}

function parseStoredRow(stored: StoredRow): StoredIntentResolutionMetrics {
  // A half-written row loses its cost rather than reporting half of one: either column NULL and
  // the caller is told no loop ran.
  const cost =
    stored.steps_taken === null || stored.elapsed_ms === null
      ? {}
      : { question: { stepsTaken: stored.steps_taken, elapsedMs: stored.elapsed_ms } };
  return storedIntentResolutionMetricsSchema.parse({
    promptJobId: stored.prompt_job_id,
    outcome: stored.outcome,
    resolver: JSON.parse(stored.resolver_measurement),
    ...cost,
    createdAt: stored.created_at,
  });
}
