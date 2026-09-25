// Layered build gate (PLAN flow step 6, ADR-0004).
//
// The gate is a final verdict, distinct from the unit-generation fix loop. It runs
// always-on rungs in order: structural checks first (`gate-structural.ts`), then a
// scratch-database smoke round-trip (`gate-smoke.ts`), then the opt-in behavioral
// tier (`gate-behavioral.ts`). This file owns the public contract — the rung result
// shapes, the gate input/output, and the gate error — plus the orchestration that
// runs the rungs in order and records their outcomes. The cross-rung mechanics live
// in `gate-internal.ts`.

import type { Database } from "bun:sqlite";
import type { GateRungName, GateRungStatus } from "../../platform/gate-rungs.ts";
import type { Provider, TokenUsage } from "../../platform/provider/index.ts";
import { addTokenUsage, ZERO_TOKEN_USAGE } from "../../platform/provider/usage.ts";
import type { CapabilitySpec, CapabilityTool } from "../../registry/index.ts";
import type { CapabilityTableDdl } from "../../runtime/data/index.ts";
import type { HandlerUnitName } from "../units/generation/units.ts";
import {
  CapabilityGateError,
  type CapabilityGateFailureMeasurement,
} from "./capability-gate-error.ts";
import { rerunPassedGateRung, runGateRung, skipGateRung } from "./gate-rung-runner.ts";
import type {
  BehavioralExecutionImpact,
  BehavioralExecutionPlan,
} from "./rungs/behavioral/freeze/behavioral-execution-plan.ts";
import { BehavioralRungFailure, runBehavioralRung } from "./rungs/behavioral/gate-behavioral.ts";
import type { FrozenBehavioralTests } from "./rungs/behavioral/generation/gate-behavioral-full-schema.ts";
import type {
  BehavioralFailureAttribution,
  BehavioralFailureSurface,
} from "./rungs/behavioral/repair/behavioral-failure-attribution.ts";
import { DesignLintRungError, runDesignLintRung } from "./rungs/design-lint/gate-design-lint.ts";
import { runSmokeRung } from "./rungs/smoke/gate-smoke.ts";
import { SmokeRungFailure, type SmokeRungRun } from "./rungs/smoke/gate-smoke-repair.ts";
import {
  runStructuralRung,
  type StructuralGateResult,
} from "./rungs/structural/gate-structural.ts";

export const BEHAVIORAL_TIER_ENV_VAR = "OMNI_BEHAVIORAL_TIER";

const BEHAVIORAL_TIER_ON_VALUES = new Set(["1", "true", "on", "yes"]);
const BEHAVIORAL_TIER_OFF_VALUES = new Set(["0", "false", "off", "no"]);

export {
  GATE_RUNG_ORDER,
  GATE_RUNG_STATUSES,
  type GateRungName,
  type GateRungStatus,
} from "../../platform/gate-rungs.ts";

export interface GateRungOutcome {
  readonly rung: GateRungName;
  readonly status: GateRungStatus;
  readonly durationMs: number;
  readonly error?: string;
  readonly reason?: string;
}

export interface SmokeGateResult {
  readonly tableName: string;
  readonly rowCount: number;
  readonly insertedRowId: string;
  readonly createFragmentLength: number;
  readonly readFragmentLength: number;
  readonly updateFragmentLength?: number;
  readonly searchCaseCount?: number;
  readonly deleteFragmentLength?: number;
  readonly fixed: boolean;
  readonly attempts: readonly SmokeGateAttempt[];
  readonly usage: TokenUsage;
  readonly realDatabaseUnchanged?: boolean;
}

export interface SmokeGateAttempt {
  readonly attempt: number;
  readonly action?: HandlerUnitName;
  readonly repairAction?: HandlerUnitName;
  readonly durationMs: number;
  readonly repairDurationMs?: number;
  readonly usage?: TokenUsage;
  readonly error?: string;
}

export interface BehavioralTierInput {
  readonly enabled?: boolean;
  /**
   * The suite frozen before any Handler generation or repair.
   * Required when the tier is on: the Gate executes behavioral intent, it never authors it.
   */
  readonly frozen?: FrozenBehavioralTestsInput;
  /**
   * Which Handlers this build authored rather than copied, with the Gate's own repairs
   * folded in. Omitted, nothing is provably unaffected and the complete frozen suite runs.
   */
  readonly impact?: BehavioralExecutionImpact;
  /**
   * Overrides the rung's bounded repair budget. Defaults to `DEFAULT_UNIT_FIX_ATTEMPTS`,
   * the same knob generation, design lint, and smoke spend — one execution, one repair.
   */
  readonly maxAttempts?: number;
}

export interface FrozenBehavioralTestsInput {
  readonly frozenTests: FrozenBehavioralTests;
  readonly generation: BehavioralTestGenerationMetrics;
}

export interface BehavioralTestGenerationMetrics {
  readonly outcome: "passed";
  readonly durationMs: number;
  readonly usage: TokenUsage;
  readonly testCount: number;
  /** Actions whose tests this build authored — their total inputs changed (or are new). */
  readonly generatedActions: readonly CapabilityTool[];
  /** Actions whose prior frozen tests carried forward byte-for-byte on unchanged inputs. */
  readonly carriedActions: readonly CapabilityTool[];
}

export interface BehavioralTestCaseOutcome {
  readonly action?: HandlerUnitName;
  readonly name: string;
  readonly status: "passed";
  readonly durationMs: number;
}

export interface BehavioralTestRunMetrics {
  readonly outcome: "passed";
  readonly durationMs: number;
  readonly cases: readonly BehavioralTestCaseOutcome[];
}

/**
 * One turn of the behavioral rung's bounded repair loop. `failure` and `attribution` are
 * present exactly on a turn whose run failed, `repairs` and `usage` on one that then paid.
 */
export interface BehavioralRepairAttempt {
  readonly attempt: number;
  readonly durationMs: number;
  readonly failure?: {
    readonly action: HandlerUnitName;
    readonly testName: string;
    readonly surface: BehavioralFailureSurface;
    readonly message: string;
  };
  /** Whose fault the failing frozen case was, and on what grounds (total, or conservative). */
  readonly attribution?: BehavioralFailureAttribution;
  /**
   * The Handlers this turn rewrote, each with its own cost. A conservative round rewrites
   * several, so charging each the whole round's tokens inflates accounting by that set size.
   */
  readonly repairs?: readonly BehavioralHandlerRepair[];
  /**
   * Every provider generation this turn started, rejected output included. Unlike `repairs`:
   * a structural rejection, byte-identical answer, or provider error changed no Handler byte.
   */
  readonly generations?: readonly BehavioralHandlerGenerationAttempt[];
  /** The whole round's wall time and provider cost, repaired and rejected units alike. */
  readonly repairDurationMs?: number;
  readonly usage?: TokenUsage;
  readonly error?: string;
}

export interface BehavioralHandlerGenerationAttempt {
  readonly action: HandlerUnitName;
  /** Per-Handler repair generation number, independent of the suite's global turn number. */
  readonly attempt: number;
  readonly durationMs: number;
  readonly outcome: "repaired" | "structural_rejected" | "byte_identical" | "provider_error";
  readonly usage?: TokenUsage;
  readonly error?: string;
}

export interface BehavioralHandlerRepair {
  readonly action: HandlerUnitName;
  readonly durationMs: number;
  readonly usage: TokenUsage;
}

/**
 * What the bounded repair loop spent to clear the rung. `fixed` is false on the ordinary
 * path — the frozen suite passed the first time and no Handler byte moved here.
 */
export interface BehavioralRepairResult {
  readonly fixed: boolean;
  readonly repairedHandlers: readonly HandlerUnitName[];
  readonly attempts: readonly BehavioralRepairAttempt[];
  readonly usage: TokenUsage;
}

export type BehavioralGateResult =
  | {
      readonly tier: "on";
      readonly status: "passed";
      readonly testGen: BehavioralTestGenerationMetrics;
      readonly testRun: BehavioralTestRunMetrics;
      /**
       * Per Action: copied or generated, executed or skipped, and why — for the turn that
       * passed. The rung refuses to return unless every Handler it repaired ran here.
       */
      readonly execution: BehavioralExecutionPlan;
      readonly frozenTests: FrozenBehavioralTests;
      /** The bounded per-Handler repair record. */
      readonly repair: BehavioralRepairResult;
    }
  | {
      readonly tier: "off";
      readonly status: "skipped";
      readonly reason: string;
    };

/**
 * The design-lint knob. The bounded fix loop reuses M2's `DEFAULT_UNIT_FIX_ATTEMPTS`
 * (default 2) unless overridden here — the same reused knob, not a new one.
 */
export interface DesignLintTierInput {
  readonly maxAttempts?: number;
}

export interface SmokeGateInput {
  readonly maxAttempts?: number;
}

/**
 * One turn of the design-lint fix loop: the review (attempt 1), or a regeneration + review.
 * `usage` marks a regeneration turn; `error` is the failure fed forward, absent when passed.
 */
export interface DesignLintAttempt {
  readonly attempt: number;
  readonly durationMs: number;
  readonly usage?: TokenUsage;
  readonly error?: string;
}

/**
 * The rung's verdict, carrying the final item renderer — the original, or the one the fix
 * loop regenerated clean. The pipeline commits `itemRenderer`, so a fix reaches disk.
 */
export interface DesignLintGateResult {
  readonly status: "passed";
  readonly itemRenderer: string;
  readonly fixed: boolean;
  readonly attempts: readonly DesignLintAttempt[];
  readonly usage: TokenUsage;
}

export interface CapabilityGateInput {
  readonly spec: CapabilitySpec;
  // The migration stage owns DDL derivation. The gate applies that exact output to
  // scratch so smoke proves the build's own schema, not a separately-derived one.
  readonly ddl: CapabilityTableDdl;
  readonly handlers: Readonly<Partial<Record<HandlerUnitName, string>>>;
  // The structural rung type-checks it; smoke and behavioral bind it into the real
  // `present` adapter the handlers render through, so create and read cannot drift.
  readonly itemRenderer: string;
  // Design lint, smoke, and behavioral all repair through it. Behavioral never generates a
  // *test* through it: the suite was frozen before this Gate was called, and repair obeys it.
  readonly provider?: Provider;
  // Defaults from OMNI_BEHAVIORAL_TIER (ON), overridable here without touching process.env.
  // When on, it also carries the frozen suite the behavioral rung executes.
  readonly behavioralTier?: BehavioralTierInput;
  // Optional override for the design-lint rung's bounded fix loop (default
  // DEFAULT_UNIT_FIX_ATTEMPTS); tests set it to exercise fix-then-pass and cap exhaustion.
  readonly designLint?: DesignLintTierInput;
  // The same bounded unit-fix budget as generation and design lint. Attempt one runs the
  // supplied snapshot; later ones regenerate only the Handler the fixture attributes.
  readonly smoke?: SmokeGateInput;
  // Optional assertion hook for the real db: the gate snapshots capability tables
  // before and after smoke and fails if they changed.
  readonly realDatabase?: Database;
  // The full physical schema of every declared read dependency, applied to the Gate's fresh
  // in-memory catalog. Live registry rows and capability data never enter scratch.
  readonly scratchCatalog?: readonly ScratchCatalogCapability[];
}

export interface ScratchCatalogCapability {
  readonly spec: CapabilitySpec;
  readonly incarnationId: string;
}

export interface CapabilityGateResult {
  readonly outcomes: readonly GateRungOutcome[];
  readonly durationMs: number;
  readonly structural: StructuralGateResult;
  readonly smoke: SmokeGateResult;
  readonly behavioral: BehavioralGateResult;
  readonly designLint: DesignLintGateResult;
  readonly handlers: Readonly<Partial<Record<HandlerUnitName, string>>>;
}

/**
 * The seal on a verdict this Gate itself returned: the result's JSON as it was issued. Compared
 * on read, so a hand-built result and a rung outcome edited after the verdict both fail.
 */
const issuedGateEvidence = new WeakMap<CapabilityGateResult, string>();

/** Refuse caller-constructed or post-verdict-mutated Gate objects. */
export function assertIssuedCapabilityGateResult(result: CapabilityGateResult): void {
  const issued = issuedGateEvidence.get(result);
  if (issued === undefined || issued !== JSON.stringify(result)) {
    throw new Error("Capability publication requires immutable evidence issued by the Gate.");
  }
}

// Re-exported so `src/builder/index.ts` and the gate's own tests reach the behavioral
// prompt, freeze stage, and frozen-artifact shape without importing the rung files.
export {
  type ActionTestInputs,
  actionTestInputDigest,
  actionTestInputs,
  assertActionSuiteContract,
  assertFrozenTestsContract,
  type BehavioralActionExecution,
  type BehavioralExecutionImpact,
  type BehavioralExecutionPlan,
  type BehavioralExecutionPlanInput,
  type BehavioralExecutionReason,
  type BehavioralTestActionProgress,
  type BehavioralTestActionReport,
  type BehavioralTestFreezeProgress,
  BehavioralTestGenerationError,
  type BehavioralTestInputSummary,
  behavioralSuiteCoverage,
  buildBehavioralTestPrompt,
  type FreezeBehavioralTestsInput,
  type FrozenActionTests,
  type FrozenBehavioralTests,
  type FrozenBehavioralTestsResult,
  type FullBehavioralTestCase,
  freezeBehavioralTests,
  frozenBehavioralTestCases,
  frozenBehavioralTestsSchema,
  planBehavioralExecution,
  selectedBehavioralCases,
  specActionTestInputs,
} from "./rungs/behavioral/gate-behavioral.ts";
export { CapabilityGateError, type CapabilityGateFailureMeasurement };

/**
 * Run the layered Gate — structural, smoke, behavioral (when on), design lint — throwing
 * {@link CapabilityGateError} at the first failing rung. The caller supplies the frozen suite.
 */
export async function runCapabilityGate(input: CapabilityGateInput): Promise<CapabilityGateResult> {
  const startedAt = performance.now();
  const outcomes: GateRungOutcome[] = [];
  const behavioralTierEnabled = resolveBehavioralTierEnabledForInput(input);

  const structural = await runGateRung(outcomes, "structural", () => runStructuralRung(input));
  let smokeRun = await runGateRung(
    outcomes,
    "smoke",
    () => runSmokeRung(input),
    smokeFailureMeasurement,
  );
  let smoke = smokeRun.result;
  const repairedInput = { ...input, handlers: smokeRun.handlers };
  const skippedBehavioral = behavioralTierEnabled
    ? undefined
    : skipGateRung(outcomes, "behavioral", "Behavioral tier is off for this run.");
  const designLint = await runGateRung(
    outcomes,
    "design-lint",
    () => runDesignLintRung(repairedInput),
    (error) => ({
      smokeUsage: smoke.usage,
      designLintUsage:
        error instanceof DesignLintRungError ? error.measurement.usage : ZERO_TOKEN_USAGE,
    }),
  );

  if (designLint.fixed) {
    // Design lint's fix proved the new item.ts type-checks, not that it executes. Re-enter
    // smoke with no provider: a renderer fault must fail closed, not rewrite a good Handler.
    const finalRendererInput = {
      ...repairedInput,
      itemRenderer: designLint.itemRenderer,
      provider: undefined,
      smoke: { maxAttempts: 1 },
    };
    const finalSmokeRun = await revalidateDesignRepair(
      outcomes,
      finalRendererInput,
      smoke,
      designLint,
    );
    smoke = mergeSmokeResults(smoke, finalSmokeRun.result);
    smokeRun = { ...finalSmokeRun, result: smoke };
  }

  // The frozen suite runs once against the final renderer, losing nothing by running last —
  // it predates every Handler. Its outcome is spliced in first, restoring the public order.
  const designOutcome = outcomes.pop();
  if (designOutcome?.rung !== "design-lint") {
    throw new Error("Design-lint outcome was not recorded at the Gate boundary.");
  }
  const finalInput = {
    ...repairedInput,
    handlers: smokeRun.handlers,
    itemRenderer: designLint.itemRenderer,
    ...(input.behavioralTier
      ? { behavioralTier: withGateRepairImpact(input.behavioralTier, smoke, designLint) }
      : {}),
  };
  let phase: BehavioralPhaseResult;
  try {
    phase = await runBehavioralPhase(outcomes, finalInput, {
      structural,
      smoke,
      handlers: smokeRun.handlers,
      ...(skippedBehavioral ? { skipped: skippedBehavioral } : {}),
    });
  } catch (error) {
    rethrowBehavioralPhaseFailure(error, outcomes, designOutcome, smoke, designLint);
  }
  outcomes.push(designOutcome);

  const result: CapabilityGateResult = {
    outcomes,
    durationMs: performance.now() - startedAt,
    structural: phase.structural,
    smoke: phase.smoke,
    behavioral: phase.behavioral,
    designLint,
    handlers: phase.handlers,
  };
  issuedGateEvidence.set(result, JSON.stringify(result));
  return result;
}

async function revalidateDesignRepair(
  outcomes: GateRungOutcome[],
  input: CapabilityGateInput,
  smoke: SmokeGateResult,
  designLint: DesignLintGateResult,
): Promise<SmokeRungRun> {
  try {
    return await rerunPassedGateRung(outcomes, "smoke", () => runSmokeRung(input));
  } catch (error) {
    if (!(error instanceof CapabilityGateError)) throw error;
    throw new CapabilityGateError(error.failedRung, outcomes, error.cause, {
      smokeUsage: addTokenUsage(
        smoke.usage,
        error.cause instanceof SmokeRungFailure ? error.cause.measurement.usage : ZERO_TOKEN_USAGE,
      ),
      designLintUsage: designLint.usage,
    });
  }
}

function rethrowBehavioralPhaseFailure(
  error: unknown,
  outcomes: GateRungOutcome[],
  designOutcome: GateRungOutcome,
  smoke: SmokeGateResult,
  designLint: DesignLintGateResult,
): never {
  outcomes.push(designOutcome);
  if (!(error instanceof CapabilityGateError)) throw error;
  const behavioral =
    error.cause instanceof BehavioralRungFailure
      ? error.cause.measurement
      : error.measurement?.behavioral;
  if (!behavioral) throw error;
  throw new CapabilityGateError(error.failedRung, outcomes, error.cause, {
    smokeUsage: addTokenUsage(smoke.usage, error.measurement?.smokeUsage ?? ZERO_TOKEN_USAGE),
    designLintUsage: addTokenUsage(
      designLint.usage,
      error.measurement?.designLintUsage ?? ZERO_TOKEN_USAGE,
    ),
    behavioral,
  });
}

interface BehavioralPhaseResult {
  readonly behavioral: BehavioralGateResult;
  readonly structural: StructuralGateResult;
  readonly smoke: SmokeGateResult;
  readonly handlers: Readonly<Partial<Record<HandlerUnitName, string>>>;
}

interface BehavioralPhaseInput {
  readonly structural: StructuralGateResult;
  readonly smoke: SmokeGateResult;
  readonly handlers: Readonly<Partial<Record<HandlerUnitName, string>>>;
  /** The recorded skip when the tier is off; its presence *is* the tier verdict. */
  readonly skipped?: BehavioralGateResult;
}

/**
 * Run the behavioral tier over the final snapshot. Repaired bytes satisfy the frozen suite
 * but no always-on rung, so they re-enter structural and smoke with no provider to rewrite.
 */
async function runBehavioralPhase(
  outcomes: GateRungOutcome[],
  finalInput: CapabilityGateInput,
  prior: BehavioralPhaseInput,
): Promise<BehavioralPhaseResult> {
  if (prior.skipped) {
    return {
      behavioral: prior.skipped,
      structural: prior.structural,
      smoke: prior.smoke,
      handlers: prior.handlers,
    };
  }
  const run = await runGateRung(outcomes, "behavioral", () => runBehavioralRung(finalInput));
  if (run.result.tier !== "on" || !run.result.repair.fixed) {
    return {
      behavioral: run.result,
      structural: prior.structural,
      smoke: prior.smoke,
      handlers: run.handlers,
    };
  }
  const repairedInput = {
    ...finalInput,
    handlers: run.handlers,
    provider: undefined,
    smoke: { maxAttempts: 1 },
  };
  try {
    const structural = await rerunPassedGateRung(outcomes, "structural", () =>
      runStructuralRung(repairedInput),
    );
    const smokeRun = await rerunPassedGateRung(outcomes, "smoke", () =>
      runSmokeRung(repairedInput),
    );
    return {
      behavioral: run.result,
      structural,
      smoke: mergeSmokeResults(prior.smoke, smokeRun.result),
      handlers: run.handlers,
    };
  } catch (error) {
    if (!(error instanceof CapabilityGateError)) throw error;
    // Repair tokens are spent even when the repaired bytes fail revalidation, so carry them
    // through the later rung's error; the Gate boundary adds smoke and design measurements.
    throw new CapabilityGateError(error.failedRung, outcomes, error.cause, {
      smokeUsage:
        error.cause instanceof SmokeRungFailure
          ? error.cause.measurement.usage
          : (error.measurement?.smokeUsage ?? ZERO_TOKEN_USAGE),
      designLintUsage: error.measurement?.designLintUsage ?? ZERO_TOKEN_USAGE,
      behavioral: {
        execution: run.result.execution,
        durationMs: run.result.repair.attempts.reduce(
          (sum, attempt) => sum + attempt.durationMs,
          0,
        ),
        attempts: run.result.repair.attempts,
        generations: run.result.repair.attempts.flatMap((attempt) => attempt.generations ?? []),
        usage: run.result.repair.usage,
      },
    });
  }
}

/**
 * Fold the Gate's own repairs into the caller's impact statement: smoke and design lint
 * rewrite bytes after the plan was made. A caller that stated no impact stays unstated.
 */
function withGateRepairImpact(
  tier: BehavioralTierInput,
  smoke: SmokeGateResult,
  designLint: DesignLintGateResult,
): BehavioralTierInput {
  if (!tier.impact) return tier;
  const repaired = smoke.attempts.flatMap((attempt) =>
    attempt.repairAction ? [attempt.repairAction] : [],
  );
  if (repaired.length === 0 && !designLint.fixed) return tier;
  return {
    ...tier,
    impact: {
      ...tier.impact,
      regeneratedHandlers: [...new Set([...tier.impact.regeneratedHandlers, ...repaired])],
      regeneratedItemRenderer: (tier.impact.regeneratedItemRenderer ?? false) || designLint.fixed,
      ...(designLint.fixed
        ? {
            unnarrowableReason:
              tier.impact.unnarrowableReason ??
              "design lint repaired the shared item renderer, so its final bytes must re-prove every frozen fragment assertion",
          }
        : {}),
    },
  };
}

/** Fold both smoke executions into one public result. The final run owns the observable
 * fixture values; attempts and provider cost cover both, keeping repair accounting honest. */
function mergeSmokeResults(original: SmokeGateResult, final: SmokeGateResult): SmokeGateResult {
  const attemptOffset = original.attempts.length;
  return {
    ...final,
    fixed: original.fixed || final.fixed,
    attempts: [
      ...original.attempts,
      ...final.attempts.map((attempt) => ({
        ...attempt,
        attempt: attempt.attempt + attemptOffset,
      })),
    ],
    usage: addTokenUsage(original.usage, final.usage),
  };
}

/**
 * Resolve whether the behavioral tier is enabled from `OMNI_BEHAVIORAL_TIER`
 * (default ON). Throws on an unrecognized value rather than silently defaulting.
 */
export function resolveBehavioralTierEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[BEHAVIORAL_TIER_ENV_VAR]?.trim().toLowerCase();
  if (!raw) return true;
  if (BEHAVIORAL_TIER_ON_VALUES.has(raw)) return true;
  if (BEHAVIORAL_TIER_OFF_VALUES.has(raw)) return false;

  throw new Error(`${BEHAVIORAL_TIER_ENV_VAR} must be one of on/off, true/false, yes/no, or 1/0.`);
}

function smokeFailureMeasurement(error: unknown): CapabilityGateFailureMeasurement {
  return {
    smokeUsage: error instanceof SmokeRungFailure ? error.measurement.usage : ZERO_TOKEN_USAGE,
    designLintUsage: ZERO_TOKEN_USAGE,
  };
}

function resolveBehavioralTierEnabledForInput(input: CapabilityGateInput): boolean {
  const enabled = input.behavioralTier?.enabled ?? resolveBehavioralTierEnabled();
  if (!enabled && input.behavioralTier?.frozen) {
    throw new Error(
      "Frozen behavioral tests were supplied while the behavioral tier is off; refusing to discard frozen intent.",
    );
  }
  return enabled;
}
