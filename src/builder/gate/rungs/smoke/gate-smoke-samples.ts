// The scratch values the always-on smoke drives one full CRUD cycle with: one create
// payload and one per-field update payload, typed off the spec's own field pantry.
//
// The switch is exhaustive by construction (an explicit non-`unknown` return type and no
// `default`), so a new field type cannot reach the smoke without a sample of its own. A
// choice is the one type whose sample is not free text: it can only ever hold a value it
// declares, so both phases draw from its declared options. A file field submits what the form's
// photo control posts, and takes the edits in turn that its field permits (`fileUpdateSamples`).

import type { Database } from "bun:sqlite";
import {
  activeFileFields,
  activeSpecFields,
  type CapabilitySpec,
  isFileFieldType,
  type SpecField,
  selectableChoiceValues,
} from "../../../../registry/index.ts";
import {
  type CapabilityDataColumnValue,
  type CapabilityFileProjection,
  FILE_CLEAR_VALUE,
  projectFileLedgerRow,
} from "../../../../runtime/data/index.ts";
import type { CapabilityInput, CapabilityInputValue } from "../../../../runtime/router/index.ts";
import { mintScratchFile } from "../../gate-scratch-files.ts";
import { scratchFileName } from "../../gate-scratch-names.ts";

export interface SmokeInput {
  readonly input: CapabilityInput;
  readonly expectedValues: Readonly<Record<string, CapabilityDataColumnValue>>;
}

/** One pending scratch file: the key a form posts, and the file a read should then find. */
export interface SmokeFile {
  readonly key: string;
  readonly expected: CapabilityFileProjection;
}

/**
 * The files one cycle submits to a file field: on create, as a replacement, onto an empty field,
 * and to the second create, which a required field is never left out of.
 */
export interface SmokeFiles {
  readonly created: SmokeFile;
  readonly replacement: SmokeFile;
  readonly added: SmokeFile;
  readonly leftOut: SmokeFile;
}

/** Every active file field's smoke files, minted pending in the scratch ledger before the cycle. */
export function mintSmokeFiles(
  spec: CapabilitySpec,
  database: Database,
): ReadonlyMap<string, SmokeFiles> {
  const fileFields = activeFileFields(spec.schema.fields);
  return new Map(
    fileFields.map((field) => {
      const mint = (label: string): SmokeFile => {
        const row = mintScratchFile(database, spec, field, scratchFileName(label));
        return { key: row.key, expected: projectFileLedgerRow(row) };
      };
      const files = {
        created: mint("gate smoke"),
        replacement: mint("gate update"),
        added: mint("gate added"),
        leftOut: mint("gate second"),
      };
      return [field.name, files];
    }),
  );
}

export function buildSmokeInput(
  spec: CapabilitySpec,
  files: ReadonlyMap<string, SmokeFiles>,
): SmokeInput {
  const values: Record<string, CapabilityInputValue> = {};
  const expectedValues: Record<string, CapabilityDataColumnValue> = {};
  const fields = activeSpecFields(spec.schema.fields);
  for (const field of fields) {
    const sample = sampleValue(field, "create", files.get(field.name));
    if (sample.input !== undefined) values[field.name] = sample.input;
    expectedValues[field.name] = sample.expected;
  }
  return {
    input: { values, submittedFields: new Set(fields.map((field) => field.name)) },
    expectedValues,
  };
}

/**
 * A second create with every optional file field left out of both the values and the submitted
 * fields, as a request other than the form's may send it, so the record holds no file there. A
 * required file field posts a file of its own, since the first create's is claimed by now; a spec
 * with no optional one has no such create.
 */
export function leftOutCreate(
  spec: CapabilitySpec,
  files: ReadonlyMap<string, SmokeFiles>,
): SmokeInput | undefined {
  const fileFields = activeFileFields(spec.schema.fields);
  const leftOut = new Set(fileFields.filter((field) => !field.required).map(({ name }) => name));
  if (leftOut.size === 0) return undefined;
  const smoke = buildSmokeInput(spec, files);
  const values = { ...smoke.input.values };
  const expectedValues = { ...smoke.expectedValues };
  for (const field of fileFields) {
    if (leftOut.has(field.name)) {
      delete values[field.name];
      expectedValues[field.name] = null;
      continue;
    }
    const own = requireSmokeFiles(field, files.get(field.name)).leftOut;
    values[field.name] = own.key;
    expectedValues[field.name] = own.expected;
  }
  const submittedFields = new Set(
    [...smoke.input.submittedFields].filter((name) => !leftOut.has(name)),
  );
  return { input: { values, submittedFields }, expectedValues };
}

export interface SmokeUpdateSample {
  readonly field: SpecField;
  readonly input: CapabilityInput;
  readonly expected: CapabilityDataColumnValue;
}

export function buildUpdateInputs(
  spec: CapabilitySpec,
  files: ReadonlyMap<string, SmokeFiles>,
): readonly SmokeUpdateSample[] {
  const fields = activeSpecFields(spec.schema.fields);
  if (fields.length === 0) throw new Error("Smoke update requires at least one active field.");
  return fields.flatMap((field) => {
    if (isFileFieldType(field.type)) {
      return fileUpdateSamples(field, requireSmokeFiles(field, files.get(field.name)));
    }
    const sample = sampleValue(field, "update", undefined);
    return [updateSample(field, sample.input, sample.expected)];
  });
}

/**
 * The edits the form's photo control posts, in an order where each starts from what the last one
 * left: keep the file the record holds, replace it, clear it, leave the empty field empty, and add
 * one. A required field is refused an empty save, so it takes the first two alone.
 */
function fileUpdateSamples(field: SpecField, files: SmokeFiles): readonly SmokeUpdateSample[] {
  const holding = [
    updateSample(field, files.created.key, files.created.expected),
    updateSample(field, files.replacement.key, files.replacement.expected),
  ];
  if (field.required) return holding;
  return [
    ...holding,
    updateSample(field, FILE_CLEAR_VALUE, null),
    updateSample(field, "", null),
    updateSample(field, files.added.key, files.added.expected),
  ];
}

function updateSample(
  field: SpecField,
  value: CapabilityInputValue | undefined,
  expected: CapabilityDataColumnValue,
): SmokeUpdateSample {
  return {
    field,
    input: {
      values: value === undefined ? {} : { [field.name]: value },
      submittedFields: new Set([field.name]),
    },
    expected,
  };
}

function requireSmokeFiles(field: SpecField, files: SmokeFiles | undefined): SmokeFiles {
  if (!files) throw new Error(`Smoke file field "${field.name}" has no scratch files minted.`);
  return files;
}

function sampleValue(
  field: SpecField,
  phase: "create" | "update",
  files: SmokeFiles | undefined,
): { readonly input?: CapabilityInputValue; readonly expected: CapabilityDataColumnValue } {
  const prefix = phase === "create" ? "gate smoke" : "gate update";
  switch (field.type) {
    case "string": {
      const sample = boundedSample(`${prefix} ${field.name}`, field.max_length);
      return { input: sample, expected: sample };
    }
    case "number":
      return phase === "create"
        ? { input: "42.5", expected: 42.5 }
        : { input: "84.25", expected: 84.25 };
    case "boolean":
      return phase === "create" ? { expected: false } : { input: "on", expected: true };
    case "datetime":
      return phase === "create"
        ? { input: "2026-06-23T00:00:00.000Z", expected: "2026-06-23T00:00:00.000Z" }
        : { input: "2027-07-24T01:02:03.000Z", expected: "2027-07-24T01:02:03.000Z" };
    case "date":
      return phase === "create"
        ? { input: "2026-06-23", expected: "2026-06-23" }
        : { input: "2027-07-24", expected: "2027-07-24" };
    case "choice": {
      const chosen = sampleChoiceValue(field, phase);
      return { input: chosen, expected: chosen };
    }
    case "string[]": {
      const expected = [`${prefix} first`, "literal,comma", `${prefix} last`];
      return { input: expected, expected };
    }
    case "file": {
      const { created } = requireSmokeFiles(field, files);
      return { input: created.key, expected: created.expected };
    }
  }
}

/**
 * The smoke's own free text, trimmed to the field's declared limit: a field name is unbounded, so
 * the sample can outrun a fair limit and fail the cycle on the fixture, not the capability.
 */
function boundedSample(sample: string, limit: number | undefined): string {
  return limit === undefined || sample.length <= limit ? sample : sample.slice(0, limit);
}

/**
 * A value the field actually declares, so the cycle runs on real admitted options. Only ones still
 * on offer: the platform refuses a disabled one on a new selection, and one is always choosable.
 */
function sampleChoiceValue(field: SpecField, phase: "create" | "update"): string {
  const options = [...selectableChoiceValues(field)];
  const first = options[0];
  if (!first) throw new Error(`Choice field "${field.name}" offers no choosable option.`);
  return phase === "create" ? first : (options[1] ?? first);
}
