// Bounded per-Handler repair for the platform-owned smoke fixture. The fixture
// callback is immutable; only the Action attributed by a failed execution may be
// regenerated, statically rechecked, and tried again from fresh scratch state.

import type { CapabilityRow } from "../registry/index.ts";
import type { CapabilityGateInput, SmokeGateAttempt, SmokeGateResult } from "./gate.ts";
import { checkGeneratedUnit } from "./unit-checks.ts";
import {
  DEFAULT_UNIT_FIX_ATTEMPTS,
  generateUnitContent,
  type HandlerUnitName,
  type UnitGenerationFailure,
} from "./units.ts";

type SmokeExecutionResult = Omit<SmokeGateResult, "fixed" | "attempts" | "usage">;

export interface SmokeRungRun {
  readonly result: SmokeGateResult;
  readonly handlers: Readonly<Partial<Record<HandlerUnitName, string>>>;
}

export class SmokeActionFailure extends Error {
  override readonly name = "SmokeActionFailure";

  constructor(
    readonly action: HandlerUnitName,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(`Smoke ${action} failed: ${message}`);
  }
}

class SmokeRungFailure extends Error {
  override readonly name = "SmokeRungFailure";
  readonly diagnostic: {
    readonly smoke: {
      readonly action?: HandlerUnitName;
      readonly attempts: readonly SmokeGateAttempt[];
      readonly failure: string;
    };
  };

  constructor(
    action: HandlerUnitName | undefined,
    attempts: readonly SmokeGateAttempt[],
    failure: string,
    override readonly cause?: unknown,
  ) {
    super(failure);
    this.diagnostic = { smoke: { ...(action ? { action } : {}), attempts, failure } };
  }
}

interface PendingRepair {
  readonly action: HandlerUnitName;
  readonly content: string;
  readonly durationMs: number;
  readonly usage: NonNullable<SmokeGateAttempt["usage"]>;
}

export async function runSmokeRepairLoop(
  input: CapabilityGateInput,
  execute: (
    handlers: Readonly<Partial<Record<HandlerUnitName, string>>>,
  ) => Promise<SmokeExecutionResult>,
): Promise<SmokeRungRun> {
  const maxAttempts = normalizeMaxAttempts(input.smoke?.maxAttempts);
  const attempts: SmokeGateAttempt[] = [];
  const handlers: Partial<Record<HandlerUnitName, string>> = { ...input.handlers };
  const dependencyCatalog = scratchDependencyRows(input);
  let pending: PendingRepair | undefined;

  while (attempts.length < maxAttempts) {
    const attempt = attempts.length + 1;
    const startedAt = performance.now();
    try {
      const result = await execute(handlers);
      attempts.push(passedAttempt(attempt, startedAt, pending));
      return {
        handlers,
        result: {
          ...result,
          fixed: attempt > 1,
          attempts,
          usage: sumAttemptUsage(attempts),
        },
      };
    } catch (error) {
      const failure = toSmokeFailure(error);
      attempts.push(failedAttempt(attempt, startedAt, pending, failure));
      if (!failure.action || !input.provider || attempts.length >= maxAttempts) {
        throw new SmokeRungFailure(failure.action, attempts, failure.message, error);
      }
      pending = await prepareValidRepair({
        input,
        action: failure.action,
        failure: failure.message,
        attempts,
        maxAttempts,
        dependencyCatalog,
      });
      handlers[pending.action] = pending.content;
    }
  }

  throw new SmokeRungFailure(undefined, attempts, "Smoke rung exhausted its bounded repair loop.");
}

interface RepairPreparationInput {
  readonly input: CapabilityGateInput;
  readonly action: HandlerUnitName;
  readonly failure: string;
  readonly maxAttempts: number;
  readonly attempts: SmokeGateAttempt[];
  readonly dependencyCatalog: readonly CapabilityRow[];
}

async function prepareValidRepair(options: RepairPreparationInput): Promise<PendingRepair> {
  let failure = options.failure;
  let cause: unknown;
  while (options.attempts.length < options.maxAttempts) {
    const attempt = options.attempts.length + 1;
    const startedAt = performance.now();
    try {
      const repaired = await generateHandlerRepair(
        options.input,
        options.action,
        failure,
        options.dependencyCatalog,
      );
      const staticFailure = checkGeneratedUnit(
        options.input.spec,
        { kind: "handler", name: options.action },
        repaired.content,
        options.dependencyCatalog,
      );
      if (!staticFailure) return repaired;
      failure = `Smoke repair for ${options.action} failed structural validation: ${staticFailure.message}`;
      cause = staticFailure;
      options.attempts.push({
        attempt,
        action: options.action,
        repairAction: options.action,
        durationMs: performance.now() - startedAt,
        repairDurationMs: repaired.durationMs,
        usage: repaired.usage,
        error: failure,
      });
    } catch (repairError) {
      failure = repairError instanceof Error ? repairError.message : String(repairError);
      cause = repairError;
      options.attempts.push({
        attempt,
        action: options.action,
        durationMs: performance.now() - startedAt,
        error: failure,
      });
    }
  }
  throw new SmokeRungFailure(options.action, options.attempts, failure, cause);
}

async function generateHandlerRepair(
  input: CapabilityGateInput,
  action: HandlerUnitName,
  message: string,
  dependencyCatalog: readonly CapabilityRow[],
): Promise<PendingRepair> {
  if (!input.provider) throw new Error("Smoke repair requires a provider.");
  const unit = { kind: "handler" as const, name: action };
  const previousFailure: UnitGenerationFailure = { ...unit, message };
  const repaired = await generateUnitContent(
    input.provider,
    input.spec,
    unit,
    previousFailure,
    dependencyCatalog,
  );
  return {
    action,
    content: repaired.content,
    durationMs: repaired.durationMs,
    usage: repaired.usage,
  };
}

function passedAttempt(
  attempt: number,
  startedAt: number,
  pending: PendingRepair | undefined,
): SmokeGateAttempt {
  return {
    attempt,
    ...(pending
      ? {
          action: pending.action,
          repairAction: pending.action,
          repairDurationMs: pending.durationMs,
          usage: pending.usage,
        }
      : {}),
    durationMs: performance.now() - startedAt + (pending?.durationMs ?? 0),
  };
}

function failedAttempt(
  attempt: number,
  startedAt: number,
  pending: PendingRepair | undefined,
  failure: { readonly action?: HandlerUnitName; readonly message: string },
): SmokeGateAttempt {
  return {
    attempt,
    ...(failure.action ? { action: failure.action } : {}),
    ...(pending
      ? {
          repairAction: pending.action,
          repairDurationMs: pending.durationMs,
          usage: pending.usage,
        }
      : {}),
    durationMs: performance.now() - startedAt + (pending?.durationMs ?? 0),
    error: failure.message,
  };
}

function toSmokeFailure(error: unknown): {
  readonly action?: HandlerUnitName;
  readonly message: string;
} {
  return error instanceof SmokeActionFailure
    ? { action: error.action, message: error.message }
    : { message: error instanceof Error ? error.message : String(error) };
}

function scratchDependencyRows(input: CapabilityGateInput): CapabilityRow[] {
  return (input.scratchCatalog ?? []).map((fixture) => ({
    ...fixture.spec,
    incarnation_id: fixture.incarnationId,
    version: 1,
    artifacts_path: `scratch/${fixture.spec.id}`,
  }));
}

function normalizeMaxAttempts(value: number | undefined): number {
  if (value === undefined) return DEFAULT_UNIT_FIX_ATTEMPTS;
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError("Smoke maxAttempts must be a positive integer.");
  }
  return value;
}

function sumAttemptUsage(attempts: readonly SmokeGateAttempt[]) {
  const usages = attempts.flatMap((attempt) => (attempt.usage ? [attempt.usage] : []));
  return {
    inputTokens: sumDefined(usages.map((usage) => usage.inputTokens)),
    outputTokens: sumDefined(usages.map((usage) => usage.outputTokens)),
    totalTokens: sumDefined(usages.map((usage) => usage.totalTokens)),
  };
}

function sumDefined(values: readonly (number | undefined)[]): number | undefined {
  const present = values.filter((value): value is number => value !== undefined);
  return present.length === 0 ? undefined : present.reduce((sum, value) => sum + value, 0);
}
