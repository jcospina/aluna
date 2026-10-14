// A capability's relations (ADR-0011): which of its single-line text fields show another
// capability's field. They live on the registry row beside the logo seed, never in the spec a
// model writes, and changing one makes no version.
//
// Parsing checks the shape alone. Whether a relation still holds is decided where it is used, so a
// hidden field or a deleted target never stops a row loading.

import { z } from "zod";

import { isLongTextField } from "./fields/form-intent.ts";
import { incarnationIdSchema } from "./identifiers.ts";
import type { SpecField, UiFormIntent } from "./spec/spec.ts";
import { allUnique, sqlNameText } from "./spec/spec-text.ts";

export const relationSchema = z.strictObject({
  field: sqlNameText,
  to: z.strictObject({
    capability: sqlNameText,
    incarnation: incarnationIdSchema,
    field: sqlNameText,
  }),
});
export type Relation = z.infer<typeof relationSchema>;

export const relationsSchema = z
  .array(relationSchema)
  .refine(
    (relations) => allUnique(relations.map((relation) => relation.field)),
    "a field holds at most one relation",
  );

/** A `string` field the form does not draw as long text. */
export function isSingleLineTextField(
  form: Pick<UiFormIntent, "long_text">,
  field: Pick<SpecField, "name" | "type">,
): boolean {
  return field.type === "string" && !isLongTextField(form, field.name);
}

/** Either end of a relation: an active single-line text field. */
export function isLinkableField(
  form: Pick<UiFormIntent, "long_text">,
  field: Pick<SpecField, "name" | "type" | "lifecycle">,
): boolean {
  return field.lifecycle === "active" && isSingleLineTextField(form, field);
}

/** The relation one field holds, if it holds one. */
export function relationOf(
  relations: readonly Relation[],
  fieldName: string,
): Relation | undefined {
  return relations.find((relation) => relation.field === fieldName);
}
