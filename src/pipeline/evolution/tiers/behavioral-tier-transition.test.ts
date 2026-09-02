// Decision 24's behavioral-tier transition table.
//
// The table itself, row by row, over the two facts it is a function of: the committed
// snapshot's recorded tier and the Gate's per-Action execution plan. The end-to-end half —
// that a published version's artifacts and metrics actually match the row named here — is
// `evolution-tier-transition.test.ts`; these are the rules.

import { describe, expect, test } from "bun:test";
import type { BehavioralActionExecution, BehavioralExecutionPlan } from "../../../builder/index.ts";
import type { CapabilityTool } from "../../../registry/index.ts";
import {
  BEHAVIORAL_TIER_TRANSITION_DISPOSITIONS,
  BEHAVIORAL_TIER_TRANSITION_ROWS,
  BehavioralTierTransitionError,
  behavioralTierTransition,
} from "./behavioral-tier-transition.ts";

const ACTIONS = ["create", "read", "update", "delete", "search"] as const;

function execution(
  entries: Readonly<
    Partial<Record<CapabilityTool, Pick<BehavioralActionExecution, "source" | "execution">>>
  >,
  fullSuite = false,
): BehavioralExecutionPlan {
  const actions = ACTIONS.map((action): BehavioralActionExecution => {
    const entry = entries[action] ?? { source: "copied", execution: "skipped" };
    return {
      action,
      source: entry.source,
      execution: entry.execution,
      reason:
        entry.source === "generated"
          ? "generated_this_build"
          : entry.execution === "executed"
            ? "covered_handler_regenerated"
            : "no_covered_handler_change",
      caseCount: 2,
    };
  });
  return fullSuite
    ? { actions, fullSuite: true, fullSuiteReason: "narrowing was refused" }
    : { actions, fullSuite: false };
}

const ALL_GENERATED = execution(
  Object.fromEntries(
    ACTIONS.map((action) => [action, { source: "generated", execution: "executed" }]),
  ),
);
const ALL_CARRIED = execution({});

describe("the behavioral-tier transition table (decision 24)", () => {
  test("off → off carries no artifacts and names the tier-off row", () => {
    expect(behavioralTierTransition({ prior: "off", candidate: "off" })).toEqual({
      prior: "off",
      candidate: "off",
      artifacts: "absent",
      rows: [{ row: "tier_off", disposition: "absent; no generation or execution" }],
    });
  });

  test("on → off is a different row from off → off, and neither copies", () => {
    // Both end with no artifacts, but only one of them had frozen intent to leave behind.
    // A reader of a tier-off version cannot tell those apart from the version alone, which
    // is the whole reason the row is named rather than inferred from "no tests present".
    const disabled = behavioralTierTransition({ prior: "on", candidate: "off" });
    expect(disabled.rows).toEqual([
      { row: "tier_disabled", disposition: "absent; no copy or execution" },
    ]);
    expect(disabled.artifacts).toBe("absent");
  });

  test("off → on generates, freezes, and runs every suite from current candidate inputs", () => {
    const transition = behavioralTierTransition({
      prior: "off",
      candidate: "on",
      execution: ALL_GENERATED,
    });
    expect(transition.artifacts).toBe("present");
    expect(transition.rows.map((entry) => `${entry.action}:${entry.row}`)).toEqual([
      "create:tier_enabled",
      "read:tier_enabled",
      "update:tier_enabled",
      "delete:tier_enabled",
      "search:tier_enabled",
    ]);
  });

  test("off → on fails closed on a suite claimed to be carried", () => {
    // There is nothing to carry: a tier-off snapshot holds no `tests/behavioral.json`. A
    // `copied` entry here would publish frozen intent whose source does not exist.
    expect(() =>
      behavioralTierTransition({
        prior: "off",
        candidate: "on",
        execution: execution({ read: { source: "copied", execution: "skipped" } }),
      }),
    ).toThrow(BehavioralTierTransitionError);
  });
});

describe("the transition table's on → on rows", () => {
  test("on → on with unchanged inputs and no Handler impact copies and does not run", () => {
    const transition = behavioralTierTransition({
      prior: "on",
      candidate: "on",
      execution: ALL_CARRIED,
    });
    expect(transition.rows.every((entry) => entry.row === "carried_unrun")).toBe(true);
    expect(transition.rows[0]?.disposition).toBe("copy; do not run");
  });

  test("on → on with unchanged inputs and a Handler impacted copies and runs", () => {
    const transition = behavioralTierTransition({
      prior: "on",
      candidate: "on",
      execution: execution({ update: { source: "copied", execution: "executed" } }),
    });
    expect(transition.rows.map((entry) => `${entry.action}:${entry.row}`)).toEqual([
      "create:carried_unrun",
      "read:carried_unrun",
      "update:carried_rerun",
      "delete:carried_unrun",
      "search:carried_unrun",
    ]);
    expect(transition.rows[2]?.disposition).toBe("copy; run impacted/full fallback");
  });

  test("the full-suite fallback is the same carried-rerun row for every suite it sweeps in", () => {
    // Decision 24's fourth row reads "copy; run impacted/full fallback" — one row for both
    // ways a carried suite can end up re-proven, because the artifact outcome is identical.
    const transition = behavioralTierTransition({
      prior: "on",
      candidate: "on",
      execution: execution(
        Object.fromEntries(
          ACTIONS.map((action) => [action, { source: "copied", execution: "executed" }]),
        ),
        true,
      ),
    });
    expect(transition.rows.every((entry) => entry.row === "carried_rerun")).toBe(true);
  });

  test("on → on with changed inputs regenerates, and mixes with the carried rows per Action", () => {
    const transition = behavioralTierTransition({
      prior: "on",
      candidate: "on",
      execution: execution({
        create: { source: "generated", execution: "executed" },
        update: { source: "generated", execution: "executed" },
      }),
    });
    expect(transition.rows.map((entry) => `${entry.action}:${entry.row}`)).toEqual([
      "create:regenerated",
      "read:carried_unrun",
      "update:regenerated",
      "delete:carried_unrun",
      "search:carried_unrun",
    ]);
  });

  test("the two halves must agree about the tier", () => {
    // A tier-off build authors no suite, so a plan reaching this point means the freeze
    // stage and the Gate disagree — the one input pairing the table has no row for.
    expect(() =>
      behavioralTierTransition({ prior: "on", candidate: "off", execution: ALL_CARRIED }),
    ).toThrow(BehavioralTierTransitionError);
    expect(() => behavioralTierTransition({ prior: "on", candidate: "on" })).toThrow(
      BehavioralTierTransitionError,
    );
  });

  test("a suite this build authored and never ran is refused, not reported as run", () => {
    // The mirror of the off→on guard. `regenerated`'s disposition claims the suite was run;
    // a version published on a freshly authored suite that judged no code is exactly what
    // the frozen tier exists to prevent, and `assertBehavioralTestMetadataShape` rejects it
    // at publication — so reporting it as an ordinary regeneration first would be the one
    // surface telling a developer the opposite of what the boundary is about to say.
    for (const prior of ["on", "off"] as const) {
      expect(() =>
        behavioralTierTransition({
          prior,
          candidate: "on",
          execution: execution({ delete: { source: "generated", execution: "skipped" } }),
        }),
      ).toThrow(BehavioralTierTransitionError);
    }
  });

  test("each row's disposition is the PLAN's own table cell, verbatim", () => {
    // Pinned against literals rather than against the module's constant, so editing a
    // disposition is a test failure instead of a silent rewording of decision 24's table.
    expect(BEHAVIORAL_TIER_TRANSITION_DISPOSITIONS).toEqual({
      tier_off: "absent; no generation or execution",
      tier_enabled: "generate, freeze, and run from current candidate inputs",
      carried_unrun: "copy; do not run",
      carried_rerun: "copy; run impacted/full fallback",
      regenerated: "generate, freeze, and run",
      tier_disabled: "absent; no copy or execution",
    });
  });

  test("every row in the closed vocabulary is reachable, and each carries its table cell", () => {
    // Totality both ways: no row is decoration, and no row can be reported without the
    // disposition the PLAN's table states for it.
    const reached = new Set(
      [
        behavioralTierTransition({ prior: "off", candidate: "off" }),
        behavioralTierTransition({ prior: "on", candidate: "off" }),
        behavioralTierTransition({ prior: "off", candidate: "on", execution: ALL_GENERATED }),
        behavioralTierTransition({ prior: "on", candidate: "on", execution: ALL_CARRIED }),
        behavioralTierTransition({
          prior: "on",
          candidate: "on",
          execution: execution({
            create: { source: "generated", execution: "executed" },
            read: { source: "copied", execution: "executed" },
          }),
        }),
      ].flatMap((transition) => transition.rows.map((entry) => entry.row)),
    );
    expect([...reached].sort()).toEqual([...BEHAVIORAL_TIER_TRANSITION_ROWS].sort());
    for (const transition of [
      behavioralTierTransition({ prior: "off", candidate: "on", execution: ALL_GENERATED }),
      behavioralTierTransition({ prior: "off", candidate: "off" }),
    ]) {
      for (const entry of transition.rows) {
        expect(entry.disposition).toBe(BEHAVIORAL_TIER_TRANSITION_DISPOSITIONS[entry.row]);
      }
    }
  });
});
