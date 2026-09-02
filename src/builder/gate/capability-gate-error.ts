import type { TokenUsage } from "../../platform/provider/index.ts";
import type { GateRungName, GateRungOutcome } from "./gate.ts";
import { diagnosticForError } from "./gate-internal.ts";
import type { BehavioralRungFailureMeasurement } from "./rungs/behavioral/gate-behavioral.ts";

/** Provider work and execution evidence already completed when a Gate fails. */
export interface CapabilityGateFailureMeasurement {
  readonly smokeUsage: TokenUsage;
  readonly designLintUsage: TokenUsage;
  readonly behavioral?: BehavioralRungFailureMeasurement;
}

export class CapabilityGateError extends Error {
  override readonly name = "CapabilityGateError";
  readonly failedRung: GateRungName;
  readonly outcomes: readonly GateRungOutcome[];
  readonly diagnostic?: unknown;
  readonly measurement?: CapabilityGateFailureMeasurement;
  override readonly cause?: unknown;

  constructor(
    failedRung: GateRungName,
    outcomes: readonly GateRungOutcome[],
    cause?: unknown,
    measurement?: CapabilityGateFailureMeasurement,
  ) {
    const failed = outcomes.find((outcome) => outcome.rung === failedRung);
    super(`Capability gate failed at ${failedRung}: ${failed?.error ?? "unknown failure"}`);
    this.failedRung = failedRung;
    this.outcomes = outcomes;
    this.cause = cause;
    this.diagnostic = diagnosticForError(cause);
    this.measurement = measurement;
  }
}
