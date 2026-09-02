// Runtime failure attribution for the frozen behavioral rung: given a failing frozen
// assertion, **whose fault is it?** — answered without ever considering the possibility
// that the test is wrong. The suite was frozen before a single Handler byte existed, so the
// code is the variable and the intent is the constant.
//
// The rule is short because the executor makes it short. `runFullBehavioralCase` seeds
// setup rows through the platform mutation port, invokes exactly one generated Handler, and
// reads state back through the platform query port. Exactly two generated units can be
// implicated in a case: that Handler, and — only for assertions over the rendered fragment
// — the shared item renderer. So:
//
//   - a failure before the Handler ran is nobody's Handler's fault (fail closed);
//   - a failure in the Handler call, or in the scratch rows it left behind, is that one
//     Handler's fault — attribution is total;
//   - a failure the shared item renderer could have caused — a fragment assertion, or a
//     throw from inside the renderer while the Handler was calling it — is that one
//     Handler's fault *unless* the renderer may also have moved, in which case blaming the
//     Handler would require assuming the frozen assertion is unsatisfiable. That case is
//     the conservative Handler set.
//
// Repair may only ever rewrite Handlers, so a genuinely broken renderer is not repairable
// here by design: it exhausts the bounded budget and fails the Gate closed, leaving the
// prior version live. `item.ts` belongs to the design-lint rung's own fix loop.

import type { CapabilitySpec } from "../../../../../registry/index.ts";
import { FULL_CAPABILITY_TOOLS } from "../../../../../registry/index.ts";
import type { HandlerUnitName } from "../../../../units/generation/units.ts";
import type { BehavioralExecutionImpact } from "../freeze/behavioral-execution-plan.ts";

/**
 * Where in one frozen case's execution the failure surfaced. Closed, and tagged at the
 * throw site rather than sniffed out of a message, because attribution is a verdict about
 * which generated unit ran — not a guess about how an error was worded.
 *
 * - `setup` — platform work before the Handler was invoked (scratch schema, seeded rows).
 * - `handler_invocation` — the Handler threw, or its thrown/absent platform error did not
 *   match what the frozen case expects.
 * - `fragment` — anything the shared `item.ts` could be responsible for: an assertion over
 *   the returned fragment, *and* a throw from inside the renderer itself, which happens
 *   during the Handler call and would otherwise masquerade as the Handler's own failure.
 * - `row_state` — an assertion over the scratch rows the Handler left behind; the item
 *   renderer is not involved in producing them.
 */
export const BEHAVIORAL_FAILURE_SURFACES = [
  "setup",
  "handler_invocation",
  "fragment",
  "row_state",
] as const;

export type BehavioralFailureSurface = (typeof BEHAVIORAL_FAILURE_SURFACES)[number];

/**
 * Why repair may rewrite the Handlers it is about to rewrite. Closed and recorded per
 * attempt: "we regenerated five Handlers" is only auditable next to the reason narrowing
 * to one was refused.
 *
 * - `single_handler_execution` — total: exactly one generated Handler could have caused it.
 * - `fragment_with_regenerated_item_renderer` — a fragment assertion failed while the
 *   shared renderer moved in this same build, so the failure cannot be pinned.
 * - `fragment_with_unstated_impact` — a fragment assertion failed and this build never
 *   said what it regenerated, so the renderer cannot be proven to have stayed put.
 * - `no_handler_executed` — the case failed before any Handler ran; nothing is repairable
 *   and the Gate fails closed.
 */
export const BEHAVIORAL_ATTRIBUTION_REASONS = [
  "single_handler_execution",
  "fragment_with_regenerated_item_renderer",
  "fragment_with_unstated_impact",
  "no_handler_executed",
] as const;

export type BehavioralAttributionReason = (typeof BEHAVIORAL_ATTRIBUTION_REASONS)[number];

export interface BehavioralFailureAttribution {
  /** True exactly when one Handler is named. Total attribution repairs precisely that one. */
  readonly total: boolean;
  readonly reason: BehavioralAttributionReason;
  /**
   * The Handlers repair may rewrite, in the canonical Action order. Empty means nothing may
   * be rewritten: the Gate fails closed rather than regenerating an innocent unit.
   */
  readonly handlers: readonly HandlerUnitName[];
}

export interface BehavioralFailureAttributionInput {
  readonly surface: BehavioralFailureSurface;
  /** The Action whose Handler the failing frozen case invoked. */
  readonly action: HandlerUnitName;
  /**
   * This build's executable impact as the repair loop currently knows it (the caller's
   * statement plus any Handler the Gate has already repaired). Absent means the build
   * stated nothing at all, which is also a statement: nothing can be proven unmoved.
   */
  readonly impact?: BehavioralExecutionImpact;
  /** The Actions this capability declares — decision 22's conservative set. */
  readonly declaredHandlers: readonly HandlerUnitName[];
}

/** The conservative Handler set: every Action the capability declares. */
export function declaredHandlerSet(spec: CapabilitySpec): readonly HandlerUnitName[] {
  return FULL_CAPABILITY_TOOLS.filter((action) => spec.tools.includes(action));
}

/**
 * Attribute one failing frozen case to the Handler set repair may rewrite.
 *
 * Pure, and deliberately independent of *which* suites ran: a copied Handler that this
 * build never touched is still the Handler that just failed its own frozen intent, and
 * repairing it is the only lawful response. What the impact statement is consulted for is
 * narrower and specific — whether the shared item renderer is a live suspect.
 */
export function attributeBehavioralFailure(
  input: BehavioralFailureAttributionInput,
): BehavioralFailureAttribution {
  if (input.surface === "setup") {
    return { total: false, reason: "no_handler_executed", handlers: [] };
  }
  if (input.surface !== "fragment") {
    return { total: true, reason: "single_handler_execution", handlers: [input.action] };
  }
  const conservative = conservativeReason(input.impact);
  if (!conservative) {
    return { total: true, reason: "single_handler_execution", handlers: [input.action] };
  }
  return { total: false, reason: conservative, handlers: [...input.declaredHandlers] };
}

function conservativeReason(
  impact: BehavioralExecutionImpact | undefined,
):
  | Exclude<BehavioralAttributionReason, "single_handler_execution" | "no_handler_executed">
  | undefined {
  if (!impact) return "fragment_with_unstated_impact";
  if (impact.regeneratedItemRenderer) return "fragment_with_regenerated_item_renderer";
  return undefined;
}
