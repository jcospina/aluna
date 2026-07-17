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

import {
  type CapabilityTableDdl,
  createCapabilityMutationPort,
  materializeCapabilityActionRecord,
  selectCapabilityRows,
} from "../capability-data/index.ts";
import type { PresentationAdapter } from "../presentation/index.ts";
import type { Provider, TokenUsage } from "../provider/index.ts";
import {
  activeSpecFields,
  behavioralErrorMarkersSchema,
  type CapabilitySpec,
} from "../registry/index.ts";
import type { CapabilityInput } from "../router/index.ts";
import type {
  BehavioralGateResult,
  BehavioralTestCaseOutcome,
  BehavioralTestRunMetrics,
  CapabilityGateInput,
} from "./gate.ts";
import { isFullCrudSpec, runFullBehavioralRung } from "./gate-behavioral-full.ts";
import { buildFullBehavioralTestPrompt } from "./gate-behavioral-full-prompt.ts";
import {
  type BehavioralScalar,
  fieldValuesToRecord,
  inputValuesToHandlerInput,
} from "./gate-behavioral-input.ts";
import {
  ageSetupRows,
  assertFragmentIncludes,
  assertFragmentIncludesInOrder,
  assertKnownFields,
  assertValidationErrorMarkers,
  behavioralFieldValueSchema,
  behavioralInputValueSchema,
  behavioralRowSchema,
  nonEmptyStringSchema,
  rowMatches,
  sameBehavioralError,
} from "./gate-behavioral-shared.ts";
import {
  assertFragment,
  buildGatePresent,
  buildGateQueryPort,
  errorMessage,
  type LoadedHandlers,
  loadHandlers,
  openScratchDatabasePair,
  prepareScratchCatalog,
  sameSnapshot,
  snapshotCapabilityTables,
} from "./gate-internal.ts";
import type { HandlerUnitName } from "./units.ts";

const behavioralExpectedErrorSchema = z.strictObject({
  action: z.literal("create"),
  trigger: z.literal("missing_required_fields"),
  code: z.literal("missing_required_fields"),
  fields: z.array(nonEmptyStringSchema).min(1),
  expected_markers: behavioralErrorMarkersSchema,
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
  readonly scratchRows?: ReturnType<typeof selectCapabilityRows>;
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
  if (isFullCrudSpec(input.spec)) return runFullBehavioralRung(input);
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
    scratchCatalog: input.scratchCatalog,
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
  if (isFullCrudSpec(spec)) return buildFullBehavioralTestPrompt(spec);
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
  return { suite, usage: await result.usage, durationMs: performance.now() - startedAt };
}

interface RunBehavioralTestsInput {
  readonly spec: CapabilitySpec;
  readonly ddl: CapabilityTableDdl;
  readonly handlers: Readonly<Partial<Record<HandlerUnitName, string>>>;
  readonly itemRenderer: string;
  readonly suite: BehavioralTestSuite;
  readonly realDatabase?: Database;
  readonly scratchCatalog?: CapabilityGateInput["scratchCatalog"];
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
      await runBehavioralCase(
        input.spec,
        input.ddl,
        input.scratchCatalog,
        handlers,
        present,
        testCase,
      );
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
  scratchCatalog: CapabilityGateInput["scratchCatalog"],
  handlers: LoadedHandlers,
  present: PresentationAdapter,
  testCase: BehavioralTestCase,
): Promise<void> {
  assertBehavioralCaseReferencesSpecFields(spec, testCase);
  const scratch = openScratchDatabasePair();
  const setupRows = testCase.setupRows.map((row) => fieldValuesToRecord(row.values));
  const createInput = inputValuesToHandlerInput(spec, testCase.input);
  let createFragment: string | undefined;
  let readFragment: string | undefined;
  let scratchRows: ReturnType<typeof selectCapabilityRows> | undefined;

  try {
    prepareScratchCatalog(spec, ddl, scratchCatalog, scratch);
    const mutation = createCapabilityMutationPort(spec, scratch.readwrite);
    const createQuery = buildGateQueryPort(spec, "create", scratchCatalog, scratch.readonly);
    const readQuery = buildGateQueryPort(spec, "read", scratchCatalog, scratch.readonly);
    const setupIds: string[] = [];

    for (const row of setupRows) {
      const created = materializeCapabilityActionRecord(mutation.create(row));
      setupIds.push(String(created.id));
    }
    ageSetupRows(scratch.readwrite, ddl.tableName, setupIds);

    createFragment = await handlers.create({
      input: createInput,
      mutation,
      query: createQuery,
      present,
    });
    assertFragment("create", createFragment);

    scratchRows = selectCapabilityRows(spec, readQuery);
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
      query: readQuery,
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
