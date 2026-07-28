// Behavioral test execution selection — Module 4, Epic 4.7/02 (PLAN decision 23's
// execution clause; ADR-0006 "frozen tests and immutable snapshots"; ARCH §6.2 step 5).
//
// Generation follows total per-Action inputs (4.7/01). *Execution* follows executable
// impact, and this module is the whole of that decision:
//
//   - a suite this build generated has never run against any code, so it runs;
//   - a suite copied byte-for-byte from the prior version runs whenever a Handler it
//     covers regenerates;
//   - only when no covered Handler changed may a copied suite skip execution;
//   - and when coverage or runtime failure attribution cannot be narrowed, the complete
//     frozen suite runs instead of trusting a narrowing that is not sound.
//
// The rule is stated once, here, over data the Gate already has, so a developer can read
// the whole run/skip verdict — and its reason — without re-deriving it from the Diff.

import type { CapabilityTool } from "../../../registry/index.ts";
import type { HandlerUnitName } from "../../units/units.ts";
import type {
  FrozenBehavioralTests,
  FullBehavioralTestCase,
} from "./gate-behavioral-full-schema.ts";

/**
 * The executable impact of one build, as its caller knows it *before* the Gate runs.
 * Absent entirely, the Gate cannot prove any copied suite unaffected and runs everything —
 * failing safe is the only honest answer to "which Handlers moved?" when nobody said.
 */
export interface BehavioralExecutionImpact {
  /** Handler units this build authors, rather than copying forward byte-for-byte. */
  readonly regeneratedHandlers: readonly HandlerUnitName[];
  /**
   * Whether `item.ts` moved too. It is not a Handler and covers no Action on its own, but
   * every fragment assertion renders through it — so a Handler failure alongside a moved
   * renderer is not attributable to that Handler, and narrowing stops being sound.
   */
  readonly regeneratedItemRenderer?: boolean;
  /**
   * Set when the caller's own change facts could not be scoped to Actions at all (PLAN
   * decision 22's conservative fallback, e.g. a free-text `behavior` change). The sentence
   * is shown as the run's reason, so the fallback reads as a decision, not as an accident.
   */
  readonly unnarrowableReason?: string;
}

/**
 * Why one Action's frozen suite ran, or did not. Closed, because the snapshot records it:
 * an audit of "was this version's intent re-proven?" is only worth reading if the grounds
 * come from a fixed vocabulary.
 *
 * - `generated_this_build` — authored from changed inputs; it has never judged any code.
 * - `covered_handler_regenerated` — copied forward, but a Handler it covers moved.
 * - `full_suite_fallback` — copied and unaffected on its own, run because narrowing was
 *   not sound.
 * - `no_covered_handler_change` — copied and nothing it covers moved: the only lawful skip.
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
 * The Handlers one Action's frozen suite covers.
 *
 * Coverage is total and it is exactly one Handler, and that is a property of how the rung
 * executes rather than a claim about the generated cases: `runFullBehavioralCase` seeds
 * setup rows through the platform mutation port, invokes the single Handler named by the
 * case's Action, and reads state back through the platform query port. No other generated
 * Handler is loaded or called. That is what makes "run only the impacted suites" a fact
 * about the executor instead of an assumption about the model's output — and it is pinned
 * by a test that poisons every other Handler and watches the suite still pass.
 */
export function behavioralSuiteCoverage(action: CapabilityTool): readonly HandlerUnitName[] {
  return [action];
}

/**
 * Decide which frozen Action suites this Gate executes. Pure: it reads the frozen artifact,
 * the freeze stage's generated/copied split, and the build's stated impact, and returns the
 * complete per-Action verdict with the reason for each.
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

  // The fallback exists to stop an *unsound skip*. When the narrowed plan skips nothing, no
  // narrowing is being relied on, so there is nothing to fall back from — a first build,
  // where every suite is new, is not a "full-suite fallback" and must not report as one.
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
 * Why this build may not narrow execution, or `undefined` when it may. Ordered from the
 * coarsest ignorance to the most specific: an unstated impact says nothing at all, a caller-
 * declared unscoped fact says "these facts name no Action", and a moved item renderer says
 * "these facts name Actions, but a failure could not be pinned to one".
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
 * The cases the rung executes, in the frozen artifact's canonical order — the same bytes
 * the artifact carries, filtered by Action, never rewritten. A plan that executes nothing
 * yields an empty list, and the rung runs no test at all.
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
