import {
  CapabilityGateError,
  type CapabilityGateFailureMeasurement,
} from "./capability-gate-error.ts";
import type { BehavioralGateResult, GateRungName, GateRungOutcome } from "./gate.ts";
import { errorMessage } from "./gate-internal.ts";

export async function runGateRung<T>(
  outcomes: GateRungOutcome[],
  rung: GateRungName,
  body: () => T | Promise<T>,
  failureMeasurement?: (error: unknown) => CapabilityGateFailureMeasurement,
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
    throw new CapabilityGateError(rung, outcomes, error, failureMeasurement?.(error));
  }
}

export async function rerunPassedGateRung<T>(
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

export function skipGateRung(
  outcomes: GateRungOutcome[],
  rung: GateRungName,
  reason: string,
): BehavioralGateResult {
  outcomes.push({ rung, status: "skipped", durationMs: 0, reason });
  return { tier: "off", status: "skipped", reason };
}
