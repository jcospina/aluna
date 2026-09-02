// The form's two subset collections: which string fields are drawn multi-line, and what a
// field says about itself underneath. Both name a subset rather than covering a type
// totally, so what is proved here is the difference that makes: a partial list is fine, an
// ineligible or repeated or out-of-order entry is not.

import { describe, expect, test } from "bun:test";

import {
  capabilitySpecSchema,
  defaultBehavioralErrorsForSchema,
  fieldGuidanceText,
  isLongTextField,
  MAX_FIELD_GUIDANCE_LENGTH,
  type SpecField,
  type UiFormIntent,
} from "../index.ts";
import { validSpec } from "../spec/spec.test-support.ts";

const TEXT_FIELDS: readonly SpecField[] = [
  { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
  { name: "notes", label: "Notes", type: "string", required: false, lifecycle: "active" },
  { name: "count", label: "Count", type: "number", required: false, lifecycle: "active" },
  { name: "tags", label: "Tags", type: "string[]", required: false, lifecycle: "active" },
  { name: "archived", label: "Archived", type: "string", required: false, lifecycle: "inactive" },
];

function specWithForm(form: Partial<UiFormIntent>, fields: readonly SpecField[] = TEXT_FIELDS) {
  const base = validSpec();
  return {
    ...base,
    schema: { fields: [...fields] },
    ui_intent: {
      ...base.ui_intent,
      form: {
        list_inputs: [{ field: "tags", mode: "repeatable" as const }],
        choice_inputs: [],
        long_text: [],
        guidance: [],
        ...form,
      },
      item: { ...base.ui_intent.item, shows: ["title"] },
    },
    behavioral_errors: defaultBehavioralErrorsForSchema({ fields: [...fields] }),
  };
}

function issues(form: Partial<UiFormIntent>, fields: readonly SpecField[] = TEXT_FIELDS) {
  const parsed = capabilitySpecSchema.safeParse(specWithForm(form, fields));
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

describe("long_text names a subset of the active string fields", () => {
  test("a partial list is admitted — opting a field in is a choice, not a coverage duty", () => {
    expect(issues({ long_text: ["notes"] })).toEqual([]);
    expect(issues({ long_text: [] })).toEqual([]);
    expect(issues({ long_text: ["title", "notes"] })).toEqual([]);
  });

  test("an unknown field fails closed", () => {
    expect(issues({ long_text: ["nowhere"] })).toEqual(['field "nowhere" is not in schema.fields']);
  });

  test("an inactive field fails closed", () => {
    expect(issues({ long_text: ["archived"] })).toEqual(['field "archived" must be active']);
  });

  test("a non-string field fails closed, list and scalar alike", () => {
    expect(issues({ long_text: ["count"] })).toEqual([
      'field "count" must be a scalar string field',
    ]);
    expect(issues({ long_text: ["tags"] })).toEqual(['field "tags" must be a scalar string field']);
  });

  test("a choice field fails closed: it draws its own control", () => {
    const fields: readonly SpecField[] = [
      ...TEXT_FIELDS,
      {
        name: "stage",
        label: "Stage",
        type: "choice",
        required: false,
        lifecycle: "active",
        values: [{ value: "draft", label: "Draft" }],
        groups: [],
      },
    ];
    expect(
      issues(
        { long_text: ["stage"], choice_inputs: [{ field: "stage", presentation: "picker" }] },
        fields,
      ),
    ).toEqual(['field "stage" must be a scalar string field']);
  });

  test("a repeat fails closed", () => {
    expect(issues({ long_text: ["notes", "notes"] })).toEqual([
      'field "notes" appears more than once',
    ]);
  });

  test("entries out of schema-field order fail closed, so one opt-in has one spelling", () => {
    expect(issues({ long_text: ["notes", "title"] })).toEqual([
      'field "title" is out of schema-field order',
    ]);
  });
});

describe("guidance is one line under one field", () => {
  const hint = (field: string, text: string) => ({ guidance: [{ field, text }] });

  test("any active field may carry one, whatever its type", () => {
    expect(issues(hint("count", "Rounded to the nearest whole."))).toEqual([]);
    expect(issues(hint("tags", "Two or three is plenty."))).toEqual([]);
  });

  test("the default-announcing sentence needs no key of its own", () => {
    expect(issues(hint("title", "Defaults to today."))).toEqual([]);
  });

  test("unknown, inactive, repeated and out-of-order entries all fail closed", () => {
    expect(issues(hint("nowhere", "Hi"))).toEqual(['field "nowhere" is not in schema.fields']);
    expect(issues(hint("archived", "Hi"))).toEqual(['field "archived" must be active']);
    expect(
      issues({
        guidance: [
          { field: "notes", text: "One" },
          { field: "notes", text: "Two" },
        ],
      }),
    ).toEqual(['field "notes" appears more than once']);
    expect(
      issues({
        guidance: [
          { field: "notes", text: "One" },
          { field: "title", text: "Two" },
        ],
      }),
    ).toEqual(['field "title" is out of schema-field order']);
  });

  test("the text is bounded, single-line and free of control characters", () => {
    expect(issues(hint("notes", "x".repeat(MAX_FIELD_GUIDANCE_LENGTH)))).toEqual([]);
    expect(issues(hint("notes", "x".repeat(MAX_FIELD_GUIDANCE_LENGTH + 1)))).not.toEqual([]);
    expect(issues(hint("notes", "two\nlines"))).not.toEqual([]);
    expect(issues(hint("notes", "ab"))).not.toEqual([]);
    expect(issues(hint("notes", "   "))).not.toEqual([]);
  });

  test("there is no placeholder key anywhere on the form", () => {
    const spec = specWithForm({}) as unknown as { ui_intent: { form: Record<string, unknown> } };
    spec.ui_intent.form.placeholder = [{ field: "notes", text: "Type here" }];
    expect(capabilitySpecSchema.safeParse(spec).success).toBe(false);
  });
});

describe("the renderer's two readers", () => {
  const form = capabilitySpecSchema.parse(
    specWithForm({ long_text: ["notes"], guidance: [{ field: "notes", text: "A few lines." }] }),
  ).ui_intent.form;

  test("isLongTextField answers only for a named field", () => {
    expect(isLongTextField(form, "notes")).toBe(true);
    expect(isLongTextField(form, "title")).toBe(false);
  });

  test("fieldGuidanceText answers the declared line, or nothing", () => {
    expect(fieldGuidanceText(form, "notes")).toBe("A few lines.");
    expect(fieldGuidanceText(form, "title")).toBeUndefined();
  });
});
