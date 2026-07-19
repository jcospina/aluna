import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

import {
  createCapabilityDeleteMutationPort,
  createCapabilityMutationPort,
  createCapabilityUpdateMutationPort,
  materializeCapabilityActionRecord,
  RecordNotFoundError,
  selectCapabilityRows,
} from "../capability-data/index.ts";
import type { PresentationAdapter } from "../presentation/index.ts";
import type { Provider, TokenUsage } from "../provider/index.ts";
import { activeSpecFields, type CapabilitySpec } from "../registry/index.ts";
import type { CapabilityInput } from "../router/index.ts";
import type {
  BehavioralGateResult,
  BehavioralTestCaseOutcome,
  BehavioralTestRunMetrics,
  CapabilityGateInput,
} from "./gate.ts";
import { assertFullSuiteContract } from "./gate-behavioral-full-contract.ts";
import { buildFullBehavioralTestPrompt } from "./gate-behavioral-full-prompt.ts";
import {
  type FullBehavioralTestCase,
  type FullBehavioralTestSuite,
  fullBehavioralTestSuiteSchema,
} from "./gate-behavioral-full-schema.ts";
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
  rowMatches,
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

interface GeneratedFullBehavioralTests {
  readonly suite: FullBehavioralTestSuite;
  readonly durationMs: number;
  readonly usage: TokenUsage;
}

interface FullBehavioralCaseDiagnostic {
  readonly testCase: FullBehavioralTestCase;
  readonly setupRows: readonly Record<string, BehavioralScalar>[];
  readonly actionInput?: CapabilityInput;
  readonly scratchRows?: ReturnType<typeof selectCapabilityRows>;
  readonly fragment?: string;
  readonly failure: string;
}

class FullBehavioralCaseFailure extends Error {
  override readonly name = "BehavioralCaseFailure";
  readonly diagnostic: FullBehavioralCaseDiagnostic;

  constructor(testName: string, diagnostic: FullBehavioralCaseDiagnostic) {
    super(`Behavioral test "${testName}" failed: ${diagnostic.failure}`);
    this.diagnostic = diagnostic;
  }
}

export async function runFullBehavioralRung(
  input: CapabilityGateInput,
): Promise<BehavioralGateResult> {
  if (!input.provider) {
    throw new Error(
      "Behavioral tier is on, but no provider was supplied for behavioral test generation.",
    );
  }
  const generated = await generateFullBehavioralTests(input.provider, input.spec);
  const testRun = await runFullBehavioralTests(input, generated.suite);
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

async function generateFullBehavioralTests(
  provider: Provider,
  spec: CapabilitySpec,
): Promise<GeneratedFullBehavioralTests> {
  const startedAt = performance.now();
  const result = provider.generate(
    buildFullBehavioralTestPrompt(spec),
    fullBehavioralTestSuiteSchema,
  );
  const suite = fullBehavioralTestSuiteSchema.parse(await result.object);
  assertFullSuiteContract(spec, suite);
  return { suite, usage: await result.usage, durationMs: performance.now() - startedAt };
}

async function runFullBehavioralTests(
  input: CapabilityGateInput,
  suite: FullBehavioralTestSuite,
): Promise<BehavioralTestRunMetrics> {
  const startedAt = performance.now();
  const beforeReal = input.realDatabase ? snapshotCapabilityTables(input.realDatabase) : undefined;
  const handlers = await loadHandlers(input.handlers, input.spec.tools);
  const present = buildGatePresent(input.spec, input.itemRenderer);
  const cases: BehavioralTestCaseOutcome[] = [];
  let runError: unknown;
  try {
    for (const testCase of suite.cases) {
      const caseStartedAt = performance.now();
      await runFullBehavioralCase(input, handlers, present, testCase);
      cases.push({
        action: testCase.action,
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
  return { outcome: "passed", durationMs: performance.now() - startedAt, cases };
}

async function runFullBehavioralCase(
  input: CapabilityGateInput,
  handlers: LoadedHandlers,
  present: PresentationAdapter,
  testCase: FullBehavioralTestCase,
): Promise<void> {
  assertCaseFields(input.spec, testCase);
  const scratch = openScratchDatabasePair();
  const setupRows = testCase.setupRows.map((row) => fieldValuesToRecord(row.values));
  const submittedFields =
    testCase.action === "create"
      ? activeSpecFields(input.spec.schema.fields).map((field) => field.name)
      : testCase.action === "update"
        ? [...new Set(testCase.input.map((entry) => entry.field))]
        : [];
  const actionInput = inputValuesToHandlerInput(input.spec, testCase.input, submittedFields);
  let fragment: string | undefined;
  let scratchRows: ReturnType<typeof selectCapabilityRows> | undefined;
  try {
    prepareScratchCatalog(input.spec, input.ddl, input.scratchCatalog, scratch);
    const setupIds = seedRows(input.spec, setupRows, scratch.readwrite);
    ageSetupRows(scratch.readwrite, input.ddl.tableName, setupIds);
    const targetId = resolveTargetId(testCase, setupIds);
    fragment = await invokeExpectedAction(
      input,
      handlers,
      present,
      testCase,
      actionInput,
      targetId,
      scratch.readwrite,
      scratch.readonly,
    );
    scratchRows = selectCapabilityRows(
      input.spec,
      buildGateQueryPort(input.spec, "read", input.scratchCatalog, scratch.readonly),
    );
    assertFragmentResult(testCase, fragment);
    assertExpectedRows(input.spec, scratchRows, testCase);
  } catch (error) {
    throw new FullBehavioralCaseFailure(testCase.name, {
      testCase,
      setupRows,
      actionInput,
      scratchRows,
      fragment,
      failure: errorMessage(error),
    });
  } finally {
    scratch.readonly.close();
    scratch.readwrite.close();
  }
}

function seedRows(
  spec: CapabilitySpec,
  rows: readonly Record<string, BehavioralScalar>[],
  database: Database,
): string[] {
  const create = createCapabilityMutationPort(spec, database);
  return rows.map((row) => String(materializeCapabilityActionRecord(create.create(row)).id));
}

function resolveTargetId(testCase: FullBehavioralTestCase, setupIds: readonly string[]) {
  if (testCase.target === "first_setup_row") return setupIds[0];
  if (testCase.target === "missing_record") return randomUUID();
  return undefined;
}

async function invokeExpectedAction(
  input: CapabilityGateInput,
  handlers: LoadedHandlers,
  present: PresentationAdapter,
  testCase: FullBehavioralTestCase,
  actionInput: CapabilityInput,
  targetId: string | undefined,
  readwrite: Database,
  readonly: Database,
): Promise<string | undefined> {
  try {
    const fragment = await invokeAction(
      input,
      handlers,
      present,
      testCase.action,
      actionInput,
      targetId,
      readwrite,
      readonly,
    );
    if (testCase.expectedPlatformError) {
      throw new Error(`expected ${testCase.action} to throw record_not_found`);
    }
    return fragment;
  } catch (error) {
    if (!testCase.expectedPlatformError) throw error;
    assertPlatformRecordNotFound(error, testCase.expectedPlatformError);
    return undefined;
  }
}

async function invokeAction(
  input: CapabilityGateInput,
  handlers: LoadedHandlers,
  present: PresentationAdapter,
  action: HandlerUnitName,
  actionInput: CapabilityInput,
  targetId: string | undefined,
  readwrite: Database,
  readonly: Database,
): Promise<string> {
  const query = buildGateQueryPort(input.spec, action, input.scratchCatalog, readonly);
  if (action === "create") {
    return handlers.create({
      input: actionInput,
      mutation: createCapabilityMutationPort(input.spec, readwrite),
      query,
      present,
    });
  }
  if (action === "read") return handlers.read({ input: actionInput, query, present });
  if (action === "search") {
    if (!handlers.search) throw new Error("Behavioral search Handler is missing.");
    return handlers.search({ input: actionInput, query, present });
  }
  if (!targetId) throw new Error(`Behavioral ${action} target is missing.`);
  if (action === "update") {
    if (!handlers.update) throw new Error("Behavioral update Handler is missing.");
    return handlers.update({
      input: actionInput,
      mutation: createCapabilityUpdateMutationPort(
        input.spec,
        targetId,
        actionInput.submittedFields,
        readwrite,
      ),
      query,
      present,
    });
  }
  if (!handlers.delete) throw new Error("Behavioral delete Handler is missing.");
  return handlers.delete({
    input: actionInput,
    mutation: createCapabilityDeleteMutationPort(input.spec, targetId, readwrite),
    query,
  });
}

function assertPlatformRecordNotFound(
  error: unknown,
  expected: NonNullable<FullBehavioralTestCase["expectedPlatformError"]>,
): void {
  if (!(error instanceof RecordNotFoundError)) {
    throw new Error(`expected RecordNotFoundError, received ${errorMessage(error)}`);
  }
  if (error.code !== expected.code || error.action !== expected.action) {
    throw new Error(
      `expected ${expected.action}/${expected.code}, received ${error.action}/${error.code}`,
    );
  }
}

function assertFragmentResult(
  testCase: FullBehavioralTestCase,
  fragment: string | undefined,
): void {
  if (testCase.expectedPlatformError) {
    if (fragment !== undefined) throw new Error(`expected ${testCase.action} record_not_found`);
    return;
  }
  assertReturnedFragment(testCase, fragment);
  assertFragmentExpectations(testCase, fragment ?? "");
}

function assertReturnedFragment(
  testCase: FullBehavioralTestCase,
  fragment: string | undefined,
): void {
  if (testCase.action === "delete") {
    if (typeof fragment !== "string") throw new Error("delete Handler did not return a string");
    return;
  }
  assertFragment(testCase.action, fragment);
}

function assertFragmentExpectations(testCase: FullBehavioralTestCase, fragment: string): void {
  if (testCase.expectedError) assertValidationErrorMarkers(fragment, testCase.expectedError);
  else {
    assertFragmentIncludes(testCase.action, fragment, testCase.expectFragmentIncludes);
    for (const excluded of testCase.expectFragmentExcludes) {
      if (fragment.includes(excluded)) {
        throw new Error(`${testCase.action} Handler fragment unexpectedly included ${excluded}.`);
      }
    }
    assertFragmentIncludesInOrder(fragment, testCase.expectFragmentIncludesInOrder);
  }
}

function assertExpectedRows(
  spec: CapabilitySpec,
  rows: ReturnType<typeof selectCapabilityRows>,
  testCase: FullBehavioralTestCase,
): void {
  if (rows.length !== testCase.expectedRowCount) {
    throw new Error(
      `expected ${testCase.expectedRowCount} scratch row(s), received ${rows.length}.`,
    );
  }
  for (const expectedRow of testCase.expectedRows) {
    const expected = fieldValuesToRecord(expectedRow.values);
    if (!rows.some((row) => rowMatches(spec.schema.fields, row, expected))) {
      throw new Error(`did not find a scratch row matching ${JSON.stringify(expected)}.`);
    }
  }
}

function assertCaseFields(spec: CapabilitySpec, testCase: FullBehavioralTestCase): void {
  const rowFields = new Set(activeSpecFields(spec.schema.fields).map((field) => field.name));
  const inputFields =
    testCase.action === "read" || testCase.action === "delete"
      ? new Set<string>()
      : testCase.action === "search"
        ? new Set(["q"])
        : new Set(rowFields);
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
