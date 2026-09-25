// The smallest capability a file field can live in: a required caption and one optional photo.
// Shared by every layer's file-field suite, so each proves its part against the same spec.

import { validSpec } from "../spec/spec.test-support.ts";
import type { SpecField } from "../spec/spec.ts";

export const CAPTION_FIELD: SpecField = {
  name: "caption",
  label: "Caption",
  type: "string",
  required: true,
  lifecycle: "active",
};

export const PHOTO_FIELD: SpecField = {
  name: "photo",
  label: "Photo",
  type: "file",
  required: false,
  lifecycle: "active",
  accepts: ["image"],
};

export function photoSpec(fields: readonly SpecField[] = [CAPTION_FIELD, PHOTO_FIELD]) {
  const base = validSpec();
  return validSpec({
    id: "photos",
    label: "Photos",
    noun: "photo",
    plural_noun: "photos",
    prompt_context: "Stores the user's captioned photos.",
    schema: { fields: fields.map((field) => ({ ...field })) },
    ui_intent: { ...base.ui_intent, item: { ...base.ui_intent.item, shows: ["caption"] } },
  });
}

/** Every ordering of every non-empty selection of `values`. */
export function orderings<T>(values: readonly T[]): T[][] {
  const result: T[][] = [];
  for (const [index, value] of values.entries()) {
    const rest = values.filter((_, other) => other !== index);
    result.push([value], ...orderings(rest).map((tail) => [value, ...tail]));
  }
  return result;
}
