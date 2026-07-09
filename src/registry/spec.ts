// The capability spec shape — Module 2, Epic 2.1 plus Module 3's presentation
// intent reshape (ARCH §2 "The generated artifacts", §6.3 "Capability Registry",
// PLAN 3.3 decision 7, ADR-0005 §6).
//
// The spec is the structured object the AI authors and the platform derives
// everything else from — DDL, handlers, presentation intent, behavioral tests. It is the only
// artifact that cannot be reconstructed from something else (ARCH §2), so this
// shape is the single gate every generated spec must clear before anything
// downstream sees it. Validation is loud on purpose: a non-conforming spec
// throws here rather than flowing onward malformed (the 2.5 spec-gen stage maps
// that throw onto the build's failure path).
//
// The M2 pantry is deliberately tiny (PLAN decision 8):
//
//   - Field types: `string | number | boolean | datetime | date`, each with
//     `required`. (`date` — a calendar day, distinct from the `datetime` instant —
//     was added in M3 alongside the centralized field renderer, so a "due date"
//     asks for a day, not a timestamp.) No list types (M4), no `file`/`file[]`
//     (M6), no relations (never — no foreign keys). Every object is strict, so any
//     extra key — `auto`, `references`, `added_in_version` — fails validation.
//   - `ui_intent` records only capability-specific presentation choices:
//     item direction, the closed collection layout (`feed | grid`), and the
//     detail fields/order. It never stores `views` or `modal: true`; the shared
//     modal is a platform invariant (ADR-0005 §6). `tools` speaks M2's two
//     actions (`create`, `read`); `behavior` is free text the behavioral tier
//     generates tests from; `behavioral_errors` is the stable validation error
//     contract product copy must not stand in for.
//   - The platform trio — `id`, `created_at`, `extra` — is platform-owned, never
//     a spec field. A spec naming one of them is rejected. This deviates from
//     ARCH §6.3's example (`created_at` with `auto`) deliberately, per the PLAN:
//     making the trio platform-owned removes the `auto` concept from M2 entirely.

import { z } from "zod";
import { isCapabilityNameLabel } from "./labels.ts";

// Columns every capability data table gets from the platform, never from the
// spec (PLAN decision 8): `id` (PK), `created_at` (uniform — pre-pays M5's
// NL→SQL catalog), `extra` (the JSON escape-hatch column, present from birth).
// Exported for the 2.2 spec→DDL mapper, which emits them on every table.
export const PLATFORM_COLUMNS = ["id", "created_at", "extra"] as const;

// Capability ids and field names both end up inside SQL identifiers — the data
// table is `cap_<id>` and each field becomes a column (2.2 mapper) — so both are
// confined to a shape that needs no quoting and can never smuggle SQL.
const SQL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const SQL_NAME_MESSAGE = "must be lowercase letters/digits/underscores, starting with a letter";

// Free-text values the platform displays or feeds to the model — blank strings
// are never meaningful, so they fail rather than propagate.
const nonBlankText = z
  .string()
  .min(1)
  .refine((text) => text.trim().length > 0, "must not be blank");
const capabilityNameText = nonBlankText.refine(
  isCapabilityNameLabel,
  "must be a short capability name, not a sentence",
);

// The complete M2 field type enum. Anything else — `string[]`, `file`, a
// relation — is not a parse error to recover from but a spec the platform must
// refuse (PLAN decision 8 reserves list types for M4 and files for M6).
export const fieldTypeSchema = z.enum(["string", "number", "boolean", "datetime", "date"]);
export type FieldType = z.infer<typeof fieldTypeSchema>;

// One user field: name, type, required — nothing else validates. Strictness is
// what rejects ARCH §6.3's `auto` example key, per the PLAN's recorded deviation.
export const specFieldSchema = z.strictObject({
  name: z
    .string()
    .regex(SQL_NAME_PATTERN, SQL_NAME_MESSAGE)
    .refine(
      (name) => !(PLATFORM_COLUMNS as readonly string[]).includes(name),
      `is platform-owned (${PLATFORM_COLUMNS.join(", ")}) and cannot be a spec field`,
    ),
  type: fieldTypeSchema,
  required: z.boolean(),
});
export type SpecField = z.infer<typeof specFieldSchema>;

// Closed collection-layout values the platform list container knows how to map
// to presentation classes. Unknown values fail here, symmetric with unknown field
// types failing the spec gate.
export const uiCollectionLayoutSchema = z.enum(["feed", "grid"]);
export type UiCollectionLayout = z.infer<typeof uiCollectionLayoutSchema>;

export const uiIntentSchema = z.strictObject({
  item: nonBlankText,
  collection: z.strictObject({
    layout: uiCollectionLayoutSchema,
  }),
  detail: z.strictObject({
    shows: z
      .array(z.string().regex(SQL_NAME_PATTERN, SQL_NAME_MESSAGE))
      .min(1)
      .refine(allUnique, "detail fields must be unique"),
  }),
});
export type UiIntent = z.infer<typeof uiIntentSchema>;

// M2's two actions, the values the router validates `/capability/:id/:action`
// against (2.3). `update`/`delete`/`search` arrive in later modules.
export const capabilityToolSchema = z.enum(["create", "read"]);
export type CapabilityTool = z.infer<typeof capabilityToolSchema>;

export const MISSING_REQUIRED_FIELDS_ERROR_CODE = "missing_required_fields";
export const BEHAVIORAL_ERROR_MARKERS = {
  role_attribute: "data-role",
  role: "error",
  code_attribute: "data-error-code",
  fields_attribute: "data-error-fields",
  fields_separator: " ",
} as const;

export const behavioralErrorMarkersSchema = z.strictObject({
  role_attribute: z.literal(BEHAVIORAL_ERROR_MARKERS.role_attribute),
  role: z.literal(BEHAVIORAL_ERROR_MARKERS.role),
  code_attribute: z.literal(BEHAVIORAL_ERROR_MARKERS.code_attribute),
  fields_attribute: z.literal(BEHAVIORAL_ERROR_MARKERS.fields_attribute),
  fields_separator: z.literal(BEHAVIORAL_ERROR_MARKERS.fields_separator),
});
export type BehavioralErrorMarkers = z.infer<typeof behavioralErrorMarkersSchema>;

export const behavioralErrorCaseSchema = z.strictObject({
  action: z.literal("create"),
  trigger: z.literal(MISSING_REQUIRED_FIELDS_ERROR_CODE),
  code: z.literal(MISSING_REQUIRED_FIELDS_ERROR_CODE),
  fields: z
    .array(z.string().regex(SQL_NAME_PATTERN, SQL_NAME_MESSAGE))
    .min(1)
    .refine(allUnique, "behavioral error fields must be unique"),
  expected_markers: behavioralErrorMarkersSchema,
});
export type BehavioralErrorCase = z.infer<typeof behavioralErrorCaseSchema>;

function allUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

// The spec proper — everything the AI authors (ARCH §2: schema + ui_intent +
// behavior, plus the identity and resolver context the registry row carries,
// §6.3). `version` and `artifacts_path` are deliberately absent: the platform
// assigns those at commit, the AI never does.
const commonSpecShape = {
  // Engineering identity — becomes the `cap_<id>` table name and the artifacts
  // directory; never user-facing (CONTEXT.md "Engineering language").
  id: z.string().regex(SQL_NAME_PATTERN, SQL_NAME_MESSAGE),
  schema: z.strictObject({
    fields: z
      .array(specFieldSchema)
      .min(1)
      .refine(
        (fields) => allUnique(fields.map((field) => field.name)),
        "field names must be unique",
      ),
  }),
  ui_intent: uiIntentSchema,
  // Free text. The behavioral tier generates tests from this — from stated
  // intent, never from handler code (ARCH §2).
  behavior: nonBlankText,
  // Stable validation-error behavior that the generated handler and independent
  // behavioral tests both consume. User-facing copy can vary; this contract is
  // made of semantic markers and affected fields.
  behavioral_errors: z.array(behavioralErrorCaseSchema).max(8),
  tools: z.array(capabilityToolSchema).min(1).refine(allUnique, "tools must be unique"),
  // What the intent resolver reads to understand this capability (ARCH §6.3).
  prompt_context: nonBlankText,
};

export const capabilitySpecSchema = z
  .strictObject({
    ...commonSpecShape,
    // User-facing capability name, shown in the capability toolbar. This is a name,
    // not the intent resolver's product-voice narration sentence.
    label: capabilityNameText,
  })
  .superRefine(validateSpecSemantics);
export type CapabilitySpec = z.infer<typeof capabilitySpecSchema>;

// One registry row (ARCH §6.3): the spec plus the two platform-assigned values —
// `version` (bumped per regeneration; keys the derived-artifact caches) and
// `artifacts_path` (the version directory holding handlers and views). The row
// stays lean — spec + version + pointer — because the intent resolver scans
// every row on every classification; nothing bulky lives here.
export const capabilityRowSchema = z
  .strictObject({
    ...commonSpecShape,
    // Existing rows may contain older narration-like labels; display paths
    // canonicalize them while generated specs are stricter going forward.
    label: nonBlankText,
    version: z.number().int().min(1),
    artifacts_path: nonBlankText,
  })
  .superRefine(validateSpecSemantics);
export type CapabilityRow = z.infer<typeof capabilityRowSchema>;

export function defaultBehavioralErrorsForSchema(
  schema: CapabilitySpec["schema"],
): BehavioralErrorCase[] {
  const fields = schema.fields.filter((field) => field.required).map((field) => field.name);
  if (fields.length === 0) return [];

  return [
    {
      action: "create",
      trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
      code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
      fields,
      expected_markers: BEHAVIORAL_ERROR_MARKERS,
    },
  ];
}

function validateBehavioralErrors(
  spec: Pick<CapabilitySpec, "schema" | "behavioral_errors">,
  ctx: z.RefinementCtx,
): void {
  const fieldsByName = new Map(spec.schema.fields.map((field) => [field.name, field]));
  const requiredFieldNames = spec.schema.fields
    .filter((field) => field.required)
    .map((field) => field.name);

  for (const [index, errorCase] of spec.behavioral_errors.entries()) {
    validateBehavioralErrorFields(ctx, fieldsByName, errorCase, index);
  }

  if (missingRequiredFieldsCaseIsMissing(spec.behavioral_errors, requiredFieldNames)) {
    ctx.addIssue({
      code: "custom",
      message:
        "behavioral_errors must include one missing_required_fields case covering all required fields",
      path: ["behavioral_errors"],
    });
  }
}

function validateSpecSemantics(
  spec: Pick<CapabilitySpec, "schema" | "ui_intent" | "behavioral_errors">,
  ctx: z.RefinementCtx,
): void {
  validateBehavioralErrors(spec, ctx);
  validateDetailShows(spec, ctx);
}

function validateDetailShows(
  spec: Pick<CapabilitySpec, "schema" | "ui_intent">,
  ctx: z.RefinementCtx,
): void {
  const fieldNames = new Set(spec.schema.fields.map((field) => field.name));

  for (const [index, fieldName] of spec.ui_intent.detail.shows.entries()) {
    if (!fieldNames.has(fieldName)) {
      ctx.addIssue({
        code: "custom",
        message: `detail field "${fieldName}" is not in schema.fields`,
        path: ["ui_intent", "detail", "shows", index],
      });
    }
  }
}

function validateBehavioralErrorFields(
  ctx: z.RefinementCtx,
  fieldsByName: ReadonlyMap<string, SpecField>,
  errorCase: BehavioralErrorCase,
  index: number,
): void {
  for (const fieldName of errorCase.fields) {
    const field = fieldsByName.get(fieldName);
    if (!field) {
      addBehavioralErrorFieldIssue(ctx, index, fieldName, "is not in schema.fields");
      continue;
    }
    if (!field.required) {
      addBehavioralErrorFieldIssue(ctx, index, fieldName, "must be required");
    }
  }
}

function addBehavioralErrorFieldIssue(
  ctx: z.RefinementCtx,
  index: number,
  fieldName: string,
  reason: string,
): void {
  ctx.addIssue({
    code: "custom",
    message: `behavioral error field "${fieldName}" ${reason}`,
    path: ["behavioral_errors", index, "fields"],
  });
}

function missingRequiredFieldsCaseIsMissing(
  errorCases: readonly BehavioralErrorCase[],
  requiredFieldNames: readonly string[],
): boolean {
  if (requiredFieldNames.length === 0) return false;
  return !errorCases.some(
    (errorCase) =>
      errorCase.code === MISSING_REQUIRED_FIELDS_ERROR_CODE &&
      sameStringSet(errorCase.fields, requiredFieldNames),
  );
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}
