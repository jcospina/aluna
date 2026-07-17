// Recording one generation-metrics row per build (Epic 2.7; "failure is data").
//
// The build pipeline fills a single mutable {@link DemoBuildAccumulator} as its
// stages land, then writes exactly one metrics row at the end — complete on success,
// or carrying everything up to the failing rung on failure. This module owns that
// accumulator, the writers, and the stage-classification that turns a thrown error
// into the row's `failure` location.

import {
  CapabilityGateError,
  type CapabilityGateResult,
  type GateRungOutcome,
  type GeneratedUnit,
  UnitGenerationError,
} from "../builder/index.ts";
import type { IntentClassification } from "../intent-resolver/index.ts";
import type {
  GenerationFailure,
  GenerationMetrics,
  GenerationTimings,
  UnitAttemptSummary,
} from "../metrics/index.ts";
import { sumTokenUsage } from "../metrics/index.ts";
import type { TokenUsage } from "../provider/index.ts";
import { resolveModel } from "../provider/index.ts";

/**
 * How the app persists a generation-metrics row. Injected (via `AppDeps.recordMetrics`)
 * so the real writer rides the read-write connection in production while tests pass a
 * capturing stub — no real-db writes, and the wiring stays assertable.
 */
export type RecordMetrics = (metrics: GenerationMetrics) => void;

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
}

/**
 * Write the build's one metrics row through the injected recorder (the real
 * read-write connection by default). Guarded so a metrics-write hiccup never flips a
 * genuine outcome or masks the original build error.
 */
export function writeBuildMetrics(
  recordMetrics: RecordMetrics,
  generationId: string,
  intent: IntentClassification,
  acc: DemoBuildAccumulator,
  builtAt: number,
  outcome: GenerationMetrics["outcome"],
  failure?: GenerationFailure,
): void {
  try {
    recordMetrics({
      id: generationId,
      outcome,
      model: resolveModel(),
      intent: {
        type: intent.type,
        confidence: intent.confidence,
        targetCapability: intent.target_capability,
      },
      usage: sumTokenUsage(acc.usages),
      timings: { ...acc.timings, totalMs: performance.now() - builtAt },
      ...(acc.capabilityId ? { capabilityId: acc.capabilityId } : {}),
      ...(acc.incarnationId ? { incarnationId: acc.incarnationId } : {}),
      ...(acc.gateRungs ? { gateRungs: acc.gateRungs } : {}),
      ...(acc.unitAttempts ? { unitAttempts: acc.unitAttempts } : {}),
      ...(failure ? { failure } : {}),
    });
  } catch (metricsError) {
    console.error(
      "Aluna spec-build demo: metrics write failed:",
      metricsError instanceof Error ? metricsError.message : metricsError,
    );
  }
}

/**
 * Write the metrics row for a deflected prompt (an intent the platform recognizes
 * but does not yet act on). Same guard as {@link writeBuildMetrics}.
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
