// Best-effort measurements for prompt jobs that never become admitted builds.
//
// These rows are intentionally separate from durable generation lifecycle rows:
// completion never waits for this write, and losing it in a crash cannot imply that
// product mutation was lost or partially admitted.

import type { Database } from "bun:sqlite";
import { z } from "zod";
import { db, dbReadonly } from "../persistence/db.ts";
import {
  type CarriedResolverMeasurement,
  carriedResolverMeasurementSchema,
} from "./lifecycle-store.ts";

export const INTENT_RESOLUTION_METRICS_TABLE = "intent_resolution_metrics";

export const INTENT_RESOLUTION_OUTCOMES = ["completed", "cancelled", "expired"] as const;
export const intentResolutionOutcomeSchema = z.enum(INTENT_RESOLUTION_OUTCOMES);
export type IntentResolutionOutcome = z.infer<typeof intentResolutionOutcomeSchema>;

export const intentResolutionMetricsSchema = z.strictObject({
  promptJobId: z.string().min(1),
  outcome: intentResolutionOutcomeSchema,
  resolver: carriedResolverMeasurementSchema,
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
  created_at: string;
}

const ROW_COLUMNS = "prompt_job_id, outcome, resolver_measurement, created_at";

export function intentResolutionMetrics(input: {
  readonly promptJobId: string;
  readonly outcome?: IntentResolutionOutcome;
  readonly resolver: CarriedResolverMeasurement;
}): IntentResolutionMetrics {
  return intentResolutionMetricsSchema.parse({
    promptJobId: input.promptJobId,
    outcome: input.outcome ?? "completed",
    resolver: input.resolver,
  });
}

export function writeIntentResolutionMetrics(
  input: IntentResolutionMetrics,
  database: Database = db,
): IntentResolutionMetrics {
  const row = intentResolutionMetricsSchema.parse(input);
  database.run(
    `INSERT INTO ${INTENT_RESOLUTION_METRICS_TABLE}
       (prompt_job_id, outcome, resolver_measurement)
     VALUES (?, ?, ?)`,
    [row.promptJobId, row.outcome, JSON.stringify(row.resolver)],
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
  return storedIntentResolutionMetricsSchema.parse({
    promptJobId: stored.prompt_job_id,
    outcome: stored.outcome,
    resolver: JSON.parse(stored.resolver_measurement),
    createdAt: stored.created_at,
  });
}
