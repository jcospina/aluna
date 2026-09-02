// Execution selection for frozen behavioral suites — PLAN decision 23's execution
// clause. Generation follows total inputs; execution follows executable impact. These are
// the run/skip rules stated as facts about the plan, independent of any Gate machinery.

import { describe, expect, test } from "bun:test";
import type { CapabilityTool } from "../../../../../registry/index.ts";
import { frozenBehavioralTestsFor, notesSpec } from "../../../gate.test-support.ts";
import {
  type BehavioralExecutionImpact,
  behavioralSuiteCoverage,
  planBehavioralExecution,
  selectedBehavioralCases,
} from "./behavioral-execution-plan.ts";

const SPEC = notesSpec();
const FROZEN = frozenBehavioralTestsFor(SPEC);
const ALL_ACTIONS: readonly CapabilityTool[] = ["create", "read", "update", "delete", "search"];

function plan(generatedActions: readonly CapabilityTool[], impact?: BehavioralExecutionImpact) {
  return planBehavioralExecution({
    frozenTests: FROZEN,
    generatedActions,
    ...(impact ? { impact } : {}),
  });
}

/** `create:executed` style, so an expectation reads as the sentence it is asserting. */
function verdicts(result: ReturnType<typeof plan>): readonly string[] {
  return result.actions.map((entry) => `${entry.action}:${entry.execution}`);
}

function reasons(result: ReturnType<typeof plan>): readonly string[] {
  return result.actions.map((entry) => `${entry.action}:${entry.reason}`);
}

describe("coverage is one Handler per Action suite", () => {
  test("each Action's suite covers exactly its own Handler", () => {
    for (const action of ALL_ACTIONS) {
      expect(behavioralSuiteCoverage(action)).toEqual([action]);
    }
  });
});

describe("a suite this build generated always runs", () => {
  test("every Action generated — everything runs, and it is not a fallback", () => {
    // A first build, or an evolution whose every test input moved. Nothing is being
    // skipped, so nothing is being narrowed, so this must not report as the full-suite
    // fallback: "we ran everything" and "we could not prove anything safe" are different
    // facts and the snapshot records which one happened.
    const result = plan(ALL_ACTIONS, {
      regeneratedHandlers: [...ALL_ACTIONS],
      regeneratedItemRenderer: true,
    });

    expect(verdicts(result)).toEqual([
      "create:executed",
      "read:executed",
      "update:executed",
      "delete:executed",
      "search:executed",
    ]);
    expect(new Set(reasons(result).map((entry) => entry.split(":")[1]))).toEqual(
      new Set(["generated_this_build"]),
    );
    expect(result.fullSuite).toBe(false);
    expect(result.fullSuiteReason).toBeUndefined();
  });

  test("a generated suite runs even when its Handler was copied", () => {
    // New intent has never judged any code. Carrying the Handler forward does not make the
    // assertion already-proven — it makes it never-proven.
    const result = plan(["search"], { regeneratedHandlers: [] });

    expect(verdicts(result)).toEqual([
      "create:skipped",
      "read:skipped",
      "update:skipped",
      "delete:skipped",
      "search:executed",
    ]);
    expect(result.actions.find((entry) => entry.action === "search")?.reason).toBe(
      "generated_this_build",
    );
  });
});

describe("a copied suite runs when a Handler it covers regenerates", () => {
  test("only the impacted Action's suite runs", () => {
    const result = plan([], { regeneratedHandlers: ["update"] });

    expect(verdicts(result)).toEqual([
      "create:skipped",
      "read:skipped",
      "update:executed",
      "delete:skipped",
      "search:skipped",
    ]);
    expect(reasons(result)).toEqual([
      "create:no_covered_handler_change",
      "read:no_covered_handler_change",
      "update:covered_handler_regenerated",
      "delete:no_covered_handler_change",
      "search:no_covered_handler_change",
    ]);
    expect(result.fullSuite).toBe(false);
    expect(result.actions.every((entry) => entry.source === "copied")).toBe(true);
  });

  test("no covered Handler changes — every copied suite skips execution", () => {
    const result = plan([], { regeneratedHandlers: [] });

    expect(result.actions.every((entry) => entry.execution === "skipped")).toBe(true);
    expect(result.fullSuite).toBe(false);
    expect(selectedBehavioralCases(FROZEN, result)).toEqual([]);
  });

  test("an item-renderer-only planned change runs nothing without an unscoped fact", () => {
    // The Diff separately marks renderer changes that may invalidate frozen fragments with
    // `unnarrowableReason`. A label-only renderer regeneration carries no such fact.
    const result = plan([], { regeneratedHandlers: [], regeneratedItemRenderer: true });

    expect(result.actions.every((entry) => entry.execution === "skipped")).toBe(true);
    expect(result.fullSuite).toBe(false);
  });
});

describe("the full-suite fallback", () => {
  test("an unstated impact cannot narrow anything", () => {
    const result = plan([]);

    expect(result.actions.every((entry) => entry.execution === "executed")).toBe(true);
    expect(result.actions.every((entry) => entry.reason === "full_suite_fallback")).toBe(true);
    expect(result.fullSuite).toBe(true);
    expect(result.fullSuiteReason).toContain("did not state which Handlers it regenerated");
  });

  test("a caller-declared unscoped fact runs the complete frozen suite in its own words", () => {
    const result = plan([], {
      regeneratedHandlers: ["create"],
      unnarrowableReason: "a changed fact scoped to no single Action",
    });

    expect(result.actions.every((entry) => entry.execution === "executed")).toBe(true);
    expect(result.fullSuiteReason).toBe("a changed fact scoped to no single Action");
    // The Action whose Handler did move keeps its specific reason: the fallback widens the
    // run, it does not overwrite what was already known about it.
    expect(result.actions.find((entry) => entry.action === "create")?.reason).toBe(
      "covered_handler_regenerated",
    );
  });

  test("a moved item renderer alongside moved Handler bytes defeats attribution", () => {
    const result = plan([], {
      regeneratedHandlers: ["update"],
      regeneratedItemRenderer: true,
    });

    expect(verdicts(result)).toEqual([
      "create:executed",
      "read:executed",
      "update:executed",
      "delete:executed",
      "search:executed",
    ]);
    expect(result.fullSuite).toBe(true);
    expect(result.fullSuiteReason).toContain("could not be attributed to one Handler");
    expect(reasons(result)).toEqual([
      "create:full_suite_fallback",
      "read:full_suite_fallback",
      "update:covered_handler_regenerated",
      "delete:full_suite_fallback",
      "search:full_suite_fallback",
    ]);
  });
});

describe("the selected cases are the frozen bytes", () => {
  test("executed Actions contribute their frozen cases, in canonical order", () => {
    const result = plan([], { regeneratedHandlers: ["read", "create"] });
    const selected = selectedBehavioralCases(FROZEN, result);

    expect([...new Set(selected.map((testCase) => testCase.action))]).toEqual(["create", "read"]);
    const frozenCreate = FROZEN.actions.find((entry) => entry.action === "create")?.cases ?? [];
    // Identity, not equality: selection filters the artifact, it never rewrites a case.
    expect(selected.slice(0, frozenCreate.length)).toEqual(frozenCreate);
    for (const [index, testCase] of frozenCreate.entries()) {
      expect(selected[index]).toBe(testCase);
    }
  });
});
