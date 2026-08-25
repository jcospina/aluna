// Bounded per-Handler repair against frozen behavioral intent.
//
// The smoke rung repairs against a fixture the platform owns. This rung repairs against a
// suite the *model* authored, which is why the loop is built the way it is: the suite was
// frozen before any Handler byte existed and admitted against the platform-owned Action
// response contract before the rung ran, so by the time a case fails the intent is settled
// and the code is the only variable left. Nothing here can edit, regenerate, weaken,
// reorder or skip a frozen case; the only lever is Handler bytes, and every attempt reruns
// the same frozen bytes from the same artifact object.
//
// Two things make that claim checkable rather than aspirational:
//
//   - a seal over the frozen artifact is re-verified at every attempt boundary, so a
//     mutation by anything the loop calls fails the Gate instead of passing quietly;
//   - repair answers only to `FullBehavioralCaseFailure`. Any other error out of the rung —
//     an inadmissible suite, a scratch-setup fault, a real-database mutation — is not a
//     verdict about a Handler and fails the Gate closed without spending the budget.
//
// Repairing a Handler is also an admission that its bytes moved, so each round folds the
// repaired Handlers back into the executable impact and re-plans, and the turn that passes
// asserts that every rewritten Handler's suite actually ran. Under the current planning
// rules neither can change the outcome, so both are coupling guards rather than observable
// behavior — they are here so that loosening either rule fails loudly instead of quietly
// letting a repair buy a pass with an unrun suite.

import { isProviderAbortError, type TokenUsage } from "../../../provider/index.ts";
import { type CapabilityRow, LOGO_BIRTH_STATUS } from "../../../registry/index.ts";
import { DEFAULT_UNIT_FIX_ATTEMPTS, type HandlerUnitName } from "../../units/units.ts";
import type {
  BehavioralGateResult,
  BehavioralHandlerGenerationAttempt,
  BehavioralRepairAttempt,
  BehavioralTestRunMetrics,
  CapabilityGateInput,
  FrozenBehavioralTestsInput,
} from "../gate.ts";
import { errorMessage } from "../gate-internal.ts";
import {
  type BehavioralExecutionImpact,
  type BehavioralExecutionPlan,
  planBehavioralExecution,
} from "./behavioral-execution-plan.ts";
import {
  attributeBehavioralFailure,
  declaredHandlerSet,
} from "./behavioral-failure-attribution.ts";
import { FullBehavioralCaseFailure } from "./gate-behavioral-full.ts";
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
 * The rung's failure after the bounded budget is spent, or when nothing may be repaired.
 *
 * The diagnostic keeps the failing case's own evidence — the rendered fragment, the scratch
 * rows, the Handler input — at the top level, because that is what a developer reads to
 * understand *why* the frozen intent was not met, and it does not become less useful for
 * having been retried. The repair record sits beside it under `repair`: what was attributed
 * to whom, what was rewritten, and what the budget bought.
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
 * Execute the frozen suite, and on a failing case repair the attributed Handler set and
 * rerun the same frozen bytes, up to ADR-0003's bounded budget. Returns the passing rung
 * result plus the Handler bytes that earned it; throws {@link BehavioralRungFailure} when
 * the budget is spent, when nothing may lawfully be repaired, or when no repair landed.
 */
export async function runBehavioralRepairLoop(
  options: BehavioralRepairLoopInput,
): Promise<BehavioralRungRun> {
  const state: RepairLoopState = {
    startedAt: performance.now(),
    maxAttempts: normalizeMaxAttempts(options.input.behavioralTier?.maxAttempts),
    seal: JSON.stringify(options.frozen.frozenTests),
    declaredHandlers: declaredHandlerSet(options.input.spec),
    dependencyCatalog: scratchDependencyRows(options.input),
    handlers: { ...options.input.handlers },
    repairedHandlers: new Set<HandlerUnitName>(),
    generationAttempts: new Map<HandlerUnitName, number>(),
    attempts: [],
  };

  // Every non-passing turn either records one attempt and returns repaired bytes, or throws.
  // `repairFromCaseFailure` rejects regeneration on the max-attempt turn, so the loop cannot
  // cross the bound and needs no unreachable exhaustion throw after it.
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
 * One turn: re-plan against the impact as it now stands, run the selected frozen cases,
 * and — when a case fails and the budget allows — repair the attributed Handlers. Throws
 * rather than returning when the Gate must fail closed.
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
    // Not a verdict about a Handler — a malformed suite, a scratch fault, the real-database
    // guard, or this loop's own invariant. The Gate fails closed either way, but once a
    // repair round has been paid for, that spend is evidence: carry the attempt record out
    // rather than letting the tokens and the attribution vanish with the raw throw.
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
 * Every Handler this loop rewrote was judged by its own frozen suite on the turn that
 * passed. Total attribution satisfies it because the repaired Handler is the one whose suite
 * just failed; the conservative set satisfies it because every path that widens attribution
 * also runs the complete frozen suite. It holds by construction today and is checked anyway,
 * so that loosening either rule later fails the Gate here instead of quietly letting a
 * repair buy a pass with an unrun suite.
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
 * Fold this Gate's own behavioral repairs into the executable impact before re-planning.
 * An unstated impact stays unstated: it already runs the complete frozen suite, and
 * inventing a statement out of repairs alone would narrow execution on the strength of
 * something the caller never claimed.
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

// Scratch dependency rows never reach the registry, so their logo values are the
// birth state a real row would be inserted with rather than anything meaningful.
const SCRATCH_DEPENDENCY_SEED = 1;

function scratchDependencyRows(input: CapabilityGateInput): CapabilityRow[] {
  return (input.scratchCatalog ?? []).map((fixture) => ({
    ...fixture.spec,
    incarnation_id: fixture.incarnationId,
    version: 1,
    artifacts_path: `scratch/${fixture.spec.id}`,
    seed: SCRATCH_DEPENDENCY_SEED,
    logo: { status: LOGO_BIRTH_STATUS, attempts: 0 },
  }));
}

function normalizeMaxAttempts(value: number | undefined): number {
  if (value === undefined) return DEFAULT_UNIT_FIX_ATTEMPTS;
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError("Behavioral maxAttempts must be a positive integer.");
  }
  return value;
}

function sumAttemptUsage(attempts: readonly BehavioralRepairAttempt[]): TokenUsage {
  return sumUsage(attempts.flatMap((attempt) => (attempt.usage ? [attempt.usage] : [])));
}

function sumUsage(usages: readonly TokenUsage[]): TokenUsage {
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
