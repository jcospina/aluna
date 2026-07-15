// The smoke rung — a real create→read round-trip through the generated handlers,
// against a scratch database, using the same injected-toolbox contract the runtime
// uses.
//
// It applies the migration's exact DDL to scratch, runs `create` with a synthesized
// sample input, asserts the row landed with the expected typed values, then runs
// `read` — proving the generated code actually works end to end. When a real db is
// supplied it snapshots the `cap_*` tables before and after and fails if the gate
// changed them.

import {
  type CapabilityDataColumnValue,
  createCapabilityDataTool,
} from "../capability-data/index.ts";
import { activeSpecFields, type CapabilitySpec, type SpecField } from "../registry/index.ts";
import type { CapabilityInput, CapabilityInputValue } from "../router/index.ts";
import type { CapabilityGateInput, SmokeGateResult } from "./gate.ts";
import {
  applyDdl,
  assertFragment,
  buildGatePresent,
  fieldValueMatches,
  loadHandlers,
  openScratchDatabasePair,
  sameSnapshot,
  snapshotCapabilityTables,
} from "./gate-internal.ts";

/** Run the smoke rung: a create→read round-trip on scratch, asserting the row + fragments. */
export async function runSmokeRung(input: CapabilityGateInput): Promise<SmokeGateResult> {
  const realDatabase = input.realDatabase;
  const beforeReal = realDatabase ? snapshotCapabilityTables(realDatabase) : undefined;
  const scratch = openScratchDatabasePair();
  let smoke: SmokeGateResult | undefined;
  let smokeError: unknown;

  try {
    applyDdl(input.ddl, scratch.readwrite);
    const data = createCapabilityDataTool(input.spec, scratch);
    const handlers = await loadHandlers(input.handlers);
    // The real adapter the router injects at runtime, built from this build's item
    // renderer. Create and read render records through it, so their item markup cannot
    // drift (ADR-0005 §2).
    const present = buildGatePresent(input.spec, input.itemRenderer);
    const smokeInput = buildSmokeInput(input.spec);

    const createFragment = await handlers.create({
      input: smokeInput.input,
      data,
      present,
    });
    assertFragment("create", createFragment);

    const rows = data.select();
    assertSmokeRows(input.spec, rows, smokeInput.expectedValues);

    const readFragment = await handlers.read({
      input: { values: {}, submittedFields: new Set() },
      data,
      present,
    });
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

interface SmokeInput {
  readonly input: CapabilityInput;
  readonly expectedValues: Readonly<Record<string, CapabilityDataColumnValue>>;
}

function buildSmokeInput(spec: CapabilitySpec): SmokeInput {
  const values: Record<string, CapabilityInputValue> = {};
  const expectedValues: Record<string, CapabilityDataColumnValue> = {};

  for (const field of activeSpecFields(spec.schema.fields)) {
    const sample = sampleValue(field);
    values[field.name] = sample.input;
    expectedValues[field.name] = sample.expected;
  }

  return {
    input: {
      values,
      submittedFields: new Set(activeSpecFields(spec.schema.fields).map((field) => field.name)),
    },
    expectedValues,
  };
}

function sampleValue(field: SpecField): {
  input: CapabilityInputValue;
  expected: CapabilityDataColumnValue;
} {
  switch (field.type) {
    case "string":
      return { input: `gate smoke ${field.name}`, expected: `gate smoke ${field.name}` };
    case "number":
      return { input: "42.5", expected: 42.5 };
    case "boolean":
      return { input: "on", expected: true };
    case "datetime":
      return { input: "2026-06-23T00:00:00.000Z", expected: "2026-06-23T00:00:00.000Z" };
    case "date":
      return { input: "2026-06-23", expected: "2026-06-23" };
    case "string[]":
      return {
        input: [`gate smoke ${field.name} first`, "literal,comma", `gate smoke ${field.name} last`],
        expected: [
          `gate smoke ${field.name} first`,
          "literal,comma",
          `gate smoke ${field.name} last`,
        ],
      };
  }
}

function assertSmokeRows(
  spec: CapabilitySpec,
  rows: ReturnType<ReturnType<typeof createCapabilityDataTool>["select"]>,
  expectedValues: Readonly<Record<string, CapabilityDataColumnValue>>,
): void {
  if (rows.length !== 1) {
    throw new Error(`Smoke expected exactly one scratch row, received ${rows.length}.`);
  }

  const row = rows[0];
  if (!row) throw new Error("Smoke expected one scratch row, received none.");

  for (const field of activeSpecFields(spec.schema.fields)) {
    const expected = expectedValues[field.name];
    if (!fieldValueMatches(field.type, row[field.name], expected)) {
      throw new Error(
        `Smoke row field "${field.name}" expected ${JSON.stringify(expected)}, received ${JSON.stringify(row[field.name])}.`,
      );
    }
  }
}
