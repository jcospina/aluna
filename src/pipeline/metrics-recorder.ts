// Recording one generation-metrics row per build (Epic 2.7; "failure is data").
//
// The build pipeline admits one durable running row, fills a mutable
// {@link DemoBuildAccumulator} as stages land, then finalizes that same row on success
// or failure. This module owns the accumulator, lifecycle adapter, and classification
// that turns a thrown error into the row's typed terminal outcome and failure location.

import type { Database } from "bun:sqlite";
import {
  type BehavioralActionExecution,
  type BehavioralHandlerGenerationAttempt,
  type BehavioralTestActionReport,
  BehavioralTestGenerationError,
  CapabilityGateError,
  type CapabilityGateResult,
  type FrozenBehavioralTestsResult,
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
  /**
   * The units an evolution byte-copied from the committed snapshot. They are part of the
   * assembled inventory, so they carry unit attempts like any other — but they were never
   * generated, and the stage vector says so (decision 21's copy is a claim about bytes).
   */
  copiedUnits?: ReadonlySet<string>;
  /**
   * Per Action, whether this build generated or copied that frozen suite and whether it
   * executed or skipped it (4.7/02). Generation and execution are separate decisions, so the
   * stage vector records them as separate per-Action rows rather than one blended verdict.
   */
  behavioralExecution?: readonly BehavioralActionExecution[];
  /**
   * Per Action, whether this build authored that suite or carried the prior frozen bytes —
   * recorded by the freeze stage itself (4.7/01), which runs long before the Gate. Kept
   * separate from `behavioralExecution` precisely so a run that froze intent and then failed
   * still reports the generation work it did rather than looking like a run that never
   * reached the tier at all.
   */
  behavioralFreeze?: readonly BehavioralTestActionReport[];
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

// The terminal shapes the stage vector is read for: an activated build, a
// failure, a cancellation, and the measured no-op (decision 37) whose downstream
// stages are all skipped exactly like a never-activated build.
type LifecycleTerminal = "activated" | "failed" | "cancelled" | "no_change";

function activationStageState(
  acc: DemoBuildAccumulator,
  terminal: LifecycleTerminal,
): GenerationStageMeasurement["state"] {
  return terminal === "activated" || acc.activationAttempted ? "executed" : "skipped";
}

function behavioralTestGenerationStageState(
  acc: DemoBuildAccumulator,
  behavioralSeen: boolean,
  failure: GenerationFailure | undefined,
): GenerationStageMeasurement["state"] {
  // Read off the freeze stage's own report, not the Gate's — the freeze is what authored or
  // carried these bytes, and it happened before any Handler existed. A run that froze intent
  // and then failed still says so, instead of collapsing into the tier-off reading.
  if (acc.behavioralFreeze) {
    // "generated" would be a lie for an evolution whose every Action carried its prior suite
    // forward on unchanged inputs — copy is a claim about bytes here exactly as for units.
    return acc.behavioralFreeze.every((entry) => entry.status === "carried")
      ? "copied"
      : "generated";
  }
  if (failure?.stage === "behavioral_test_generation") return "executed";
  // `absent` is the tier saying there was nothing to author (decision 24's tier-off rows);
  // `skipped` is a run that never reached the tier at all.
  return behavioralSeen ? "absent" : "skipped";
}

function behavioralTestExecutionStageState(
  acc: DemoBuildAccumulator,
  behavioralSeen: boolean,
): GenerationStageMeasurement["state"] {
  // Failure evidence carries the last execution plan even though the rung never returned a
  // successful `testRun` timing. Read the plan first so a failed frozen assertion is not
  // mislabeled as an absent tier.
  if (acc.behavioralExecution) {
    return acc.behavioralExecution.every((entry) => entry.execution === "skipped")
      ? "skipped"
      : "executed";
  }
  if (acc.timings.testRunMs === undefined) return behavioralSeen ? "absent" : "skipped";
  // A tier-on run whose every frozen suite was skipped executed no test at all. Decision 23
  // makes that a legitimate outcome — not a missing measurement — so it is reported as the
  // skip it is rather than as an execution that happened to take no time.
  return "executed";
}

/**
 * The per-Action behavioral test rows (4.7/02). Two subjects per Action: what this build did
 * about the *intent* (generated it, or copied the prior frozen bytes), and what it did about
 * the *code* (executed that suite, or skipped it because nothing it covers moved).
 */
function behavioralTestStages(acc: DemoBuildAccumulator): readonly GenerationStageMeasurement[] {
  return (acc.behavioralExecution ?? []).flatMap((entry) => [
    {
      stage: "behavioral_test_generation",
      state: entry.source === "generated" ? ("generated" as const) : ("copied" as const),
      test: { kind: "behavioral-suite", name: entry.action },
    },
    {
      stage: "behavioral_test_execution",
      state: entry.execution === "executed" ? ("executed" as const) : ("skipped" as const),
      test: { kind: "behavioral-suite", name: entry.action },
    },
  ]);
}

/** A complete semantic state vector; later evolution can mark individual entries copied. */
export function lifecycleStages(
  acc: DemoBuildAccumulator,
  terminal: LifecycleTerminal,
  failure?: GenerationFailure,
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
      state: acc.copiedUnits?.has(unit.name)
        ? ("copied" as const)
        : generatedUnits.has(`${unit.kind}:${unit.name}`)
          ? ("generated" as const)
          : ("skipped" as const),
      unit,
    })),
    {
      stage: "behavioral_test_generation",
      state: behavioralTestGenerationStageState(acc, behavioralSeen, failure),
    },
    {
      stage: "behavioral_test_execution",
      state: behavioralTestExecutionStageState(acc, behavioralSeen),
    },
    ...behavioralTestStages(acc),
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

/**
 * Finalize a measured no-op (decision 37). The candidate was authored and totally
 * validated, then the Diff Engine found zero change facts — so the run's already-running
 * lifecycle row resolves straight to `success/no_change` with every downstream stage
 * skipped. Spec generation is `generated` (the candidate was authored); nothing after
 * the Diff ran, so no DDL, unit, gate, or publication work is recorded. The generation's
 * duration and token usage are the only real measurement.
 */
export function finalizeMeasuredNoChange(
  recordMetrics: RecordMetrics,
  input: {
    readonly buildId: string;
    readonly incarnationId: string;
    readonly durationMs: number;
    readonly usage: TokenUsage;
    /** When the run opened its durable row, so `totalMs` is the real elapsed time. */
    readonly builtAt: number;
  },
): void {
  const acc: DemoBuildAccumulator = {
    usages: [input.usage],
    timings: { specGenMs: input.durationMs },
  };
  recordMetrics.succeed({
    buildId: input.buildId,
    incarnationId: input.incarnationId,
    outcome: "no_change",
    stages: lifecycleStages(acc, "no_change"),
    measurement: lifecycleMeasurement(acc, input.builtAt),
  });
}

export function lifecycleFailureOutcome(failure: GenerationFailure): GenerationFailureOutcome {
  switch (failure.stage) {
    case "spec_gen":
      return "spec_generation_failed";
    case "migration":
      return "migration_failed";
    case "unit_generation":
      return "unit_generation_failed";
    case "behavioral_test_generation":
      // Preserve the durable terminal vocabulary and SQLite CHECK established by 0008.
      // The measurement's exact stage distinguishes this pre-Gate tier failure, while the
      // coarse terminal outcome remains the behavioral experiment's existing bucket.
      return "gate_failed";
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
  // Freezing happens before either Handler generation or the Gate (4.7/01). Name that real
  // stage instead of fabricating a failed behavioral rung that never entered the inventory.
  if (error instanceof BehavioralTestGenerationError) {
    return { stage: "behavioral_test_generation", message };
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
    // Only the *run* half is the Gate's to report. Generation's timing and tokens were
    // recorded by `recordBehavioralFreezeMetrics` when the freeze happened, so they survive a
    // build that never reaches this line — and are not counted twice when it does.
    acc.timings.testRunMs = gateResult.behavioral.testRun.durationMs;
    acc.behavioralExecution = gateResult.behavioral.execution.actions;
  }
  acc.usages.push(gateResult.smoke.usage);
  acc.usages.push(gateResult.designLint.usage);
  if (gateResult.behavioral.tier === "on") {
    acc.usages.push(gateResult.behavioral.repair.usage);
  }
}

/**
 * Preserve the work a thrown Gate completed before its verdict. Successful and failed runs
 * use the same accounting boundary: initial unit usage is recorded before the Gate, then
 * provider-backed rung usage is added once here (or by `recordGateMetrics` on success).
 */
export function recordGateFailureMetrics(
  acc: DemoBuildAccumulator,
  error: CapabilityGateError,
): void {
  acc.gateRungs = error.outcomes;
  const measurement = error.measurement;
  if (!measurement) return;

  acc.usages.push(measurement.smokeUsage);
  acc.usages.push(measurement.designLintUsage);
  const behavioral = measurement.behavioral;
  if (!behavioral) return;

  acc.behavioralExecution = behavioral.execution.actions;
  acc.usages.push(behavioral.usage);
  mergeBehavioralGenerationAttempts(acc, behavioral.generations);
}

function mergeBehavioralGenerationAttempts(
  acc: DemoBuildAccumulator,
  generations: readonly BehavioralHandlerGenerationAttempt[],
): void {
  if (!acc.unitAttempts) return;
  const byName = new Map(acc.unitAttempts.map((unit) => [unit.name, unit]));
  for (const generation of generations) {
    const prior = byName.get(generation.action);
    if (!prior) continue;
    byName.set(generation.action, {
      ...prior,
      attempts: prior.attempts + 1,
      durationMs: prior.durationMs + generation.durationMs,
      usage: addMetricsUsage(prior.usage, generation.usage),
    });
  }
  acc.unitAttempts = acc.unitAttempts.map((unit) => byName.get(unit.name) ?? unit);
}

function addMetricsUsage(
  left: UnitAttemptSummary["usage"],
  right: TokenUsage | undefined,
): UnitAttemptSummary["usage"] {
  if (!right) return left;
  return {
    inputTokens: addOptionalMetric(left.inputTokens, right.inputTokens),
    outputTokens: addOptionalMetric(left.outputTokens, right.outputTokens),
    totalTokens: addOptionalMetric(left.totalTokens, right.totalTokens),
  };
}

function addOptionalMetric(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  return left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);
}

/**
 * Record the behavioral tier's *generation* leg the moment the suite is frozen (4.7/01),
 * which is before the first Handler byte and long before the Gate. The measured cost of
 * authoring tests is what M8 weighs the tier against the no-test baseline with; recording it
 * only on a successful Gate would attribute the spend of every failed tier-on build to
 * nothing, and would leave the stage vector unable to tell a tier-on run that froze five
 * suites and then failed from a run that never turned the tier on.
 */
export function recordBehavioralFreezeMetrics(
  acc: DemoBuildAccumulator,
  frozen: FrozenBehavioralTestsResult,
): void {
  acc.timings.testGenMs = frozen.durationMs;
  acc.behavioralFreeze = frozen.report;
  acc.usages.push(frozen.usage);
}
