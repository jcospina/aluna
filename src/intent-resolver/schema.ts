// The intent classification shape - Module 2, Epic 2.4.
//
// PLAN decision 6 says the resolver speaks the full future-facing language from
// day one, even while M2 only acts on `new_capability`. The reject bucket is part
// of that contract so unsupported or unclear prompts still become measurable
// classifications rather than ad hoc errors.

import { z } from "zod";

const nonBlankText = z
  .string()
  .min(1)
  .refine((text) => text.trim().length > 0, "must not be blank");

export const INTENT_TYPES = [
  "new_capability",
  "extend_capability",
  "ui_change",
  "data_query",
  "reject",
] as const;

export const intentTypeSchema = z.enum(INTENT_TYPES);
export type IntentType = z.infer<typeof intentTypeSchema>;

export const intentClassificationSchema = z.strictObject({
  type: intentTypeSchema,
  confidence: z.number().min(0).max(1),
  target_capability: nonBlankText.nullable(),
  proposed_action: nonBlankText,
  user_facing_label: nonBlankText,
  // Confirmations are reserved for later modules: capability delete in M4 and
  // implicit-loop proposals in M7. In M2 the schema carries the field, but only
  // the literal value `false` validates.
  requires_confirmation: z.literal(false),
});
export type IntentClassification = z.infer<typeof intentClassificationSchema>;
