import { describe, expect, test } from "bun:test";

import {
  BEHAVIORAL_SUITE as FULL_BEHAVIORAL_SUITE,
  NOTES_SPEC as FULL_NOTES_SPEC,
} from "../../../app/app.test-support.ts";
import type { CapabilitySpec } from "../../../registry/index.ts";
import { assertFullSuiteContract } from "./gate-behavioral-full-contract.ts";
import type { FullBehavioralTestSuite } from "./gate-behavioral-full-schema.ts";
import { assertFragmentIncludesInOrder } from "./gate-behavioral-shared.ts";

describe("capability gate — mutation response contract", () => {
  test("rejects collection-order assertions attached to a create response", () => {
    const suite = structuredClone(FULL_BEHAVIORAL_SUITE) as FullBehavioralTestSuite;
    const createCase = suite.cases.find(
      (testCase) => testCase.action === "create" && !testCase.expectedError,
    );
    if (!createCase) throw new Error("behavioral suite is missing normal create coverage");
    const oldRow = { values: [{ field: "text", value: "Create Old Marker" }] };
    createCase.name = "create_entry_newest_first";
    createCase.setupRows = [oldRow];
    createCase.expectedRows = [...createCase.expectedRows, oldRow];
    createCase.expectedRowCount = 2;
    createCase.expectFragmentIncludesInOrder = ["Behavioral note", "Create Old Marker"];

    expect(() => assertFullSuiteContract(FULL_NOTES_SPEC as CapabilitySpec, suite)).toThrow(
      "create fragment ordering",
    );
  });

  test("rejects preserved-row values attached to a create response", () => {
    const suite = structuredClone(FULL_BEHAVIORAL_SUITE) as FullBehavioralTestSuite;
    const createCase = suite.cases.find(
      (testCase) => testCase.action === "create" && !testCase.expectedError,
    );
    if (!createCase) throw new Error("behavioral suite is missing normal create coverage");
    const oldRow = { values: [{ field: "text", value: "Create Old Marker" }] };
    createCase.setupRows = [oldRow];
    createCase.expectedRows = [...createCase.expectedRows, oldRow];
    createCase.expectedRowCount = 2;
    createCase.expectFragmentIncludes = ["Create Old Marker"];

    expect(() => assertFullSuiteContract(FULL_NOTES_SPEC as CapabilitySpec, suite)).toThrow(
      "create fragment assertions may use submitted input or one affected expected row only",
    );
  });

  test("rejects a sole preserved row mislabeled as a create result", () => {
    const suite = structuredClone(FULL_BEHAVIORAL_SUITE) as FullBehavioralTestSuite;
    const createCase = suite.cases.find(
      (testCase) => testCase.action === "create" && !testCase.expectedError,
    );
    if (!createCase) throw new Error("behavioral suite is missing normal create coverage");
    const oldRow = { values: [{ field: "text", value: "Create Sole Old Marker" }] };
    createCase.setupRows = [oldRow];
    createCase.expectedRows = [oldRow];
    createCase.expectedRowCount = 2;
    createCase.expectFragmentIncludes = ["Create Sole Old Marker"];

    expect(() => assertFullSuiteContract(FULL_NOTES_SPEC as CapabilitySpec, suite)).toThrow(
      "unrelated preserved rows are not part of the response",
    );
  });

  test("rejects a sole unrelated row mislabeled as an update result", () => {
    const suite = structuredClone(FULL_BEHAVIORAL_SUITE) as FullBehavioralTestSuite;
    const updateCase = suite.cases.find(
      (testCase) => testCase.action === "update" && !testCase.expectedError,
    );
    if (!updateCase) throw new Error("behavioral suite is missing normal update coverage");
    const targetRow = { values: [{ field: "text", value: "Update Target Marker" }] };
    const unrelatedRow = { values: [{ field: "text", value: "Update Other Marker" }] };
    updateCase.setupRows = [targetRow, unrelatedRow];
    updateCase.expectedRows = [unrelatedRow];
    updateCase.expectedRowCount = 2;
    updateCase.expectFragmentIncludes = ["Update Other Marker"];

    expect(() => assertFullSuiteContract(FULL_NOTES_SPEC as CapabilitySpec, suite)).toThrow(
      "unrelated preserved rows are not part of the response",
    );
  });

  test("rejects a create marker duplicated in an unrelated row", () => {
    const suite = structuredClone(FULL_BEHAVIORAL_SUITE) as FullBehavioralTestSuite;
    const createCase = suite.cases.find(
      (testCase) => testCase.action === "create" && !testCase.expectedError,
    );
    if (!createCase) throw new Error("behavioral suite is missing normal create coverage");
    const duplicate = "Duplicate Create Marker";
    createCase.setupRows = [{ values: [{ field: "text", value: duplicate }] }];
    createCase.input = [{ field: "text", value: duplicate }];
    createCase.expectedRows = [{ values: [{ field: "text", value: duplicate }] }];
    createCase.expectedRowCount = 2;
    createCase.expectFragmentIncludes = [duplicate];

    expect(() => assertFullSuiteContract(FULL_NOTES_SPEC as CapabilitySpec, suite)).toThrow(
      "unrelated preserved rows are not part of the response",
    );
  });

  test("rejects an update marker duplicated in an unrelated row", () => {
    const suite = structuredClone(FULL_BEHAVIORAL_SUITE) as FullBehavioralTestSuite;
    const updateCase = suite.cases.find(
      (testCase) => testCase.action === "update" && !testCase.expectedError,
    );
    if (!updateCase) throw new Error("behavioral suite is missing normal update coverage");
    const duplicate = "Duplicate Update Marker";
    updateCase.setupRows = [
      { values: [{ field: "text", value: "Update Target Marker" }] },
      { values: [{ field: "text", value: duplicate }] },
    ];
    updateCase.input = [{ field: "text", value: duplicate }];
    updateCase.expectedRows = [{ values: [{ field: "text", value: duplicate }] }];
    updateCase.expectedRowCount = 2;
    updateCase.expectFragmentIncludes = [duplicate];

    expect(() => assertFullSuiteContract(FULL_NOTES_SPEC as CapabilitySpec, suite)).toThrow(
      "unrelated preserved rows are not part of the response",
    );
  });

  test("attributes ordered-fragment failures to the actual Action", () => {
    expect(() => assertFragmentIncludesInOrder("create", "New marker", ["Old marker"])).toThrow(
      'expected create fragment to include "Old marker" in order',
    );
  });
});
