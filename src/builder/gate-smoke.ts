// The always-on smoke rung — the complete five-Action lifecycle plus the frozen,
// platform-owned deterministic-search baseline. Every execution uses fresh scratch
// SQLite and the same mutation/query/presentation adapters as live routing.

import type { Database } from "bun:sqlite";

import {
  type CapabilityDataColumnValue,
  type CapabilityDataRow,
  createCapabilityDeleteMutationPort,
  createCapabilityMutationPort,
  createCapabilityUpdateMutationPort,
  encodeCapabilityFieldForStorage,
  materializeCapabilityActionRecord,
  selectCapabilityRows,
} from "../capability-data/index.ts";
import { activeSpecFields, type CapabilitySpec, type SpecField } from "../registry/index.ts";
import type {
  CapabilityDeleteHandler,
  CapabilityInput,
  CapabilityInputValue,
} from "../router/index.ts";
import type { CapabilityGateInput, SmokeGateResult } from "./gate.ts";
import {
  assertFragment,
  buildGatePresent,
  buildGateQueryPort,
  fieldValueMatches,
  type LoadedHandlers,
  loadHandlers,
  openScratchDatabasePair,
  prepareScratchCatalog,
  SMOKE_HANDLER_NAMES,
  sameSnapshot,
  snapshotCapabilityTables,
  sqlIdentifier,
} from "./gate-internal.ts";
import { runSmokeRepairLoop, SmokeActionFailure, type SmokeRungRun } from "./gate-smoke-repair.ts";
import {
  fixtureFieldValue,
  type RecordingPresentation,
  runAdversarialSearchBaseline,
} from "./gate-smoke-search.ts";
import type { HandlerUnitName } from "./units.ts";

/**
 * Run the unchanged fixture, repairing only the Handler to which a failure is
 * attributed. Attempt one checks the supplied snapshot; each later attempt uses one
 * provider regeneration and reruns the entire fixture from a fresh scratch database.
 */
export async function runSmokeRung(input: CapabilityGateInput): Promise<SmokeRungRun> {
  return runSmokeRepairLoop(input, (handlers) => executeSmokeSnapshot({ ...input, handlers }));
}

async function executeSmokeSnapshot(
  input: CapabilityGateInput,
): Promise<Omit<SmokeGateResult, "fixed" | "attempts" | "usage">> {
  const realDatabase = input.realDatabase;
  const beforeReal = realDatabase ? snapshotCapabilityTables(realDatabase) : undefined;
  const scratch = openScratchDatabasePair();

  try {
    prepareScratchCatalog(input.spec, input.ddl, input.scratchCatalog, scratch);
    const result = await executeSmokeCycle(input, scratch.readwrite, scratch.readonly);
    assertRealDatabaseUnchanged(realDatabase, beforeReal);
    return { ...result, ...(beforeReal ? { realDatabaseUnchanged: true } : {}) };
  } catch (error) {
    assertRealDatabaseUnchanged(realDatabase, beforeReal);
    throw error;
  } finally {
    scratch.readonly.close();
    scratch.readwrite.close();
  }
}

async function executeSmokeCycle(
  input: CapabilityGateInput,
  readwrite: Database,
  readonly: Database,
): Promise<Omit<SmokeGateResult, "fixed" | "attempts" | "usage" | "realDatabaseUnchanged">> {
  const isFullCrud = input.spec.tools.length === SMOKE_HANDLER_NAMES.length;
  const names = isFullCrud ? SMOKE_HANDLER_NAMES : (["create", "read"] as const);
  const handlers = await loadHandlers(input.handlers, names);
  const recorder = recordingPresentation(input.spec, input.itemRenderer);
  const initial = await executeCreateRead(input, handlers, recorder, readwrite, readonly);
  const { beforeUpdate, createFragment, initialRows, insertedRow, readFragment } = initial;

  if (!isFullCrud) {
    return {
      tableName: input.ddl.tableName,
      rowCount: initialRows.length,
      insertedRowId: insertedRow.id,
      createFragmentLength: createFragment.length,
      readFragmentLength: readFragment.length,
    };
  }

  const update = handlers.update;
  const search = handlers.search;
  const remove = handlers.delete;
  if (!update || !search || !remove) {
    throw new Error("Five-Action smoke requires update, search, and delete Handlers.");
  }

  const updateSample = buildUpdateInput(input.spec);
  const updateFragment = await runAction("update", async () => {
    recorder.clear();
    const fragment = await update({
      input: updateSample.input,
      mutation: createCapabilityUpdateMutationPort(
        input.spec,
        insertedRow.id,
        updateSample.input.submittedFields,
        readwrite,
      ),
      query: buildGateQueryPort(input.spec, "update", input.scratchCatalog, readonly),
      present: recorder.present,
    });
    assertFragment("update", fragment);
    const rows = selectCapabilityRows(
      input.spec,
      buildGateQueryPort(input.spec, "read", input.scratchCatalog, readonly),
    );
    const updated = rows.find((row) => row.id === insertedRow.id);
    if (!updated) throw new Error("updated target disappeared from scratch");
    if (
      !fieldValueMatches(
        updateSample.field.type,
        updated[updateSample.field.name],
        updateSample.expected,
      )
    ) {
      throw new Error(
        `updated field ${updateSample.field.name} did not persist the submitted value`,
      );
    }
    assertObservedRows(input.spec, recorder.rows(), [updated]);
    assertMergePreserved(
      input.spec,
      beforeUpdate,
      rawRow(input.ddl.tableName, insertedRow.id, readwrite),
      updateSample.field.name,
    );
    return fragment;
  });

  const searchCaseCount = await runAction("search", () =>
    runAdversarialSearchBaseline({
      spec: input.spec,
      tableName: input.ddl.tableName,
      readwrite,
      readonly,
      scratchCatalog: input.scratchCatalog,
      read: handlers.read,
      search,
      recorder,
      updatedField: updateSample.field,
      updatedId: insertedRow.id,
    }),
  );

  const deleteFragment = await executeDelete(input, remove, insertedRow.id, readwrite, readonly);

  return {
    tableName: input.ddl.tableName,
    rowCount: initialRows.length,
    insertedRowId: insertedRow.id,
    createFragmentLength: createFragment.length,
    readFragmentLength: readFragment.length,
    updateFragmentLength: updateFragment.length,
    searchCaseCount,
    deleteFragmentLength: deleteFragment.length,
  };
}

interface CreateReadResult {
  readonly beforeUpdate: Record<string, unknown>;
  readonly createFragment: string;
  readonly initialRows: readonly CapabilityDataRow[];
  readonly insertedRow: CapabilityDataRow;
  readonly readFragment: string;
}

async function executeCreateRead(
  input: CapabilityGateInput,
  handlers: LoadedHandlers,
  recorder: RecordingPresentation,
  readwrite: Database,
  readonly: Database,
): Promise<CreateReadResult> {
  const smokeInput = buildSmokeInput(input.spec);
  const createFragment = await runAction("create", async () => {
    recorder.clear();
    const fragment = await handlers.create({
      input: smokeInput.input,
      mutation: createCapabilityMutationPort(input.spec, readwrite),
      query: buildGateQueryPort(input.spec, "create", input.scratchCatalog, readonly),
      present: recorder.present,
    });
    assertFragment("create", fragment);
    return fragment;
  });
  const initialRows = selectCapabilityRows(
    input.spec,
    buildGateQueryPort(input.spec, "read", input.scratchCatalog, readonly),
  );
  await runAction("create", () => {
    assertSmokeRows(input.spec, initialRows, smokeInput.expectedValues);
    assertObservedRows(input.spec, recorder.rows(), initialRows);
  });
  const insertedRow = initialRows[0];
  if (!insertedRow) throw new SmokeActionFailure("create", "scratch insert produced no row");
  seedProtectedUpdateState(input.spec, input.ddl.tableName, insertedRow.id, readwrite);
  const beforeUpdate = rawRow(input.ddl.tableName, insertedRow.id, readwrite);
  const readFragment = await runRead(input, handlers, recorder, readonly);
  return { beforeUpdate, createFragment, initialRows, insertedRow, readFragment };
}

async function runRead(
  input: CapabilityGateInput,
  handlers: LoadedHandlers,
  recorder: RecordingPresentation,
  readonly: Database,
): Promise<string> {
  return runAction("read", async () => {
    recorder.clear();
    const fragment = await handlers.read({
      input: emptyInput(),
      query: buildGateQueryPort(input.spec, "read", input.scratchCatalog, readonly),
      present: recorder.present,
    });
    assertFragment("read", fragment);
    const expected = selectCapabilityRows(
      input.spec,
      buildGateQueryPort(input.spec, "read", input.scratchCatalog, readonly),
    );
    assertObservedRows(input.spec, recorder.rows(), expected);
    return fragment;
  });
}

async function executeDelete(
  input: CapabilityGateInput,
  handler: CapabilityDeleteHandler,
  targetId: string,
  readwrite: Database,
  readonly: Database,
): Promise<string> {
  return runAction("delete", async () => {
    const fragment = await handler({
      input: emptyInput(),
      mutation: createCapabilityDeleteMutationPort(input.spec, targetId, readwrite),
      query: buildGateQueryPort(input.spec, "delete", input.scratchCatalog, readonly),
    });
    if (typeof fragment !== "string") throw new Error("delete Handler did not return a string");
    if (rawRowOrNull(input.ddl.tableName, targetId, readwrite)) {
      throw new Error("delete Handler left its bound target in scratch");
    }
    return fragment;
  });
}

function recordingPresentation(spec: CapabilitySpec, itemRenderer: string): RecordingPresentation {
  const base = buildGatePresent(spec, itemRenderer);
  const observed: CapabilityDataRow[] = [];
  const fragments: string[] = [];
  return {
    present(record) {
      observed.push(materializeCapabilityActionRecord(record));
      const fragment = base(record);
      fragments.push(fragment);
      return fragment;
    },
    clear() {
      observed.length = 0;
      fragments.length = 0;
    },
    rows() {
      return [...observed];
    },
    fragments() {
      return [...fragments];
    },
  };
}

interface SmokeInput {
  readonly input: CapabilityInput;
  readonly expectedValues: Readonly<Record<string, CapabilityDataColumnValue>>;
}

function buildSmokeInput(spec: CapabilitySpec): SmokeInput {
  const values: Record<string, CapabilityInputValue> = {};
  const expectedValues: Record<string, CapabilityDataColumnValue> = {};
  const fields = activeSpecFields(spec.schema.fields);
  for (const field of fields) {
    const sample = sampleValue(field, "create");
    if (sample.input !== undefined) values[field.name] = sample.input;
    expectedValues[field.name] = sample.expected;
  }
  return {
    input: { values, submittedFields: new Set(fields.map((field) => field.name)) },
    expectedValues,
  };
}

function buildUpdateInput(spec: CapabilitySpec): {
  readonly field: SpecField;
  readonly input: CapabilityInput;
  readonly expected: CapabilityDataColumnValue;
} {
  const fields = activeSpecFields(spec.schema.fields);
  const field =
    fields.find((candidate) => candidate.type === "string" || candidate.type === "string[]") ??
    fields.find((candidate) => candidate.type !== "boolean") ??
    fields[0];
  if (!field) throw new Error("Smoke update requires at least one active field.");
  const sample = sampleValue(field, "update");
  return {
    field,
    input: {
      values: sample.input === undefined ? {} : { [field.name]: sample.input },
      submittedFields: new Set([field.name]),
    },
    expected: sample.expected,
  };
}

function sampleValue(
  field: SpecField,
  phase: "create" | "update",
): { readonly input?: CapabilityInputValue; readonly expected: CapabilityDataColumnValue } {
  const prefix = phase === "create" ? "gate smoke" : "gate update";
  switch (field.type) {
    case "string":
      return { input: `${prefix} ${field.name}`, expected: `${prefix} ${field.name}` };
    case "number":
      return phase === "create"
        ? { input: "42.5", expected: 42.5 }
        : { input: "84.25", expected: 84.25 };
    case "boolean":
      return phase === "create" ? { input: "on", expected: true } : { expected: false };
    case "datetime":
      return phase === "create"
        ? { input: "2026-06-23T00:00:00.000Z", expected: "2026-06-23T00:00:00.000Z" }
        : { input: "2027-07-24T01:02:03.000Z", expected: "2027-07-24T01:02:03.000Z" };
    case "date":
      return phase === "create"
        ? { input: "2026-06-23", expected: "2026-06-23" }
        : { input: "2027-07-24", expected: "2027-07-24" };
    case "string[]": {
      const expected = [`${prefix} first`, "literal,comma", `${prefix} last`];
      return { input: expected, expected };
    }
  }
}

function assertSmokeRows(
  spec: CapabilitySpec,
  rows: readonly CapabilityDataRow[],
  expectedValues: Readonly<Record<string, CapabilityDataColumnValue>>,
): void {
  if (rows.length !== 1)
    throw new Error(`expected exactly one scratch row, received ${rows.length}`);
  const row = rows[0];
  if (!row) throw new Error("expected one scratch row, received none");
  for (const field of activeSpecFields(spec.schema.fields)) {
    if (!fieldValueMatches(field.type, row[field.name], expectedValues[field.name])) {
      throw new Error(
        `row field ${field.name} expected ${JSON.stringify(expectedValues[field.name])}, received ${JSON.stringify(row[field.name])}`,
      );
    }
  }
}

function seedProtectedUpdateState(
  spec: CapabilitySpec,
  tableName: string,
  id: string,
  database: Database,
): void {
  const assignments: string[] = ['"extra" = ?'];
  const values: Array<string | number | null> = ['{"gate":"merge-preserved"}'];
  for (const field of spec.schema.fields.filter(
    (candidate) => candidate.lifecycle === "inactive",
  )) {
    assignments.push(`${sqlIdentifier(field.name)} = ?`);
    values.push(encodeCapabilityFieldForStorage(field, fixtureFieldValue(field, 91)));
  }
  database
    .query(`UPDATE ${sqlIdentifier(tableName)} SET ${assignments.join(", ")} WHERE "id" = ?`)
    .run(...values, id);
}

function assertMergePreserved(
  spec: CapabilitySpec,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  changedField: string,
): void {
  for (const name of [
    "id",
    "created_at",
    "extra",
    ...spec.schema.fields.filter((field) => field.name !== changedField).map((field) => field.name),
  ]) {
    if (JSON.stringify(after[name]) !== JSON.stringify(before[name])) {
      throw new Error(`merge update changed omitted/protected column ${name}`);
    }
  }
}

function rawRow(tableName: string, id: string, database: Database): Record<string, unknown> {
  const row = rawRowOrNull(tableName, id, database);
  if (!row) throw new Error(`scratch row ${id} is missing`);
  return row;
}

function rawRowOrNull(
  tableName: string,
  id: string,
  database: Database,
): Record<string, unknown> | null {
  return database
    .query(`SELECT * FROM ${sqlIdentifier(tableName)} WHERE "id" = ?`)
    .get(id) as Record<string, unknown> | null;
}

function assertObservedRows(
  spec: CapabilitySpec,
  observed: readonly CapabilityDataRow[],
  expected: readonly CapabilityDataRow[],
): void {
  assertIdsEqual(
    "rendered record order",
    observed.map((row) => row.id),
    expected.map((row) => row.id),
  );
  const expectedKeys = [
    "created_at",
    "id",
    ...activeSpecFields(spec.schema.fields).map((field) => field.name),
  ].sort();
  for (const row of observed) {
    if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(expectedKeys)) {
      throw new Error(`record ${row.id} did not expose the complete Action-safe active projection`);
    }
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (JSON.stringify(observed[index]) !== JSON.stringify(expected[index])) {
      throw new Error(
        `rendered record ${expected[index]?.id ?? index} was not completely rehydrated`,
      );
    }
  }
}

function assertIdsEqual(
  label: string,
  actual: readonly string[],
  expected: readonly string[],
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

function emptyInput(): CapabilityInput {
  return { values: {}, submittedFields: new Set() };
}

async function runAction<T>(action: HandlerUnitName, operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof SmokeActionFailure) throw error;
    throw new SmokeActionFailure(
      action,
      error instanceof Error ? error.message : String(error),
      error,
    );
  }
}

function assertRealDatabaseUnchanged(
  database: Database | undefined,
  before: ReturnType<typeof snapshotCapabilityTables> | undefined,
): void {
  if (database && before && !sameSnapshot(before, snapshotCapabilityTables(database))) {
    throw new Error("Gate execution changed real capability data tables.");
  }
}
