// The intent classification shape.
//
// The resolver speaks the full intent language, one shape for every prompt. The
// reject bucket is part of that contract so unsupported or unclear prompts still
// become measurable classifications rather than ad hoc errors.

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
  "link_capability",
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
  /**
   * The existing capabilities whose records this request is about. The openai-compatible wire holds
   * the model to no schema, so a null list or id reads as none and the resolver drops an id naming
   * no active capability; any other entry fails the answer.
   */
  related_capabilities: z
    .array(z.string().nullable())
    .nullable()
    .transform((ids) => (ids ?? []).filter((id): id is string => id !== null)),
  // The resolver never asks for a confirmation: a capability is deleted from its logo, which
  // confirms on its own route, and a proposal belongs to the implicit loop. Data questions named
  // the first proposal — the gap answer — and deliberately shipped it with no control, so the
  // implicit loop inherits a customer rather than a shape guessed at.
  requires_confirmation: z.literal(false),
});
type ParsedIntentClassification = z.infer<typeof intentClassificationObject>;

function validateTarget(intent: ParsedIntentClassification, ctx: RefinementCtx): void {
  const requiresTarget =
    intent.type === "extend_capability" ||
    intent.type === "ui_change" ||
    intent.type === "link_capability" ||
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
    case "link_capability":
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
