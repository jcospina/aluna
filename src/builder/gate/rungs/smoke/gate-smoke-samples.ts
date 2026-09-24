// The scratch values the always-on smoke drives one full CRUD cycle with: one create
// payload and one per-field update payload, typed off the spec's own field pantry.
//
// The switch is exhaustive by construction (an explicit non-`unknown` return type and no
// `default`), so a new field type cannot reach the smoke without a sample of its own. A
// choice is the one type whose sample is not free text: it can only ever hold a value it
// declares, so both phases draw from its declared options. A file field submits what 7.1/08's
// control will post, and takes five edits in turn (`fileUpdateSamples`).

import type { Database } from "bun:sqlite";
import {
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
import { mintScratchFile, scratchFileName } from "../../gate-scratch-files.ts";

export interface SmokeInput {
  readonly input: CapabilityInput;
  readonly expectedValues: Readonly<Record<string, CapabilityDataColumnValue>>;
}

/** One pending scratch file: the key a form posts, and the file a read should then find. */
export interface SmokeFile {
  readonly key: string;
  readonly expected: CapabilityFileProjection;
}

/** The files one cycle submits to a file field: on create, as a replacement, and onto an empty field. */
export interface SmokeFiles {
  readonly created: SmokeFile;
  readonly replacement: SmokeFile;
  readonly added: SmokeFile;
}

/** Every active file field's smoke files, minted pending in the scratch ledger before the cycle. */
export function mintSmokeFiles(
  spec: CapabilitySpec,
  database: Database,
): ReadonlyMap<string, SmokeFiles> {
  const fileFields = activeSpecFields(spec.schema.fields).filter((field) =>
    isFileFieldType(field.type),
  );
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
 * The same create as the form's stand-in posts it until 7.1/08: every file field left out of both
 * the values and the submitted fields, so the record holds no file.
 */
export function standInCreate(smoke: SmokeInput, spec: CapabilitySpec): SmokeInput {
  const files = new Set(
    activeSpecFields(spec.schema.fields)
      .filter((field) => isFileFieldType(field.type))
      .map((field) => field.name),
  );
  const kept = <Value>(entries: Readonly<Record<string, Value>>) =>
    Object.fromEntries(Object.entries(entries).filter(([name]) => !files.has(name)));
  return {
    input: {
      values: kept(smoke.input.values),
      submittedFields: new Set([...smoke.input.submittedFields].filter((name) => !files.has(name))),
    },
    expectedValues: {
      ...kept(smoke.expectedValues),
      ...Object.fromEntries([...files].map((name) => [name, null])),
    },
  };
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
 * The edits 7.1/08's control posts, in an order where each starts from what the last one left:
 * keep the file the record holds, replace it, clear it, leave the empty field empty, and add one.
 */
function fileUpdateSamples(field: SpecField, files: SmokeFiles): readonly SmokeUpdateSample[] {
  return [
    updateSample(field, files.created.key, files.created.expected),
    updateSample(field, files.replacement.key, files.replacement.expected),
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
