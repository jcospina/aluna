// Random capabilities for the unit-prompt property tests: generated fields of every type, one always
// active, and a valid form and card over them.

import fc from "fast-check";
import { PHOTO_FIELD } from "../../../registry/fields/file.test-support.ts";
import {
  defaultBehavioralErrorsForSchema,
  fieldTypeSchema,
  isFileFieldType,
  type SpecField,
} from "../../../registry/index.ts";
import { notesSpec } from "../../gate/gate.test-support.ts";

const fieldName = fc.stringMatching(/^zq[a-z]{6}$/);
const anyField = fc
  .record({
    name: fieldName,
    label: fc.stringMatching(/^L[A-Z]{7}$/),
    type: fc.constantFrom(...fieldTypeSchema.options),
    required: fc.boolean(),
    lifecycle: fc.constantFrom("active" as const, "inactive" as const),
    options: fc.uniqueArray(
      fc.record({
        value: fc.stringMatching(/^v[a-z]{7}$/),
        label: fc.stringMatching(/^O[A-Z]{7}$/),
      }),
      { minLength: 1, maxLength: 3, selector: (option) => option.value },
    ),
  })
  .map(({ options, ...field }): SpecField => {
    if (field.type === "choice") return { ...field, values: options, groups: [] };
    if (isFileFieldType(field.type)) return { ...field, accepts: PHOTO_FIELD.accepts };
    return field;
  });

/** A valid capability of generated fields, one of them always active, showing a generated subset. */
export const anySpec = fc
  .uniqueArray(anyField, { minLength: 1, maxLength: 6, selector: (field) => field.name })
  .map((fields) =>
    fields.map((field, index) =>
      index === 0 ? { ...field, lifecycle: "active" as const } : field,
    ),
  )
  .chain((fields) => {
    const active = fields.filter((field) => field.lifecycle === "active");
    return fc
      .subarray(
        active.map((field) => field.name),
        { minLength: 1 },
      )
      .map((shows) => {
        const base = notesSpec();
        const schema = { fields };
        const named = (type: string) => active.filter((field) => field.type === type);
        return notesSpec({
          schema,
          behavioral_errors: defaultBehavioralErrorsForSchema(schema),
          ui_intent: {
            ...base.ui_intent,
            form: {
              ...base.ui_intent.form,
              list_inputs: named("string[]").map(({ name }) => ({
                field: name,
                mode: "repeatable",
              })),
              choice_inputs: named("choice").map(({ name }) => ({
                field: name,
                presentation: "picker",
              })),
            },
            item: { ...base.ui_intent.item, shows },
          },
        });
      });
  });

export const RUNS = { seed: 20260926, numRuns: 120 };

/** The JSON a Handler prompt ends with: its own fields, behaviour and dependencies. */
export function actionGenerationContext(prompt: string): Record<string, unknown> {
  const marker = "Action generation context JSON:\n";
  const start = prompt.indexOf(marker);
  if (start < 0) throw new Error("missing Action generation context JSON");
  return JSON.parse(prompt.slice(start + marker.length)) as Record<string, unknown>;
}
