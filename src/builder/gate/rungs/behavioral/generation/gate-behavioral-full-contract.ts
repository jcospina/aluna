// The platform-owned behavioral test contract.
//
// Generated tests are model output, so the platform decides what an Action's observable response
// *is*: a suite contradicting the response-shape matrix in modules/04 PLAN.md is rejected before
// it can be frozen or executed, and model output can never redefine an Action's contract by
// asserting against it. Error cases leave every fragment assertion empty on every Action and
// prove only stable semantic markers, codes, Action and affected fields.
//
// Checks run per Action at generation time, before a single Handler byte exists, and again over
// the assembled frozen artifact before the Gate executes it.

import { normalizeSearchText } from "../../../../../platform/persistence/sqlite-functions.ts";
import {
  activeSpecFields,
  type CapabilitySpec,
  type CapabilityTool,
  FULL_CAPABILITY_TOOLS,
  isChoiceFieldType,
  isListFieldType,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../../../../../registry/index.ts";
import { actionTestInputDigest, actionTestInputs } from "../freeze/behavioral-test-inputs.ts";
import { assertKnownFields, sameBehavioralError } from "../gate-behavioral-shared.ts";
import type {
  FrozenBehavioralTests,
  FullBehavioralTestCase,
} from "./gate-behavioral-full-schema.ts";
import type { BehavioralScalar } from "./gate-behavioral-input.ts";

/**
 * Validate one Action's generated cases against the platform contract. Called on generated and
 * carried-forward suites alike, so nothing unadmitted reaches the artifact or Handler repair.
 */
export function assertActionSuiteContract(
  spec: CapabilitySpec,
  action: CapabilityTool,
  cases: readonly FullBehavioralTestCase[],
): void {
  for (const testCase of cases) {
    if (testCase.action !== action) {
      throw new Error(
        `Behavioral ${action} suite contains a ${testCase.action} case; each Action's tests are generated independently.`,
      );
    }
  }
  const hasNormal = cases.some(
    (testCase) =>
      !testCase.expectedError &&
      !testCase.expectedPlatformError &&
      testCase.target !== "missing_record",
  );
  if (!hasNormal) throw new Error(`Behavioral suite must contain a normal ${action} case.`);

  for (const errorCase of spec.behavioral_errors.filter((entry) => entry.action === action)) {
    const count = cases.filter(
      (testCase) =>
        testCase.expectedError && sameBehavioralError(errorCase, testCase.expectedError),
    ).length;
    if (count !== 1) {
      throw new Error(
        `Behavioral suite must contain exactly one case for authored error ${errorCase.action}/${errorCase.code}.`,
      );
    }
  }
  if (action === "update" || action === "delete") assertNotFoundCoverage(cases, action);
  for (const testCase of cases) assertCaseContract(spec, testCase);
}

/**
 * Validate the assembled frozen artifact: every declared Action covered once in canonical order,
 * each content-addressed to its *current* total inputs, and every case still admissible.
 */
export function assertFrozenTestsContract(
  spec: CapabilitySpec,
  frozen: FrozenBehavioralTests,
): void {
  const declared = FULL_CAPABILITY_TOOLS.filter((action) => spec.tools.includes(action));
  const covered = frozen.actions.map((entry) => entry.action);
  if (
    covered.length !== declared.length ||
    covered.some((action, index) => action !== declared[index])
  ) {
    throw new Error(
      `Frozen behavioral tests must cover exactly [${declared.join(", ")}] in canonical Action order, received [${covered.join(", ")}].`,
    );
  }
  for (const entry of frozen.actions) {
    const digest = actionTestInputDigest(actionTestInputs(spec, entry.action));
    if (entry.input_digest !== digest) {
      throw new Error(
        `Frozen ${entry.action} tests are not content-addressed to their current total inputs.`,
      );
    }
    assertActionSuiteContract(spec, entry.action, entry.cases);
  }
}

function assertNotFoundCoverage(
  cases: readonly FullBehavioralTestCase[],
  action: "update" | "delete",
): void {
  const count = cases.filter(
    (testCase) =>
      testCase.target === "missing_record" && testCase.expectedPlatformError?.action === action,
  ).length;
  if (count !== 1) {
    throw new Error(`Behavioral suite must contain exactly one ${action} record_not_found case.`);
  }
}

function assertCaseContract(spec: CapabilitySpec, testCase: FullBehavioralTestCase): void {
  assertActionAndTarget(spec, testCase);
  assertCaseFieldVocabulary(spec, testCase);
  assertErrorOwnership(spec, testCase);
  assertResponseShape(testCase);
  if (testCase.expectedError?.code === MISSING_REQUIRED_FIELDS_ERROR_CODE) {
    assertMissingRequiredTrigger(testCase);
  }
  if (!testCase.expectedError && !testCase.expectedPlatformError) {
    assertAssertionsUseSyntheticValues(testCase);
    assertSearchOrderingCoverage(spec, testCase);
  }
}

/**
 * Every field a case names must still be active in *this* spec. `read` and `delete` project no
 * schema, so a hidden field moves no digest and a carried suite would fail every retry forever.
 */
function assertCaseFieldVocabulary(spec: CapabilitySpec, testCase: FullBehavioralTestCase): void {
  const rowFields = new Set(activeSpecFields(spec.schema.fields).map((field) => field.name));
  const inputFields =
    testCase.action === "read" || testCase.action === "delete"
      ? new Set<string>()
      : testCase.action === "search"
        ? new Set(["q"])
        : rowFields;

  assertKnownFields(
    testCase.name,
    "input",
    testCase.input.map((entry) => entry.field),
    inputFields,
  );
  for (const [index, row] of testCase.setupRows.entries()) {
    assertKnownFields(
      testCase.name,
      `setupRows[${index}]`,
      row.values.map((entry) => entry.field),
      rowFields,
    );
  }
  for (const [index, row] of testCase.expectedRows.entries()) {
    assertKnownFields(
      testCase.name,
      `expectedRows[${index}]`,
      row.values.map((entry) => entry.field),
      rowFields,
    );
  }
  if (testCase.expectedError) {
    assertKnownFields(
      testCase.name,
      "expectedError.fields",
      testCase.expectedError.fields,
      rowFields,
    );
  }
}

/**
 * The response-shape matrix itself. Every rejection is a contradiction between what a case
 * asserts and what the Action can observably return, never a guess at whether it would pass.
 */
function assertResponseShape(testCase: FullBehavioralTestCase): void {
  const ordered = testCase.expectFragmentIncludesInOrder;
  const asserted = fragmentAssertions(testCase);
  if ((testCase.expectedError || testCase.expectedPlatformError) && asserted.length > 0) {
    throw new Error(
      "behavioral error cases assert semantic markers/codes/Actions/fields, never product wording",
    );
  }
  if (testCase.action === "delete" && asserted.length > 0) {
    throw new Error(
      "delete returns no observable item evidence: deletion is proved from scratch state, so every delete fragment assertion is inadmissible",
    );
  }
  if (testCase.action !== "read" && testCase.action !== "search" && ordered.length > 0) {
    throw new Error(
      `${testCase.action} fragment ordering is invalid: only read/search return ordered collections`,
    );
  }
  assertMutationFragmentEvidence(testCase);
}

/**
 * create/update observe the one mutated item, so a marker that also occurs in an unrelated setup
 * row is inadmissibly ambiguous — even when it is a submitted value.
 */
function assertMutationFragmentEvidence(testCase: FullBehavioralTestCase): void {
  if (testCase.action !== "create" && testCase.action !== "update") return;
  const unrelated = new Set(unrelatedRowValues(testCase));
  const ambiguous = fragmentAssertions(testCase).find((assertion) => unrelated.has(assertion));
  if (ambiguous !== undefined) {
    throw new Error(
      `${testCase.action} fragment assertion ${JSON.stringify(ambiguous)} also occurs in an unrelated setup row; ${testCase.action} returns only the mutated item, so preserved rows are state assertions`,
    );
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
    if (fragmentAssertions(testCase).length > 0) {
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
  return activeSpecFields(spec.schema.fields).some((field) => isSearchableTextType(field.type));
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
      .filter((field) => isSearchableTextType(field.type))
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

function isSearchableTextType(type: CapabilitySpec["schema"]["fields"][number]["type"]): boolean {
  return type === "string" || isChoiceFieldType(type) || isListFieldType(type);
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
  const syntheticValues = new Set(
    syntheticFragmentValues(testCase).filter((value) => value.length > 0),
  );
  const assertions = fragmentAssertions(testCase);
  if (assertions.every((assertion) => syntheticValues.has(assertion))) return;
  throw new Error(invalidFragmentAssertionMessage(testCase));
}

function fragmentAssertions(testCase: FullBehavioralTestCase): readonly string[] {
  return [
    ...testCase.expectFragmentIncludes,
    ...testCase.expectFragmentExcludes,
    ...testCase.expectFragmentIncludesInOrder,
  ];
}

function syntheticFragmentValues(testCase: FullBehavioralTestCase): string[] {
  if (testCase.action === "create" || testCase.action === "update") {
    return mutationFragmentValues(testCase);
  }
  if (testCase.action === "read" || testCase.action === "search") {
    return [
      ...testCase.setupRows.flatMap((row) => row.values.flatMap(scalarStrings)),
      ...testCase.expectedRows.flatMap((row) => row.values.flatMap(scalarStrings)),
    ];
  }
  return [];
}

function mutationFragmentValues(testCase: FullBehavioralTestCase): string[] {
  const resultValues =
    testCase.expectedRows.length === 1
      ? (testCase.expectedRows[0]?.values.flatMap(scalarStrings) ?? [])
      : [];
  const unrelatedValues = new Set(unrelatedRowValues(testCase));
  return [...testCase.input.map((entry) => entry.value), ...resultValues].filter(
    (value) => !unrelatedValues.has(value),
  );
}

/**
 * The values a mutation case's *other* rows carry. `create` mutates nothing already seeded, so
 * every setup row is unrelated; `update` binds `first_setup_row`, so only later rows are.
 */
function unrelatedRowValues(testCase: FullBehavioralTestCase): string[] {
  const unrelatedRows =
    testCase.action === "create" ? testCase.setupRows : testCase.setupRows.slice(1);
  return unrelatedRows.flatMap((row) => row.values.flatMap(scalarStrings));
}

function invalidFragmentAssertionMessage(testCase: FullBehavioralTestCase): string {
  if (testCase.action === "create" || testCase.action === "update") {
    return `${testCase.action} fragment assertions may use submitted input or one affected expected row only; unrelated preserved rows are not part of the response`;
  }
  return "behavioral fragment assertions must use synthetic case values, never product wording";
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
