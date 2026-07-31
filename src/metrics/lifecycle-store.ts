// Durable lifecycle storage for every admitted generation. Unlike the historical
// terminal-only metrics table, this store represents running work, typed terminal
// outcomes, recovery after process interruption, and semantic stage state.
//
// One row is written directly terminal rather than opening `running` first: the
// lease-head stale refusal (PLAN decision 28, 4.8/03). It never enters `running`
// because no Builder provider work ever starts, and for a new capability refused
// before incarnation assignment it has no incarnation at all. That absence is real
// domain knowledge, so the public row shape carries `incarnationId: null` — but the
// physical column sits inside `PRIMARY KEY (build_id, incarnation_id)` on a STRICT
// table, where SQLite enforces NOT NULL implicitly and no ALTER can relax it. This
// module therefore owns the translation, exactly as migration 0006 made the registry's
// incarnation column physically permissive and left its meaning to row validation:
// `ABSENT_INCARNATION` is written to disk and never escapes this file.

import type { Database } from "bun:sqlite";
import { z } from "zod";
import { intentTypeSchema, overlapResolutionSchema } from "../intent-resolver/index.ts";
import { db, dbReadonly } from "../persistence/db.ts";
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
  overlapResolution: overlapResolutionSchema.optional(),
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

/**
 * The on-disk stand-in for "this row has no incarnation". Never returned to a caller
 * and never accepted from one — {@link toStoredIncarnation} and {@link fromStoredIncarnation}
 * are the only two places it appears.
 */
const ABSENT_INCARNATION = "";

function toStoredIncarnation(incarnationId: string | null): string {
  return incarnationId ?? ABSENT_INCARNATION;
}

function fromStoredIncarnation(stored: string): string | null {
  return stored === ABSENT_INCARNATION ? null : stored;
}

const generationLifecycleBaseSchema = z.strictObject({
  buildId: z.string().min(1),
  /**
   * Null only for a new-capability stale refusal that never reached incarnation
   * assignment (decision 28). Every other row — including an evolution's stale
   * refusal, which carries its expected incarnation — names one.
   */
  incarnationId: z.string().uuid().nullable(),
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
  // A missing incarnation is only ever the new-capability stale refusal. Anything else
  // without one is a row that lost its identity, not a row that never had one.
  if (row.incarnationId === null && row.outcome !== "stale") {
    ctx.addIssue({
      code: "custom",
      path: ["incarnationId"],
      message: "only a stale admission refusal may omit its incarnation",
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

/**
 * The lease-head stale refusal's row. It is written directly terminal — there is no
 * `running` row to update, because the refusal happens before the first Builder
 * provider call (decision 28).
 */
export interface WriteStaleGenerationAdmissionInput {
  readonly buildId: string;
  /** The expected incarnation for evolution; null for a new capability refused before assignment. */
  readonly incarnationId: string | null;
  readonly capabilityId?: string | null;
  readonly resolver?: CarriedResolverMeasurement | null;
  readonly measurement?: GenerationBuildMeasurement | null;
  /** Every generation stage, all skipped — nothing this row describes ever ran. */
  readonly stages: readonly GenerationStageMeasurement[];
}

export type GenerationSuccessOutcome = Extract<
  GenerationTerminalOutcome,
  "activated" | "no_change"
>;
/**
 * The failure outcomes a *running* row may be finalized into.
 *
 * `stale` is deliberately excluded. A refused admission never runs, so it has no running
 * row to close — it is written terminal on its first and only write by
 * {@link writeStaleGenerationAdmission}. Admitting `stale` here would let a build that
 * called a provider, generated units, or moved DDL file itself as one that never started,
 * which is the one thing decision 28's row is supposed to be able to prove.
 */
export type GenerationFailureOutcome = Exclude<
  GenerationTerminalOutcome,
  GenerationSuccessOutcome | "interrupted" | "stale"
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

/**
 * Record one refused admission while the build lease is still held. Unlike every other
 * row this store writes, it is terminal on its first and only write: the target,
 * expected-absence, or resolver catalog moved between resolution and the lease head, so
 * the request was refused outright rather than rebased onto the newer catalog.
 */
export function writeStaleGenerationAdmission(
  input: WriteStaleGenerationAdmissionInput,
  database: Database = db,
): GenerationLifecycle {
  const row = generationLifecycleSchema.parse({
    buildId: input.buildId,
    incarnationId: input.incarnationId,
    capabilityId: input.capabilityId ?? null,
    lifecycleStatus: "failed",
    outcome: "stale",
    resolver: input.resolver ?? null,
    measurement: input.measurement ?? null,
    stages: input.stages,
  });

  database.run(
    `INSERT INTO ${GENERATION_LIFECYCLE_TABLE} (
       build_id, incarnation_id, capability_id, lifecycle_status, outcome,
       resolver_measurement, build_measurement, stage_measurements
     ) VALUES (?, ?, ?, 'failed', 'stale', ?, ?, ?)`,
    [
      row.buildId,
      toStoredIncarnation(row.incarnationId),
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
  incarnationId: string | null,
  database: Database = dbReadonly,
): StoredGenerationLifecycle | null {
  const stored = database
    .query(
      `SELECT ${LIFECYCLE_COLUMNS} FROM ${GENERATION_LIFECYCLE_TABLE}
       WHERE build_id = ? AND incarnation_id = ?`,
    )
    .get(buildId, toStoredIncarnation(incarnationId)) as StoredLifecycleRow | null;
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
    incarnationId: fromStoredIncarnation(stored.incarnation_id),
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
