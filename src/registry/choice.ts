// The choice field type: the one entry in the field pantry that carries data of its own.
//
// A choice stores a single stable string drawn from the ordered options its field
// declares. Values are the wire values — immutable for the life of the capability, and
// append-only through evolution, so a committed row can never end up holding data the
// spec no longer admits. Labels are the user-facing wording and evolve as freely as a
// field label does.
//
// Everything here is authored by the model and gated before anything downstream sees it:
// the DDL mapper, the form renderer, mutation validation and the Diff matrix all read a
// choice field that has already been proved well-formed.

import { z } from "zod";

import type { CapabilitySpec, SpecField } from "./spec.ts";
import { nonBlankText, sameOrderedStrings, sqlNameText } from "./spec-text.ts";

export const CHOICE_FIELD_TYPE = "choice" as const;
export type ChoiceFieldType = typeof CHOICE_FIELD_TYPE;

export function isChoiceFieldType(type: string): type is ChoiceFieldType {
  return type === CHOICE_FIELD_TYPE;
}

/**
 * The structural refusal a submitted value outside a choice field's declared options
 * earns. Platform-owned, like `record_not_found`: the platform raises it before canonical
 * state moves, so a capability that authored it would be claiming an error it never gets
 * to see.
 */
export const INVALID_CHOICE_ERROR_CODE = "invalid_choice";

/**
 * One declared option. The full picker's per-option `group`, `note` and `disabled` keys
 * are deliberately absent rather than present-and-empty: adding an optional key later is
 * additive, so specs written against this shape need no rewrite when 5.10/02 populates
 * them.
 */
export const choiceOptionSchema = z.strictObject({
  value: nonBlankText,
  label: nonBlankText,
});
export type ChoiceOption = z.infer<typeof choiceOptionSchema>;

/**
 * One declared option group. The collection is ordered and always present on a choice
 * field so 5.10/02 can populate group headings without another persisted-shape cut; until
 * then {@link validateChoiceFields} holds it empty, because an option has no key with
 * which to name a group yet.
 */
export const choiceGroupSchema = z.strictObject({
  id: sqlNameText,
  heading: nonBlankText,
});
export type ChoiceGroup = z.infer<typeof choiceGroupSchema>;

/**
 * The closed set of controls a choice field may render as. 5.10/02 opens this to the
 * radio group and the segmented control; until then the picker is the only admitted
 * value, and an unknown one fails the build closed exactly as an unknown field type does.
 */
export const CHOICE_PRESENTATIONS = ["picker"] as const;
export const choicePresentationSchema = z.enum(CHOICE_PRESENTATIONS);
export type ChoicePresentation = z.infer<typeof choicePresentationSchema>;

export const choiceInputIntentSchema = z.strictObject({
  field: sqlNameText,
  presentation: choicePresentationSchema,
});
export type ChoiceInputIntent = z.infer<typeof choiceInputIntentSchema>;

/**
 * The declared options of one choice field. Callers that already know the field is a
 * choice get the non-null array without restating the validated invariant; anything else
 * fails loudly, because a choice field reaching a consumer without its values means the
 * spec gate was bypassed.
 */
export function choiceFieldOptions(
  field: Pick<SpecField, "name" | "type" | "values">,
): readonly ChoiceOption[] {
  if (!isChoiceFieldType(field.type) || field.values === undefined) {
    throw new Error(`Field "${field.name}" is not a choice field carrying declared values.`);
  }
  return field.values;
}

/** The wire values one choice field admits, for platform mutation validation. */
export function admittedChoiceValues(
  field: Pick<SpecField, "name" | "type" | "values">,
): ReadonlySet<string> {
  return new Set(choiceFieldOptions(field).map((option) => option.value));
}

/**
 * The choice field's own fail-closed rules, in both directions. A non-choice field that
 * carried options would be declaring a vocabulary nothing enforces; a choice field
 * without them would be a text input with a picker painted on it. Blank values and blank
 * labels are already refused per option — what only the whole field can see is that its
 * values are unique, that it has any at all, and that it declares no group before
 * 5.10/02 gives an option the key with which to name one.
 */
export function validateChoiceFields(
  spec: Pick<CapabilitySpec, "schema">,
  ctx: z.RefinementCtx,
): void {
  for (const [index, field] of spec.schema.fields.entries()) {
    if (isChoiceFieldType(field.type)) {
      validateChoiceFieldCollections(ctx, index, field);
    } else {
      validateNonChoiceField(ctx, index, field);
    }
  }
}

function validateNonChoiceField(ctx: z.RefinementCtx, index: number, field: SpecField): void {
  if (field.values !== undefined) {
    addFieldIssue(ctx, index, "values", "only a choice field declares values");
  }
  if (field.groups !== undefined) {
    addFieldIssue(ctx, index, "groups", "only a choice field declares option groups");
  }
}

function validateChoiceFieldCollections(
  ctx: z.RefinementCtx,
  index: number,
  field: SpecField,
): void {
  if (field.values === undefined) {
    addFieldIssue(ctx, index, "values", "a choice field must declare its values");
  } else if (field.values.length === 0) {
    addFieldIssue(ctx, index, "values", "a choice field must declare at least one option");
  } else {
    validateUniqueOptionValues(ctx, index, field.values);
  }

  if (field.groups === undefined) {
    addFieldIssue(ctx, index, "groups", "a choice field must declare its groups collection");
  } else if (field.groups.length > 0) {
    addFieldIssue(
      ctx,
      index,
      "groups",
      "option groups are not declared yet; a choice field carries an empty groups collection",
    );
  }
}

function validateUniqueOptionValues(
  ctx: z.RefinementCtx,
  fieldIndex: number,
  options: readonly ChoiceOption[],
): void {
  const seen = new Set<string>();
  for (const [index, option] of options.entries()) {
    if (seen.has(option.value)) {
      ctx.addIssue({
        code: "custom",
        message: `option value "${option.value}" appears more than once`,
        path: ["schema", "fields", fieldIndex, "values", index, "value"],
      });
    }
    seen.add(option.value);
  }
}

function addFieldIssue(
  ctx: z.RefinementCtx,
  index: number,
  key: "values" | "groups",
  message: string,
): void {
  ctx.addIssue({ code: "custom", message, path: ["schema", "fields", index, key] });
}

/**
 * `choice_inputs` mirrors `list_inputs`: exactly one entry per active choice field, in
 * schema-field order, so the form renderer resolves a control for every choice it draws
 * and a hidden field never leaves a stale entry behind.
 */
export function validateChoiceInputs(
  spec: Pick<CapabilitySpec, "schema" | "ui_intent">,
  ctx: z.RefinementCtx,
): void {
  const fieldsByName = new Map(spec.schema.fields.map((field) => [field.name, field]));
  const expectedFields = spec.schema.fields
    .filter((field) => field.lifecycle === "active" && isChoiceFieldType(field.type))
    .map((field) => field.name);
  const actualFields = spec.ui_intent.form.choice_inputs.map((entry) => entry.field);

  for (const [index, entry] of spec.ui_intent.form.choice_inputs.entries()) {
    validateChoiceInputEntry(fieldsByName, actualFields, entry, index, ctx);
  }

  if (!sameOrderedStrings(actualFields, expectedFields)) {
    ctx.addIssue({
      code: "custom",
      message:
        "form choice_inputs must contain every active choice field exactly once in schema-field order",
      path: ["ui_intent", "form", "choice_inputs"],
    });
  }
}

function validateChoiceInputEntry(
  fieldsByName: ReadonlyMap<string, SpecField>,
  actualFields: readonly string[],
  entry: ChoiceInputIntent,
  index: number,
  ctx: z.RefinementCtx,
): void {
  const field = fieldsByName.get(entry.field);
  if (!field) {
    addChoiceInputIssue(ctx, index, `field "${entry.field}" is not in schema.fields`);
  } else if (field.lifecycle !== "active") {
    addChoiceInputIssue(ctx, index, `field "${entry.field}" must be active`);
  } else if (!isChoiceFieldType(field.type)) {
    addChoiceInputIssue(ctx, index, `field "${entry.field}" must be a choice field`);
  }

  if (actualFields.indexOf(entry.field) !== index) {
    addChoiceInputIssue(ctx, index, `field "${entry.field}" appears more than once`);
  }
}

function addChoiceInputIssue(ctx: z.RefinementCtx, index: number, message: string): void {
  ctx.addIssue({
    code: "custom",
    message,
    path: ["ui_intent", "form", "choice_inputs", index, "field"],
  });
}
