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
  GATE_RUNG_ORDER,
  type GateRungOutcome,
  type GeneratedUnit,
  SnapshotVerificationError,
  UnitGenerationError,
} from "../builder/index.ts";
import { errorDetail, errorMessage } from "../platform/errors.ts";
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
  IntentResolutionMetrics,
  QuestionCost,
  StartGenerationLifecycleInput,
  StoredGenerationLifecycle,
  UnitAttemptSummary,
  WriteStaleGenerationAdmissionInput,
} from "../platform/metrics/index.ts";
import {
  finalizeGenerationLifecycleFailure,
  finalizeGenerationLifecycleSuccess,
  getGenerationLifecycle,
  startGenerationLifecycle,
  updateGenerationLifecycleIdentity,
  writeGenerationMetrics,
  writeIntentResolutionMetrics,
  writeStaleGenerationAdmission,
} from "../platform/metrics/index.ts";
import type { TokenUsage } from "../platform/provider/index.ts";
import { resolveModel } from "../platform/provider/index.ts";
import { addTokenUsage, sumTokenUsages } from "../platform/provider/usage.ts";
import type { MutationCoordinator } from "../runtime/concurrency/mutation-coordinator.ts";
import type { IntentClassification } from "./intent/index.ts";

/**
 * How the app persists a generation-metrics row. Injected via `AppDeps.recordMetrics`, so the
 * real writer rides the read-write connection while tests pass a capturing stub.
 */
export interface RecordMetrics {
  /** Legacy best-effort resolution-only measurement writer. */
  (metrics: GenerationMetrics): void;
  readonly resolve: (metrics: IntentResolutionMetrics) => void;
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
  /**
   * The one row written terminal on its first write: a lease-head stale refusal, which
   * never opens `running` because no Builder provider work starts.
   */
  readonly refuseStale: (input: WriteStaleGenerationAdmissionInput) => GenerationLifecycle;
  readonly get: (buildId: string, incarnationId: string | null) => StoredGenerationLifecycle | null;
}

/** Bind lifecycle operations to one write connection. Success joins the caller's transaction. */
export function createMetricsRecorder(database: Database): RecordMetrics {
  const legacy = (metrics: GenerationMetrics) => void writeGenerationMetrics(metrics, database);
  return Object.assign(legacy, {
    resolve: (metrics: IntentResolutionMetrics) =>
      void writeIntentResolutionMetrics(metrics, database),
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
    refuseStale: (input: WriteStaleGenerationAdmissionInput) =>
      writeStaleGenerationAdmission(input, database),
    get: (buildId: string, incarnationId: string | null) =>
      getGenerationLifecycle(buildId, incarnationId, database),
  });
}

/**
 * The build measurements the stages fill in as they land, in one mutable accumulator: the row is
 * written from it at the end, complete on success or up to the failing rung on failure.
 */
export interface DemoBuildAccumulator {
  readonly usages: TokenUsage[];
  readonly timings: GenerationTimings;
  capabilityId?: string;
  incarnationId?: string;
  gateRungs?: readonly GateRungOutcome[];
  unitAttempts?: UnitAttemptSummary[];
  /**
   * The units an evolution byte-copied from the committed snapshot. They carry unit attempts like
   * any other, but were never generated, and the stage vector says so (decision 21).
   */
  copiedUnits?: ReadonlySet<string>;
  /**
   * Per Action, whether this build generated or copied that frozen suite and whether it ran it.
   * Generation and execution are separate decisions, so the stage vector keeps them separate.
   */
  behavioralExecution?: readonly BehavioralActionExecution[];
  /**
   * Per Action, whether this build authored that suite or carried prior frozen bytes, recorded by
   * the freeze stage. Separate from `behavioralExecution` so a run that froze and failed says so.
   */
  behavioralFreeze?: readonly BehavioralTestActionReport[];
  publicationAttempted?: boolean;
  activationAttempted?: boolean;
}

/**
 * A question's one durable row. `target_capability` is free text the model chose, and this is the
 * only field of it that is written down — so a target naming nothing in the catalog is carried as
 * none rather than persisted verbatim. The extend path already refuses such a target outright;
 * `data_query` and `reject` never looked, and a question may leave behind no words of its own.
 */
export function carriedResolverMeasurement(
  intent: IntentClassification,
  usage: TokenUsage,
  durationMs: number,
  catalogFingerprint: string,
  known: readonly string[],
): CarriedResolverMeasurement & { readonly usage: TokenUsage } {
  const target = intent.target_capability;
  return {
    intent: {
      type: intent.type,
      confidence: intent.confidence,
      targetCapability: target !== null && known.includes(target) ? target : null,
    },
    model: resolveModel(),
    durationMs,
    usage,
    catalogFingerprint,
    overlapResolution: intent.resolution,
  };
}

/**
 * What one question cost (PLAN decision 33, ADR-0008). The clock is read here because decision
 * 9's sweep (`../runtime/query/question-loop.test.ts`) refuses one on the query path. A reading
 * the row could not hold is dropped rather than carried: the cost is an addition to a row that
 * lands without it, and a broken clock may not take the resolver measurement down with it.
 */
export function questionCost(askedAt: number, stepsTaken: number): QuestionCost | undefined {
  const elapsedMs = Math.round(performance.now() - askedAt);
  return Number.isSafeInteger(elapsedMs) && elapsedMs >= 0 ? { stepsTaken, elapsedMs } : undefined;
}

export function lifecycleMeasurement(
  acc: DemoBuildAccumulator,
  builtAt: number,
  failure?: GenerationFailure,
): GenerationBuildMeasurement {
  return {
    model: resolveModel(),
    usage: sumTokenUsages(acc.usages),
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

// The terminal shapes the stage vector is read for. The measured no-op skips every downstream
// stage exactly like a never-activated build.
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
  // The freeze stage's report, not the Gate's: the freeze authored or carried these bytes before
  // any Handler existed, so a run that froze and then failed does not read as tier-off.
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
  // Failure evidence carries the last execution plan though the rung returned no `testRun` timing.
  // Read the plan first, so a failed frozen assertion is not mislabeled as an absent tier.
  if (acc.behavioralExecution) {
    return acc.behavioralExecution.every((entry) => entry.execution === "skipped")
      ? "skipped"
      : "executed";
  }
  if (acc.timings.testRunMs === undefined) return behavioralSeen ? "absent" : "skipped";
  // A tier-on run whose every frozen suite was skipped executed no test. Decision 23 makes that a
  // legitimate outcome, reported as a skip rather than an execution that took no time.
  return "executed";
}

/**
 * The per-Action behavioral test rows, two subjects each: what this build did about the *intent*
 * (generated or copied it), and about the *code* (executed the suite, or skipped an unmoved one).
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
    ...GATE_RUNG_ORDER.map((name) => ({
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
 * Finalizes a measured no-op: the candidate was authored and validated, the Diff Engine found
 * zero change facts, so spec generation is `generated` and nothing after the Diff is recorded.
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

/**
 * The stale refusal's stage vector: every generation stage skipped, because the request was
 * refused at the head of the lease and, unlike a failed build, nothing was even attempted.
 */
export function staleAdmissionStages(): readonly GenerationStageMeasurement[] {
  return lifecycleStages({ usages: [], timings: {} }, "failed");
}

/**
 * The stale refusal's measurement. `totalMs` is the caller's whole clock, so for `/prompt` it
 * spans classification and the queue wait, not just the pause at the lease head.
 */
export function staleAdmissionMeasurement(builtAt: number): GenerationBuildMeasurement {
  return {
    // `model` names the model this build would have run on; usage is absent rather than zero,
    // since the Builder called no provider and the resolver's spend rides its own measurement.
    model: resolveModel(),
    timings: { totalMs: performance.now() - builtAt },
  };
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
      // Keeps the durable vocabulary and SQLite CHECK from 0008: the measurement's stage marks
      // this pre-Gate tier failure, while the coarse outcome stays the existing bucket.
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
 * Write the resolver-only metrics row: the one a prompt leaves when nothing was built. A refusal
 * and a deflection leave it because the platform does not act on them; a question leaves it
 * because answering one builds nothing (ARCH §9.6). Best-effort in every case.
 */
export function writeResolverOnlyMetrics(
  recordMetrics: RecordMetrics,
  metrics: IntentResolutionMetrics,
): void {
  try {
    recordMetrics.resolve(metrics);
  } catch (metricsError) {
    console.error("Aluna build job: metrics write failed:", errorDetail(metricsError));
  }
}

/**
 * Queue that row behind the platform's write lease and never wait for it. Both non-build prompt
 * paths leave the same one, so the fire-and-forget shape and the sentence it logs live here.
 * `row` is called *inside* the write, so a shape the schema refuses is lost as quietly as a write
 * that failed — and nothing is awaited, because a question calls this from a `finally` over an
 * answer already delivered and a throw there would take the delivery down with it.
 */
export function rememberResolverRow(
  mutationCoordinator: MutationCoordinator,
  recordMetrics: RecordMetrics,
  row: () => IntentResolutionMetrics,
): void {
  void mutationCoordinator
    .withPlatformWrite(() => writeResolverOnlyMetrics(recordMetrics, row()))
    .catch((error) => {
      console.error("Aluna resolver metrics write did not complete:", errorDetail(error));
    });
}

function specGenerationIncomplete(acc: DemoBuildAccumulator): boolean {
  return acc.timings.specGenMs === undefined || acc.capabilityId === undefined;
}

/**
 * Names the stage (and, for the gate, the rung) a failed build stopped at. The structured errors
 * carry the location; spec-gen, migration and commit throw without one, so those are inferred.
 */
export function classifyBuildFailure(error: unknown, acc: DemoBuildAccumulator): GenerationFailure {
  const message = errorMessage(error);
  if (error instanceof CapabilityGateError) {
    return { stage: "gate", rung: error.failedRung, message };
  }
  // Freezing happens before either Handler generation or the Gate. Name that real
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
  if (specGenerationIncomplete(acc)) return { stage: "spec_gen", message };
  if (timings.migrationMs === undefined) return { stage: "migration", message };
  if (timings.codeGenMs === undefined || timings.presentationGenMs === undefined) {
    return { stage: "unit_generation", message };
  }
  if (acc.gateRungs === undefined) return { stage: "gate", message };
  // Rungs recorded means the gate passed, so the only stage left to have thrown is the commit.
  return { stage: "commit", message };
}

/**
 * Records the unit-generation legs: code-gen (handlers) and presentation-gen wall time — the item
 * renderer succeeds M2's html-gen (ADR-0005) — plus per-unit fix attempts and token usage.
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
 * Records the gate legs: per-rung outcomes, the behavioral tier's test-gen and test-run timings
 * and usage (the columns M8 weighs the tier with), and the design-lint rung's repair tokens.
 */
export function recordGateMetrics(
  acc: DemoBuildAccumulator,
  gateResult: CapabilityGateResult,
): void {
  acc.gateRungs = gateResult.outcomes;
  if (gateResult.behavioral.tier === "on") {
    // Only the *run* half is the Gate's. `recordBehavioralFreezeMetrics` already took generation's
    // timing and tokens, so they survive a build that stops earlier and are not counted twice.
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
 * Preserves the work a thrown Gate completed. Same accounting boundary as success: unit usage is
 * recorded before the Gate, rung usage added once here or by `recordGateMetrics`.
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
  return right ? addTokenUsage(left, right) : left;
}

/**
 * Records the tier's *generation* leg the moment the suite is frozen, before the first Handler
 * byte. Recording it on a successful Gate only would lose every failed tier-on build's spend.
 */
export function recordBehavioralFreezeMetrics(
  acc: DemoBuildAccumulator,
  frozen: FrozenBehavioralTestsResult,
): void {
  acc.timings.testGenMs = frozen.durationMs;
  acc.behavioralFreeze = frozen.report;
  acc.usages.push(frozen.usage);
}
