// Layered build gate — Module 2, Epic 2.5 (PLAN flow step 6, ADR-0004).
//
// The gate is a final verdict, distinct from the unit-generation fix loop. It runs
// always-on rungs in order: structural checks first (`gate-structural.ts`), then a
// scratch-database smoke round-trip (`gate-smoke.ts`), then the opt-in behavioral
// tier (`gate-behavioral.ts`). This file owns the public contract — the rung result
// shapes, the gate input/output, and the gate error — plus the orchestration that
// runs the rungs in order and records their outcomes. The cross-rung mechanics live
// in `gate-internal.ts`.

import type { Database } from "bun:sqlite";

import type { CapabilityCreateValues, CapabilityTableDdl } from "../capability-data/index.ts";
import type { Provider, TokenUsage } from "../provider/index.ts";
import type { CapabilitySpec } from "../registry/index.ts";
import { runBehavioralRung } from "./gate-behavioral.ts";
import { runDesignLintRung } from "./gate-design-lint.ts";
import { diagnosticForError, errorMessage } from "./gate-internal.ts";
import { runSmokeRung } from "./gate-smoke.ts";
import { runStructuralRung, type StructuralGateResult } from "./gate-structural.ts";
import type { HandlerUnitName } from "./units.ts";

export const BEHAVIORAL_TIER_ENV_VAR = "OMNI_BEHAVIORAL_TIER";

const GATE_RUNG_ORDER = ["structural", "smoke", "behavioral", "design-lint"] as const;
const BEHAVIORAL_TIER_ON_VALUES = new Set(["1", "true", "on", "yes"]);
const BEHAVIORAL_TIER_OFF_VALUES = new Set(["0", "false", "off", "no"]);

export type GateRungName = (typeof GATE_RUNG_ORDER)[number];
export type GateRungStatus = "passed" | "failed" | "skipped";

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
}

export interface BehavioralTestGenerationMetrics {
  readonly outcome: "passed";
  readonly durationMs: number;
  readonly usage: TokenUsage;
  readonly testCount: number;
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

export type BehavioralGateResult =
  | {
      readonly tier: "on";
      readonly status: "passed";
      readonly testGen: BehavioralTestGenerationMetrics;
      readonly testRun: BehavioralTestRunMetrics;
    }
  | {
      readonly tier: "off";
      readonly status: "skipped";
      readonly reason: string;
    };

// The design-lint knob. The bounded fix loop reuses M2's `DEFAULT_UNIT_FIX_ATTEMPTS`
// (default 2) unless overridden here — the same reused knob, not a new one.
export interface DesignLintTierInput {
  readonly maxAttempts?: number;
}

export interface SmokeGateInput {
  readonly maxAttempts?: number;
}

// One turn of the design-lint fix loop: the review (attempt 1) or a regeneration + review.
// `usage` is present only on a regeneration turn; `error` is the failure fed into the next
// attempt (absent on the turn that passed).
export interface DesignLintAttempt {
  readonly attempt: number;
  readonly durationMs: number;
  readonly usage?: TokenUsage;
  readonly error?: string;
}

// The design-lint rung's result: the final item renderer (the original, or the one the fix
// loop regenerated clean), whether a fix was needed, the per-attempt record, and the token
// usage any regeneration cost. The pipeline commits `itemRenderer`, so a fix reaches disk.
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
  // The build's generated item renderer (ADR-0005 §2). The structural rung type-checks
  // it and the smoke/behavioral rungs bind it into the real `present` adapter the
  // handlers render records through — so create and read cannot drift.
  readonly itemRenderer: string;
  // The behavioral tier generates tests from spec behavior + schema only; the
  // design-lint rung regenerates the item renderer through the provider when it rejects a
  // composition (its bounded fix loop). Required when the behavioral tier is on, and when
  // design-lint needs to fix a violation; unused when the tier is off and the renderer is
  // already clean.
  readonly provider?: Provider;
  // Global default comes from OMNI_BEHAVIORAL_TIER (default ON); tests and future
  // orchestration can override explicitly without mutating process.env.
  readonly behavioralTier?: BehavioralTierInput;
  // Optional override for the design-lint rung's bounded fix loop (default
  // DEFAULT_UNIT_FIX_ATTEMPTS); tests set it to exercise fix-then-pass and cap exhaustion.
  readonly designLint?: DesignLintTierInput;
  // The smoke rung reuses the same bounded unit-fix budget as generation/design lint.
  // Attempt one executes the supplied snapshot; later attempts regenerate only the
  // Handler attributed by the unchanged platform-owned fixture.
  readonly smoke?: SmokeGateInput;
  // Optional assertion hook for the real db: the gate snapshots capability tables
  // before and after smoke and fails if they changed.
  readonly realDatabase?: Database;
  // Synthetic schemas/rows for every externally declared read dependency. The
  // Gate derives their DDL and seeds them into its fresh in-memory catalog; live
  // registry rows or live capability data never enter scratch execution.
  readonly scratchCatalog?: readonly ScratchCatalogCapability[];
}

export interface ScratchCatalogCapability {
  readonly spec: CapabilitySpec;
  readonly incarnationId: string;
  readonly rows: readonly CapabilityCreateValues[];
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

export class CapabilityGateError extends Error {
  override readonly name = "CapabilityGateError";
  readonly failedRung: GateRungName;
  readonly outcomes: readonly GateRungOutcome[];
  readonly diagnostic?: unknown;
  override readonly cause?: unknown;

  constructor(failedRung: GateRungName, outcomes: readonly GateRungOutcome[], cause?: unknown) {
    const failed = outcomes.find((outcome) => outcome.rung === failedRung);
    super(`Capability gate failed at ${failedRung}: ${failed?.error ?? "unknown failure"}`);
    this.failedRung = failedRung;
    this.outcomes = outcomes;
    this.cause = cause;
    this.diagnostic = diagnosticForError(cause);
  }
}

// Re-exported so the public builder surface (src/builder/index.ts) and the gate's
// own tests reach the behavioral prompt without depending on the rung file directly.
export { buildBehavioralTestPrompt } from "./gate-behavioral.ts";

/**
 * Run the layered Gate and report outcomes in canonical order — structural, smoke, the
 * behavioral tier (when enabled, else skipped), then the always-on design-lint rung.
 * The first failing rung throws {@link CapabilityGateError}; a full pass returns the smoke,
 * behavioral, and design-lint results (the last carrying the final, possibly-fixed item
 * renderer the pipeline commits) alongside the per-rung outcomes. Design lint runs before
 * behavioral execution so the generated suite freezes and runs exactly once against the
 * final renderer. When design lint changes bytes, they first re-enter smoke without Handler
 * repair; repeated smoke duration/usage is folded into the same public rung result.
 */
export async function runCapabilityGate(input: CapabilityGateInput): Promise<CapabilityGateResult> {
  const startedAt = performance.now();
  const outcomes: GateRungOutcome[] = [];
  const behavioralTierEnabled = resolveBehavioralTierEnabledForInput(input);

  const structural = await runGateRung(outcomes, "structural", () => runStructuralRung(input));
  let smokeRun = await runGateRung(outcomes, "smoke", () => runSmokeRung(input));
  let smoke = smokeRun.result;
  const repairedInput = { ...input, handlers: smokeRun.handlers };
  const skippedBehavioral = behavioralTierEnabled
    ? undefined
    : skipGateRung(outcomes, "behavioral", "Behavioral tier is off for this run.");
  const designLint = await runGateRung(outcomes, "design-lint", () =>
    runDesignLintRung(repairedInput),
  );

  if (designLint.fixed) {
    // Design lint is the final rung and may replace item.ts. Its own fix loop proves the
    // regenerated unit's structural shape/type and design contract, but those new bytes
    // have not yet executed through presentation. Re-enter the executable rungs so the
    // exact renderer the pipeline commits has cleared every active check. The revalidation
    // gets no provider and one attempt: an item-renderer-caused failure must fail closed,
    // never consume the Handler repair budget or rewrite an innocent Handler.
    const finalRendererInput = {
      ...repairedInput,
      itemRenderer: designLint.itemRenderer,
      provider: undefined,
      smoke: { maxAttempts: 1 },
    };
    const finalSmokeRun = await rerunPassedGateRung(outcomes, "smoke", () =>
      runSmokeRung(finalRendererInput),
    );
    smoke = mergeSmokeResults(smoke, finalSmokeRun.result);
    smokeRun = { ...finalSmokeRun, result: smoke };
  }

  // Design has now fixed/frozen the renderer and smoke has executed its final bytes. Only
  // now generate the behavioral suite, once, and execute it against that exact snapshot.
  // Its outcome is inserted before design-lint to preserve the Gate's documented public
  // rung order even though design preparation necessarily happened first.
  const designOutcome = outcomes.pop();
  if (designOutcome?.rung !== "design-lint") {
    throw new Error("Design-lint outcome was not recorded at the Gate boundary.");
  }
  const finalInput = {
    ...repairedInput,
    handlers: smokeRun.handlers,
    itemRenderer: designLint.itemRenderer,
  };
  let behavioral: BehavioralGateResult | undefined;
  try {
    behavioral = behavioralTierEnabled
      ? await runGateRung(outcomes, "behavioral", () => runBehavioralRung(finalInput))
      : skippedBehavioral;
  } catch (error) {
    // Design already passed against this exact renderer. Restore its deferred verdict so
    // the failure preview remains a complete canonical inventory rather than implying the
    // final rung never ran.
    outcomes.push(designOutcome);
    throw error;
  }
  outcomes.push(designOutcome);
  if (!behavioral) throw new Error("Behavioral Gate result was not resolved.");

  return {
    outcomes,
    durationMs: performance.now() - startedAt,
    structural,
    smoke,
    behavioral,
    designLint,
    handlers: smokeRun.handlers,
  };
}

/** Re-run a rung that already passed while preserving the public one-outcome-per-rung
 * shape. Duration is cumulative; a final-candidate failure replaces the stale pass so the
 * fail-closed preview names the bytes that were actually rejected. */
async function rerunPassedGateRung<T>(
  outcomes: GateRungOutcome[],
  rung: GateRungName,
  body: () => T | Promise<T>,
): Promise<T> {
  const outcomeIndex = outcomes.findIndex((outcome) => outcome.rung === rung);
  const previous = outcomes[outcomeIndex];
  if (outcomeIndex < 0 || previous?.status !== "passed") {
    throw new Error(`Cannot re-run ${rung} before its first successful Gate pass.`);
  }

  const startedAt = performance.now();
  try {
    const result = await body();
    outcomes[outcomeIndex] = {
      ...previous,
      durationMs: previous.durationMs + (performance.now() - startedAt),
    };
    return result;
  } catch (error) {
    outcomes[outcomeIndex] = {
      rung,
      status: "failed",
      durationMs: previous.durationMs + (performance.now() - startedAt),
      error: errorMessage(error),
    };
    throw new CapabilityGateError(rung, outcomes, error);
  }
}

/** Fold the original and final-renderer smoke executions into the one public result. The
 * final run owns observable fixture values; attempts and provider cost cover both runs so
 * previews, commit-unit repair accounting, and metrics remain honest. */
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

function addTokenUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    inputTokens: addOptionalNumber(left.inputTokens, right.inputTokens),
    outputTokens: addOptionalNumber(left.outputTokens, right.outputTokens),
    totalTokens: addOptionalNumber(left.totalTokens, right.totalTokens),
  };
}

function addOptionalNumber(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  return left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);
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

async function runGateRung<T>(
  outcomes: GateRungOutcome[],
  rung: GateRungName,
  body: () => T | Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await body();
    outcomes.push({ rung, status: "passed", durationMs: performance.now() - startedAt });
    return result;
  } catch (error) {
    outcomes.push({
      rung,
      status: "failed",
      durationMs: performance.now() - startedAt,
      error: errorMessage(error),
    });
    throw new CapabilityGateError(rung, outcomes, error);
  }
}

function skipGateRung(
  outcomes: GateRungOutcome[],
  rung: GateRungName,
  reason: string,
): BehavioralGateResult {
  outcomes.push({ rung, status: "skipped", durationMs: 0, reason });
  return { tier: "off", status: "skipped", reason };
}

function resolveBehavioralTierEnabledForInput(input: CapabilityGateInput): boolean {
  return input.behavioralTier?.enabled ?? resolveBehavioralTierEnabled();
}
