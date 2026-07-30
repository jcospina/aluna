// The intent classification shape - Module 2, Epic 2.4.
//
// PLAN decision 6 says the resolver speaks the full future-facing language from
// day one, even while M2 only acts on `new_capability`. The reject bucket is part
// of that contract so unsupported or unclear prompts still become measurable
// classifications rather than ad hoc errors.

import { type RefinementCtx, z } from "zod";

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

export const OVERLAP_RESOLUTIONS = ["new", "extend", "namespace", "none"] as const;
export const overlapResolutionSchema = z.enum(OVERLAP_RESOLUTIONS);
export type OverlapResolution = z.infer<typeof overlapResolutionSchema>;

const intentClassificationObject = z.strictObject({
  type: intentTypeSchema,
  confidence: z.number().min(0).max(1),
  target_capability: nonBlankText.nullable(),
  /**
   * Internal overlap outcome. `namespace` is metrics/Builder context only: the
   * user sees an independently named capability, never this engineering term.
   */
  resolution: overlapResolutionSchema,
  proposed_identity: z
    .strictObject({
      id: z.string().regex(/^[a-z][a-z0-9_]*$/),
      label: nonBlankText,
    })
    .nullable(),
  proposed_action: nonBlankText,
  user_facing_label: nonBlankText,
  // Confirmations are reserved for later modules: capability delete in M4 and
  // implicit-loop proposals in M7. In M2 the schema carries the field, but only
  // the literal value `false` validates.
  requires_confirmation: z.literal(false),
});
type ParsedIntentClassification = z.infer<typeof intentClassificationObject>;

function validateTarget(intent: ParsedIntentClassification, ctx: RefinementCtx): void {
  const requiresTarget =
    intent.type === "extend_capability" ||
    intent.type === "ui_change" ||
    (intent.type === "new_capability" && intent.resolution === "namespace");
  const forbidsTarget =
    intent.type === "reject" ||
    (intent.type === "new_capability" && intent.resolution !== "namespace");
  if (requiresTarget && intent.target_capability === null) {
    ctx.addIssue({
      code: "custom",
      path: ["target_capability"],
      message: `${intent.type} must target an existing capability`,
    });
  }
  if (forbidsTarget && intent.target_capability !== null) {
    ctx.addIssue({
      code: "custom",
      path: ["target_capability"],
      message: `${intent.type} cannot target an existing capability`,
    });
  }
}

function resolutionMatches(intent: ParsedIntentClassification): boolean {
  switch (intent.type) {
    case "new_capability":
      return intent.resolution === "new" || intent.resolution === "namespace";
    case "extend_capability":
    case "ui_change":
      return intent.resolution === "extend";
    case "data_query":
    case "reject":
      return intent.resolution === "none";
  }
}

function validateResolution(intent: ParsedIntentClassification, ctx: RefinementCtx): void {
  if (resolutionMatches(intent)) return;
  ctx.addIssue({
    code: "custom",
    path: ["resolution"],
    message: `resolution "${intent.resolution}" is invalid for ${intent.type}`,
  });
}

export const intentClassificationSchema = intentClassificationObject.superRefine((intent, ctx) => {
  validateTarget(intent, ctx);
  validateResolution(intent, ctx);
  const requiresIdentity = intent.resolution === "namespace";
  if (requiresIdentity !== (intent.proposed_identity !== null)) {
    ctx.addIssue({
      code: "custom",
      path: ["proposed_identity"],
      message: requiresIdentity
        ? "namespace resolution requires a semantic proposed identity"
        : "only namespace resolution may propose a separate identity",
    });
  }
});
export type IntentClassification = z.infer<typeof intentClassificationSchema>;
