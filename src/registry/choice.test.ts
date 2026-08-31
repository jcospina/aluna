// The choice field's shape contract: what it must declare, what no other field may
// declare, and how `ui_intent.form.choice_inputs` tracks the active choice fields.

import { describe, expect, test } from "bun:test";

import {
  admittedChoiceValues,
  type CapabilitySpec,
  CHOICE_PRESENTATIONS,
  capabilitySpecSchema,
  choiceFieldOptions,
  INVALID_CHOICE_ERROR_CODE,
  isChoiceFieldType,
} from "./index.ts";
import { validSpec } from "./spec.test-support.ts";

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
] as const;

function choiceField(overrides: Record<string, unknown> = {}) {
  return {
    name: "status",
    label: "Status",
    type: "choice" as const,
    required: false,
    lifecycle: "active" as const,
    values: [...STATUS_OPTIONS],
    groups: [],
    ...overrides,
  };
}

function specWithChoice(field: Record<string, unknown> = choiceField()): CapabilitySpec {
  return validSpec({
    schema: {
      fields: [
        { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
        field as CapabilitySpec["schema"]["fields"][number],
      ],
    },
  });
}

function rejects(spec: unknown): string {
  const parsed = capabilitySpecSchema.safeParse(spec);
  expect(parsed.success).toBe(false);
  return parsed.success ? "" : parsed.error.issues.map((issue) => issue.message).join(" | ");
}

describe("the choice field carries its declared values", () => {
  test("a well-formed choice field round-trips through the spec gate", () => {
    const spec = specWithChoice();
    expect(capabilitySpecSchema.parse(spec)).toEqual(spec);
    expect(isChoiceFieldType("choice")).toBe(true);
  });

  test("every new choice emits an empty ordered groups collection", () => {
    const spec = specWithChoice();
    const status = spec.schema.fields.find((field) => field.name === "status");
    expect(status?.groups).toEqual([]);
  });

  test("options keep their authored order, and the admitted set is their values", () => {
    const status = specWithChoice().schema.fields[1];
    if (!status) throw new Error("the choice field is missing");
    expect(choiceFieldOptions(status).map((option) => option.value)).toEqual(["draft", "sent"]);
    expect([...admittedChoiceValues(status)]).toEqual(["draft", "sent"]);
  });

  test("the presentation enum admits only the picker in this cut", () => {
    expect(CHOICE_PRESENTATIONS).toEqual(["picker"]);
    expect(rejects(withPresentation("radio"))).toContain("picker");
  });
});

describe("the choice field fails closed", () => {
  test("a choice with no options is rejected", () => {
    expect(rejects(specWithChoice(choiceField({ values: [] })))).toContain("at least one option");
  });

  test("a choice with no values collection at all is rejected", () => {
    expect(rejects(specWithChoice(choiceField({ values: undefined })))).toContain(
      "must declare its values",
    );
  });

  test("duplicate option values are rejected", () => {
    const duplicated = choiceField({
      values: [
        { value: "draft", label: "Draft" },
        { value: "draft", label: "Also draft" },
      ],
    });
    expect(rejects(specWithChoice(duplicated))).toContain("appears more than once");
  });

  test("a blank option value or a blank label is rejected", () => {
    expect(
      rejects(specWithChoice(choiceField({ values: [{ value: " ", label: "Draft" }] }))),
    ).toContain("must not be blank");
    expect(
      rejects(specWithChoice(choiceField({ values: [{ value: "draft", label: " " }] }))),
    ).toContain("must not be blank");
  });

  test("a values array on a non-choice field is rejected", () => {
    const spec = validSpec({
      schema: {
        fields: [
          {
            name: "title",
            label: "Title",
            type: "string",
            required: true,
            lifecycle: "active",
            values: [...STATUS_OPTIONS],
          } as CapabilitySpec["schema"]["fields"][number],
        ],
      },
    });
    expect(rejects(spec)).toContain("only a choice field declares values");
  });

  test("a groups array on a non-choice field is rejected", () => {
    const spec = validSpec({
      schema: {
        fields: [
          {
            name: "title",
            label: "Title",
            type: "string",
            required: true,
            lifecycle: "active",
            groups: [],
          } as CapabilitySpec["schema"]["fields"][number],
        ],
      },
    });
    expect(rejects(spec)).toContain("only a choice field declares option groups");
  });

  test("a declared option group is rejected until 5.10/02 gives an option a way to name one", () => {
    const grouped = choiceField({ groups: [{ id: "open", heading: "Open" }] });
    expect(rejects(specWithChoice(grouped))).toContain("option groups are not declared yet");
  });

  test("invalid_choice is platform-owned and cannot be authored", () => {
    const spec = specWithChoice();
    const authored = {
      ...spec,
      behavioral_errors: [
        ...spec.behavioral_errors,
        {
          action: "create" as const,
          trigger: INVALID_CHOICE_ERROR_CODE,
          code: INVALID_CHOICE_ERROR_CODE,
          fields: ["status"],
          expected_markers: spec.behavioral_errors[0]?.expected_markers,
        },
      ],
    };
    expect(rejects(authored)).toContain("platform-owned");
  });
});

describe("choice_inputs tracks the active choice fields", () => {
  test("an entry is required for every active choice field, in schema order", () => {
    const spec = specWithChoice();
    expect(spec.ui_intent.form.choice_inputs).toEqual([
      { field: "status", presentation: "picker" },
    ]);
    expect(rejects({ ...spec, ui_intent: withChoiceInputs(spec, []) })).toContain(
      "exactly once in schema-field order",
    );
  });

  test("an entry naming a non-choice field is rejected", () => {
    const spec = specWithChoice();
    expect(
      rejects({
        ...spec,
        ui_intent: withChoiceInputs(spec, [{ field: "title", presentation: "picker" }]),
      }),
    ).toContain("must be a choice field");
  });

  test("an entry naming an unknown field is rejected", () => {
    const spec = specWithChoice();
    expect(
      rejects({
        ...spec,
        ui_intent: withChoiceInputs(spec, [{ field: "missing", presentation: "picker" }]),
      }),
    ).toContain("is not in schema.fields");
  });

  test("an inactive choice field carries no entry", () => {
    const hidden = specWithChoice(choiceField({ lifecycle: "inactive" }));
    expect(hidden.ui_intent.form.choice_inputs).toEqual([]);
    expect(capabilitySpecSchema.parse(hidden)).toEqual(hidden);
  });

  test("a duplicate entry is rejected", () => {
    const spec = specWithChoice();
    expect(
      rejects({
        ...spec,
        ui_intent: withChoiceInputs(spec, [
          { field: "status", presentation: "picker" },
          { field: "status", presentation: "picker" },
        ]),
      }),
    ).toContain("appears more than once");
  });
});

function withChoiceInputs(spec: CapabilitySpec, entries: unknown[]) {
  return { ...spec.ui_intent, form: { ...spec.ui_intent.form, choice_inputs: entries } };
}

function withPresentation(presentation: string) {
  const spec = specWithChoice();
  return { ...spec, ui_intent: withChoiceInputs(spec, [{ field: "status", presentation }]) };
}
