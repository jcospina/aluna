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
// The reset-bounded M4 pantry remains deliberately tiny (PLAN decision 5):
//
//   - Field types: `string | number | boolean | datetime | date | string[]`, each
//     with `required`. (`date` — a calendar day, distinct from the `datetime`
//     instant — was added in M3; M4 adds only `string[]` behind the closed list
//     vocabulary below.) No other list types, no `file`/`file[]` (M6), no
//     relations (never — no foreign keys). Every object is strict, so any
//     extra key — `auto`, `references`, `added_in_version` — fails validation.
//   - `ui_intent` records only capability-specific presentation choices:
//     item direction, the closed collection layout (`feed | grid`), the
//     detail fields/order, and one closed input mode for every active `string[]`.
//     It never stores `views` or `modal: true`; the shared
//     modal is a platform invariant (ADR-0005 §6). `tools` is the exact
//     reset-bounded M4.1 Action tuple (`create`, `read`) and
//     `read_dependencies` carries exactly those keys with empty arrays;
//     `behavior` is free text the behavioral tier
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
export const ALUNA_RESERVED_FIELD_PREFIX = "__aluna_";

// Free-text values the platform displays or feeds to the model — blank strings
// are never meaningful, so they fail rather than propagate.
const nonBlankText = z
  .string()
  .min(1)
  .refine((text) => text.trim().length > 0, "must not be blank");
export const incarnationIdSchema = z.string().uuid();
const capabilityNameText = nonBlankText.refine(
  isCapabilityNameLabel,
  "must be a short capability name, not a sentence",
);

export const SCALAR_FIELD_TYPES = ["string", "number", "boolean", "datetime", "date"] as const;
export const LIST_FIELD_TYPES = ["string[]"] as const;

// The closed field pantry. Future list types extend LIST_FIELD_TYPES first, which
// makes every exhaustive FieldType consumer fail type-check until it handles the
// new storage, Gate, and presentation behavior.
export const fieldTypeSchema = z.enum([...SCALAR_FIELD_TYPES, ...LIST_FIELD_TYPES]);
export type FieldType = z.infer<typeof fieldTypeSchema>;
export type ListFieldType = (typeof LIST_FIELD_TYPES)[number];

export function isListFieldType(type: string): type is ListFieldType {
  return (LIST_FIELD_TYPES as readonly string[]).includes(type);
}

export const fieldLifecycleSchema = z.enum(["active", "inactive"]);
export type FieldLifecycle = z.infer<typeof fieldLifecycleSchema>;

// One user field: name, type, required — nothing else validates. Strictness is
// what rejects ARCH §6.3's `auto` example key, per the PLAN's recorded deviation.
export const specFieldSchema = z.strictObject({
  name: z
    .string()
    .regex(SQL_NAME_PATTERN, SQL_NAME_MESSAGE)
    .refine(
      (name) => !name.startsWith(ALUNA_RESERVED_FIELD_PREFIX),
      `uses the reserved ${ALUNA_RESERVED_FIELD_PREFIX} prefix`,
    )
    .refine(
      (name) => !(PLATFORM_COLUMNS as readonly string[]).includes(name),
      `is platform-owned (${PLATFORM_COLUMNS.join(", ")}) and cannot be a spec field`,
    ),
  label: nonBlankText,
  type: fieldTypeSchema,
  required: z.boolean(),
  lifecycle: fieldLifecycleSchema,
});
export type SpecField = z.infer<typeof specFieldSchema>;

export const CREATED_AT_DESCRIPTOR = {
  name: "created_at",
  label: "Created",
  type: "datetime",
  readOnly: true,
} as const;

export type PresentationFieldDescriptor =
  | Pick<SpecField, "name" | "label" | "type">
  | typeof CREATED_AT_DESCRIPTOR;

// Closed collection-layout values the platform list container knows how to map
// to presentation classes. Unknown values fail here, symmetric with unknown field
// types failing the spec gate.
export const uiCollectionLayoutSchema = z.enum(["feed", "grid"]);
export type UiCollectionLayout = z.infer<typeof uiCollectionLayoutSchema>;

export const LIST_INPUT_MODES = ["comma_separated", "repeatable"] as const;
export const listInputModeSchema = z.enum(LIST_INPUT_MODES);
export type ListInputMode = z.infer<typeof listInputModeSchema>;

export const listInputIntentSchema = z.strictObject({
  field: z.string().regex(SQL_NAME_PATTERN, SQL_NAME_MESSAGE),
  mode: listInputModeSchema,
});
export type ListInputIntent = z.infer<typeof listInputIntentSchema>;

export const uiFormIntentSchema = z.strictObject({
  list_inputs: z.array(listInputIntentSchema),
});
export type UiFormIntent = z.infer<typeof uiFormIntentSchema>;

export const uiIntentSchema = z.strictObject({
  form: uiFormIntentSchema,
  item: z.strictObject({
    direction: nonBlankText,
    shows: z
      .array(z.string().regex(SQL_NAME_PATTERN, SQL_NAME_MESSAGE))
      .min(1)
      .refine(allUnique, "item fields must be unique"),
  }),
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

// M4.1's exact reset-bounded two-Action transition. `update`/`delete`/`search`
// arrive through the complete five-Action reference shape in 4.2, not as
// optional or empty keys here.
export const TRANSITIONAL_CAPABILITY_TOOLS = ["create", "read"] as const;
export const capabilityToolSchema = z.enum(TRANSITIONAL_CAPABILITY_TOOLS);
export type CapabilityTool = z.infer<typeof capabilityToolSchema>;

// Model this as a homogeneous fixed-length array for provider JSON Schema:
// OpenAI rejects tuple-style positional `items: [...]`. The refinement keeps the
// authored contract just as narrow — only the exact ordered [create, read] value
// crosses the local hard gate — while the emitted wire schema uses one item object.
const capabilityToolsSchema = z
  .array(capabilityToolSchema)
  .length(TRANSITIONAL_CAPABILITY_TOOLS.length)
  .refine(
    (tools) => tools.every((tool, index) => tool === TRANSITIONAL_CAPABILITY_TOOLS[index]),
    `must be exactly [${TRANSITIONAL_CAPABILITY_TOOLS.join(", ")}] in that order`,
  );

// The pair shape is defined now so 4.2 can admit validated dependency identities
// without recutting the authored property. M4.1 deliberately requires both
// arrays to be empty.
export const readDependencySchema = z.strictObject({
  capability_id: z.string().regex(SQL_NAME_PATTERN, SQL_NAME_MESSAGE),
  incarnation_id: incarnationIdSchema,
});
export type ReadDependency = z.infer<typeof readDependencySchema>;

export const readDependenciesSchema = z.strictObject({
  create: z.array(readDependencySchema).length(0, "must be empty during the M4.1 transition"),
  read: z.array(readDependencySchema).length(0, "must be empty during the M4.1 transition"),
});
export type ReadDependencies = z.infer<typeof readDependenciesSchema>;

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
  tools: capabilityToolsSchema,
  read_dependencies: readDependenciesSchema,
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

// One registry row (ARCH §6.3): the spec plus the platform-assigned incarnation,
// version, and artifact pointer. The opaque incarnation identifies one complete
// capability lifetime and is deliberately absent from the AI-authored spec.
// `version` (bumped per regeneration; keys the derived-artifact caches) and
// `artifacts_path` (the version directory holding the item renderer and handlers). The row
// stays lean — spec + incarnation + version + pointer — because the intent resolver scans
// every row on every classification; nothing bulky lives here.
export const capabilityRowSchema = z
  .strictObject({
    ...commonSpecShape,
    // Existing rows may contain older narration-like labels; display paths
    // canonicalize them while generated specs are stricter going forward.
    label: nonBlankText,
    incarnation_id: incarnationIdSchema,
    version: z.number().int().min(1),
    artifacts_path: nonBlankText,
  })
  .superRefine(validateSpecSemantics);
export type CapabilityRow = z.infer<typeof capabilityRowSchema>;

export function defaultBehavioralErrorsForSchema(
  schema: CapabilitySpec["schema"],
): BehavioralErrorCase[] {
  const fields = schema.fields
    .filter((field) => field.lifecycle === "active" && field.required)
    .map((field) => field.name);
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
    .filter((field) => field.lifecycle === "active" && field.required)
    .map((field) => field.name);

  for (const [index, errorCase] of spec.behavioral_errors.entries()) {
    validateBehavioralErrorFields(ctx, fieldsByName, errorCase, index);
  }

  if (!hasExactTransitionalRequiredFieldsErrors(spec.behavioral_errors, requiredFieldNames)) {
    ctx.addIssue({
      code: "custom",
      message:
        "behavioral_errors must be exactly one create missing_required_fields case covering all active required fields, or empty when none are required",
      path: ["behavioral_errors"],
    });
  }
}

function validateSpecSemantics(
  spec: Pick<CapabilitySpec, "schema" | "ui_intent" | "behavioral_errors">,
  ctx: z.RefinementCtx,
): void {
  validateBehavioralErrors(spec, ctx);
  validatePresentationShows(spec, ctx);
  validateListInputs(spec, ctx);
}

function validateListInputs(
  spec: Pick<CapabilitySpec, "schema" | "ui_intent">,
  ctx: z.RefinementCtx,
): void {
  const fieldsByName = new Map(spec.schema.fields.map((field) => [field.name, field]));
  const expectedFields = spec.schema.fields
    .filter((field) => field.lifecycle === "active" && isListFieldType(field.type))
    .map((field) => field.name);
  const actualFields = spec.ui_intent.form.list_inputs.map((entry) => entry.field);

  for (const [index, entry] of spec.ui_intent.form.list_inputs.entries()) {
    const field = fieldsByName.get(entry.field);
    if (!field) {
      addListInputIssue(ctx, index, `field "${entry.field}" is not in schema.fields`);
    } else if (field.lifecycle !== "active") {
      addListInputIssue(ctx, index, `field "${entry.field}" must be active`);
    } else if (!isListFieldType(field.type)) {
      addListInputIssue(ctx, index, `field "${entry.field}" must be a list field`);
    }

    if (actualFields.indexOf(entry.field) !== index) {
      addListInputIssue(ctx, index, `field "${entry.field}" appears more than once`);
    }
  }

  if (!sameOrderedStrings(actualFields, expectedFields)) {
    ctx.addIssue({
      code: "custom",
      message:
        "form list_inputs must contain every active string[] field exactly once in schema-field order",
      path: ["ui_intent", "form", "list_inputs"],
    });
  }
}

function addListInputIssue(ctx: z.RefinementCtx, index: number, message: string): void {
  ctx.addIssue({
    code: "custom",
    message,
    path: ["ui_intent", "form", "list_inputs", index, "field"],
  });
}

function validatePresentationShows(
  spec: Pick<CapabilitySpec, "schema" | "ui_intent">,
  ctx: z.RefinementCtx,
): void {
  const fieldsByName = new Map(spec.schema.fields.map((field) => [field.name, field]));
  validateShowsList("item", spec.ui_intent.item.shows, fieldsByName, ctx);
  validateShowsList("detail", spec.ui_intent.detail.shows, fieldsByName, ctx);
}

function validateShowsList(
  surface: "item" | "detail",
  shows: readonly string[],
  fieldsByName: ReadonlyMap<string, SpecField>,
  ctx: z.RefinementCtx,
): void {
  for (const [index, fieldName] of shows.entries()) {
    if (fieldName === CREATED_AT_DESCRIPTOR.name) continue;
    const field = fieldsByName.get(fieldName);
    if (field?.lifecycle === "active") continue;
    ctx.addIssue({
      code: "custom",
      message: `${surface} field "${fieldName}" must be an active schema field or created_at`,
      path: ["ui_intent", surface, "shows", index],
    });
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
      continue;
    }
    if (field.lifecycle !== "active") {
      addBehavioralErrorFieldIssue(ctx, index, fieldName, "must be active");
    }
  }
}

export function activeSpecFields(fields: readonly SpecField[]): readonly SpecField[] {
  return fields.filter((field) => field.lifecycle === "active");
}

export function presentationFieldDescriptors(
  spec: Pick<CapabilitySpec, "schema">,
  shows: readonly string[],
): readonly PresentationFieldDescriptor[] {
  const activeByName = new Map(
    activeSpecFields(spec.schema.fields).map((field) => [field.name, field]),
  );
  return shows.map((name) => {
    if (name === CREATED_AT_DESCRIPTOR.name) return CREATED_AT_DESCRIPTOR;
    const field = activeByName.get(name);
    if (!field) {
      throw new Error(`Presentation field "${name}" is not active.`);
    }
    return { name: field.name, label: field.label, type: field.type };
  });
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

function hasExactTransitionalRequiredFieldsErrors(
  errorCases: readonly BehavioralErrorCase[],
  requiredFieldNames: readonly string[],
): boolean {
  if (requiredFieldNames.length === 0) return errorCases.length === 0;
  if (errorCases.length !== 1) return false;
  const [errorCase] = errorCases;
  return (
    errorCase?.action === "create" &&
    errorCase.code === MISSING_REQUIRED_FIELDS_ERROR_CODE &&
    sameOrderedStrings(errorCase.fields, requiredFieldNames)
  );
}

function sameOrderedStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
