// The form's two **subset** presentation collections: `long_text` and `guidance`.
//
// `ui_intent.form` holds four collections, and they split into two kinds. `list_inputs`
// and `choice_inputs` are total over their field type — every active `string[]` has an
// input mode and every active choice has a presentation, because neither can be drawn at
// all without one — so each lives with the type it completes (`spec.ts` and `choice.ts`).
// The two here are subsets: a string field renders perfectly well as a single-line input
// and a field is complete without a hint, so naming one is opting it in.
//
// Both are ordered by schema-field order and both fail closed on an unknown, inactive,
// duplicate or ineligible entry — the same checks `validateListInputs` runs, with the one
// difference a subset forces on the order check (see {@link validateFormFieldSubset}).

import { z } from "zod";

import type { CapabilitySpec, SpecField } from "../spec/spec.ts";
import { singleLinePhrase, sqlNameText } from "../spec/spec-text.ts";

/**
 * One line of hint under one field, a form fact rather than a schema one; it carries the sentence
 * announcing a default. No placeholder key: a keystroke erases one (`design/design-system.md`).
 */
export const MAX_FIELD_GUIDANCE_LENGTH = 96;

/**
 * Bounded, single-line and free of control characters, for the reasons every other authored phrase
 * on a control is (`choice.ts`): it is written into markup and into generation prompts.
 */
export const fieldGuidanceSchema = z.strictObject({
  field: sqlNameText,
  text: singleLinePhrase(MAX_FIELD_GUIDANCE_LENGTH).refine(
    (text) => !/\p{Cc}/u.test(text),
    "must not contain control characters",
  ),
});
export type FieldGuidance = z.infer<typeof fieldGuidanceSchema>;

/**
 * The fields drawn as a multi-line control. A title and three paragraphs of notes are both a
 * `string`, so the choice is presentation and belongs here, not in the schema (controls.html).
 */
export const longTextIntentSchema = z.array(sqlNameText);

/** Every entry names an active scalar `string`. A choice, a list or any other type fails. */
export function validateLongTextInputs(
  spec: Pick<CapabilitySpec, "schema" | "ui_intent">,
  ctx: z.RefinementCtx,
): void {
  validateFormFieldSubset(
    spec.schema.fields,
    spec.ui_intent.form.long_text,
    "long_text",
    (field) => field.type === "string",
    "must be a scalar string field",
    ctx,
  );
}

/** Any active field may carry a hint, and none may carry two. */
export function validateFieldGuidance(
  spec: Pick<CapabilitySpec, "schema" | "ui_intent">,
  ctx: z.RefinementCtx,
): void {
  validateFormFieldSubset(
    spec.schema.fields,
    spec.ui_intent.form.guidance.map((entry) => entry.field),
    "guidance",
    () => true,
    "",
    ctx,
  );
}

type SubsetKey = "long_text" | "guidance";

/**
 * Each entry names a distinct active field the collection is eligible for, in schema-field order.
 * Order is a strictly increasing walk of positions, because a subset has no single expected list.
 */
function validateFormFieldSubset(
  fields: readonly SpecField[],
  entries: readonly string[],
  key: SubsetKey,
  eligible: (field: SpecField) => boolean,
  ineligible: string,
  ctx: z.RefinementCtx,
): void {
  const fieldsByName = new Map(fields.map((field) => [field.name, field]));
  const positionByName = new Map(fields.map((field, index) => [field.name, index]));
  let previous = -1;

  for (const [index, name] of entries.entries()) {
    if (entries.indexOf(name) !== index) {
      addSubsetIssue(ctx, key, index, `field "${name}" appears more than once`);
      continue;
    }
    const field = fieldsByName.get(name);
    if (!field) {
      addSubsetIssue(ctx, key, index, `field "${name}" is not in schema.fields`);
      continue;
    }
    eligibilityIssue(field, eligible, ineligible, (message) =>
      addSubsetIssue(ctx, key, index, message),
    );
    const position = positionByName.get(name) ?? -1;
    if (position <= previous) {
      addSubsetIssue(ctx, key, index, `field "${name}" is out of schema-field order`);
    }
    previous = position;
  }
}

function eligibilityIssue(
  field: SpecField,
  eligible: (field: SpecField) => boolean,
  ineligible: string,
  report: (message: string) => void,
): void {
  if (field.lifecycle !== "active") {
    report(`field "${field.name}" must be active`);
    return;
  }
  if (!eligible(field)) report(`field "${field.name}" ${ineligible}`);
}

function addSubsetIssue(
  ctx: z.RefinementCtx,
  key: SubsetKey,
  index: number,
  message: string,
): void {
  ctx.addIssue({
    code: "custom",
    message,
    path:
      key === "long_text"
        ? ["ui_intent", "form", "long_text", index]
        : ["ui_intent", "form", "guidance", index, "field"],
  });
}

/** The hint for one field, or nothing. The renderer's only reader of the collection. */
export function fieldGuidanceText(
  form: Pick<CapabilitySpec["ui_intent"]["form"], "guidance">,
  fieldName: string,
): string | undefined {
  return form.guidance.find((entry) => entry.field === fieldName)?.text;
}

/** Whether this field is drawn as a multi-line control. */
export function isLongTextField(
  form: Pick<CapabilitySpec["ui_intent"]["form"], "long_text">,
  fieldName: string,
): boolean {
  return form.long_text.includes(fieldName);
}
