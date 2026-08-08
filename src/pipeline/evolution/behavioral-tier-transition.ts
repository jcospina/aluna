// The behavioral-tier transition table: what a new version carries, and what it re-proves,
// for every pair of (prior snapshot tier, candidate tier).
//
//   | Prior snapshot | Candidate tier | Test-input change            | Test artifact/execution                       |
//   | -------------- | -------------- | ---------------------------- | --------------------------------------------- |
//   | off            | off            | any                          | absent; no generation or execution             |
//   | off            | on             | any                          | generate, freeze, and run from current inputs  |
//   | on             | on             | unchanged, no Handler impact | copy; do not run                               |
//   | on             | on             | unchanged, Handler impacted  | copy; run impacted/full fallback               |
//   | on             | on             | changed                      | generate, freeze, and run                      |
//   | on             | off            | any                          | absent; no copy or execution                   |
//
// Nothing here decides anything: generation was settled at the freeze stage and execution
// by `planBehavioralExecution`. What this adds is the *name* of the row those two landed
// on, which buys two things — the build can report its transition while it is happening
// (tier-off rows have empty per-Action reports, so without the row the panel shows
// nothing), and the crossing neither half can express on its own (a suite carried out of a
// snapshot that holds none, or a suite authored this build and never run) fails closed
// here rather than reaching publication as an ordinary copy.
//
// The row is deliberately not written into `snapshot.json`. A transition is a fact about a
// *pair* of versions and each half is already recorded, so a later reader derives the row
// from two manifests it already has. Storing it would make the manifest a pointer to its
// predecessor.

import type { BehavioralActionExecution, BehavioralExecutionPlan } from "../../builder/index.ts";
import type { CapabilityTool } from "../../registry/index.ts";

/** The global tier as one snapshot records it. */
export type BehavioralTierState = "on" | "off";

/**
 * Decision 24's six rows, as the row that applied.
 *
 * - `tier_off` — off→off: this version carries no behavioral-test artifacts at all.
 * - `tier_enabled` — off→on: the prior snapshot holds no frozen tests, so every Action's
 *   suite is authored from the current candidate inputs and every one of them runs.
 * - `carried_unrun` — on→on, this Action's inputs unchanged and nothing it covers moved:
 *   the prior frozen bytes carry and execute nothing. The only lawful skip.
 * - `carried_rerun` — on→on, inputs unchanged but the build's impact reaches it: the same
 *   frozen bytes are re-proven against new code, narrowed to the impacted suites or, when
 *   narrowing is not sound, the full frozen suite.
 * - `regenerated` — on→on, this build authored the suite rather than carrying it: normally
 *   because the Action's total inputs changed, and also on the freeze stage's cache-miss
 *   path, where an otherwise-unchanged carried suite was found inadmissible. Either way it
 *   is frozen and run, because it has never judged any code.
 * - `tier_disabled` — on→off: the prior version's frozen tests are neither copied nor run.
 */
export const BEHAVIORAL_TIER_TRANSITION_ROWS = [
  "tier_off",
  "tier_enabled",
  "carried_unrun",
  "carried_rerun",
  "regenerated",
  "tier_disabled",
] as const;

export type BehavioralTierTransitionRow = (typeof BEHAVIORAL_TIER_TRANSITION_ROWS)[number];

/**
 * The table's own "Test artifact/execution" cell, verbatim per row. Carried in the payload
 * rather than left to a reading of the PLAN, because the panel showing a transition is the
 * surface on which "artifacts present/absent" has to be legible without the document open.
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
   * The rows that applied. Exactly one — naming no Action — when the candidate tier is off,
   * because a tier-off version has no per-Action suite to say anything about; otherwise one
   * per frozen Action suite, in the artifact's canonical order.
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
 * Name the row decision 24's table applied to this version. Pure, and total over the six
 * rows: every (prior, candidate) pair reaches exactly one branch, and within on→on every
 * (source, execution) pair the Gate can produce maps to exactly one row.
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
 * One on→on Action's row, or the single off→on row.
 *
 * Two crossings are unrepresentable rather than merely unlikely, and both fail closed here
 * — every row this function can return states an outcome, and stating a false one is worse
 * than refusing:
 *
 *   - a `copied` suite over a tier-off prior. That snapshot holds no
 *     `tests/behavioral.json`, so there is nothing the bytes could have been copied *from*;
 *     reporting a copy would claim frozen intent whose provenance does not exist.
 *   - a suite this build authored and then skipped. It has judged no code at all, so
 *     "generate, freeze, and run" would be a false claim about a published version. The
 *     manifest rejects it too (`assertBehavioralTestMetadataShape`); saying so before the
 *     preview reports it keeps the two boundaries in agreement.
 */
function rowFor(
  prior: BehavioralTierState,
  action: BehavioralActionExecution,
): BehavioralTierTransitionRow {
  if (action.source === "generated") {
    if (action.execution !== "executed") {
      throw new BehavioralTierTransitionError(
        `The ${action.action} suite was authored by this build and never executed against it.`,
      );
    }
    return prior === "off" ? "tier_enabled" : "regenerated";
  }
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
