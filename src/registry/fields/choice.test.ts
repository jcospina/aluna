// The choice field's shape contract: what it must declare, what no other field may
// declare, and how `ui_intent.form.choice_inputs` tracks the active choice fields.

import { describe, expect, test } from "bun:test";

import {
  admittedChoiceValues,
  type CapabilitySpec,
  CHOICE_DISABLED_ERROR_CODE,
  CHOICE_PRESENTATIONS,
  capabilitySpecSchema,
  choiceFieldOptions,
  choiceOptionRuns,
  INVALID_CHOICE_ERROR_CODE,
  isChoiceFieldType,
  selectableChoiceValues,
} from "../index.ts";
import { validSpec } from "../spec/spec.test-support.ts";

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

  test("the presentation enum admits the three controls and nothing else", () => {
    expect(CHOICE_PRESENTATIONS).toEqual(["picker", "radio", "segmented"]);
    for (const presentation of CHOICE_PRESENTATIONS) {
      expect(capabilitySpecSchema.safeParse(withPresentation(presentation)).success).toBe(true);
    }
    expect(rejects(withPresentation("dropdown"))).toContain("picker");
  });

  test("an enabled option has one spelling: `disabled` is true or absent", () => {
    const explicit = choiceField({
      values: [
        { value: "draft", label: "Draft", disabled: false },
        { value: "sent", label: "Sent" },
      ],
    });
    expect(rejects(specWithChoice(explicit))).toContain("true");
  });

  test("a disabled option stays admitted but leaves the selectable set", () => {
    const status = specWithChoice(
      choiceField({
        values: [
          { value: "draft", label: "Draft" },
          { value: "sent", label: "Sent", disabled: true },
        ],
      }),
    ).schema.fields[1];
    if (!status) throw new Error("the choice field is missing");
    expect([...admittedChoiceValues(status)]).toEqual(["draft", "sent"]);
    expect([...selectableChoiceValues(status)]).toEqual(["draft"]);
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
});

describe("what one row of a control may say", () => {
  test("an option label is one bounded line, like the note beside it", () => {
    expect(
      rejects(specWithChoice(choiceField({ values: [{ value: "a", label: "x".repeat(65) }] }))),
    ).toContain("<=64 characters");
    expect(
      rejects(specWithChoice(choiceField({ values: [{ value: "a", label: "two\nlines" }] }))),
    ).toContain("must be one line");
  });

  test("control characters are refused in a value, a label, a note and a heading", () => {
    const cases: Record<string, unknown> = {
      value: choiceField({ values: [{ value: "a\u0000b", label: "A" }] }),
      label: choiceField({ values: [{ value: "a", label: "A\u0007" }] }),
      note: choiceField({ values: [{ value: "a", label: "A", note: "n\u0001" }] }),
      heading: choiceField({
        values: [{ value: "a", label: "A", group: "open" }],
        groups: [{ id: "open", heading: "O\u0002" }],
      }),
    };
    for (const [where, field] of Object.entries(cases)) {
      expect(rejects(specWithChoice(field as Record<string, unknown>)), where).toContain(
        "control characters",
      );
    }
  });

  test("the two collections are capped, because every option enters a generation prompt", () => {
    const many = Array.from({ length: 65 }, (_, index) => ({
      value: `v${index}`,
      label: `V${index}`,
    }));
    expect(rejects(specWithChoice(choiceField({ values: many })))).toContain("at most 64 options");

    const groups = Array.from({ length: 17 }, (_, index) => ({
      id: `g${index}`,
      heading: `G${index}`,
    }));
    expect(
      rejects(
        specWithChoice(
          choiceField({
            values: groups.map((group, index) => ({
              value: `v${index}`,
              label: `V${index}`,
              group: group.id,
            })),
            groups,
          }),
        ),
      ),
    ).toContain("at most 16 groups");
  });
});

describe("the groups and the retirements fail closed", () => {
  test("a choice with every option disabled is rejected", () => {
    const emptied = choiceField({
      values: [
        { value: "draft", label: "Draft", disabled: true },
        { value: "sent", label: "Sent", disabled: true },
      ],
    });
    expect(rejects(specWithChoice(emptied))).toContain("at least one option choosable");
  });

  test("an option naming a group its field never declared is rejected", () => {
    const stray = choiceField({
      values: [{ value: "draft", label: "Draft", group: "open" }],
      groups: [],
    });
    expect(rejects(specWithChoice(stray))).toContain("is not declared by this field");
  });

  test("a group no option names is rejected", () => {
    const orphan = choiceField({ groups: [{ id: "open", heading: "Open" }] });
    expect(rejects(specWithChoice(orphan))).toContain("no option names it");
  });

  test("the same group id declared twice is rejected", () => {
    const twice = choiceField({
      values: [{ value: "draft", label: "Draft", group: "open" }],
      groups: [
        { id: "open", heading: "Open" },
        { id: "open", heading: "Also open" },
      ],
    });
    expect(rejects(specWithChoice(twice))).toContain("declared more than once");
  });

  test("a blank heading and an over-long note are rejected", () => {
    expect(
      rejects(
        specWithChoice(
          choiceField({
            values: [{ value: "draft", label: "Draft", group: "open" }],
            groups: [{ id: "open", heading: " " }],
          }),
        ),
      ),
    ).toContain("must not be blank");
    expect(
      rejects(
        specWithChoice(
          choiceField({
            values: [{ value: "draft", label: "Draft", note: "x".repeat(49) }],
          }),
        ),
      ),
    ).toContain("<=48 characters");
  });

  test("both choice refusals are platform-owned and cannot be authored", () => {
    // The platform raises each of these itself, before canonical state moves. A capability
    // authoring one would be claiming an error it never gets to see — and the behavioral
    // tier would then generate a suite asserting a Handler emits it, which no Handler can.
    for (const code of [INVALID_CHOICE_ERROR_CODE, CHOICE_DISABLED_ERROR_CODE]) {
      const spec = specWithChoice();
      const authored = {
        ...spec,
        behavioral_errors: [
          ...spec.behavioral_errors,
          {
            action: "create" as const,
            trigger: code,
            code,
            fields: ["status"],
            expected_markers: spec.behavioral_errors[0]?.expected_markers,
          },
        ],
      };
      expect(rejects(authored), code).toContain("platform-owned");
    }
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

describe("a segmented control admits only what it can show", () => {
  const groupedField = choiceField({
    values: [
      { value: "draft", label: "Draft", group: "open" },
      { value: "sent", label: "Sent", group: "open" },
    ],
    groups: [{ id: "open", heading: "Open" }],
  });
  const notedField = choiceField({
    values: [
      { value: "draft", label: "Draft", note: "not sent yet" },
      { value: "sent", label: "Sent" },
    ],
  });

  test("grouped options are refused on a segmented presentation", () => {
    const spec = specWithChoice(groupedField);
    expect(
      rejects({
        ...spec,
        ui_intent: withChoiceInputs(spec, [{ field: "status", presentation: "segmented" }]),
      }),
    ).toContain("a segmented control cannot show");
  });

  test("a noted option is refused on a segmented presentation", () => {
    const spec = specWithChoice(notedField);
    expect(
      rejects({
        ...spec,
        ui_intent: withChoiceInputs(spec, [{ field: "status", presentation: "segmented" }]),
      }),
    ).toContain("a segmented control cannot show");
  });

  test("the picker and the radio group carry both without complaint", () => {
    for (const field of [groupedField, notedField]) {
      for (const presentation of ["picker", "radio"]) {
        const spec = specWithChoice(field);
        const withControl = {
          ...spec,
          ui_intent: withChoiceInputs(spec, [{ field: "status", presentation }]),
        };
        expect(capabilitySpecSchema.safeParse(withControl).success).toBe(true);
      }
    }
  });
});

describe("the render order a control walks", () => {
  test("ungrouped options come first, then each group in declared order", () => {
    const mixed = specWithChoice(
      choiceField({
        values: [
          { value: "draft", label: "Draft", group: "closed" },
          { value: "loose", label: "Loose" },
          { value: "sent", label: "Sent", group: "open" },
          { value: "paid", label: "Paid", group: "closed" },
        ],
        groups: [
          { id: "open", heading: "Open" },
          { id: "closed", heading: "Closed" },
        ],
      }),
    ).schema.fields[1];
    if (!mixed) throw new Error("the choice field is missing");

    expect(
      choiceOptionRuns(mixed).map((run) => [
        run.group?.id ?? null,
        run.options.map((option) => option.value),
      ]),
    ).toEqual([
      [null, ["loose"]],
      ["open", ["sent"]],
      ["closed", ["draft", "paid"]],
    ]);
  });

  test("an option naming a group nobody declared fails loudly rather than vanishing", () => {
    // Unreachable through the gate, which refuses that spec. It matters because the run
    // walk is the one helper a renderer trusts: silently dropping the option would take it
    // off the control with nothing said.
    expect(() =>
      choiceOptionRuns({
        name: "status",
        type: "choice",
        values: [{ value: "a", label: "A", group: "ghost" }],
        groups: [],
      }),
    ).toThrow("undeclared group");
  });

  test("a field with no groups is one ungrouped run", () => {
    const flat = specWithChoice().schema.fields[1];
    if (!flat) throw new Error("the choice field is missing");
    expect(choiceOptionRuns(flat)).toEqual([{ group: undefined, options: [...STATUS_OPTIONS] }]);
  });
});

function withChoiceInputs(spec: CapabilitySpec, entries: unknown[]) {
  return { ...spec.ui_intent, form: { ...spec.ui_intent.form, choice_inputs: entries } };
}

function withPresentation(presentation: string) {
  const spec = specWithChoice();
  return { ...spec, ui_intent: withChoiceInputs(spec, [{ field: "status", presentation }]) };
}
