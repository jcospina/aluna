// One declaration on a scalar string field, and what it is allowed to be. Everything that
// reads it — the counter, the native attribute, mutation validation, the Diff — reads this
// one key, so what is gated here is the whole of what a limit can say.

import { describe, expect, test } from "bun:test";

import {
  capabilitySpecSchema,
  defaultBehavioralErrorsForSchema,
  MAX_DECLARED_MAX_LENGTH,
  MAX_LENGTH_EXCEEDED_ERROR_CODE,
  MIN_DECLARED_MAX_LENGTH,
  maxLengthsByField,
  promptCapabilitySpecSchema,
  type SpecField,
} from "./index.ts";
import { validSpec } from "./spec.test-support.ts";

const NOTES: SpecField = {
  name: "notes",
  label: "Notes",
  type: "string",
  required: false,
  lifecycle: "active",
};

// Deep-cloned: the wire-shape cases below write `null` onto the fields they are handed,
// and a shallow copy would leave that on the shared field constants for every later test.
function specWith(fields: readonly SpecField[]) {
  const base = validSpec();
  return {
    ...base,
    schema: { fields: fields.map((field) => ({ ...field })) },
    ui_intent: {
      ...base.ui_intent,
      form: {
        list_inputs: fields
          .filter((field) => field.lifecycle === "active" && field.type === "string[]")
          .map((field) => ({ field: field.name, mode: "repeatable" as const })),
        choice_inputs: fields
          .filter((field) => field.lifecycle === "active" && field.type === "choice")
          .map((field) => ({ field: field.name, presentation: "picker" as const })),
        long_text: [],
        guidance: [],
      },
      item: { ...base.ui_intent.item, shows: [fields[0]?.name ?? "notes"] },
    },
    behavioral_errors: defaultBehavioralErrorsForSchema({ fields: [...fields] }),
  };
}

const accepts = (fields: readonly SpecField[]) =>
  capabilitySpecSchema.safeParse(specWith(fields)).success;

describe("max_length belongs to a scalar string and nothing else", () => {
  test("a string field may declare one, or may not", () => {
    expect(accepts([{ ...NOTES, max_length: 240 }])).toBe(true);
    expect(accepts([NOTES])).toBe(true);
  });

  test("every other scalar type is refused one", () => {
    for (const type of ["number", "boolean", "date", "datetime"] as const) {
      expect(accepts([{ ...NOTES, type, max_length: 240 }])).toBe(false);
    }
  });

  test("a list field is refused one: a single number could not say what it bounds", () => {
    expect(accepts([{ ...NOTES, type: "string[]", max_length: 240 }])).toBe(false);
  });

  test("a choice field is refused one: its values are already bounded by their own rule", () => {
    expect(
      accepts([
        {
          ...NOTES,
          type: "choice",
          values: [{ value: "draft", label: "Draft" }],
          groups: [],
          max_length: 240,
        },
      ]),
    ).toBe(false);
  });
});

describe("a limit has to be a limit", () => {
  test("the two ends are admitted and the two beyond them are not", () => {
    expect(accepts([{ ...NOTES, max_length: MIN_DECLARED_MAX_LENGTH }])).toBe(true);
    expect(accepts([{ ...NOTES, max_length: MAX_DECLARED_MAX_LENGTH }])).toBe(true);
    expect(accepts([{ ...NOTES, max_length: MIN_DECLARED_MAX_LENGTH - 1 }])).toBe(false);
    expect(accepts([{ ...NOTES, max_length: MAX_DECLARED_MAX_LENGTH + 1 }])).toBe(false);
  });

  test("zero, a negative and a fraction are all refused", () => {
    for (const max_length of [0, -240, 240.5]) {
      expect(accepts([{ ...NOTES, max_length }])).toBe(false);
    }
  });

  test("the floor clears the longest text the Gate writes into a string field", () => {
    // `gate-smoke-search.ts` seeds `percent% underscore_ apostrophe'o double"quote`, which
    // is the longest fixture value any string column receives. A capability may not author
    // a field its own Gate could not fill.
    expect(MIN_DECLARED_MAX_LENGTH).toBeGreaterThanOrEqual(
      "percent% underscore_ apostrophe'o double\"quote".length,
    );
  });
});

describe("the wire spelling round-trips to the domain one", () => {
  test("null becomes absence, so a field with no limit has exactly one representation", () => {
    const wire = specWith([NOTES]) as unknown as {
      schema: { fields: Record<string, unknown>[] };
    };
    for (const field of wire.schema.fields) {
      field.values = null;
      field.groups = null;
      field.max_length = null;
    }
    const parsed = promptCapabilitySpecSchema.parse(wire);
    expect("max_length" in (parsed.schema.fields[0] as object)).toBe(false);
  });

  test("a number survives the wire shape unchanged", () => {
    const wire = specWith([{ ...NOTES, max_length: 240 }]) as unknown as {
      schema: { fields: Record<string, unknown>[] };
    };
    for (const field of wire.schema.fields) {
      field.values = null;
      field.groups = null;
      field.max_length ??= null;
    }
    expect(promptCapabilitySpecSchema.parse(wire).schema.fields[0]?.max_length).toBe(240);
  });
});

describe("the name→limit lookup every reader shares", () => {
  test("it answers for a hidden field too, because its column still holds values", () => {
    const limits = maxLengthsByField({
      schema: {
        fields: [
          { ...NOTES, max_length: 240 },
          { ...NOTES, name: "old", lifecycle: "inactive", max_length: 120 },
          { ...NOTES, name: "title" },
        ],
      },
    });
    expect([...limits]).toEqual([
      ["notes", 240],
      ["old", 120],
    ]);
  });
});

test("the refusal code is platform-owned and a capability may not author it", () => {
  const base = validSpec();
  const spec = {
    ...base,
    behavioral_errors: [
      {
        action: "create" as const,
        trigger: MAX_LENGTH_EXCEEDED_ERROR_CODE,
        code: MAX_LENGTH_EXCEEDED_ERROR_CODE,
        fields: [],
        expected_markers: base.behavioral_errors[0]?.expected_markers,
      },
    ],
  };
  expect(capabilitySpecSchema.safeParse(spec).success).toBe(false);
});
