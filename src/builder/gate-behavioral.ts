// The behavioral rung — the opt-in tier that generates black-box tests from the
// spec's stated behavior and runs them against the generated handlers.
//
// The provider authors a small suite of deterministic cases (success and
// validation-error) from spec behavior + schema only, never handler internals. Each
// case runs on its own scratch database: seed `setupRows` (aged newest-first), run
// `create`, assert the row count, the created row, and the create/read fragments —
// or, for an error case, assert the stable error markers from the spec's
// `behavioral_errors` contract. Assertions check semantic markers and codes, never
// exact product copy.

import type { Database } from "bun:sqlite";
import { z } from "zod";

import { type CapabilityTableDdl, createCapabilityDataTool } from "../capability-data/index.ts";
import type { PresentationAdapter } from "../presentation/index.ts";
import type { Provider, TokenUsage } from "../provider/index.ts";
import {
  activeSpecFields,
  type BehavioralErrorCase,
  behavioralErrorMarkersSchema,
  type CapabilitySpec,
  type SpecField,
} from "../registry/index.ts";
import type { CapabilityHandler, CapabilityInput } from "../router/index.ts";
import type {
  BehavioralGateResult,
  BehavioralTestCaseOutcome,
  BehavioralTestRunMetrics,
  CapabilityGateInput,
} from "./gate.ts";
import {
  applyDdl,
  assertFragment,
  buildGatePresent,
  errorMessage,
  fieldValueMatches,
  loadHandlers,
  openScratchDatabasePair,
  sameSnapshot,
  snapshotCapabilityTables,
  sqlIdentifier,
} from "./gate-internal.ts";
import type { HandlerUnitName } from "./units.ts";

const behavioralScalarSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);
const nonEmptyStringSchema = z.string().min(1);
const behavioralFieldValueSchema = z.strictObject({
  field: nonEmptyStringSchema,
  value: behavioralScalarSchema,
});
const behavioralInputValueSchema = z.strictObject({
  field: nonEmptyStringSchema,
  value: z.string(),
});
const behavioralExpectedErrorSchema = z.strictObject({
  action: z.literal("create"),
  trigger: z.literal("missing_required_fields"),
  code: z.literal("missing_required_fields"),
  fields: z.array(nonEmptyStringSchema).min(1),
  expected_markers: behavioralErrorMarkersSchema,
});
const behavioralRowSchema = z.strictObject({
  values: z.array(behavioralFieldValueSchema),
});
const behavioralTestCaseSchema = z.strictObject({
  name: nonEmptyStringSchema,
  setupRows: z.array(behavioralRowSchema),
  input: z.array(behavioralInputValueSchema),
  expectedCreatedRow: z.array(behavioralFieldValueSchema),
  expectedRowCount: z.number().int().nonnegative(),
  expectCreateFragmentIncludes: z.array(nonEmptyStringSchema),
  expectReadFragmentIncludes: z.array(nonEmptyStringSchema),
  expectReadFragmentIncludesInOrder: z.array(nonEmptyStringSchema),
  expectedError: behavioralExpectedErrorSchema.nullable(),
});
const behavioralTestSuiteSchema = z.strictObject({
  cases: z.array(behavioralTestCaseSchema).min(1).max(8),
});

type BehavioralTestCase = z.infer<typeof behavioralTestCaseSchema>;
type BehavioralTestSuite = z.infer<typeof behavioralTestSuiteSchema>;
type BehavioralScalar = z.infer<typeof behavioralScalarSchema>;
type BehavioralExpectedError = z.infer<typeof behavioralExpectedErrorSchema>;

interface GeneratedBehavioralTests {
  readonly suite: BehavioralTestSuite;
  readonly durationMs: number;
  readonly usage: TokenUsage;
}

interface BehavioralCaseDiagnostic {
  readonly testCase: BehavioralTestCase;
  readonly setupRows: readonly Record<string, BehavioralScalar>[];
  readonly createInput?: CapabilityInput;
  readonly scratchRows?: ReturnType<ReturnType<typeof createCapabilityDataTool>["select"]>;
  readonly createFragment?: string;
  readonly readFragment?: string;
  readonly failure: string;
}

class BehavioralCaseFailure extends Error {
  override readonly name = "BehavioralCaseFailure";
  readonly diagnostic: BehavioralCaseDiagnostic;

  constructor(testName: string, diagnostic: BehavioralCaseDiagnostic) {
    super(`Behavioral test "${testName}" failed: ${diagnostic.failure}`);
    this.diagnostic = diagnostic;
  }
}

/** Run the behavioral rung: generate the test suite, then run every case. */
export async function runBehavioralRung(input: CapabilityGateInput): Promise<BehavioralGateResult> {
  if (!input.provider) {
    throw new Error(
      "Behavioral tier is on, but no provider was supplied for behavioral test generation.",
    );
  }

  const generated = await generateBehavioralTests(input.provider, input.spec);
  const testRun = await runBehavioralTests({
    spec: input.spec,
    ddl: input.ddl,
    handlers: input.handlers,
    itemRenderer: input.itemRenderer,
    suite: generated.suite,
    realDatabase: input.realDatabase,
  });

  return {
    tier: "on",
    status: "passed",
    testGen: {
      outcome: "passed",
      durationMs: generated.durationMs,
      usage: generated.usage,
      testCount: generated.suite.cases.length,
    },
    testRun,
  };
}

/** The behavioral test-generation prompt: deterministic black-box cases from spec behavior. */
export function buildBehavioralTestPrompt(spec: CapabilitySpec): string {
  return [
    "Generate behavioral tests for this Aluna capability.",
    "",
    "Return one structured object with a `cases` array. Each case is a deterministic black-box test:",
    "- `input` is an array of `{ field, value }` form/query inputs for the create action, as strings. Repeat an entry with the same field name for each string[] element; order is preserved.",
    "- `setupRows` is an array of `{ values }` objects; each `values` is an array of `{ field, value }` pairs. They are preexisting rows, all older than the action's new row, and are listed NEWEST-FIRST: `setupRows[0]` is the most recent preexisting row and each later entry is older. Use an empty array when no setup is needed.",
    "- `expectedCreatedRow` is an array of `{ field, value }` spec fields that must be present in one scratch row. A string[] field value is an array of strings. Use an empty array when no specific row assertion is needed.",
    '- For `setupRows` and `expectedCreatedRow`, a string[] field value must be an array of strings, never a scalar string and never a nested array. Example: `{ field: "tags", value: ["work", "urgent"] }`.',
    "- `expectedRowCount` is required. For a normal create test with no setup rows, use 1.",
    "- `expectCreateFragmentIncludes`, `expectReadFragmentIncludes`, and `expectReadFragmentIncludesInOrder` assert visible HTML substrings. Use empty arrays when not needed.",
    "- For a newest-first read, the action's new row is newest of all, so `expectReadFragmentIncludesInOrder` is `[<new row marker>, <setupRows[0] marker>, <setupRows[1] marker>, ...]` — the new row, then the setup rows in their array order.",
    "- `expectedError` is required on every case. For normal success behavior, set it to null. For validation-error behavior, set it to one object copied from a `behavioral_errors` case in the source material. Do not assert user-facing error copy with fragment includes; leave those arrays empty.",
    "",
    "Important constraints:",
    "- Use only the source material JSON below. It is the complete test-generation input.",
    "- Do not assume or reference handler implementation details.",
    "- Validation-error assertions must check semantic markers, stable error codes, and affected fields from `behavioral_errors`, never exact product-copy strings.",
    "- Prefer one or two high-signal cases that prove the stated behavior.",
    "",
    "Source material JSON:",
    JSON.stringify(
      {
        behavior: spec.behavior,
        schema: { fields: activeSpecFields(spec.schema.fields) },
        behavioral_errors: spec.behavioral_errors,
      },
      null,
      2,
    ),
  ].join("\n");
}

async function generateBehavioralTests(
  provider: Provider,
  spec: CapabilitySpec,
): Promise<GeneratedBehavioralTests> {
  const startedAt = performance.now();
  const result = provider.generate(buildBehavioralTestPrompt(spec), behavioralTestSuiteSchema);
  const suite = behavioralTestSuiteSchema.parse(await result.object);
  const usage = await result.usage;
  return { suite, usage, durationMs: performance.now() - startedAt };
}

interface RunBehavioralTestsInput {
  readonly spec: CapabilitySpec;
  readonly ddl: CapabilityTableDdl;
  readonly handlers: Readonly<Record<HandlerUnitName, string>>;
  readonly itemRenderer: string;
  readonly suite: BehavioralTestSuite;
  readonly realDatabase?: Database;
}

async function runBehavioralTests(
  input: RunBehavioralTestsInput,
): Promise<BehavioralTestRunMetrics> {
  const startedAt = performance.now();
  const beforeReal = input.realDatabase ? snapshotCapabilityTables(input.realDatabase) : undefined;
  const handlers = await loadHandlers(input.handlers);
  // The real adapter the router injects at runtime, built from this build's item
  // renderer — the same one every case renders records through (ADR-0005 §2).
  const present = buildGatePresent(input.spec, input.itemRenderer);
  const cases: BehavioralTestCaseOutcome[] = [];
  let runError: unknown;

  try {
    for (const testCase of input.suite.cases) {
      const caseStartedAt = performance.now();
      await runBehavioralCase(input.spec, input.ddl, handlers, present, testCase);
      cases.push({
        name: testCase.name,
        status: "passed",
        durationMs: performance.now() - caseStartedAt,
      });
    }
  } catch (error) {
    runError = error;
  }

  if (
    beforeReal &&
    input.realDatabase &&
    !sameSnapshot(beforeReal, snapshotCapabilityTables(input.realDatabase))
  ) {
    throw new Error("Behavioral gate execution changed real capability data tables.");
  }

  if (runError) throw runError;

  return {
    outcome: "passed",
    durationMs: performance.now() - startedAt,
    cases,
  };
}

async function runBehavioralCase(
  spec: CapabilitySpec,
  ddl: CapabilityTableDdl,
  handlers: Readonly<Record<HandlerUnitName, CapabilityHandler>>,
  present: PresentationAdapter,
  testCase: BehavioralTestCase,
): Promise<void> {
  assertBehavioralCaseReferencesSpecFields(spec, testCase);
  const scratch = openScratchDatabasePair();
  const setupRows = testCase.setupRows.map((row) => fieldValuesToRecord(row.values));
  const createInput = inputValuesToHandlerInput(spec, testCase.input);
  let createFragment: string | undefined;
  let readFragment: string | undefined;
  let scratchRows: ReturnType<ReturnType<typeof createCapabilityDataTool>["select"]> | undefined;

  try {
    applyDdl(ddl, scratch.readwrite);
    const data = createCapabilityDataTool(spec, scratch);
    const setupIds: string[] = [];

    for (const row of setupRows) {
      setupIds.push(data.insert(row).id);
    }
    ageSetupRows(scratch.readwrite, ddl.tableName, setupIds);

    createFragment = await handlers.create({
      input: createInput,
      data,
      present,
    });
    assertFragment("create", createFragment);

    scratchRows = data.select();
    const expectedRowCount = testCase.expectedRowCount;
    if (scratchRows.length !== expectedRowCount) {
      throw new Error(
        `expected ${expectedRowCount} scratch row(s), received ${scratchRows.length}.`,
      );
    }

    if (testCase.expectedError) {
      assertValidationErrorCase(spec, testCase, createFragment);
      return;
    }

    assertFragmentIncludes("create", createFragment, testCase.expectCreateFragmentIncludes);
    const expectedCreatedRow = fieldValuesToRecord(testCase.expectedCreatedRow);
    if (
      Object.keys(expectedCreatedRow).length > 0 &&
      !scratchRows.some((row) => rowMatches(spec.schema.fields, row, expectedCreatedRow))
    ) {
      throw new Error(`did not find a scratch row matching ${JSON.stringify(expectedCreatedRow)}.`);
    }

    readFragment = await handlers.read({
      input: { values: {}, submittedFields: new Set() },
      data,
      present,
    });
    assertFragment("read", readFragment);
    assertFragmentIncludes("read", readFragment, testCase.expectReadFragmentIncludes);
    assertFragmentIncludesInOrder(readFragment, testCase.expectReadFragmentIncludesInOrder);
  } catch (error) {
    throw new BehavioralCaseFailure(testCase.name, {
      testCase,
      setupRows,
      createInput,
      scratchRows,
      createFragment,
      readFragment,
      failure: errorMessage(error),
    });
  } finally {
    scratch.readonly.close();
    scratch.readwrite.close();
  }
}

// Stamp the setup rows with deterministic created_at values, **newest-first**:
// setupRows[0] is the most recent preexisting row, each later entry older. Index 0
// gets the largest second-offset and the final entry 00:00:00 — all in the year 2000,
// so every setup row is older than the action's new row (stamped at the real `now`).
// A newest-first read therefore renders as [new row, ...setupRows in array order],
// which is the order the model authors `expectReadFragmentIncludesInOrder` in
// (documented in buildBehavioralTestPrompt). The model picking the order and the gate
// enforcing it must agree, or a correct handler fails a self-inconsistent test.
function ageSetupRows(database: Database, tableName: string, setupIds: readonly string[]): void {
  const update = database.query(
    `UPDATE ${sqlIdentifier(tableName)} SET "created_at" = ? WHERE "id" = ?`,
  );
  const lastIndex = setupIds.length - 1;
  for (const [index, id] of setupIds.entries()) {
    const secondsFromOldest = lastIndex - index;
    update.run(`2000-01-01 00:00:${String(secondsFromOldest).padStart(2, "0")}`, id);
  }
}

function assertBehavioralCaseReferencesSpecFields(
  spec: CapabilitySpec,
  testCase: BehavioralTestCase,
): void {
  const fields = new Set(activeSpecFields(spec.schema.fields).map((field) => field.name));
  assertKnownFields(
    testCase.name,
    "input",
    testCase.input.map((entry) => entry.field),
    fields,
  );
  for (const [index, row] of testCase.setupRows.entries()) {
    assertKnownFields(
      testCase.name,
      `setupRows[${index}]`,
      row.values.map((entry) => entry.field),
      fields,
    );
  }
  assertKnownFields(
    testCase.name,
    "expectedCreatedRow",
    testCase.expectedCreatedRow.map((entry) => entry.field),
    fields,
  );
  if (testCase.expectedError) {
    assertKnownFields(testCase.name, "expectedError.fields", testCase.expectedError.fields, fields);
    assertExpectedErrorMatchesSpecContract(spec, testCase.expectedError);
  }
}

function assertKnownFields(
  testName: string,
  label: string,
  names: readonly string[],
  fields: ReadonlySet<string>,
): void {
  for (const name of names) {
    if (!fields.has(name)) {
      throw new Error(
        `Behavioral test "${testName}" ${label} references unknown spec field "${name}".`,
      );
    }
  }
}

function assertFragmentIncludes(
  action: HandlerUnitName,
  fragment: string,
  expected: readonly string[],
): void {
  for (const text of expected) {
    if (!fragment.includes(text)) {
      throw new Error(`expected ${action} fragment to include ${JSON.stringify(text)}.`);
    }
  }
}

function assertFragmentIncludesInOrder(fragment: string, expected: readonly string[]): void {
  let cursor = 0;
  for (const text of expected) {
    const index = fragment.indexOf(text, cursor);
    if (index === -1) {
      throw new Error(`expected read fragment to include ${JSON.stringify(text)} in order.`);
    }
    cursor = index + text.length;
  }
}

function assertValidationErrorCase(
  spec: CapabilitySpec,
  testCase: BehavioralTestCase,
  createFragment: string,
): void {
  const expected = testCase.expectedError;
  if (!expected) return;

  assertExpectedErrorMatchesSpecContract(spec, expected);
  if (
    testCase.expectedCreatedRow.length > 0 ||
    testCase.expectCreateFragmentIncludes.length > 0 ||
    testCase.expectReadFragmentIncludes.length > 0 ||
    testCase.expectReadFragmentIncludesInOrder.length > 0
  ) {
    throw new Error(
      "validation-error behavioral cases must assert expectedError markers, not product-copy fragment includes",
    );
  }

  assertValidationErrorMarkers(createFragment, expected);
}

function assertExpectedErrorMatchesSpecContract(
  spec: CapabilitySpec,
  expected: BehavioralExpectedError,
): void {
  if (!spec.behavioral_errors.some((errorCase) => sameBehavioralError(errorCase, expected))) {
    throw new Error(
      `expectedError ${JSON.stringify(expected)} does not match the spec-owned behavioral_errors contract`,
    );
  }
}

function sameBehavioralError(
  specCase: BehavioralErrorCase,
  expected: BehavioralExpectedError,
): boolean {
  return (
    specCase.action === expected.action &&
    specCase.trigger === expected.trigger &&
    specCase.code === expected.code &&
    sameStringSet(specCase.fields, expected.fields) &&
    JSON.stringify(specCase.expected_markers) === JSON.stringify(expected.expected_markers)
  );
}

function assertValidationErrorMarkers(fragment: string, expected: BehavioralExpectedError): void {
  const marker = expected.expected_markers;
  const elements = parseHtmlStartTagAttributes(fragment).filter(
    (attributes) => attributes[marker.role_attribute] === marker.role,
  );
  if (elements.length === 0) {
    throw new Error(
      `expected create fragment to include an error element with ${marker.role_attribute}="${marker.role}".`,
    );
  }

  const actualSummary = elements.map((attributes) => ({
    code: attributes[marker.code_attribute],
    fields: attributes[marker.fields_attribute],
  }));
  const match = elements.find((attributes) => {
    const fields = splitErrorFields(attributes[marker.fields_attribute], marker.fields_separator);
    return (
      attributes[marker.code_attribute] === expected.code && sameStringSet(fields, expected.fields)
    );
  });

  if (!match) {
    throw new Error(
      `expected error markers code=${JSON.stringify(expected.code)} fields=${JSON.stringify(expected.fields)}, received ${JSON.stringify(actualSummary)}.`,
    );
  }
}

function parseHtmlStartTagAttributes(fragment: string): Array<Record<string, string>> {
  const elements: Array<Record<string, string>> = [];
  const tagPattern = /<[A-Za-z][A-Za-z0-9:-]*(?:\s+[^<>]*?)?>/g;
  for (const [tag] of fragment.matchAll(tagPattern)) {
    elements.push(parseAttributes(tag));
  }
  return elements;
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributePattern =
    /\s([A-Za-z_:][A-Za-z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of tag.matchAll(attributePattern)) {
    const name = match[1];
    if (!name) continue;
    attributes[name] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function splitErrorFields(value: string | undefined, separator: string): string[] {
  if (!value) return [];
  return value
    .split(separator)
    .map((field) => field.trim())
    .filter((field) => field.length > 0);
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function rowMatches(
  fields: readonly SpecField[],
  row: ReturnType<ReturnType<typeof createCapabilityDataTool>["select"]>[number],
  expected: Readonly<Record<string, BehavioralScalar>>,
): boolean {
  return Object.entries(expected).every(([field, value]) => {
    const type = fields.find((candidate) => candidate.name === field)?.type;
    return type ? fieldValueMatches(type, row[field], value) : row[field] === value;
  });
}

function fieldValuesToRecord(
  values: readonly z.infer<typeof behavioralFieldValueSchema>[],
): Record<string, BehavioralScalar> {
  return Object.fromEntries(values.map((entry) => [entry.field, entry.value]));
}

function inputValuesToHandlerInput(
  spec: CapabilitySpec,
  values: readonly z.infer<typeof behavioralInputValueSchema>[],
): CapabilityInput {
  const fieldsByName = new Map(
    activeSpecFields(spec.schema.fields).map((field) => [field.name, field]),
  );
  const grouped = new Map<string, string[]>();
  for (const entry of values) {
    const existing = grouped.get(entry.field);
    if (existing) existing.push(entry.value);
    else grouped.set(entry.field, [entry.value]);
  }

  return {
    values: Object.fromEntries(
      [...grouped].map(([fieldName, submitted]) => [
        fieldName,
        fieldsByName.get(fieldName)?.type === "string[]" ? submitted : (submitted[0] ?? ""),
      ]),
    ),
    submittedFields: new Set(activeSpecFields(spec.schema.fields).map((field) => field.name)),
  };
}
