// The behavioral-tier transition table: what a version carries, and what it re-proves.
//
//  | Prior | Cand | Test-input change            | Test artifact/execution                                 |
//  | off   | off  | any                          | absent; no generation or execution                      |
//  | off   | on   | any                          | generate, freeze, and run from current candidate inputs |
//  | on    | on   | unchanged, no Handler impact | copy; do not run                                        |
//  | on    | on   | unchanged, Handler impacted  | copy; run impacted/full fallback                        |
//  | on    | on   | changed                      | generate, freeze, and run                               |
//  | on    | off  | any                          | absent; no copy or execution                            |
//
// The row is not written into `snapshot.json`: each half is already recorded, so a later reader
// derives it from two manifests, and storing it would make a manifest point at its predecessor.

import type { BehavioralActionExecution, BehavioralExecutionPlan } from "../../../builder/index.ts";
import type { CapabilityTool } from "../../../registry/index.ts";

/** The global tier as one snapshot records it. */
export type BehavioralTierState = "on" | "off";

/** Decision 24's six rows, as the row that applied. */
export const BEHAVIORAL_TIER_TRANSITION_ROWS = [
  // off→off: this version carries no behavioral-test artifacts at all.
  "tier_off",
  // off→on: the prior snapshot holds no frozen tests, so every Action's suite is authored from
  // the current candidate inputs and every one of them runs.
  "tier_enabled",
  // on→on, this Action's inputs unchanged and nothing it covers moved: the prior frozen bytes
  // carry and execute nothing. The only lawful skip.
  "carried_unrun",
  // on→on, inputs unchanged but the build's impact reaches it: the same frozen bytes are
  // re-proven against new code, narrowed to the impacted suites or, when unsound, the full one.
  "carried_rerun",
  // on→on, this build authored the suite: the Action's inputs changed, or the freeze stage found
  // an otherwise-unchanged carried suite inadmissible. Frozen and run; it has judged no code.
  "regenerated",
  // on→off: the prior version's frozen tests are neither copied nor run.
  "tier_disabled",
] as const;

export type BehavioralTierTransitionRow = (typeof BEHAVIORAL_TIER_TRANSITION_ROWS)[number];

/**
 * The table's own "Test artifact/execution" cell, verbatim per row. Carried in the payload so the
 * panel showing a transition is legible without the PLAN open.
 */
export const BEHAVIORAL_TIER_TRANSITION_DISPOSITIONS: Readonly<
  Record<BehavioralTierTransitionRow, string>
> = {
  tier_off: "absent; no generation or execution",
  tier_enabled: "generate, freeze, and run from current candidate inputs",
  carried_unrun: "copy; do not run",
  carried_rerun: "copy; run impacted/full fallback",
  regenerated: "generate, freeze, and run",
  tier_disabled: "absent; no copy or execution",
};

export interface BehavioralTierTransitionEntry {
  readonly row: BehavioralTierTransitionRow;
  /** The Action the row applied to. Absent on the two tier-off rows, which name none. */
  readonly action?: CapabilityTool;
  readonly disposition: string;
}

export interface BehavioralTierTransition {
  readonly prior: BehavioralTierState;
  readonly candidate: BehavioralTierState;
  /** Whether this version's snapshot carries behavioral-test artifacts at all. */
  readonly artifacts: "present" | "absent";
  /**
   * The rows that applied: exactly one naming no Action when the candidate tier is off, since
   * there is no per-Action suite; otherwise one per frozen suite in the artifact's order.
   */
  readonly rows: readonly BehavioralTierTransitionEntry[];
}

export interface BehavioralTierTransitionInput {
  /** The committed snapshot's recorded tier — the table's "Prior snapshot" column. */
  readonly prior: BehavioralTierState;
  readonly candidate: BehavioralTierState;
  /** The Gate's per-Action verdict. Required exactly when the candidate tier is on. */
  readonly execution?: BehavioralExecutionPlan;
}

/**
 * Names the row decision 24's table applied to this version. It decides nothing: the freeze stage
 * settled generation and `planBehavioralExecution` execution, and every pair reaches one branch.
 */
export function behavioralTierTransition(
  input: BehavioralTierTransitionInput,
): BehavioralTierTransition {
  const { prior, candidate } = input;
  if (candidate === "off") {
    // A tier-off build authors no suite, so there is nothing for the Gate to have planned.
    // An execution plan arriving here would mean the two halves disagree about the tier.
    if (input.execution) {
      throw new BehavioralTierTransitionError(
        "A tier-off version cannot carry a behavioral execution plan.",
      );
    }
    return {
      prior,
      candidate,
      artifacts: "absent",
      rows: [entry(prior === "on" ? "tier_disabled" : "tier_off")],
    };
  }
  const execution = input.execution;
  if (!execution) {
    throw new BehavioralTierTransitionError(
      "A tier-on version must carry the Gate's behavioral execution plan.",
    );
  }
  return {
    prior,
    candidate,
    artifacts: "present",
    rows: execution.actions.map((action) => entry(rowFor(prior, action), action.action)),
  };
}

export class BehavioralTierTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BehavioralTierTransitionError";
  }
}

/**
 * One on→on Action's row, or the single off→on row. Two crossings fail closed here, because every
 * row this function can return states an outcome and stating a false one is worse than refusing.
 */
function rowFor(
  prior: BehavioralTierState,
  action: BehavioralActionExecution,
): BehavioralTierTransitionRow {
  if (action.source === "generated") {
    // A suite authored here and skipped has judged no code, so "generate, freeze, and run" would
    // be false; `assertBehavioralTestMetadataShape` rejects it at publication too.
    if (action.execution !== "executed") {
      throw new BehavioralTierTransitionError(
        `The ${action.action} suite was authored by this build and never executed against it.`,
      );
    }
    return prior === "off" ? "tier_enabled" : "regenerated";
  }
  // A tier-off snapshot holds no `tests/behavioral.json`, so there is nothing a copy could have
  // come from, and reporting one would claim frozen intent with no provenance.
  if (prior === "off") {
    throw new BehavioralTierTransitionError(
      `The ${action.action} suite was carried forward, but the prior snapshot is tier-off and holds no frozen tests.`,
    );
  }
  return action.execution === "executed" ? "carried_rerun" : "carried_unrun";
}

function entry(
  row: BehavioralTierTransitionRow,
  action?: CapabilityTool,
): BehavioralTierTransitionEntry {
  return {
    row,
    ...(action ? { action } : {}),
    disposition: BEHAVIORAL_TIER_TRANSITION_DISPOSITIONS[row],
  };
}
