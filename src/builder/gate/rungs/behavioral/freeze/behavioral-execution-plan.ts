// Behavioral test execution selection (PLAN decision 23's execution clause; ADR-0006; ARCH §6.2
// step 5).
//
// Generation follows total per-Action inputs. Execution follows executable impact, and this
// module is the whole of that decision: a suite this build generated has never run against any
// code, so it runs; a suite copied byte-for-byte from the prior version runs whenever a Handler
// it covers regenerates; only when no covered Handler changed may a copied suite skip; and when
// coverage or runtime failure attribution cannot be narrowed, the complete frozen suite runs
// rather than trusting a narrowing that is not sound.
//
// The rule is stated once, here, over data the Gate already has, so a developer can read the
// whole run/skip verdict and its reason without re-deriving it from the Diff.

import type { CapabilityTool } from "../../../../../registry/index.ts";
import type { HandlerUnitName } from "../../../../units/generation/units.ts";
import type {
  FrozenBehavioralTests,
  FullBehavioralTestCase,
} from "../generation/gate-behavioral-full-schema.ts";

/**
 * The executable impact of one build, as its caller knows it *before* the Gate runs. Absent,
 * nothing is provably unaffected and every suite runs — the safe answer when nobody said.
 */
export interface BehavioralExecutionImpact {
  /** Handler units this build authors, rather than copying forward byte-for-byte. */
  readonly regeneratedHandlers: readonly HandlerUnitName[];
  /**
   * Whether `item.ts` moved too. Every fragment assertion renders through it, so a failure
   * beside a moved renderer pins on no Handler and narrowing stops being sound.
   */
  readonly regeneratedItemRenderer?: boolean;
  /**
   * Set when the caller's change facts scope to no Action (PLAN decision 22). The sentence
   * shows as the run's reason, so the fallback reads as a decision, not an accident.
   */
  readonly unnarrowableReason?: string;
}

/**
 * Why one Action's frozen suite ran, or did not — closed, because the snapshot records it.
 * `no_covered_handler_change` is the only lawful skip; the rest all run (PLAN decision 22).
 */
export const BEHAVIORAL_EXECUTION_REASONS = [
  "generated_this_build",
  "covered_handler_regenerated",
  "full_suite_fallback",
  "no_covered_handler_change",
] as const;

export type BehavioralExecutionReason = (typeof BEHAVIORAL_EXECUTION_REASONS)[number];

export interface BehavioralActionExecution {
  readonly action: CapabilityTool;
  /** Where this version's cases came from: authored now, or carried byte-for-byte. */
  readonly source: "generated" | "copied";
  readonly execution: "executed" | "skipped";
  readonly reason: BehavioralExecutionReason;
  readonly caseCount: number;
}

export interface BehavioralExecutionPlan {
  /** One entry per frozen Action suite, in the artifact's canonical order. */
  readonly actions: readonly BehavioralActionExecution[];
  /** True when narrowing was rejected and the complete frozen suite ran. */
  readonly fullSuite: boolean;
  /** Present exactly when `fullSuite` is true: the sentence naming what could not be narrowed. */
  readonly fullSuiteReason?: string;
}

export interface BehavioralExecutionPlanInput {
  readonly frozenTests: FrozenBehavioralTests;
  /** Actions whose suites this build authored; every other frozen suite was copied. */
  readonly generatedActions: readonly CapabilityTool[];
  readonly impact?: BehavioralExecutionImpact;
}

const IMPACT_NOT_STATED =
  "this build did not state which Handlers it regenerated, so no copied suite can be proven unaffected";
const ITEM_RENDERER_MOVED =
  "the shared item renderer changed alongside Handler bytes, so a failing fragment assertion could not be attributed to one Handler";

/**
 * The Handlers one Action's frozen suite covers: exactly one, because `runFullBehavioralCase`
 * loads no other. A test poisons every other Handler and watches the suite still pass.
 */
export function behavioralSuiteCoverage(action: CapabilityTool): readonly HandlerUnitName[] {
  return [action];
}

/**
 * Decide which frozen Action suites this Gate executes. Pure, and total: every Action comes
 * back with its verdict and the reason for it.
 */
export function planBehavioralExecution(
  input: BehavioralExecutionPlanInput,
): BehavioralExecutionPlan {
  const generated = new Set<CapabilityTool>(input.generatedActions);
  const changedHandlers = new Set<HandlerUnitName>(input.impact?.regeneratedHandlers ?? []);
  const narrowed = input.frozenTests.actions.map((entry): BehavioralActionExecution => {
    const source = generated.has(entry.action) ? "generated" : "copied";
    const reason: BehavioralExecutionReason =
      source === "generated"
        ? "generated_this_build"
        : behavioralSuiteCoverage(entry.action).some((handler) => changedHandlers.has(handler))
          ? "covered_handler_regenerated"
          : "no_covered_handler_change";
    return {
      action: entry.action,
      source,
      execution: reason === "no_covered_handler_change" ? "skipped" : "executed",
      reason,
      caseCount: entry.cases.length,
    };
  });

  // The fallback stops an unsound skip, so a plan that skips nothing needs none: a first
  // build, where every suite is new, must not report as a full-suite fallback.
  if (!narrowed.some((entry) => entry.execution === "skipped")) {
    return { actions: narrowed, fullSuite: false };
  }
  const fullSuiteReason = unnarrowableReason(input.impact, changedHandlers);
  if (!fullSuiteReason) return { actions: narrowed, fullSuite: false };
  return {
    actions: narrowed.map((entry) =>
      entry.execution === "executed"
        ? entry
        : { ...entry, execution: "executed" as const, reason: "full_suite_fallback" as const },
    ),
    fullSuite: true,
    fullSuiteReason,
  };
}

/**
 * Why this build may not narrow execution, or `undefined` when it may. Ordered coarsest
 * first: an unstated impact, then facts naming no Action, then a moved item renderer.
 */
function unnarrowableReason(
  impact: BehavioralExecutionImpact | undefined,
  changedHandlers: ReadonlySet<HandlerUnitName>,
): string | undefined {
  if (!impact) return IMPACT_NOT_STATED;
  if (impact.unnarrowableReason) return impact.unnarrowableReason;
  if (impact.regeneratedItemRenderer && changedHandlers.size > 0) return ITEM_RENDERER_MOVED;
  return undefined;
}

/**
 * The cases the rung executes, in the frozen artifact's canonical order — the same bytes,
 * filtered by Action, never rewritten. A plan that executes nothing yields an empty list.
 */
export function selectedBehavioralCases(
  frozenTests: FrozenBehavioralTests,
  plan: BehavioralExecutionPlan,
): readonly FullBehavioralTestCase[] {
  const executed = new Set(
    plan.actions.filter((entry) => entry.execution === "executed").map((entry) => entry.action),
  );
  return frozenTests.actions.flatMap((entry) => (executed.has(entry.action) ? entry.cases : []));
}
