import { describe, expect, test } from "bun:test";

import {
  BEHAVIORAL_SUITE as FULL_BEHAVIORAL_SUITE,
  NOTES_SPEC as FULL_NOTES_SPEC,
} from "../../../app/app.test-support.ts";
import type { CapabilitySpec } from "../../../registry/index.ts";
import type { FullBehavioralTestSuite } from "../gate.test-support.ts";
import { assertActionSuiteContract } from "./gate-behavioral-full-contract.ts";
import { assertFragmentIncludesInOrder } from "./gate-behavioral-shared.ts";

const NOTES = FULL_NOTES_SPEC as CapabilitySpec;

/** Run the per-Action contract over a whole-capability fixture, Action by Action. */
function assertSuiteContract(spec: CapabilitySpec, suite: FullBehavioralTestSuite): void {
  for (const action of spec.tools) {
    assertActionSuiteContract(
      spec,
      action,
      suite.cases.filter((testCase) => testCase.action === action),
    );
  }
}

function suiteWithNormalCase(
  action: "create" | "update" | "delete",
  mutate: (testCase: FullBehavioralTestSuite["cases"][number]) => void,
): FullBehavioralTestSuite {
  const suite = structuredClone(FULL_BEHAVIORAL_SUITE) as {
    cases: FullBehavioralTestSuite["cases"][number][];
  };
  const testCase = suite.cases.find(
    (candidate) =>
      candidate.action === action &&
      !candidate.expectedError &&
      candidate.target !== "missing_record",
  );
  if (!testCase) throw new Error(`behavioral suite is missing normal ${action} coverage`);
  mutate(testCase);
  return suite;
}

describe("capability gate — mutation response contract", () => {
  test("rejects collection-order assertions attached to a create response", () => {
    const oldRow = { values: [{ field: "text", value: "Create Old Marker" }] };
    const suite = suiteWithNormalCase("create", (createCase) => {
      createCase.name = "create_entry_newest_first";
      createCase.setupRows = [oldRow];
      createCase.expectedRows = [...createCase.expectedRows, oldRow];
      createCase.expectedRowCount = 2;
      createCase.expectFragmentIncludesInOrder = ["Behavioral note", "Create Old Marker"];
    });

    expect(() => assertSuiteContract(NOTES, suite)).toThrow("create fragment ordering");
  });

  test("rejects preserved-row values attached to a create response", () => {
    const oldRow = { values: [{ field: "text", value: "Create Old Marker" }] };
    const suite = suiteWithNormalCase("create", (createCase) => {
      createCase.setupRows = [oldRow];
      createCase.expectedRows = [...createCase.expectedRows, oldRow];
      createCase.expectedRowCount = 2;
      createCase.expectFragmentIncludes = ["Create Old Marker"];
    });

    expect(() => assertSuiteContract(NOTES, suite)).toThrow(
      "also occurs in an unrelated setup row",
    );
  });

  test("rejects a sole preserved row mislabeled as a create result", () => {
    const oldRow = { values: [{ field: "text", value: "Create Sole Old Marker" }] };
    const suite = suiteWithNormalCase("create", (createCase) => {
      createCase.setupRows = [oldRow];
      createCase.expectedRows = [oldRow];
      createCase.expectedRowCount = 2;
      createCase.expectFragmentIncludes = ["Create Sole Old Marker"];
    });

    expect(() => assertSuiteContract(NOTES, suite)).toThrow(
      "create returns only the mutated item, so preserved rows are state assertions",
    );
  });

  test("rejects a sole unrelated row mislabeled as an update result", () => {
    const targetRow = { values: [{ field: "text", value: "Update Target Marker" }] };
    const unrelatedRow = { values: [{ field: "text", value: "Update Other Marker" }] };
    const suite = suiteWithNormalCase("update", (updateCase) => {
      updateCase.setupRows = [targetRow, unrelatedRow];
      updateCase.expectedRows = [unrelatedRow];
      updateCase.expectedRowCount = 2;
      updateCase.expectFragmentIncludes = ["Update Other Marker"];
    });

    expect(() => assertSuiteContract(NOTES, suite)).toThrow(
      "update returns only the mutated item, so preserved rows are state assertions",
    );
  });

  test("rejects a create marker duplicated in an unrelated row", () => {
    const duplicate = "Duplicate Create Marker";
    const suite = suiteWithNormalCase("create", (createCase) => {
      createCase.setupRows = [{ values: [{ field: "text", value: duplicate }] }];
      createCase.input = [{ field: "text", value: duplicate }];
      createCase.expectedRows = [{ values: [{ field: "text", value: duplicate }] }];
      createCase.expectedRowCount = 2;
      createCase.expectFragmentIncludes = [duplicate];
    });

    expect(() => assertSuiteContract(NOTES, suite)).toThrow(
      "also occurs in an unrelated setup row",
    );
  });

  test("rejects an update marker duplicated in an unrelated row", () => {
    const duplicate = "Duplicate Update Marker";
    const suite = suiteWithNormalCase("update", (updateCase) => {
      updateCase.setupRows = [
        { values: [{ field: "text", value: "Update Target Marker" }] },
        { values: [{ field: "text", value: duplicate }] },
      ];
      updateCase.input = [{ field: "text", value: duplicate }];
      updateCase.expectedRows = [{ values: [{ field: "text", value: duplicate }] }];
      updateCase.expectedRowCount = 2;
      updateCase.expectFragmentIncludes = [duplicate];
    });

    expect(() => assertSuiteContract(NOTES, suite)).toThrow(
      "also occurs in an unrelated setup row",
    );
  });

  test("rejects every flavour of delete fragment assertion", () => {
    for (const key of [
      "expectFragmentIncludes",
      "expectFragmentExcludes",
      "expectFragmentIncludesInOrder",
    ] as const) {
      const suite = suiteWithNormalCase("delete", (deleteCase) => {
        deleteCase[key] = ["Behavioral note"];
      });

      expect(() => assertSuiteContract(NOTES, suite)).toThrow(
        "delete returns no observable item evidence",
      );
    }
  });

  test("rejects fragment assertions on an error case regardless of Action", () => {
    const suite = structuredClone(FULL_BEHAVIORAL_SUITE) as {
      cases: FullBehavioralTestSuite["cases"][number][];
    };
    const errorCase = suite.cases.find((testCase) => testCase.expectedError);
    if (!errorCase) throw new Error("behavioral suite is missing authored error coverage");
    errorCase.expectFragmentIncludes = ["Behavioral note"];

    expect(() => assertSuiteContract(NOTES, suite)).toThrow("never product wording");
  });

  test("attributes ordered-fragment failures to the actual Action", () => {
    expect(() => assertFragmentIncludesInOrder("create", "New marker", ["Old marker"])).toThrow(
      'expected create fragment to include "Old marker" in order',
    );
  });
});
