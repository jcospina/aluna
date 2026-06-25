// Layered build gate — Module 2, Epic 2.5 (PLAN flow step 6, ADR-0004).
//
// The gate is a final verdict, distinct from the unit-generation fix loop. It
// runs always-on rungs in order: structural checks first, then a scratch-database
// smoke round-trip through the same injected-toolbox contract the runtime uses.

import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { z } from "zod";

import { type CapabilityTableDdl, createCapabilityDataTool } from "../capability-data/index.ts";
import type { Provider, TokenUsage } from "../provider/index.ts";
import {
  type BehavioralErrorCase,
  behavioralErrorMarkersSchema,
  type CapabilitySpec,
  type FieldType,
  type SpecField,
} from "../registry/index.ts";
import type { CapabilityHandler } from "../router/index.ts";
import type { HandlerUnitName } from "./units.ts";

export const BEHAVIORAL_TIER_ENV_VAR = "OMNI_BEHAVIORAL_TIER";

const GATE_RUNG_ORDER = ["structural", "smoke", "behavioral"] as const;
const HANDLER_NAMES = ["create", "read"] as const satisfies readonly HandlerUnitName[];
const BEHAVIORAL_TIER_ON_VALUES = new Set(["1", "true", "on", "yes"]);
const BEHAVIORAL_TIER_OFF_VALUES = new Set(["0", "false", "off", "no"]);

export type GateRungName = (typeof GATE_RUNG_ORDER)[number];
export type GateRungStatus = "passed" | "failed" | "skipped";

export interface GateRungOutcome {
  readonly rung: GateRungName;
  readonly status: GateRungStatus;
  readonly durationMs: number;
  readonly error?: string;
  readonly reason?: string;
}

export interface SmokeGateResult {
  readonly tableName: string;
  readonly rowCount: number;
  readonly insertedRowId: string;
  readonly createFragmentLength: number;
  readonly readFragmentLength: number;
  readonly realDatabaseUnchanged?: boolean;
}

export interface BehavioralTierInput {
  readonly enabled?: boolean;
}

export interface BehavioralTestGenerationMetrics {
  readonly outcome: "passed";
  readonly durationMs: number;
  readonly usage: TokenUsage;
  readonly testCount: number;
}

export interface BehavioralTestCaseOutcome {
  readonly name: string;
  readonly status: "passed";
  readonly durationMs: number;
}

export interface BehavioralTestRunMetrics {
  readonly outcome: "passed";
  readonly durationMs: number;
  readonly cases: readonly BehavioralTestCaseOutcome[];
}

export type BehavioralGateResult =
  | {
      readonly tier: "on";
      readonly status: "passed";
      readonly testGen: BehavioralTestGenerationMetrics;
      readonly testRun: BehavioralTestRunMetrics;
    }
  | {
      readonly tier: "off";
      readonly status: "skipped";
      readonly reason: string;
    };

export interface CapabilityGateInput {
  readonly spec: CapabilitySpec;
  // The migration stage owns DDL derivation. The gate applies that exact output to
  // scratch so smoke proves the build's own schema, not a separately-derived one.
  readonly ddl: CapabilityTableDdl;
  readonly handlers: Readonly<Record<HandlerUnitName, string>>;
  // The behavioral tier generates tests from spec behavior + schema only. The
  // provider is required when the tier is enabled, and unused when it is off.
  readonly provider?: Provider;
  // Global default comes from OMNI_BEHAVIORAL_TIER (default ON); tests and future
  // orchestration can override explicitly without mutating process.env.
  readonly behavioralTier?: BehavioralTierInput;
  // Optional assertion hook for the real db: the gate snapshots capability tables
  // before and after smoke and fails if they changed.
  readonly realDatabase?: Database;
}

export interface CapabilityGateResult {
  readonly outcomes: readonly GateRungOutcome[];
  readonly durationMs: number;
  readonly smoke: SmokeGateResult;
  readonly behavioral: BehavioralGateResult;
}

export class CapabilityGateError extends Error {
  override readonly name = "CapabilityGateError";
  readonly failedRung: GateRungName;
  readonly outcomes: readonly GateRungOutcome[];
  readonly diagnostic?: unknown;
  override readonly cause?: unknown;

  constructor(failedRung: GateRungName, outcomes: readonly GateRungOutcome[], cause?: unknown) {
    const failed = outcomes.find((outcome) => outcome.rung === failedRung);
    super(`Capability gate failed at ${failedRung}: ${failed?.error ?? "unknown failure"}`);
    this.failedRung = failedRung;
    this.outcomes = outcomes;
    this.cause = cause;
    this.diagnostic = diagnosticForError(cause);
  }
}

export async function runCapabilityGate(input: CapabilityGateInput): Promise<CapabilityGateResult> {
  const startedAt = performance.now();
  const outcomes: GateRungOutcome[] = [];

  await runGateRung(outcomes, "structural", () => runStructuralRung(input));
  const smoke = await runGateRung(outcomes, "smoke", () => runSmokeRung(input));
  const behavioral = resolveBehavioralTierEnabledForInput(input)
    ? await runGateRung(outcomes, "behavioral", () => runBehavioralRung(input))
    : skipGateRung(outcomes, "behavioral", "Behavioral tier is off for this run.");

  return {
    outcomes,
    durationMs: performance.now() - startedAt,
    smoke,
    behavioral,
  };
}

export function resolveBehavioralTierEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[BEHAVIORAL_TIER_ENV_VAR]?.trim().toLowerCase();
  if (!raw) return true;
  if (BEHAVIORAL_TIER_ON_VALUES.has(raw)) return true;
  if (BEHAVIORAL_TIER_OFF_VALUES.has(raw)) return false;

  throw new Error(`${BEHAVIORAL_TIER_ENV_VAR} must be one of on/off, true/false, yes/no, or 1/0.`);
}

async function runGateRung<T>(
  outcomes: GateRungOutcome[],
  rung: GateRungName,
  body: () => T | Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await body();
    outcomes.push({ rung, status: "passed", durationMs: performance.now() - startedAt });
    return result;
  } catch (error) {
    outcomes.push({
      rung,
      status: "failed",
      durationMs: performance.now() - startedAt,
      error: errorMessage(error),
    });
    throw new CapabilityGateError(rung, outcomes, error);
  }
}

function skipGateRung(
  outcomes: GateRungOutcome[],
  rung: GateRungName,
  reason: string,
): BehavioralGateResult {
  outcomes.push({ rung, status: "skipped", durationMs: 0, reason });
  return { tier: "off", status: "skipped", reason };
}

function resolveBehavioralTierEnabledForInput(input: CapabilityGateInput): boolean {
  return input.behavioralTier?.enabled ?? resolveBehavioralTierEnabled();
}

function runStructuralRung(input: CapabilityGateInput): void {
  assertHandlerExportShapes(input.handlers);
  const typeFailure = typeCheckHandlers(input.handlers);
  if (typeFailure) throw new Error(typeFailure);
}

async function runSmokeRung(input: CapabilityGateInput): Promise<SmokeGateResult> {
  const realDatabase = input.realDatabase;
  const beforeReal = realDatabase ? snapshotCapabilityTables(realDatabase) : undefined;
  const scratch = openScratchDatabasePair();
  let smoke: SmokeGateResult | undefined;
  let smokeError: unknown;

  try {
    applyDdl(input.ddl, scratch.readwrite);
    const data = createCapabilityDataTool(input.spec, scratch);
    const handlers = await loadHandlers(input.handlers);
    const smokeInput = buildSmokeInput(input.spec);

    const createFragment = await handlers.create({ input: smokeInput.input, data });
    assertFragment("create", createFragment);

    const rows = data.select();
    assertSmokeRows(input.spec, rows, smokeInput.expectedValues);

    const readFragment = await handlers.read({ input: {}, data });
    assertFragment("read", readFragment);

    const insertedRow = rows[0];
    if (!insertedRow) {
      throw new Error("Smoke expected one inserted row, but scratch select returned none.");
    }

    smoke = {
      tableName: input.ddl.tableName,
      rowCount: rows.length,
      insertedRowId: insertedRow.id,
      createFragmentLength: createFragment.length,
      readFragmentLength: readFragment.length,
      ...(beforeReal ? { realDatabaseUnchanged: true } : {}),
    };
  } catch (error) {
    smokeError = error;
  } finally {
    scratch.readonly.close();
    scratch.readwrite.close();
  }

  if (
    beforeReal &&
    realDatabase &&
    !sameSnapshot(beforeReal, snapshotCapabilityTables(realDatabase))
  ) {
    throw new Error("Gate execution changed real capability data tables.");
  }

  if (smokeError) throw smokeError;
  if (!smoke) throw new Error("Smoke rung did not produce a result.");
  return smoke;
}

const behavioralScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
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
  readonly createInput?: Record<string, string>;
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

async function runBehavioralRung(input: CapabilityGateInput): Promise<BehavioralGateResult> {
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

export function buildBehavioralTestPrompt(spec: CapabilitySpec): string {
  return [
    "Generate behavioral tests for this Aluna capability.",
    "",
    "Return one structured object with a `cases` array. Each case is a deterministic black-box test:",
    "- `input` is an array of `{ field, value }` form/query inputs for the create action, as strings.",
    "- `setupRows` is an array of `{ values }` objects; each `values` is an array of `{ field, value }` pairs. They are preexisting rows, all older than the action's new row, and are listed NEWEST-FIRST: `setupRows[0]` is the most recent preexisting row and each later entry is older. Use an empty array when no setup is needed.",
    "- `expectedCreatedRow` is an array of `{ field, value }` spec fields that must be present in one scratch row. Use an empty array when no specific row assertion is needed.",
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
      { behavior: spec.behavior, schema: spec.schema, behavioral_errors: spec.behavioral_errors },
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
  readonly suite: BehavioralTestSuite;
  readonly realDatabase?: Database;
}

async function runBehavioralTests(
  input: RunBehavioralTestsInput,
): Promise<BehavioralTestRunMetrics> {
  const startedAt = performance.now();
  const beforeReal = input.realDatabase ? snapshotCapabilityTables(input.realDatabase) : undefined;
  const handlers = await loadHandlers(input.handlers);
  const cases: BehavioralTestCaseOutcome[] = [];
  let runError: unknown;

  try {
    for (const testCase of input.suite.cases) {
      const caseStartedAt = performance.now();
      await runBehavioralCase(input.spec, input.ddl, handlers, testCase);
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
  testCase: BehavioralTestCase,
): Promise<void> {
  assertBehavioralCaseReferencesSpecFields(spec, testCase);
  const scratch = openScratchDatabasePair();
  const setupRows = testCase.setupRows.map((row) => fieldValuesToRecord(row.values));
  const createInput = inputValuesToRecord(testCase.input);
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

    readFragment = await handlers.read({ input: {}, data });
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
  const fields = new Set(spec.schema.fields.map((field) => field.name));
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

// Compare a stored field value to a behavioral test's expected value *by the field's
// spec type*. This is the success-path analogue of the validation tier's stable error
// codes: assert on semantic content, not on a byte-identical representation the model
// can't be made to emit deterministically. Datetimes compare as instants — a handler
// may legitimately canonicalize "2025-06-01T12:00:00Z" to "2025-06-01T12:00:00.000Z"
// (a `new Date(...).toISOString()` round-trip) while the model authors the test in the
// raw input form; the same *moment* is a match. Strings, numbers, and booleans are
// already normalized by the data tool, so a value comparison is exact for them.
function fieldValueMatches(type: FieldType, stored: unknown, expected: unknown): boolean {
  if (type === "datetime") return sameInstant(stored, expected);
  return stored === expected;
}

function sameInstant(stored: unknown, expected: unknown): boolean {
  if (typeof stored !== "string" || typeof expected !== "string") return stored === expected;
  const storedMs = Date.parse(stored);
  const expectedMs = Date.parse(expected);
  // A non-parseable datetime on either side is not something to silently treat as
  // equal — fall back to exact comparison so a genuinely malformed value still fails.
  if (Number.isNaN(storedMs) || Number.isNaN(expectedMs)) return stored === expected;
  return storedMs === expectedMs;
}

function fieldValuesToRecord(
  values: readonly z.infer<typeof behavioralFieldValueSchema>[],
): Record<string, BehavioralScalar> {
  return Object.fromEntries(values.map((entry) => [entry.field, entry.value]));
}

function inputValuesToRecord(
  values: readonly z.infer<typeof behavioralInputValueSchema>[],
): Record<string, string> {
  return Object.fromEntries(values.map((entry) => [entry.field, entry.value]));
}

function assertHandlerExportShapes(handlers: Readonly<Record<HandlerUnitName, string>>): void {
  for (const name of HANDLER_NAMES) {
    assertHandlerExportShape(name, handlers[name]);
  }
}

function assertHandlerExportShape(name: HandlerUnitName, content: string): void {
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error(`Generated handler "${name}" is missing.`);
  }

  const source = ts.createSourceFile(`${name}.ts`, content, ts.ScriptTarget.Latest, true);
  const statement = exactlyOneExportedStatement(name, source);
  assertDefaultAsyncFunction(name, statement);
}

function exactlyOneExportedStatement(name: HandlerUnitName, source: ts.SourceFile): ts.Statement {
  const exported = source.statements.filter(hasExportSurface);
  if (exported.length !== 1) {
    throw new Error(
      `Generated handler "${name}" must have exactly one export: the default async function.`,
    );
  }

  const [statement] = exported;
  if (!statement) {
    throw new Error(`Generated handler "${name}" must export the default async function.`);
  }
  return statement;
}

function assertDefaultAsyncFunction(name: HandlerUnitName, statement: ts.Statement): void {
  if (!ts.isFunctionDeclaration(statement)) {
    throw new Error(
      `Generated handler "${name}" must default-export an async function declaration.`,
    );
  }

  const modifiers = ts.getModifiers(statement) ?? [];
  const hasDefault = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
  const hasAsync = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);
  if (!hasDefault || !hasAsync) {
    throw new Error(`Generated handler "${name}" must use \`export default async function\`.`);
  }
  if (statement.parameters.length !== 1) {
    throw new Error(
      `Generated handler "${name}" must receive one platform-built context parameter.`,
    );
  }
}

function hasExportSurface(statement: ts.Statement): boolean {
  if (ts.isExportAssignment(statement) || ts.isExportDeclaration(statement)) return true;
  if (!ts.canHaveModifiers(statement)) return false;
  return (ts.getModifiers(statement) ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  );
}

function typeCheckHandlers(
  handlers: Readonly<Record<HandlerUnitName, string>>,
): string | undefined {
  const dir = mkdtempSync(join(tmpdir(), "aluna-gate-typecheck-"));
  try {
    writeFileSync(join(dir, "contract.d.ts"), handlerContractDeclarations);
    for (const name of HANDLER_NAMES) {
      writeFileSync(join(dir, `${name}.ts`), handlers[name]);
    }
    writeFileSync(
      join(dir, "assert.ts"),
      [
        'import create from "./create.ts";',
        'import read from "./read.ts";',
        "const assertCreate: CapabilityHandler = create;",
        "const assertRead: CapabilityHandler = read;",
        "void assertCreate;",
        "void assertRead;",
      ].join("\n"),
    );

    const program = ts.createProgram(
      [
        join(dir, "contract.d.ts"),
        join(dir, "create.ts"),
        join(dir, "read.ts"),
        join(dir, "assert.ts"),
      ],
      {
        allowImportingTsExtensions: true,
        forceConsistentCasingInFileNames: true,
        lib: ["lib.esnext.d.ts"],
        module: ts.ModuleKind.ESNext,
        moduleDetection: ts.ModuleDetectionKind.Force,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        noEmit: true,
        noFallthroughCasesInSwitch: true,
        noImplicitOverride: true,
        noUncheckedIndexedAccess: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        skipLibCheck: true,
        strict: true,
        target: ts.ScriptTarget.ESNext,
        verbatimModuleSyntax: true,
      },
    );
    const diagnostics = ts.getPreEmitDiagnostics(program);
    return diagnostics.length === 0 ? undefined : formatDiagnostics(diagnostics);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

interface ScratchDatabasePair {
  readonly readwrite: Database;
  readonly readonly: Database;
}

function openScratchDatabasePair(): ScratchDatabasePair {
  const name = `aluna_gate_${randomUUID().replaceAll("-", "_")}`;
  const uri = `file:${name}?mode=memory&cache=shared`;
  const readwrite = new Database(uri, { create: true, readwrite: true });
  const readonly = new Database(uri, { readonly: true });
  return { readwrite, readonly };
}

function applyDdl(ddl: CapabilityTableDdl, database: Database): void {
  for (const statement of ddl.statements) {
    database.exec(statement);
  }
}

async function loadHandlers(
  handlers: Readonly<Record<HandlerUnitName, string>>,
): Promise<Readonly<Record<HandlerUnitName, CapabilityHandler>>> {
  const loaded = HANDLER_NAMES.map(
    (name) => [name, loadHandlerFromSource(name, handlers[name])] as const,
  );

  return Object.fromEntries(loaded) as Readonly<Record<HandlerUnitName, CapabilityHandler>>;
}

function loadHandlerFromSource(name: HandlerUnitName, content: string): CapabilityHandler {
  // Do not dynamic-import a temporary .ts file here. In `bun --watch`, imported
  // temp files join the watch set; deleting them restarts the dev server mid-SSE.
  const transpiled = ts.transpileModule(content, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
      verbatimModuleSyntax: true,
    },
    fileName: `${name}.ts`,
    reportDiagnostics: true,
  });
  if (transpiled.diagnostics && transpiled.diagnostics.length > 0) {
    throw new Error(formatDiagnostics(transpiled.diagnostics));
  }

  const runnable = transpiled.outputText.replace(
    /\bexport\s+default\s+async\s+function(?:\s+[A-Za-z_$][\w$]*)?/,
    "async function __alunaDefaultHandler",
  );
  if (runnable === transpiled.outputText) {
    throw new Error(`Generated handler "${name}" could not be prepared for smoke execution.`);
  }

  const factory = new Function(`${runnable}\nreturn __alunaDefaultHandler;`);
  const handler = factory() as unknown;
  if (typeof handler !== "function") {
    throw new TypeError(`Generated handler "${name}" has no default function export.`);
  }
  return handler as CapabilityHandler;
}

interface SmokeInput {
  readonly input: Readonly<Record<string, string>>;
  readonly expectedValues: Readonly<Record<string, string | number | boolean>>;
}

function buildSmokeInput(spec: CapabilitySpec): SmokeInput {
  const input: Record<string, string> = {};
  const expectedValues: Record<string, string | number | boolean> = {};

  for (const field of spec.schema.fields) {
    const sample = sampleValue(field);
    input[field.name] = sample.input;
    expectedValues[field.name] = sample.expected;
  }

  return { input, expectedValues };
}

function sampleValue(field: SpecField): { input: string; expected: string | number | boolean } {
  switch (field.type) {
    case "string":
      return { input: `gate smoke ${field.name}`, expected: `gate smoke ${field.name}` };
    case "number":
      return { input: "42.5", expected: 42.5 };
    case "boolean":
      return { input: "on", expected: true };
    case "datetime":
      return { input: "2026-06-23T00:00:00.000Z", expected: "2026-06-23T00:00:00.000Z" };
  }
}

function assertFragment(action: HandlerUnitName, fragment: unknown): asserts fragment is string {
  if (typeof fragment !== "string" || fragment.trim().length === 0) {
    throw new Error(`Smoke ${action} handler must return a non-empty HTML fragment string.`);
  }
}

function assertSmokeRows(
  spec: CapabilitySpec,
  rows: ReturnType<ReturnType<typeof createCapabilityDataTool>["select"]>,
  expectedValues: Readonly<Record<string, string | number | boolean>>,
): void {
  if (rows.length !== 1) {
    throw new Error(`Smoke expected exactly one scratch row, received ${rows.length}.`);
  }

  const row = rows[0];
  if (!row) throw new Error("Smoke expected one scratch row, received none.");

  for (const field of spec.schema.fields) {
    const expected = expectedValues[field.name];
    if (!fieldValueMatches(field.type, row[field.name], expected)) {
      throw new Error(
        `Smoke row field "${field.name}" expected ${JSON.stringify(expected)}, received ${JSON.stringify(row[field.name])}.`,
      );
    }
  }
}

interface CapabilityTableSnapshot {
  readonly tableName: string;
  readonly rowsJson: string;
}

function snapshotCapabilityTables(database: Database): readonly CapabilityTableSnapshot[] {
  const tables = database
    .query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'cap\\_%' ESCAPE '\\' ORDER BY name",
    )
    .all() as { name: string }[];

  return tables.map(({ name }) => ({
    tableName: name,
    rowsJson: JSON.stringify(
      database.query(`SELECT * FROM ${sqlIdentifier(name)} ORDER BY "id"`).all(),
    ),
  }));
}

function sameSnapshot(
  left: readonly CapabilityTableSnapshot[],
  right: readonly CapabilityTableSnapshot[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return diagnostics
    .map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      if (!diagnostic.file || diagnostic.start === undefined) return message;

      const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return `${diagnostic.file.fileName}:${position.line + 1}:${position.character + 1} - ${message}`;
    })
    .join("\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function diagnosticForError(error: unknown): unknown {
  return isDiagnosticError(error) ? error.diagnostic : undefined;
}

function isDiagnosticError(error: unknown): error is { readonly diagnostic: unknown } {
  return (
    typeof error === "object" &&
    error !== null &&
    "diagnostic" in error &&
    (error as { diagnostic?: unknown }).diagnostic !== undefined
  );
}

const handlerContractDeclarations = `
type JsonPrimitive = string | number | boolean | null;
interface JsonObject {
  readonly [key: string]: JsonValue;
}
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type CapabilityDataColumnValue = string | number | boolean | JsonObject | null;
interface CapabilityDataRow {
  readonly id: string;
  readonly created_at: string;
  readonly extra: JsonObject;
  readonly [field: string]: CapabilityDataColumnValue;
}
type CapabilityInput = Readonly<Record<string, string>>;
interface CapabilityDataTool {
  insert(values: Record<string, unknown>): CapabilityDataRow;
  select(): CapabilityDataRow[];
}
interface CapabilityContext {
  readonly input: CapabilityInput;
  readonly data: CapabilityDataTool;
}
type CapabilityHandler = (context: CapabilityContext) => Promise<string>;
`;
