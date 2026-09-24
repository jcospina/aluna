// The scratch values the always-on smoke drives one full CRUD cycle with: one create
// payload and one per-field update payload, typed off the spec's own field pantry.
//
// The switch is exhaustive by construction (an explicit non-`unknown` return type and no
// `default`), so a new field type cannot reach the smoke without a sample of its own. A
// choice is the one type whose sample is not free text: it can only ever hold a value it
// declares, so both phases draw from its declared options.

import {
  activeSpecFields,
  type CapabilitySpec,
  type SpecField,
  selectableChoiceValues,
} from "../../../../registry/index.ts";
import type { CapabilityDataColumnValue } from "../../../../runtime/data/index.ts";
import type { CapabilityInput, CapabilityInputValue } from "../../../../runtime/router/index.ts";
import { formSubmitsField } from "../../gate-internal.ts";

export interface SmokeInput {
  readonly input: CapabilityInput;
  readonly expectedValues: Readonly<Record<string, CapabilityDataColumnValue>>;
}

export function buildSmokeInput(spec: CapabilitySpec): SmokeInput {
  const values: Record<string, CapabilityInputValue> = {};
  const expectedValues: Record<string, CapabilityDataColumnValue> = {};
  const fields = activeSpecFields(spec.schema.fields);
  for (const field of fields) {
    const sample = sampleValue(field, "create");
    if (sample.input !== undefined) values[field.name] = sample.input;
    expectedValues[field.name] = sample.expected;
  }
  return {
    input: {
      values,
      submittedFields: new Set(fields.filter(formSubmitsField).map((field) => field.name)),
    },
    expectedValues,
  };
}

export function buildUpdateInputs(spec: CapabilitySpec): readonly {
  readonly field: SpecField;
  readonly input: CapabilityInput;
  readonly expected: CapabilityDataColumnValue;
}[] {
  const fields = activeSpecFields(spec.schema.fields);
  if (fields.length === 0) throw new Error("Smoke update requires at least one active field.");
  return fields.map((field) => {
    const sample = sampleValue(field, "update");
    return {
      field,
      input: {
        values: sample.input === undefined ? {} : { [field.name]: sample.input },
        submittedFields: new Set(formSubmitsField(field) ? [field.name] : []),
      },
      expected: sample.expected,
    };
  });
}

function sampleValue(
  field: SpecField,
  phase: "create" | "update",
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
    case "file":
      // Empty, as every Gate value for one is (`formSubmitsField`, `builder/gate/gate-internal.ts`).
      return { expected: null };
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
