// Recording one generation-metrics row per build (Epic 2.7; "failure is data").
//
// The build pipeline admits one durable running row, fills a mutable
// {@link DemoBuildAccumulator} as stages land, then finalizes that same row on success
// or failure. This module owns the accumulator, lifecycle adapter, and classification
// that turns a thrown error into the row's typed terminal outcome and failure location.

import type { Database } from "bun:sqlite";
import {
  CapabilityGateError,
  type CapabilityGateResult,
  type GateRungOutcome,
  type GeneratedUnit,
  SnapshotVerificationError,
  UnitGenerationError,
} from "../builder/index.ts";
import type { IntentClassification } from "../intent-resolver/index.ts";
import type {
  CarriedResolverMeasurement,
  GenerationBuildMeasurement,
  GenerationFailure,
  GenerationFailureOutcome,
  GenerationLifecycle,
  GenerationMetrics,
  GenerationStageMeasurement,
  GenerationSuccessOutcome,
  GenerationTimings,
  StartGenerationLifecycleInput,
  StoredGenerationLifecycle,
  UnitAttemptSummary,
} from "../metrics/index.ts";
import {
  finalizeGenerationLifecycleFailure,
  finalizeGenerationLifecycleSuccess,
  getGenerationLifecycle,
  startGenerationLifecycle,
  sumTokenUsage,
  updateGenerationLifecycleIdentity,
  writeGenerationMetrics,
} from "../metrics/index.ts";
import type { TokenUsage } from "../provider/index.ts";
import { resolveModel } from "../provider/index.ts";

/**
 * How the app persists a generation-metrics row. Injected (via `AppDeps.recordMetrics`)
 * so the real writer rides the read-write connection in production while tests pass a
 * capturing stub — no real-db writes, and the wiring stays assertable.
 */
export interface RecordMetrics {
  /** Legacy best-effort resolution-only measurement writer. */
  (metrics: GenerationMetrics): void;
  readonly start: (input: StartGenerationLifecycleInput) => GenerationLifecycle;
  readonly identify: (buildId: string, incarnationId: string, capabilityId: string) => void;
  readonly succeed: (input: {
    readonly buildId: string;
    readonly incarnationId: string;
    readonly outcome: GenerationSuccessOutcome;
    readonly stages: readonly GenerationStageMeasurement[];
    readonly measurement: GenerationBuildMeasurement;
  }) => void;
  readonly fail: (input: {
    readonly buildId: string;
    readonly incarnationId: string;
    readonly outcome: GenerationFailureOutcome;
    readonly stages: readonly GenerationStageMeasurement[];
    readonly measurement: GenerationBuildMeasurement;
  }) => void;
  readonly get: (buildId: string, incarnationId: string) => StoredGenerationLifecycle | null;
}

/** Bind lifecycle operations to one write connection. Success joins the caller's transaction. */
export function createMetricsRecorder(database: Database): RecordMetrics {
  const legacy = (metrics: GenerationMetrics) => void writeGenerationMetrics(metrics, database);
  return Object.assign(legacy, {
    start: (input: StartGenerationLifecycleInput) => startGenerationLifecycle(input, database),
    identify: (buildId: string, incarnationId: string, capabilityId: string) =>
      updateGenerationLifecycleIdentity(buildId, incarnationId, capabilityId, database),
    succeed: (input: {
      buildId: string;
      incarnationId: string;
      outcome: GenerationSuccessOutcome;
      stages: readonly GenerationStageMeasurement[];
      measurement: GenerationBuildMeasurement;
    }) => finalizeGenerationLifecycleSuccess(input, database),
    fail: (input: {
      buildId: string;
      incarnationId: string;
      outcome: GenerationFailureOutcome;
      stages: readonly GenerationStageMeasurement[];
      measurement: GenerationBuildMeasurement;
    }) => finalizeGenerationLifecycleFailure(input, database),
    get: (buildId: string, incarnationId: string) =>
      getGenerationLifecycle(buildId, incarnationId, database),
  });
}

/**
 * The build measurements the stages fill in as they land. Held in one mutable
 * accumulator so the metrics row can be written from it at the end — complete on
 * success, or carrying everything up to the failing rung on failure.
 */
export interface DemoBuildAccumulator {
  readonly usages: TokenUsage[];
  readonly timings: GenerationTimings;
  capabilityId?: string;
  incarnationId?: string;
  gateRungs?: readonly GateRungOutcome[];
  unitAttempts?: UnitAttemptSummary[];
  publicationAttempted?: boolean;
  activationAttempted?: boolean;
}

export function carriedResolverMeasurement(
  intent: IntentClassification,
  usage: TokenUsage,
  durationMs: number,
): CarriedResolverMeasurement {
  return {
    intent: {
      type: intent.type,
      confidence: intent.confidence,
      targetCapability: intent.target_capability,
    },
    model: resolveModel(),
    durationMs,
    usage,
  };
}

export function lifecycleMeasurement(
  acc: DemoBuildAccumulator,
  builtAt: number,
  failure?: GenerationFailure,
): GenerationBuildMeasurement {
  return {
    model: resolveModel(),
    usage: sumTokenUsage(acc.usages),
    timings: { ...acc.timings, totalMs: performance.now() - builtAt },
    ...(acc.gateRungs ? { gateRungs: acc.gateRungs } : {}),
    ...(acc.unitAttempts ? { unitAttempts: acc.unitAttempts } : {}),
    ...(failure ? { failure } : {}),
  };
}

const UNIT_STAGES = [
  { kind: "item-renderer", name: "item" },
  { kind: "handler", name: "create" },
  { kind: "handler", name: "read" },
  { kind: "handler", name: "update" },
  { kind: "handler", name: "delete" },
  { kind: "handler", name: "search" },
] as const;

function activationStageState(
  acc: DemoBuildAccumulator,
  terminal: "activated" | "failed" | "cancelled",
): GenerationStageMeasurement["state"] {
  return terminal === "activated" || acc.activationAttempted ? "executed" : "skipped";
}

/** A complete semantic state vector; later evolution can mark individual entries copied. */
export function lifecycleStages(
  acc: DemoBuildAccumulator,
  terminal: "activated" | "failed" | "cancelled",
): readonly GenerationStageMeasurement[] {
  const generatedUnits = new Set(acc.unitAttempts?.map((unit) => `${unit.kind}:${unit.name}`));
  const gateByName = new Map(acc.gateRungs?.map((rung) => [rung.rung, rung.status]));
  const behavioralSeen = gateByName.has("behavioral");
  return [
    {
      stage: "spec_generation",
      state: acc.timings.specGenMs === undefined ? "skipped" : "generated",
    },
    {
      stage: "migration",
      state: acc.timings.migrationMs === undefined ? "skipped" : "executed",
    },
    ...UNIT_STAGES.map((unit) => ({
      stage: "unit_generation",
      state: generatedUnits.has(`${unit.kind}:${unit.name}`)
        ? ("generated" as const)
        : ("skipped" as const),
      unit,
    })),
    {
      stage: "behavioral_test_generation",
      state:
        acc.timings.testGenMs !== undefined ? "generated" : behavioralSeen ? "absent" : "skipped",
    },
    {
      stage: "behavioral_test_execution",
      state:
        acc.timings.testRunMs !== undefined ? "executed" : behavioralSeen ? "absent" : "skipped",
    },
    ...(["structural", "smoke", "behavioral", "design-lint"] as const).map((name) => ({
      stage: `gate_${name}`,
      state:
        gateByName.get(name) === "skipped" || !gateByName.has(name)
          ? ("skipped" as const)
          : ("executed" as const),
    })),
    {
      stage: "publication",
      state: acc.publicationAttempted ? "executed" : "skipped",
    },
    {
      stage: "activation",
      state: activationStageState(acc, terminal),
    },
  ];
}

export function lifecycleFailureOutcome(failure: GenerationFailure): GenerationFailureOutcome {
  switch (failure.stage) {
    case "spec_gen":
      return "spec_generation_failed";
    case "migration":
      return "migration_failed";
    case "unit_generation":
      return "unit_generation_failed";
    case "gate":
      return "gate_failed";
    case "publication":
      return "publication_failed";
    case "activation":
    case "commit":
      return "activation_failed";
  }
}

/**
 * Write the metrics row for a deflected prompt (an intent the platform recognizes
 * but does not yet act on). Resolver-only measurements remain best-effort.
 */
export function writeDeflectionMetrics(
  recordMetrics: RecordMetrics,
  generationId: string,
  intent: IntentClassification,
  usage: TokenUsage,
): void {
  try {
    recordMetrics({
      id: generationId,
      outcome: "deflected",
      model: resolveModel(),
      intent: {
        type: intent.type,
        confidence: intent.confidence,
        targetCapability: intent.target_capability,
      },
      usage,
    });
  } catch (metricsError) {
    console.error(
      "Aluna build job: metrics write failed:",
      metricsError instanceof Error ? metricsError.message : metricsError,
    );
  }
}

/**
 * Name the stage (and, for the gate, the rung) a failed build stopped at, for the
 * metrics row's "failure is data" record (Epic 2.7). The two structured build errors
 * carry the precise location; otherwise the failure is inferred from how far the
 * build accumulator got — spec-gen, migration, and commit all throw before producing
 * a dedicated error type. A failure once the gate's rungs are recorded (gate passed)
 * can only be the commit stage that follows it.
 */
export function classifyBuildFailure(error: unknown, acc: DemoBuildAccumulator): GenerationFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof CapabilityGateError) {
    return { stage: "gate", rung: error.failedRung, message };
  }
  if (error instanceof UnitGenerationError) {
    return { stage: "unit_generation", message };
  }
  if (error instanceof SnapshotVerificationError) {
    return { stage: "publication", message };
  }
  const { timings } = acc;
  if (timings.specGenMs === undefined) return { stage: "spec_gen", message };
  if (timings.migrationMs === undefined) return { stage: "migration", message };
  if (timings.codeGenMs === undefined || timings.presentationGenMs === undefined) {
    return { stage: "unit_generation", message };
  }
  if (acc.gateRungs === undefined) return { stage: "gate", message };
  return { stage: "commit", message };
}

/**
 * Record the unit-generation legs of the metrics row: code-gen (handlers) and
 * presentation-gen (the item renderer — the semantic successor to M2's html-gen,
 * ADR-0005 "metrics retain semantic continuity") wall time, the per-unit fix-loop
 * attempts (PLAN decision 5), and each unit's token usage.
 */
export function recordUnitMetrics(
  acc: DemoBuildAccumulator,
  units: readonly GeneratedUnit[],
): void {
  refreshUnitMetrics(acc, units);
  for (const unit of units) acc.usages.push(unit.usage);
}

/** Refresh unit timings/attempts after Gate has folded repairs into the commit units. */
export function refreshUnitMetrics(
  acc: DemoBuildAccumulator,
  units: readonly GeneratedUnit[],
): void {
  acc.timings.codeGenMs = sumUnitDuration(units, "handler");
  acc.timings.presentationGenMs = sumUnitDuration(units, "item-renderer");
  acc.unitAttempts = units.map((unit) => ({
    kind: unit.kind,
    name: unit.name,
    attempts: unit.attempts.length,
    durationMs: unit.durationMs,
    usage: unit.usage,
  }));
}

function sumUnitDuration(units: readonly GeneratedUnit[], kind: GeneratedUnit["kind"]): number {
  return units.filter((unit) => unit.kind === kind).reduce((sum, unit) => sum + unit.durationMs, 0);
}

/**
 * Record the gate legs: the per-rung outcomes (now including design-lint), the behavioral
 * tier's test-gen and test-run timings (and its token usage) when the tier is on — the
 * columns that let M8 weigh the behavioral tier against the no-test baseline — and the
 * design-lint rung's regeneration tokens, so a build that fixed a design violation reports
 * an honest total (the usage is all-absent, contributing nothing, when no fix was needed).
 */
export function recordGateMetrics(
  acc: DemoBuildAccumulator,
  gateResult: CapabilityGateResult,
): void {
  acc.gateRungs = gateResult.outcomes;
  if (gateResult.behavioral.tier === "on") {
    acc.timings.testGenMs = gateResult.behavioral.testGen.durationMs;
    acc.timings.testRunMs = gateResult.behavioral.testRun.durationMs;
    acc.usages.push(gateResult.behavioral.testGen.usage);
  }
  acc.usages.push(gateResult.smoke.usage);
  acc.usages.push(gateResult.designLint.usage);
}
