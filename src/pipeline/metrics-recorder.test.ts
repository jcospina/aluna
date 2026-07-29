// The behavioral tier's stage vector — Module 4.7/03 (PLAN decisions 24, 28).
//
// `lifecycleStages` is a pure projection of one run's accumulator, and decision 24 makes its
// behavioral rows a claim about the tier: what this version did about its *intent*
// (generated it, or copied the prior frozen bytes) and what it did about the *code*
// (executed that suite, or skipped it). The engine batteries prove the rows a real evolution
// produces; these prove the projection itself over the accumulator states a run can reach —
// including the one the Diff cannot reach on its own, a carried suite re-run because a
// Handler it covers moved.

import { describe, expect, test } from "bun:test";
import type { BehavioralActionExecution, BehavioralTestActionReport } from "../builder/index.ts";
import type { CapabilityTool } from "../registry/index.ts";
import { type DemoBuildAccumulator, lifecycleStages } from "./metrics-recorder.ts";

const ACTIONS = ["create", "read", "update", "delete", "search"] as const;

function freezeReport(carried: readonly CapabilityTool[]): readonly BehavioralTestActionReport[] {
  return ACTIONS.map((action) => ({
    action,
    status: carried.includes(action) ? ("carried" as const) : ("generated" as const),
    inputDigest: `sha256:${action}`,
    caseCount: 2,
    inputs: {
      behavior: true as const,
      schemaFields: [],
      behavioralErrorCodes: [],
      dependencies: [],
    },
  }));
}

function executionPlan(
  entries: Readonly<
    Partial<
      Record<CapabilityTool, Pick<BehavioralActionExecution, "source" | "execution" | "reason">>
    >
  >,
): readonly BehavioralActionExecution[] {
  return ACTIONS.map((action) => {
    const entry = entries[action] ?? {
      source: "copied" as const,
      execution: "skipped" as const,
      reason: "no_covered_handler_change" as const,
    };
    return { action, ...entry, caseCount: 2 };
  });
}

/** A tier-on run that reached the Gate: rungs recorded, both timings filled. */
function tierOnAccumulator(overrides: Partial<DemoBuildAccumulator>): DemoBuildAccumulator {
  return {
    usages: [],
    timings: { testGenMs: 3, testRunMs: 5 },
    gateRungs: (["structural", "smoke", "behavioral", "design-lint"] as const).map((rung) => ({
      rung,
      status: "passed" as const,
      durationMs: 1,
    })),
    ...overrides,
  };
}

function behavioralRows(stages: ReturnType<typeof lifecycleStages>): string[] {
  return stages
    .filter((stage) => stage.stage.startsWith("behavioral_test_"))
    .map(
      (stage) =>
        `${stage.test?.name ?? "*"}:${stage.stage.slice("behavioral_test_".length)}:${stage.state}`,
    );
}

describe("the behavioral tier's stage vector", () => {
  test("a carried suite re-run over a regenerated Handler reports copied and executed", () => {
    // Decision 24's fourth row in its narrowed form. It cannot arise from the Diff — every
    // change fact that regenerates a Handler also regenerates that Action's tests — so it
    // reaches a published version only through a Gate repair, and this is where the metrics
    // half of that row is pinned. Its snapshot half is in `artifact-lifecycle.test.ts`.
    const stages = lifecycleStages(
      tierOnAccumulator({
        behavioralFreeze: freezeReport([...ACTIONS]),
        behavioralExecution: executionPlan({
          update: {
            source: "copied",
            execution: "executed",
            reason: "covered_handler_regenerated",
          },
        }),
      }),
      "activated",
    );

    expect(behavioralRows(stages)).toEqual([
      // The aggregate pair: every suite was carried, and something did run.
      "*:generation:copied",
      "*:execution:executed",
      "create:generation:copied",
      "create:execution:skipped",
      "read:generation:copied",
      "read:execution:skipped",
      "update:generation:copied",
      "update:execution:executed",
      "delete:generation:copied",
      "delete:execution:skipped",
      "search:generation:copied",
      "search:execution:skipped",
    ]);
  });

  test("the tier-off rows report an absence, not a skip that never happened", () => {
    // Decision 24's two tier-off rows: no artifact, and nothing per Action to report. The
    // Gate ran (its behavioral rung is present and skipped), which is what distinguishes
    // `absent` from the `skipped` a run that never reached the tier records.
    const stages = lifecycleStages(
      {
        usages: [],
        timings: {},
        gateRungs: [
          { rung: "structural", status: "passed", durationMs: 1 },
          { rung: "smoke", status: "passed", durationMs: 1 },
          { rung: "behavioral", status: "skipped", durationMs: 0 },
          { rung: "design-lint", status: "passed", durationMs: 1 },
        ],
      },
      "activated",
    );

    expect(behavioralRows(stages)).toEqual(["*:generation:absent", "*:execution:absent"]);
  });

  test("a run that froze intent and then failed is not a tier-off row", () => {
    // The freeze stage records itself, so a build that authored suites and then died says
    // so. Without `behavioralFreeze` this would read `skipped`/`skipped` — the signature of
    // a run that never turned the tier on — and the tokens it spent would explain nothing.
    const stages = lifecycleStages(
      { usages: [], timings: { testGenMs: 3 }, behavioralFreeze: freezeReport(["read", "delete"]) },
      "failed",
      { stage: "unit_generation" },
    );

    expect(behavioralRows(stages)).toEqual(["*:generation:generated", "*:execution:skipped"]);
  });

  test("every suite carried and nothing run is `copied`/`skipped`, read off the freeze", () => {
    const stages = lifecycleStages(
      tierOnAccumulator({
        behavioralFreeze: freezeReport([...ACTIONS]),
        behavioralExecution: executionPlan({}),
      }),
      "activated",
    );

    expect(behavioralRows(stages).slice(0, 2)).toEqual([
      "*:generation:copied",
      "*:execution:skipped",
    ]);
  });
});
