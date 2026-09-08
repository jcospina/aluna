// Runtime failure attribution for the frozen behavioral rung: given a failing frozen assertion,
// whose fault is it — answered without ever considering the possibility that the test is wrong.
// The suite was frozen before a single Handler byte existed, so the code is the variable.
//
// The rule is short because the executor makes it short: `runFullBehavioralCase` invokes exactly
// one generated Handler, so only two generated units can be implicated in a case — that Handler,
// and, for assertions over the rendered fragment, the shared item renderer. A failure before the
// Handler ran fails closed; one in the Handler call or the rows it left behind is total; one the
// renderer could have caused widens to the conservative set when the renderer may have moved too.
//
// Repair only rewrites Handlers, so a broken renderer is not repairable here: it exhausts the
// budget and fails closed, leaving the prior version live. `item.ts` is design lint's own loop.

import type { CapabilitySpec } from "../../../../../registry/index.ts";
import { FULL_CAPABILITY_TOOLS } from "../../../../../registry/index.ts";
import type { HandlerUnitName } from "../../../../units/generation/units.ts";
import type { BehavioralExecutionImpact } from "../freeze/behavioral-execution-plan.ts";

/**
 * Where in one frozen case's execution the failure surfaced, tagged at the throw site rather than
 * sniffed from a message. `fragment` includes a throw from inside the renderer itself.
 */
export const BEHAVIORAL_FAILURE_SURFACES = [
  "setup",
  "handler_invocation",
  "fragment",
  "row_state",
] as const;

export type BehavioralFailureSurface = (typeof BEHAVIORAL_FAILURE_SURFACES)[number];

/**
 * Why repair may rewrite the Handlers it is about to. Closed and recorded per attempt, so
 * "we regenerated five Handlers" is auditable next to the reason narrowing to one was refused.
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
   * This build's executable impact as the repair loop knows it. Absent is also a statement:
   * nothing can be proven unmoved.
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
 * Attribute one failing frozen case to the Handler set repair may rewrite. Pure, and independent
 * of which suites ran; the impact statement is consulted only about the shared item renderer.
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
