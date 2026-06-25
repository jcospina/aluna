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

import type { CapabilityTableDdl } from "../capability-data/index.ts";
import type { Provider, TokenUsage } from "../provider/index.ts";
import type { CapabilitySpec } from "../registry/index.ts";
import { runBehavioralRung } from "./gate-behavioral.ts";
import { diagnosticForError, errorMessage } from "./gate-internal.ts";
import { runSmokeRung } from "./gate-smoke.ts";
import { runStructuralRung } from "./gate-structural.ts";
import type { HandlerUnitName } from "./units.ts";

export const BEHAVIORAL_TIER_ENV_VAR = "OMNI_BEHAVIORAL_TIER";

const GATE_RUNG_ORDER = ["structural", "smoke", "behavioral"] as const;
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
  readonly realDatabaseUnchanged?: boolean;
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

export interface CapabilityGateInput {
  readonly spec: CapabilitySpec;
  // The migration stage owns DDL derivation. The gate applies that exact output to
  // scratch so smoke proves the build's own schema, not a separately-derived one.
  readonly ddl: CapabilityTableDdl;
  readonly handlers: Readonly<Record<HandlerUnitName, string>>;
  // The behavioral tier generates tests from spec behavior + schema only. The
  // provider is required when the tier is enabled, and unused when it is off.
  readonly provider?: Provider;
  // Global default comes from OMNI_BEHAVIORAL_TIER (default ON); tests and future
  // orchestration can override explicitly without mutating process.env.
  readonly behavioralTier?: BehavioralTierInput;
  // Optional assertion hook for the real db: the gate snapshots capability tables
  // before and after smoke and fails if they changed.
  readonly realDatabase?: Database;
}

export interface CapabilityGateResult {
  readonly outcomes: readonly GateRungOutcome[];
  readonly durationMs: number;
  readonly smoke: SmokeGateResult;
  readonly behavioral: BehavioralGateResult;
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
 * Run the gate's rungs in order — structural, smoke, then the behavioral tier (when
 * enabled, else skipped) — accumulating each rung's outcome. The first failing rung
 * throws {@link CapabilityGateError}; a full pass returns the smoke + behavioral
 * results and the per-rung outcomes.
 */
export async function runCapabilityGate(input: CapabilityGateInput): Promise<CapabilityGateResult> {
  const startedAt = performance.now();
  const outcomes: GateRungOutcome[] = [];

  await runGateRung(outcomes, "structural", () => runStructuralRung(input));
  const smoke = await runGateRung(outcomes, "smoke", () => runSmokeRung(input));
  const behavioral = resolveBehavioralTierEnabledForInput(input)
    ? await runGateRung(outcomes, "behavioral", () => runBehavioralRung(input))
    : skipGateRung(outcomes, "behavioral", "Behavioral tier is off for this run.");

  return {
    outcomes,
    durationMs: performance.now() - startedAt,
    smoke,
    behavioral,
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
