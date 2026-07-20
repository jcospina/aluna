import {
  activeSpecFields,
  type CapabilitySpec,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../registry/index.ts";
import { normalizeSearchText } from "../sqlite-functions.ts";
import type {
  FullBehavioralTestCase,
  FullBehavioralTestSuite,
} from "./gate-behavioral-full-schema.ts";
import type { BehavioralScalar } from "./gate-behavioral-input.ts";
import { sameBehavioralError } from "./gate-behavioral-shared.ts";

export function assertFullSuiteContract(
  spec: CapabilitySpec,
  suite: FullBehavioralTestSuite,
): void {
  for (const action of spec.tools) {
    const hasNormal = suite.cases.some(
      (testCase) =>
        testCase.action === action &&
        !testCase.expectedError &&
        !testCase.expectedPlatformError &&
        testCase.target !== "missing_record",
    );
    if (!hasNormal) throw new Error(`Behavioral suite must contain a normal ${action} case.`);
  }
  for (const errorCase of spec.behavioral_errors) {
    const count = suite.cases.filter(
      (testCase) =>
        testCase.expectedError && sameBehavioralError(errorCase, testCase.expectedError),
    ).length;
    if (count !== 1) {
      throw new Error(
        `Behavioral suite must contain exactly one case for authored error ${errorCase.action}/${errorCase.code}.`,
      );
    }
  }
  for (const action of ["update", "delete"] as const) assertNotFoundCoverage(suite, action);
  for (const testCase of suite.cases) assertCaseContract(spec, testCase);
}

function assertNotFoundCoverage(suite: FullBehavioralTestSuite, action: "update" | "delete"): void {
  const count = suite.cases.filter(
    (testCase) =>
      testCase.action === action &&
      testCase.target === "missing_record" &&
      testCase.expectedPlatformError?.action === action,
  ).length;
  if (count !== 1) {
    throw new Error(`Behavioral suite must contain exactly one ${action} record_not_found case.`);
  }
}

function assertCaseContract(spec: CapabilitySpec, testCase: FullBehavioralTestCase): void {
  assertActionAndTarget(spec, testCase);
  assertErrorOwnership(spec, testCase);
  if (
    (testCase.expectedError || testCase.expectedPlatformError) &&
    (testCase.expectFragmentIncludes.length > 0 ||
      testCase.expectFragmentExcludes.length > 0 ||
      testCase.expectFragmentIncludesInOrder.length > 0)
  ) {
    throw new Error(
      "behavioral error cases assert semantic markers/codes/Actions/fields, never product wording",
    );
  }
  if (testCase.expectedError?.code === MISSING_REQUIRED_FIELDS_ERROR_CODE) {
    assertMissingRequiredTrigger(testCase);
  }
  if (!testCase.expectedError && !testCase.expectedPlatformError) {
    assertAssertionsUseSyntheticValues(testCase);
    assertSearchOrderingCoverage(spec, testCase);
  }
}

function assertSearchOrderingCoverage(
  spec: CapabilitySpec,
  testCase: FullBehavioralTestCase,
): void {
  if (testCase.action !== "search") return;
  const query = requiredSearchQuery(testCase);
  const ordered = testCase.expectFragmentIncludesInOrder;
  if (!hasSearchableFields(spec)) {
    if (
      testCase.expectFragmentIncludes.length > 0 ||
      testCase.expectFragmentExcludes.length > 0 ||
      ordered.length > 0
    ) {
      throw new Error(
        "normal search case cannot assert fragment matches when the capability has no active searchable fields",
      );
    }
    return;
  }
  if (testCase.setupRows.length < 2 || ordered.length < 2) {
    throw new Error(
      "normal search case must prove ordering with at least two matching setup rows and ordered synthetic fragment assertions",
    );
  }

  const rowIndexes = ordered.map((assertion) =>
    uniqueSetupRowIndex(testCase, assertion, "ordered"),
  );
  if (new Set(rowIndexes).size < 2) {
    throw new Error(
      "normal search case must prove ordering across at least two distinct matching setup rows",
    );
  }
  assertOrderedRowsMatchQuery(spec, testCase, query, ordered, rowIndexes);
  assertExcludedRowsDoNotMatchQuery(spec, testCase, query);
}

function hasSearchableFields(spec: CapabilitySpec): boolean {
  return activeSpecFields(spec.schema.fields).some(
    (field) => field.type === "string" || field.type === "string[]",
  );
}

function requiredSearchQuery(testCase: FullBehavioralTestCase): string {
  const queries = testCase.input.filter((entry) => entry.field === "q");
  const query = queries[0]?.value;
  if (queries.length !== 1 || !query || query.trim().length === 0) {
    throw new Error(
      "normal search case must exercise primary ordering with exactly one nonblank q",
    );
  }
  return query;
}

function assertOrderedRowsMatchQuery(
  spec: CapabilitySpec,
  testCase: FullBehavioralTestCase,
  query: string,
  ordered: readonly string[],
  rowIndexes: readonly number[],
): void {
  for (const [index, rowIndex] of rowIndexes.entries()) {
    if (!setupRowMatchesSearchQuery(spec, testCase, rowIndex, query)) {
      throw new Error(
        `ordered setup row identified by ${JSON.stringify(ordered[index])} does not mechanically match q`,
      );
    }
  }
}

function assertExcludedRowsDoNotMatchQuery(
  spec: CapabilitySpec,
  testCase: FullBehavioralTestCase,
  query: string,
): void {
  for (const excluded of testCase.expectFragmentExcludes) {
    const rowIndex = uniqueSetupRowIndex(testCase, excluded, "excluded");
    if (setupRowMatchesSearchQuery(spec, testCase, rowIndex, query)) {
      throw new Error(
        `excluded setup row identified by ${JSON.stringify(excluded)} mechanically matches q`,
      );
    }
  }
}

function uniqueSetupRowIndex(
  testCase: FullBehavioralTestCase,
  assertion: string,
  role: "ordered" | "excluded",
): number {
  const matches = testCase.setupRows.flatMap((row, index) =>
    row.values.flatMap(scalarStrings).includes(assertion) ? [index] : [],
  );
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error(
      `normal search ${role} assertions must each identify exactly one synthetic setup row`,
    );
  }
  return matches[0];
}

function setupRowMatchesSearchQuery(
  spec: CapabilitySpec,
  testCase: FullBehavioralTestCase,
  rowIndex: number,
  query: string,
): boolean {
  const row = testCase.setupRows[rowIndex];
  if (!row) return false;
  const searchableFields = new Set(
    activeSpecFields(spec.schema.fields)
      .filter((field) => field.type === "string" || field.type === "string[]")
      .map((field) => field.name),
  );
  const normalizedValues = row.values
    .filter((entry) => searchableFields.has(entry.field))
    .flatMap(scalarStrings)
    .map(normalizeSearchText);
  return query
    .trim()
    .split(/\s+/u)
    .map(normalizeSearchText)
    .every((term) => normalizedValues.some((value) => value.includes(term)));
}

function assertMissingRequiredTrigger(testCase: FullBehavioralTestCase): void {
  const affected = new Set(testCase.expectedError?.fields ?? []);
  const affectedInputs = testCase.input.filter((entry) => affected.has(entry.field));
  if (affectedInputs.some((entry) => entry.value.trim().length > 0)) {
    throw new Error("missing_required_fields cases may not submit non-empty affected fields");
  }
  const submittedAffected = new Set(affectedInputs.map((entry) => entry.field));
  if (
    testCase.action === "update" &&
    [...affected].some((field) => !submittedAffected.has(field))
  ) {
    throw new Error("update missing_required_fields must submit every affected field as empty");
  }
}

function assertAssertionsUseSyntheticValues(testCase: FullBehavioralTestCase): void {
  const actionValues =
    testCase.action === "create" || testCase.action === "update"
      ? [
          ...testCase.input.map((entry) => entry.value),
          ...testCase.expectedRows.flatMap((row) => row.values.flatMap(scalarStrings)),
        ]
      : testCase.action === "read" || testCase.action === "search"
        ? [
            ...testCase.setupRows.flatMap((row) => row.values.flatMap(scalarStrings)),
            ...testCase.expectedRows.flatMap((row) => row.values.flatMap(scalarStrings)),
          ]
        : [];
  const syntheticValues = new Set(actionValues.filter((value) => value.length > 0));
  const assertions = [
    ...testCase.expectFragmentIncludes,
    ...testCase.expectFragmentExcludes,
    ...testCase.expectFragmentIncludesInOrder,
  ];
  if (assertions.some((assertion) => !syntheticValues.has(assertion))) {
    throw new Error(
      "behavioral fragment assertions must use synthetic case values, never product wording",
    );
  }
}

function scalarStrings(entry: { readonly value: BehavioralScalar }): string[] {
  if (entry.value === null) return [];
  if (Array.isArray(entry.value)) return [...entry.value];
  return [String(entry.value)];
}

function assertActionAndTarget(spec: CapabilitySpec, testCase: FullBehavioralTestCase): void {
  if (!spec.tools.includes(testCase.action)) {
    throw new Error(`Behavioral case targets absent Action ${testCase.action}.`);
  }
  const targeted = testCase.action === "update" || testCase.action === "delete";
  if (targeted !== (testCase.target !== null)) {
    throw new Error(`Behavioral ${testCase.action} case has invalid target ownership.`);
  }
  if (testCase.target === "first_setup_row" && testCase.setupRows.length === 0) {
    throw new Error(`Behavioral ${testCase.action} case needs a setup row for its bound target.`);
  }
}

function assertErrorOwnership(spec: CapabilitySpec, testCase: FullBehavioralTestCase): void {
  if (testCase.expectedError && testCase.expectedPlatformError) {
    throw new Error("A behavioral case cannot expect two errors.");
  }
  const expectedError = testCase.expectedError;
  if (expectedError) {
    if (expectedError.action !== testCase.action) {
      throw new Error("Behavioral case error Action must match the case Action.");
    }
    if (
      !spec.behavioral_errors.some((candidate) => sameBehavioralError(candidate, expectedError))
    ) {
      throw new Error("Behavioral expectedError does not match the authored contract.");
    }
  }
  if (
    testCase.expectedPlatformError &&
    (testCase.expectedPlatformError.action !== testCase.action ||
      testCase.target !== "missing_record")
  ) {
    throw new Error("record_not_found must belong to a missing-record update/delete case.");
  }
}
