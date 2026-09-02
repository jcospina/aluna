import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { PresentationAdapter } from "../../../presentation/index.ts";
import { activeSpecFields, type CapabilitySpec } from "../../../registry/index.ts";
import {
  createCapabilityDeleteMutationPort,
  createCapabilityMutationPort,
  createCapabilityUpdateMutationPort,
  materializeCapabilityActionRecord,
  RecordNotFoundError,
  selectCapabilityRows,
} from "../../../runtime/data/index.ts";
import type { CapabilityInput } from "../../../runtime/router/index.ts";
import type { HandlerUnitName } from "../../units/units.ts";
import type {
  BehavioralTestCaseOutcome,
  BehavioralTestRunMetrics,
  CapabilityGateInput,
} from "../gate.ts";
import {
  assertFragment,
  buildGatePresent,
  buildGateQueryPort,
  errorMessage,
  ItemRendererExecutionError,
  type LoadedHandlers,
  loadHandlers,
  openScratchDatabasePair,
  prepareScratchCatalog,
  sameSnapshot,
  snapshotCapabilityTables,
  sqlIdentifier,
} from "../gate-internal.ts";
import { selectedBehavioralCases } from "./behavioral-execution-plan.ts";
import type { BehavioralFailureSurface } from "./behavioral-failure-attribution.ts";
import { assertFrozenTestsContract } from "./gate-behavioral-full-contract.ts";
import type { FullBehavioralTestCase } from "./gate-behavioral-full-schema.ts";
import {
  type BehavioralScalar,
  fieldValuesToRecord,
  inputValuesToHandlerInput,
} from "./gate-behavioral-input.ts";
import { type BehavioralRungRun, runBehavioralRepairLoop } from "./gate-behavioral-repair.ts";
import {
  ageSetupRows,
  assertFragmentIncludes,
  assertFragmentIncludesInOrder,
  assertKnownFields,
  assertValidationErrorMarkers,
  rowMatches,
} from "./gate-behavioral-shared.ts";

interface FullBehavioralCaseDiagnostic {
  readonly testCase: FullBehavioralTestCase;
  readonly setupRows: readonly Record<string, BehavioralScalar>[];
  readonly actionInput?: CapabilityInput;
  readonly scratchRows?: ReturnType<typeof selectCapabilityRows>;
  readonly fragment?: string;
  /** Where in the case's execution it failed — the input to runtime attribution. */
  readonly surface: BehavioralFailureSurface;
  readonly failure: string;
}

/**
 * One frozen case's verdict against these bytes. Exported because it is the *only* error
 * a Handler repair may answer to: anything else escaping the rung — an
 * inadmissible suite, a scratch-setup fault, a real-database mutation — fails the Gate
 * closed rather than spending the repair budget on an innocent unit.
 */
export class FullBehavioralCaseFailure extends Error {
  override readonly name = "BehavioralCaseFailure";
  readonly diagnostic: FullBehavioralCaseDiagnostic;

  constructor(testName: string, diagnostic: FullBehavioralCaseDiagnostic) {
    super(`Behavioral test "${testName}" failed: ${diagnostic.failure}`);
    this.diagnostic = diagnostic;
  }
}

/**
 * Execute the frozen behavioral suite. The rung generates nothing: decision 23 freezes the
 * suite before any Handler is generated or repaired, so by the time the Gate runs
 * the tests already exist and the rung's only job is to run them against the exact bytes
 * the Gate is about to clear. The platform contract is re-asserted here rather than trusted
 * from the freeze stage, so no caller can smuggle an inadmissible suite into execution.
 *
 * *Which* frozen suites run is `planBehavioralExecution`'s decision: execution
 * follows executable impact, so a suite copied byte-for-byte from the prior version runs
 * only when a Handler it covers regenerated — or when narrowing could not be proven sound,
 * in which case the complete frozen suite runs. When the plan executes nothing, this rung
 * loads no Handler and opens no scratch database: a skip is a skip.
 *
 * A *failing* case does not end the rung outright: `runBehavioralRepairLoop`
 * rewrites the attributed Handler(s) within ADR-0003's bounded budget and reruns the same
 * frozen bytes. The suite is admitted against the platform-owned Action response contract
 * here, once, before any of that — an inadmissible suite may neither execute nor drive a
 * repair.
 */
export function runFullBehavioralRung(input: CapabilityGateInput): Promise<BehavioralRungRun> {
  const frozen = input.behavioralTier?.frozen;
  if (!frozen) {
    throw new Error(
      "Behavioral tier is on, but no frozen test suite was supplied. Tests are generated and frozen before Handler generation or repair (PLAN decision 23).",
    );
  }
  assertFrozenTestsContract(input.spec, frozen.frozenTests);
  return runBehavioralRepairLoop({
    input,
    frozen,
    execute: (handlers, execution) => {
      const cases = selectedBehavioralCases(frozen.frozenTests, execution);
      return cases.length === 0
        ? Promise.resolve({ outcome: "passed" as const, durationMs: 0, cases: [] })
        : runFullBehavioralTests({ ...input, handlers }, cases);
    },
  });
}

async function runFullBehavioralTests(
  input: CapabilityGateInput,
  cases: readonly FullBehavioralTestCase[],
): Promise<BehavioralTestRunMetrics> {
  const startedAt = performance.now();
  const beforeReal = input.realDatabase ? snapshotCapabilityTables(input.realDatabase) : undefined;
  const handlers = await loadHandlers(input.handlers, input.spec.tools);
  const present = buildGatePresent(input.spec, input.itemRenderer);
  const outcomes: BehavioralTestCaseOutcome[] = [];
  let runError: unknown;
  try {
    for (const testCase of cases) {
      const caseStartedAt = performance.now();
      await runFullBehavioralCase(input, handlers, present, testCase);
      outcomes.push({
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
  return { outcome: "passed", durationMs: performance.now() - startedAt, cases: outcomes };
}

async function runFullBehavioralCase(
  input: CapabilityGateInput,
  handlers: LoadedHandlers,
  present: PresentationAdapter,
  testCase: FullBehavioralTestCase,
): Promise<void> {
  assertCaseFields(input.spec, testCase);
  const scratch = openScratchDatabasePair();
  const setupRows = testCase.setupRows.map((row) =>
    fieldValuesToRecord(activeSpecFields(input.spec.schema.fields), row.values),
  );
  const submittedFields =
    testCase.action === "create"
      ? activeSpecFields(input.spec.schema.fields).map((field) => field.name)
      : testCase.action === "update"
        ? [...new Set(testCase.input.map((entry) => entry.field))]
        : [];
  const actionInput = inputValuesToHandlerInput(input.spec, testCase.input, submittedFields);
  let fragment: string | undefined;
  let scratchRows: ReturnType<typeof selectCapabilityRows> | undefined;
  // Tagged as execution advances, never inferred from the message afterwards. Runtime
  // attribution turns on *which generated units had run by this point*, and only
  // the executor knows that — a wording heuristic over an error string would not.
  let surface: BehavioralFailureSurface = "setup";
  try {
    prepareScratchCatalog(input.spec, input.ddl, input.scratchCatalog, scratch);
    const setupIds = seedRows(input.spec, input.ddl.tableName, setupRows, scratch.readwrite);
    ageSetupRows(scratch.readwrite, input.ddl.tableName, setupIds);
    const targetId = resolveTargetId(testCase, setupIds);
    surface = "handler_invocation";
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
    // Reading the scratch table back is platform work, but it reads the state this
    // Handler just wrote: a row it corrupted surfaces here and is its own doing.
    surface = "row_state";
    scratchRows = selectCapabilityRows(
      input.spec,
      buildGateQueryPort(input.spec, "read", input.scratchCatalog, scratch.readonly),
    );
    surface = "fragment";
    assertFragmentResult(testCase, fragment);
    surface = "row_state";
    assertExpectedRows(input.spec, scratchRows, testCase);
  } catch (error) {
    throw new FullBehavioralCaseFailure(testCase.name, {
      testCase,
      setupRows,
      actionInput,
      scratchRows,
      fragment,
      // The item renderer runs *inside* the Handler call, so a renderer defect would
      // otherwise be tagged `handler_invocation` — the one surface attribution treats as
      // unconditionally total — and blamed on a Handler that could not possibly fix it.
      // A marked renderer throw moves to the fragment surface, where attribution asks
      // whether the shared renderer is proven unmoved before narrowing.
      surface: renderedThrough(error) ? "fragment" : surface,
      failure: errorMessage(error),
    });
  } finally {
    scratch.readonly.close();
    scratch.readwrite.close();
  }
}

/** Whether this failure came out of the shared item renderer rather than the Handler. */
function renderedThrough(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (current instanceof ItemRendererExecutionError) return true;
  }
  return false;
}

function seedRows(
  spec: CapabilitySpec,
  tableName: string,
  rows: readonly Record<string, BehavioralScalar>[],
  database: Database,
): string[] {
  const create = createCapabilityMutationPort(spec, database);
  return rows.map((row, index) => {
    const generatedId = String(materializeCapabilityActionRecord(create.create(row)).id);
    // Setup order is semantic input to the generated test. Stable ids ensure an
    // id-only Handler cannot pass or fail ordering assertions by random UUID luck.
    const deterministicId = `behavior_setup_${String(index).padStart(4, "0")}`;
    database
      .query(`UPDATE ${sqlIdentifier(tableName)} SET "id" = ? WHERE "id" = ?`)
      .run(deterministicId, generatedId);
    return deterministicId;
  });
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
  if (testCase.action === "read" && !testCase.expectedError && testCase.expectedRowCount === 0) {
    if (fragment !== "") {
      throw new Error("read Handler must return an empty string when no rows exist");
    }
    return;
  }
  if (testCase.action === "delete" || testCase.action === "search") {
    if (typeof fragment !== "string") {
      throw new Error(`${testCase.action} Handler did not return a string`);
    }
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
    assertFragmentIncludesInOrder(
      testCase.action,
      fragment,
      testCase.expectFragmentIncludesInOrder,
    );
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
    const expected = fieldValuesToRecord(activeSpecFields(spec.schema.fields), expectedRow.values);
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
