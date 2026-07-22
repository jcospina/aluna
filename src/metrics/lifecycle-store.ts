// Durable lifecycle storage for every admitted generation. Unlike the historical
// terminal-only metrics table, this store represents running work, typed terminal
// outcomes, recovery after process interruption, and semantic stage state.

import type { Database } from "bun:sqlite";
import { z } from "zod";

import { db, dbReadonly } from "../db.ts";
import { intentTypeSchema } from "../intent-resolver/index.ts";
import {
  gateRungOutcomeSchema,
  generationFailureSchema,
  tokenUsageSchema,
  unitAttemptSummarySchema,
} from "./shared-schema.ts";

export const GENERATION_LIFECYCLE_TABLE = "generation_lifecycle_metrics";

export const GENERATION_LIFECYCLE_STATUSES = [
  "running",
  "success",
  "failed",
  "interrupted",
] as const;
export const generationLifecycleStatusSchema = z.enum(GENERATION_LIFECYCLE_STATUSES);
export type GenerationLifecycleStatus = z.infer<typeof generationLifecycleStatusSchema>;

export const GENERATION_TERMINAL_OUTCOMES = [
  "activated",
  "no_change",
  "stale",
  "spec_generation_failed",
  "migration_failed",
  "unit_generation_failed",
  "gate_failed",
  "publication_failed",
  "activation_failed",
  "cancelled",
  "interrupted",
] as const;
export const generationTerminalOutcomeSchema = z.enum(GENERATION_TERMINAL_OUTCOMES);
export type GenerationTerminalOutcome = z.infer<typeof generationTerminalOutcomeSchema>;

export const GENERATION_STAGE_STATES = [
  "generated",
  "copied",
  "executed",
  "skipped",
  "absent",
] as const;
export const generationStageStateSchema = z.enum(GENERATION_STAGE_STATES);
export type GenerationStageState = z.infer<typeof generationStageStateSchema>;

const generationStageSubjectSchema = z.strictObject({
  kind: z.string().min(1),
  name: z.string().min(1),
});

export const generationStageMeasurementSchema = z
  .strictObject({
    stage: z.string().min(1),
    state: generationStageStateSchema,
    unit: generationStageSubjectSchema.optional(),
    test: generationStageSubjectSchema.optional(),
  })
  .superRefine((measurement, ctx) => {
    if (measurement.unit && measurement.test) {
      ctx.addIssue({
        code: "custom",
        message: "a stage measurement may identify a unit or a test, not both",
      });
    }
  });
export type GenerationStageMeasurement = z.infer<typeof generationStageMeasurementSchema>;

// Content-free by construction: resolver classification and provider measurement,
// never prompt text, proposed copy, generated artifacts, or user records.
export const carriedResolverMeasurementSchema = z.strictObject({
  intent: z.strictObject({
    type: intentTypeSchema,
    confidence: z.number().min(0).max(1),
    targetCapability: z.string().min(1).nullable(),
  }),
  model: z.string().min(1),
  durationMs: z.number().nonnegative(),
  usage: tokenUsageSchema,
  catalogFingerprint: z.string().min(1).optional(),
  overlapResolution: z.string().min(1).optional(),
});
export type CarriedResolverMeasurement = z.infer<typeof carriedResolverMeasurementSchema>;

export const generationBuildMeasurementSchema = z.strictObject({
  model: z.string().min(1),
  usage: tokenUsageSchema.optional(),
  timings: z
    .strictObject({
      resolverMs: z.number().nonnegative().optional(),
      queueWaitMs: z.number().nonnegative().optional(),
      specGenMs: z.number().nonnegative().optional(),
      migrationMs: z.number().nonnegative().optional(),
      codeGenMs: z.number().nonnegative().optional(),
      presentationGenMs: z.number().nonnegative().optional(),
      testGenMs: z.number().nonnegative().optional(),
      testRunMs: z.number().nonnegative().optional(),
      publicationMs: z.number().nonnegative().optional(),
      totalMs: z.number().nonnegative().optional(),
    })
    .optional(),
  gateRungs: z.array(gateRungOutcomeSchema).readonly().optional(),
  unitAttempts: z.array(unitAttemptSummarySchema).readonly().optional(),
  failure: generationFailureSchema.optional(),
});
export type GenerationBuildMeasurement = z.infer<typeof generationBuildMeasurementSchema>;

const generationLifecycleBaseSchema = z.strictObject({
  buildId: z.string().min(1),
  incarnationId: z.string().uuid(),
  capabilityId: z.string().min(1).nullable(),
  lifecycleStatus: generationLifecycleStatusSchema,
  outcome: generationTerminalOutcomeSchema.nullable(),
  resolver: carriedResolverMeasurementSchema.nullable(),
  measurement: generationBuildMeasurementSchema.nullable(),
  stages: z.array(generationStageMeasurementSchema).readonly(),
});

export const generationLifecycleSchema = generationLifecycleBaseSchema.superRefine((row, ctx) => {
  const validTerminal =
    (row.lifecycleStatus === "running" && row.outcome === null) ||
    (row.lifecycleStatus === "success" &&
      (row.outcome === "activated" || row.outcome === "no_change")) ||
    (row.lifecycleStatus === "failed" &&
      row.outcome !== null &&
      row.outcome !== "activated" &&
      row.outcome !== "no_change" &&
      row.outcome !== "interrupted") ||
    (row.lifecycleStatus === "interrupted" && row.outcome === "interrupted");
  if (!validTerminal) {
    ctx.addIssue({
      code: "custom",
      path: ["outcome"],
      message: `outcome is incompatible with lifecycle status ${row.lifecycleStatus}`,
    });
  }
});
export type GenerationLifecycle = z.infer<typeof generationLifecycleSchema>;

export const storedGenerationLifecycleSchema = generationLifecycleSchema.extend({
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type StoredGenerationLifecycle = z.infer<typeof storedGenerationLifecycleSchema>;

export interface StartGenerationLifecycleInput {
  readonly buildId: string;
  readonly incarnationId: string;
  readonly capabilityId?: string | null;
  readonly resolver?: CarriedResolverMeasurement | null;
  readonly measurement?: GenerationBuildMeasurement | null;
  readonly stages?: readonly GenerationStageMeasurement[];
}

export interface FinalizeGenerationLifecycleInput {
  readonly buildId: string;
  readonly incarnationId: string;
  readonly outcome: GenerationTerminalOutcome;
  readonly stages: readonly GenerationStageMeasurement[];
  readonly measurement?: GenerationBuildMeasurement | null;
}

export type GenerationSuccessOutcome = Extract<
  GenerationTerminalOutcome,
  "activated" | "no_change"
>;
export type GenerationFailureOutcome = Exclude<
  GenerationTerminalOutcome,
  GenerationSuccessOutcome | "interrupted"
>;

interface StoredLifecycleRow {
  build_id: string;
  incarnation_id: string;
  capability_id: string | null;
  lifecycle_status: string;
  outcome: string | null;
  resolver_measurement: string | null;
  build_measurement: string | null;
  stage_measurements: string;
  created_at: string;
  updated_at: string;
}

const LIFECYCLE_COLUMNS = [
  "build_id",
  "incarnation_id",
  "capability_id",
  "lifecycle_status",
  "outcome",
  "resolver_measurement",
  "build_measurement",
  "stage_measurements",
  "created_at",
  "updated_at",
].join(", ");

export function startGenerationLifecycle(
  input: StartGenerationLifecycleInput,
  database: Database = db,
): GenerationLifecycle {
  const row = generationLifecycleSchema.parse({
    buildId: input.buildId,
    incarnationId: input.incarnationId,
    capabilityId: input.capabilityId ?? null,
    lifecycleStatus: "running",
    outcome: null,
    resolver: input.resolver ?? null,
    measurement: input.measurement ?? null,
    stages: input.stages ?? [],
  });

  database.run(
    `INSERT INTO ${GENERATION_LIFECYCLE_TABLE} (
       build_id, incarnation_id, capability_id, lifecycle_status, outcome,
       resolver_measurement, build_measurement, stage_measurements
     ) VALUES (?, ?, ?, 'running', NULL, ?, ?, ?)`,
    [
      row.buildId,
      row.incarnationId,
      row.capabilityId,
      row.resolver === null ? null : JSON.stringify(row.resolver),
      row.measurement === null ? null : JSON.stringify(row.measurement),
      JSON.stringify(row.stages),
    ],
  );
  return row;
}

export function updateGenerationLifecycleIdentity(
  buildId: string,
  incarnationId: string,
  capabilityId: string,
  database: Database = db,
): void {
  z.string().min(1).parse(capabilityId);
  const result = database.run(
    `UPDATE ${GENERATION_LIFECYCLE_TABLE}
     SET capability_id = ?, updated_at = datetime('now')
     WHERE build_id = ? AND incarnation_id = ? AND lifecycle_status = 'running'`,
    [capabilityId, buildId, incarnationId],
  );
  if (result.changes !== 1) {
    throw new Error(`Running generation lifecycle not found: ${buildId}/${incarnationId}`);
  }
}

function finalizeGenerationLifecycle(
  input: FinalizeGenerationLifecycleInput,
  lifecycleStatus: "success" | "failed",
  database: Database,
): void {
  generationLifecycleSchema.parse({
    buildId: input.buildId,
    incarnationId: input.incarnationId,
    capabilityId: null,
    lifecycleStatus,
    outcome: input.outcome,
    resolver: null,
    measurement: input.measurement ?? null,
    stages: input.stages,
  });
  const result = database.run(
    `UPDATE ${GENERATION_LIFECYCLE_TABLE}
     SET lifecycle_status = ?, outcome = ?, stage_measurements = ?, build_measurement = ?,
         updated_at = datetime('now')
     WHERE build_id = ? AND incarnation_id = ? AND lifecycle_status = 'running'`,
    [
      lifecycleStatus,
      input.outcome,
      JSON.stringify(input.stages),
      input.measurement === null || input.measurement === undefined
        ? null
        : JSON.stringify(input.measurement),
      input.buildId,
      input.incarnationId,
    ],
  );
  if (result.changes !== 1) {
    throw new Error(
      `Running generation lifecycle not found: ${input.buildId}/${input.incarnationId}`,
    );
  }
}

export function finalizeGenerationLifecycleSuccess(
  input: Omit<FinalizeGenerationLifecycleInput, "outcome"> & {
    readonly outcome: GenerationSuccessOutcome;
  },
  database: Database = db,
): void {
  finalizeGenerationLifecycle(input, "success", database);
}

export function finalizeGenerationLifecycleFailure(
  input: Omit<FinalizeGenerationLifecycleInput, "outcome"> & {
    readonly outcome: GenerationFailureOutcome;
  },
  database: Database = db,
): void {
  database.transaction(() => finalizeGenerationLifecycle(input, "failed", database))();
}

export function reconcileRunningGenerationLifecycles(database: Database = db): number {
  const result = database.run(
    `UPDATE ${GENERATION_LIFECYCLE_TABLE}
     SET lifecycle_status = 'interrupted', outcome = 'interrupted', updated_at = datetime('now')
     WHERE lifecycle_status = 'running'`,
  );
  return result.changes;
}

export function getGenerationLifecycle(
  buildId: string,
  incarnationId: string,
  database: Database = dbReadonly,
): StoredGenerationLifecycle | null {
  const stored = database
    .query(
      `SELECT ${LIFECYCLE_COLUMNS} FROM ${GENERATION_LIFECYCLE_TABLE}
       WHERE build_id = ? AND incarnation_id = ?`,
    )
    .get(buildId, incarnationId) as StoredLifecycleRow | null;
  return stored ? parseStoredLifecycle(stored) : null;
}

export function listGenerationLifecycles(
  database: Database = dbReadonly,
): StoredGenerationLifecycle[] {
  const rows = database
    .query(
      `SELECT ${LIFECYCLE_COLUMNS} FROM ${GENERATION_LIFECYCLE_TABLE}
       ORDER BY created_at DESC, build_id, incarnation_id`,
    )
    .all() as StoredLifecycleRow[];
  return rows.map(parseStoredLifecycle);
}

function parseStoredLifecycle(stored: StoredLifecycleRow): StoredGenerationLifecycle {
  return storedGenerationLifecycleSchema.parse({
    buildId: stored.build_id,
    incarnationId: stored.incarnation_id,
    capabilityId: stored.capability_id,
    lifecycleStatus: stored.lifecycle_status,
    outcome: stored.outcome,
    resolver: stored.resolver_measurement === null ? null : JSON.parse(stored.resolver_measurement),
    measurement: stored.build_measurement === null ? null : JSON.parse(stored.build_measurement),
    stages: JSON.parse(stored.stage_measurements),
    createdAt: stored.created_at,
    updatedAt: stored.updated_at,
  });
}
