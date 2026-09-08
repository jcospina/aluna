// Bounded per-Handler repair against frozen behavioral intent.
//
// The smoke rung repairs against a fixture the platform owns; this one repairs against a suite the
// model authored, frozen before any Handler byte existed. By the time a case fails the intent is
// settled and the code is the only variable: nothing here may edit, weaken, reorder or skip a
// frozen case, and every attempt reruns the same bytes from the same artifact object.
//
// Two things make that checkable. A seal over the frozen artifact is re-verified at every attempt
// boundary, and repair answers only to `FullBehavioralCaseFailure` — any other error is no verdict
// about a Handler and fails closed without spending the budget. Each round then re-plans on the
// repaired Handlers, and the passing turn asserts their suites ran — loosening either fails loud.

import { errorMessage } from "../../../../../platform/errors.ts";
import { isProviderAbortError, type TokenUsage } from "../../../../../platform/provider/index.ts";
import { sumTokenUsages } from "../../../../../platform/provider/usage.ts";
import type { CapabilityRow } from "../../../../../registry/index.ts";
import { normalizeMaxAttempts } from "../../../../attempts.ts";
import {
  DEFAULT_UNIT_FIX_ATTEMPTS,
  type HandlerUnitName,
} from "../../../../units/generation/units.ts";
import type {
  BehavioralGateResult,
  BehavioralHandlerGenerationAttempt,
  BehavioralRepairAttempt,
  BehavioralTestRunMetrics,
  CapabilityGateInput,
  FrozenBehavioralTestsInput,
} from "../../../gate.ts";
import { scratchDependencyRows } from "../../../gate-internal.ts";
import {
  type BehavioralExecutionImpact,
  type BehavioralExecutionPlan,
  planBehavioralExecution,
} from "../freeze/behavioral-execution-plan.ts";
import { FullBehavioralCaseFailure } from "../generation/gate-behavioral-full.ts";
import {
  attributeBehavioralFailure,
  declaredHandlerSet,
} from "./behavioral-failure-attribution.ts";
import {
  type HandlerRepair,
  repairAttributedHandlers,
} from "./gate-behavioral-repair-generation.ts";

export interface BehavioralRungRun {
  readonly result: BehavioralGateResult;
  /** The Handler bytes that cleared the rung — repaired ones included. The pipeline commits these. */
  readonly handlers: Readonly<Partial<Record<HandlerUnitName, string>>>;
}

/** Typed evidence retained when the behavioral rung fails after provider work began. */
export interface BehavioralRungFailureMeasurement {
  readonly execution: BehavioralExecutionPlan;
  /** Whole repair-loop wall time through the failure, including execution and provider work. */
  readonly durationMs: number;
  readonly attempts: readonly BehavioralRepairAttempt[];
  readonly generations: readonly BehavioralHandlerGenerationAttempt[];
  readonly usage: TokenUsage;
}

/**
 * The rung's failure after the budget is spent, or when nothing may be repaired. The failing
 * case's own evidence stays at the top level; the repair record sits beside it under `repair`.
 */
export class BehavioralRungFailure extends Error {
  override readonly name = "BehavioralRungFailure";
  readonly diagnostic: Record<string, unknown> & {
    readonly repair: {
      readonly attempts: readonly BehavioralRepairAttempt[];
      readonly failure: string;
    };
  };
  readonly measurement: BehavioralRungFailureMeasurement;

  constructor(
    measurement: BehavioralRungFailureMeasurement,
    failure: string,
    override readonly cause?: unknown,
  ) {
    super(failure);
    this.measurement = measurement;
    const caseDiagnostic =
      cause instanceof FullBehavioralCaseFailure ? cause.diagnostic : { failure };
    this.diagnostic = {
      ...caseDiagnostic,
      repair: { attempts: measurement.attempts, failure },
    };
  }
}

/** Raised when the frozen artifact is not byte-identical to what the rung was handed. */
export class FrozenIntentMutatedError extends Error {
  override readonly name = "FrozenIntentMutatedError";

  constructor() {
    super(
      "Frozen behavioral intent changed during the Gate. Repair rewrites Handlers, never tests (PLAN decision 23).",
    );
  }
}

export interface BehavioralRepairLoopInput {
  readonly input: CapabilityGateInput;
  readonly frozen: FrozenBehavioralTestsInput;
  /** Run the plan's selected frozen cases against these Handler bytes. */
  readonly execute: (
    handlers: Readonly<Partial<Record<HandlerUnitName, string>>>,
    plan: BehavioralExecutionPlan,
  ) => Promise<BehavioralTestRunMetrics>;
}

/**
 * Execute the frozen suite, repairing attributed Handlers and rerunning the same bytes up to
 * ADR-0003's budget. A spent budget throws {@link BehavioralRungFailure}, as does no repair.
 */
export async function runBehavioralRepairLoop(
  options: BehavioralRepairLoopInput,
): Promise<BehavioralRungRun> {
  const state: RepairLoopState = {
    startedAt: performance.now(),
    maxAttempts: normalizeMaxAttempts(
      options.input.behavioralTier?.maxAttempts,
      DEFAULT_UNIT_FIX_ATTEMPTS,
      "Behavioral",
    ),
    seal: JSON.stringify(options.frozen.frozenTests),
    declaredHandlers: declaredHandlerSet(options.input.spec),
    dependencyCatalog: scratchDependencyRows(options.input.scratchCatalog),
    handlers: { ...options.input.handlers },
    repairedHandlers: new Set<HandlerUnitName>(),
    generationAttempts: new Map<HandlerUnitName, number>(),
    attempts: [],
  };

  // Every non-passing turn records an attempt and returns bytes, or throws. Regeneration is
  // refused on the max-attempt turn, so the loop needs no unreachable exhaustion throw.
  while (true) {
    const repairs = await runRepairAttempt(options, state);
    if (repairs.kind === "passed") return repairs.run;
    for (const entry of repairs.repaired) {
      state.handlers[entry.action] = entry.content;
      state.repairedHandlers.add(entry.action);
    }
  }
}

interface RepairLoopState {
  readonly startedAt: number;
  readonly maxAttempts: number;
  readonly seal: string;
  readonly declaredHandlers: readonly HandlerUnitName[];
  readonly dependencyCatalog: readonly CapabilityRow[];
  readonly handlers: Partial<Record<HandlerUnitName, string>>;
  readonly repairedHandlers: Set<HandlerUnitName>;
  /** Provider repair calls spent by each Handler; never shared across units. */
  readonly generationAttempts: Map<HandlerUnitName, number>;
  readonly attempts: BehavioralRepairAttempt[];
}

type RepairAttemptResult =
  | { readonly kind: "passed"; readonly run: BehavioralRungRun }
  | { readonly kind: "repaired"; readonly repaired: readonly HandlerRepair[] };

/**
 * One turn: re-plan against the impact as it stands, run the selected frozen cases, and repair
 * the attributed Handlers when one fails. Throws rather than returning on a fail-closed.
 */
async function runRepairAttempt(
  options: BehavioralRepairLoopInput,
  state: RepairLoopState,
): Promise<RepairAttemptResult> {
  const { frozen } = options;
  const startedAt = performance.now();
  const impact = impactWithRepairs(options.input.behavioralTier?.impact, state.repairedHandlers);
  const execution = planBehavioralExecution({
    frozenTests: frozen.frozenTests,
    generatedActions: frozen.generation.generatedActions,
    ...(impact ? { impact } : {}),
  });

  try {
    const testRun = await options.execute(state.handlers, execution);
    assertFrozenIntentUnmoved(state.seal, frozen.frozenTests);
    // Before this turn is recorded as a pass. A verdict that fails the invariant is not a
    // passing attempt with a caveat, and must never be written down as one.
    assertRepairsWereProven(state, execution);
    state.attempts.push({
      attempt: state.attempts.length + 1,
      durationMs: performance.now() - startedAt,
    });
    return { kind: "passed", run: passedRun(options, state, execution, testRun) };
  } catch (error) {
    if (isProviderAbortError(error)) throw error;
    // Check the seal before anything else reads the artifact: if executing the suite moved
    // it, every downstream verdict — including this failure — is untrustworthy.
    assertFrozenIntentUnmoved(state.seal, frozen.frozenTests);
    if (error instanceof FullBehavioralCaseFailure) {
      return await repairFromCaseFailure(options, state, {
        error,
        impact,
        execution,
        startedAt,
      });
    }
    // Not a verdict about a Handler, so the Gate fails closed. A paid-for repair round is
    // still evidence: carry the attempt record out rather than losing it with the raw throw.
    if (state.attempts.length === 0) throw error;
    state.attempts.push({
      attempt: state.attempts.length + 1,
      durationMs: performance.now() - startedAt,
      error: errorMessage(error),
    });
    throw behavioralRungFailure(state, execution, errorMessage(error), error);
  }
}

/**
 * Every Handler this loop rewrote was judged by its own frozen suite on the turn that passed.
 * True by construction, checked anyway: a loosened rule fails here, not with an unrun suite.
 */
function assertRepairsWereProven(state: RepairLoopState, execution: BehavioralExecutionPlan): void {
  const unproven = [...state.repairedHandlers].filter(
    (action) =>
      !execution.actions.some((entry) => entry.action === action && entry.execution === "executed"),
  );
  if (unproven.length > 0) {
    throw behavioralRungFailure(
      state,
      execution,
      `Behavioral repair rewrote ${unproven.join(", ")} without re-running the frozen suite covering it.`,
    );
  }
}

interface CaseFailureContext {
  readonly error: FullBehavioralCaseFailure;
  readonly impact: BehavioralExecutionImpact | undefined;
  readonly execution: BehavioralExecutionPlan;
  readonly startedAt: number;
}

/** Attribute one failing frozen case and spend a repair turn on it, or fail the Gate closed. */
async function repairFromCaseFailure(
  options: BehavioralRepairLoopInput,
  state: RepairLoopState,
  context: CaseFailureContext,
): Promise<RepairAttemptResult> {
  const { error, impact, execution, startedAt } = context;
  const { testCase, surface } = error.diagnostic;
  const attempt = state.attempts.length + 1;
  const attribution = attributeBehavioralFailure({
    surface,
    action: testCase.action,
    ...(impact ? { impact } : {}),
    declaredHandlers: state.declaredHandlers,
  });
  const failure = {
    action: testCase.action,
    testName: testCase.name,
    surface,
    message: error.diagnostic.failure,
  };
  const provider = options.input.provider;
  const maxRepairAttempts = state.maxAttempts - 1;
  const eligibleHandlers = attribution.handlers.filter(
    (handler) => (state.generationAttempts.get(handler) ?? 0) < maxRepairAttempts,
  );

  if (attribution.handlers.length === 0 || !provider || eligibleHandlers.length === 0) {
    state.attempts.push({
      attempt,
      durationMs: performance.now() - startedAt,
      failure,
      attribution,
      error: error.message,
    });
    throw behavioralRungFailure(state, execution, error.message, error);
  }

  const round = await repairAttributedHandlers({
    provider,
    input: options.input,
    attribution,
    handlersToRepair: eligibleHandlers,
    failure: error.message,
    dependencyCatalog: state.dependencyCatalog,
    handlers: state.handlers,
    generationAttempts: state.generationAttempts,
    maxRepairAttempts,
  });
  state.attempts.push({
    attempt,
    // The elapsed turn already includes the awaited repair round.
    durationMs: performance.now() - startedAt,
    failure,
    attribution,
    repairs: round.repaired.map(({ content: _content, ...repair }) => repair),
    generations: round.generations,
    repairDurationMs: round.durationMs,
    usage: round.usage,
    error: error.message,
  });
  if (round.repaired.length === 0) {
    // Rerunning byte-identical Handlers against byte-identical tests cannot change the
    // verdict. Stop here rather than burning the remaining budget on a certainty.
    throw behavioralRungFailure(
      state,
      execution,
      `${error.message} No Handler repair was admissible: ${round.rejected.join("; ")}`,
      error,
    );
  }
  return { kind: "repaired", repaired: round.repaired };
}

function passedRun(
  options: BehavioralRepairLoopInput,
  state: RepairLoopState,
  execution: BehavioralExecutionPlan,
  testRun: BehavioralTestRunMetrics,
): BehavioralRungRun {
  return {
    handlers: state.handlers,
    result: {
      tier: "on",
      status: "passed",
      testGen: options.frozen.generation,
      testRun,
      execution,
      frozenTests: options.frozen.frozenTests,
      repair: {
        fixed: state.repairedHandlers.size > 0,
        repairedHandlers: orderedHandlers(state.repairedHandlers, state.declaredHandlers),
        attempts: state.attempts,
        usage: sumAttemptUsage(state.attempts),
      },
    },
  };
}

function behavioralRungFailure(
  state: RepairLoopState,
  execution: BehavioralExecutionPlan,
  failure: string,
  cause?: unknown,
): BehavioralRungFailure {
  const attempts = [...state.attempts];
  return new BehavioralRungFailure(
    {
      execution,
      durationMs: performance.now() - state.startedAt,
      attempts,
      generations: attempts.flatMap((attempt) => attempt.generations ?? []),
      usage: sumAttemptUsage(attempts),
    },
    failure,
    cause,
  );
}

/**
 * Fold this Gate's repairs into the executable impact before re-planning. An unstated impact
 * stays unstated: inventing one from repairs would narrow on a claim nobody made.
 */
function impactWithRepairs(
  base: BehavioralExecutionImpact | undefined,
  repaired: ReadonlySet<HandlerUnitName>,
): BehavioralExecutionImpact | undefined {
  if (!base || repaired.size === 0) return base;
  return {
    ...base,
    regeneratedHandlers: [...new Set([...base.regeneratedHandlers, ...repaired])],
  };
}

function assertFrozenIntentUnmoved(seal: string, frozenTests: unknown): void {
  if (JSON.stringify(frozenTests) !== seal) throw new FrozenIntentMutatedError();
}

function orderedHandlers(
  repaired: ReadonlySet<HandlerUnitName>,
  declared: readonly HandlerUnitName[],
): readonly HandlerUnitName[] {
  return declared.filter((action) => repaired.has(action));
}

function sumAttemptUsage(attempts: readonly BehavioralRepairAttempt[]): TokenUsage {
  return sumTokenUsages(attempts.flatMap((attempt) => (attempt.usage ? [attempt.usage] : [])));
}
