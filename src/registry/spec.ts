// The capability spec shape: the structured object the AI authors and the platform derives
// everything else from — DDL, handlers, presentation intent, behavioral tests. It is the
// only artifact that cannot be reconstructed from something else, so this shape is the
// single gate every generated spec must clear before anything downstream sees it.
// Validation is loud on purpose: a non-conforming spec throws here rather than flowing
// onward malformed, and the spec-gen stage maps that throw onto the build's failure path.
//
// The pantry is deliberately tiny:
//
//   - Field types: `string | number | boolean | datetime | date | string[]`, each with
//     `required`. (`date` is a calendar day, distinct from the `datetime` instant.) No
//     other list types, no `file`/`file[]`, and no relations — there are no foreign keys.
//     Every object is strict, so any extra key fails validation.
//   - `ui_intent` records only capability-specific presentation choices: item direction,
//     the closed collection layout (`feed | grid`), and one closed
//     input mode for every active `string[]`. It never stores `views` or `modal: true` —
//     the shared modal is a platform invariant. `tools` is the fixed five-Action tuple;
//     `read_dependencies` carries exactly one array per Action; `behavior` is free text the
//     behavioral tier generates tests from; `behavioral_errors` is the stable validation
//     error contract product copy must not stand in for.
//   - The platform trio — `id`, `created_at`, `extra` — is platform-owned, never a spec
//     field, and a spec naming one of them is rejected. Making the trio platform-owned is
//     what removes the `auto` concept from the spec entirely.
//   - `subject`, `ground` and `companion` are the logo's birth facts and `noun` is the
//     desk's empty-state word. Both colours are validated by naming one of eight hue
//     families — the whole of colour validation — plus the one thing a per-field schema
//     cannot see: they have to differ. Which shade of a named family the capability
//     actually wears is not in the spec at all: the platform resolves it from the
//     incarnation seed. Users never steer any of the four: the subject
//     comes from what the capability is for, and a prompt reaching for art direction is
//     refused by the intent resolver where every other presentation-steering prompt is.

import { z } from "zod";
import { isCapabilityNameLabel } from "./labels.ts";
import { capabilityLogoStateSchema, logoHueFamilySchema, logoSeedSchema } from "./logo.ts";

/**
 * Columns every capability data table gets from the platform, never from the
 * spec: `id` (PK), `created_at` (uniform — pre-pays M5's
 * NL→SQL catalog), `extra` (the JSON escape-hatch column, present from birth).
 * Exported for the 2.2 spec→DDL mapper, which emits them on every table.
 */
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

// The two short authored phrases the logo contract adds. Both are single-line by
// construction: one fills the request's subject slot and the other lands inside a
// sentence of desk copy, and a newline in either would break the surface it feeds.
const singleLinePhrase = (max: number) =>
  nonBlankText.max(max).refine((text) => !/[\r\n]/.test(text), "must be one line");

export const MAX_LOGO_SUBJECT_LENGTH = 80;
export const MAX_CAPABILITY_NOUN_LENGTH = 32;

/** The subject phrase alone — the registry re-validates it when a claim hands it out. */
export const logoSubjectSchema = singleLinePhrase(MAX_LOGO_SUBJECT_LENGTH);

export const SCALAR_FIELD_TYPES = ["string", "number", "boolean", "datetime", "date"] as const;
export const LIST_FIELD_TYPES = ["string[]"] as const;

/**
 * The closed field pantry. Future list types extend LIST_FIELD_TYPES first, which
 * makes every exhaustive FieldType consumer fail type-check until it handles the
 * new storage, Gate, and presentation behavior.
 */
export const fieldTypeSchema = z.enum([...SCALAR_FIELD_TYPES, ...LIST_FIELD_TYPES]);
export type FieldType = z.infer<typeof fieldTypeSchema>;
export type ListFieldType = (typeof LIST_FIELD_TYPES)[number];

export function isListFieldType(type: string): type is ListFieldType {
  return (LIST_FIELD_TYPES as readonly string[]).includes(type);
}

export const fieldLifecycleSchema = z.enum(["active", "inactive"]);
export type FieldLifecycle = z.infer<typeof fieldLifecycleSchema>;

/**
 * One user field: name, type, required — nothing else validates. Strictness is
 * what rejects ARCH §6.3's `auto` example key, per the PLAN's recorded deviation.
 */
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

/**
 * Closed collection-layout values the platform list container knows how to map
 * to presentation classes. Unknown values fail here, symmetric with unknown field
 * types failing the spec gate.
 */
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
});
export type UiIntent = z.infer<typeof uiIntentSchema>;

/**
 * From the 4.4 steady-state cutover the five Actions are mandatory and fixed
 * every capability is born with the complete ordered inventory and
 * no evolution can drop one. There is no longer any narrower admitted shape.
 */
export const FULL_CAPABILITY_TOOLS = ["create", "read", "update", "delete", "search"] as const;
export const capabilityToolSchema = z.enum(FULL_CAPABILITY_TOOLS);
export type CapabilityTool = z.infer<typeof capabilityToolSchema>;

// Model this as a homogeneous fixed-length array for provider JSON Schema: OpenAI
// rejects tuple-style positional `items: [...]`. The refinement keeps the authored
// contract narrow — only the exact ordered five-Action value crosses the local hard
// gate — while the emitted wire schema uses one item object.
const capabilityToolsSchema = z
  .array(capabilityToolSchema)
  .length(FULL_CAPABILITY_TOOLS.length)
  .refine(
    (tools) => sameOrderedStrings(tools, FULL_CAPABILITY_TOOLS),
    `must be exactly [${FULL_CAPABILITY_TOOLS.join(", ")}] in canonical order`,
  );

/**
 * One read-dependency identity: which prior capability incarnation an Action reads.
 */
export const readDependencySchema = z.strictObject({
  capability_id: z.string().regex(SQL_NAME_PATTERN, SQL_NAME_MESSAGE),
  incarnation_id: incarnationIdSchema,
});
export type ReadDependency = z.infer<typeof readDependencySchema>;

/**
 * One key per fixed Action — the same complete five-Action inventory as `tools`.
 */
export const readDependenciesSchema = z.strictObject({
  create: z.array(readDependencySchema),
  read: z.array(readDependencySchema),
  update: z.array(readDependencySchema),
  delete: z.array(readDependencySchema),
  search: z.array(readDependencySchema),
});
export type ReadDependencies = z.infer<typeof readDependenciesSchema>;

export const MISSING_REQUIRED_FIELDS_ERROR_CODE = "missing_required_fields";
export const MAX_BEHAVIORAL_ERRORS = 8;
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

const behavioralErrorCaseShape = {
  trigger: z.string().regex(SQL_NAME_PATTERN, SQL_NAME_MESSAGE),
  code: z.string().regex(SQL_NAME_PATTERN, SQL_NAME_MESSAGE),
  fields: z
    .array(z.string().regex(SQL_NAME_PATTERN, SQL_NAME_MESSAGE))
    .min(1)
    .refine(allUnique, "behavioral error fields must be unique"),
  expected_markers: behavioralErrorMarkersSchema,
};

export const behavioralErrorCaseSchema = z.strictObject({
  action: capabilityToolSchema,
  ...behavioralErrorCaseShape,
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
  // The three logo birth facts. They are authored once, at birth, and evolution
  // preserves them byte-for-byte: artwork is made once and never remade (ADR-0007
  // L7), so a spec that drifted from its drawing would be describing a picture
  // nothing is allowed to redraw. Both colours validate against the eight hue families
  // by name — the whole of colour validation (decision 39) — and `validateLogoColours`
  // adds the one thing a per-field schema cannot see: they have to differ, or the
  // request carries one colour where the contract says exactly two.
  //
  // The spec names a *hue*, not a colour: `resolveLogoShades` draws the concrete shade
  // from the incarnation seed. Two capabilities that both authored `cyan_blue` are two
  // different blues, which is the only thing in the path that survives a spec model
  // collapsing to one modal answer for a whole neighbourhood of prompts.
  subject: logoSubjectSchema,
  ground: logoHueFamilySchema,
  companion: logoHueFamilySchema,
  // The singular common noun for one record, used in the desk's empty-state copy
  // ("add your first note above"). A platform-View fact: it may evolve, and it never
  // selects logo generation.
  noun: singleLinePhrase(MAX_CAPABILITY_NOUN_LENGTH),
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
  // intent, never from handler code.
  behavior: nonBlankText,
  // Stable validation-error behavior that the generated handler and independent
  // behavioral tests both consume. User-facing copy can vary; this contract is
  // made of semantic markers and affected fields.
  behavioral_errors: z.array(behavioralErrorCaseSchema).max(MAX_BEHAVIORAL_ERRORS),
  tools: capabilityToolsSchema,
  read_dependencies: readDependenciesSchema,
  // What the intent resolver reads to understand this capability.
  prompt_context: nonBlankText,
};

export const capabilitySpecSchema = z
  .strictObject({
    ...commonSpecShape,
    // User-facing capability name, written under its logo on the desk. This is a name,
    // not the intent resolver's product-voice narration sentence.
    label: capabilityNameText,
  })
  .superRefine(validateSpecSemantics);
export type CapabilitySpec = z.infer<typeof capabilitySpecSchema>;

/**
 * The prompt Builder and the registry now admit exactly one shape. `capabilitySpecSchema`
 * already pins the complete fixed five-Action inventory, so the prompt-build
 * path validates against that same schema — there is no separate, looser registry shape.
 */
export const promptCapabilitySpecSchema = capabilitySpecSchema;

// The spec plus the platform-assigned incarnation, version, artifact pointer, and
// logo seed. The opaque incarnation identifies one complete capability lifetime and
// is deliberately absent from the AI-authored spec, as are `version` (bumped per
// regeneration; keys the derived-artifact caches), `artifacts_path` (the version
// directory holding the item renderer and handlers), and `seed`. The row stays lean
// because the intent resolver scans every row on every classification; nothing bulky
// lives here, and the artwork itself is a file rather than a column.
const capabilityRegistryShape = {
  ...commonSpecShape,
  // Existing rows may contain older narration-like labels; display paths
  // canonicalize them while generated specs are stricter going forward.
  label: nonBlankText,
  incarnation_id: incarnationIdSchema,
  version: z.number().int().min(1),
  artifacts_path: nonBlankText,
  // The incarnation's stored seed — the record of what drew its logo. Born with the
  // registry row and carried unchanged through every version, because the artwork is.
  seed: logoSeedSchema,
};

/**
 * What a write puts into the registry: the row without its logo lifecycle. The
 * lifecycle is absent here on purpose — evolution never reads or writes the logo
 * (ADR-0007), and a write shape that could carry a status is a write that could
 * overwrite a claim some other desk load has already won and spent an attempt on.
 * Only the claim and transition functions in `store.ts` move that value.
 */
export const capabilityRegistryWriteSchema = z
  .strictObject(capabilityRegistryShape)
  .superRefine(validateSpecSemantics);
export type CapabilityRegistryWrite = z.infer<typeof capabilityRegistryWriteSchema>;

/**
 * One registry row as it is read back: everything a write supplies plus the durable
 * logo lifecycle the platform owns alone.
 */
export const capabilityRowSchema = z
  .strictObject({
    ...capabilityRegistryShape,
    logo: capabilityLogoStateSchema,
  })
  .superRefine(validateSpecSemantics);
export type CapabilityRow = z.infer<typeof capabilityRowSchema>;

export function capabilitySpecFromRow(row: CapabilityRow): CapabilitySpec {
  return capabilitySpecSchema.parse({
    id: row.id,
    label: row.label,
    subject: row.subject,
    ground: row.ground,
    companion: row.companion,
    noun: row.noun,
    schema: row.schema,
    ui_intent: row.ui_intent,
    behavior: row.behavior,
    behavioral_errors: row.behavioral_errors,
    tools: row.tools,
    read_dependencies: row.read_dependencies,
    prompt_context: row.prompt_context,
  });
}

export function defaultBehavioralErrorsForSchema(
  schema: CapabilitySpec["schema"],
): BehavioralErrorCase[] {
  const fields = schema.fields
    .filter((field) => field.lifecycle === "active" && field.required)
    .map((field) => field.name);
  if (fields.length === 0) return [];

  // The fixed five-Action shape owns a missing_required_fields case on each writing
  // Action that revalidates required fields: create and update.
  const actions = ["create", "update"] as const;
  return actions.map((action) => ({
    action,
    trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
    code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
    fields,
    expected_markers: BEHAVIORAL_ERROR_MARKERS,
  }));
}

function validateBehavioralErrors(
  spec: Pick<CapabilitySpec, "schema" | "behavioral_errors" | "tools">,
  ctx: z.RefinementCtx,
): void {
  const fieldsByName = new Map(spec.schema.fields.map((field) => [field.name, field]));
  const requiredFieldNames = spec.schema.fields
    .filter((field) => field.lifecycle === "active" && field.required)
    .map((field) => field.name);

  const seenOwnership = new Set<string>();
  for (const [index, errorCase] of spec.behavioral_errors.entries()) {
    validateBehavioralErrorFields(ctx, fieldsByName, errorCase, index);
    if (errorCase.trigger === "record_not_found" || errorCase.code === "record_not_found") {
      ctx.addIssue({
        code: "custom",
        message: "record_not_found is platform-owned and must not be authored by a capability",
        path: ["behavioral_errors", index],
      });
    }
    if (!spec.tools.includes(errorCase.action)) {
      ctx.addIssue({
        code: "custom",
        message: `behavioral error Action "${errorCase.action}" is not present in tools`,
        path: ["behavioral_errors", index, "action"],
      });
    }
    const ownership = `${errorCase.action}\u0000${errorCase.trigger}\u0000${errorCase.code}`;
    if (seenOwnership.has(ownership)) {
      ctx.addIssue({
        code: "custom",
        message: "behavioral error Action ownership must be unique per trigger/code",
        path: ["behavioral_errors", index, "action"],
      });
    }
    seenOwnership.add(ownership);
  }

  if (!hasExactRequiredFieldsErrors(spec.behavioral_errors, requiredFieldNames)) {
    ctx.addIssue({
      code: "custom",
      message:
        "behavioral_errors must contain the exact missing_required_fields cases for the admitted Action shape and active required fields",
      path: ["behavioral_errors"],
    });
  }
}

function validateSpecSemantics(
  spec: Pick<
    CapabilitySpec,
    | "id"
    | "schema"
    | "ui_intent"
    | "behavioral_errors"
    | "tools"
    | "read_dependencies"
    | "ground"
    | "companion"
  >,
  ctx: z.RefinementCtx,
): void {
  validateLogoColours(spec, ctx);
  validateActionShapePair(spec, ctx);
  validateReadDependencies(spec, ctx);
  validateBehavioralErrors(spec, ctx);
  validatePresentationShows(spec, ctx);
  validateListInputs(spec, ctx);
}

/**
 * The logo's two hues have to be two. Each field already validates against the eight
 * families on its own; only the whole object can see that they are the same one, and a
 * request built from a spec that named one hue twice would ask for a drawing of a thing
 * in the colour of the thing it sits on. Two different families share no shade, so this
 * is also what guarantees the resolved pair differs.
 */
function validateLogoColours(
  spec: Pick<CapabilitySpec, "ground" | "companion">,
  ctx: z.RefinementCtx,
): void {
  if (spec.ground !== spec.companion) return;
  ctx.addIssue({
    code: "custom",
    message: `companion must differ from ground; both name "${spec.ground}"`,
    path: ["companion"],
  });
}

function validateReadDependencies(
  spec: Pick<CapabilitySpec, "id" | "read_dependencies">,
  ctx: z.RefinementCtx,
): void {
  for (const [action, dependencies] of Object.entries(spec.read_dependencies)) {
    let previousKey: string | undefined;
    for (const [index, dependency] of dependencies.entries()) {
      const path = ["read_dependencies", action, index];
      if (dependency.capability_id === spec.id) {
        ctx.addIssue({
          code: "custom",
          message: "self-dependency is implicit and must not be listed",
          path,
        });
      }
      const key = `${dependency.capability_id}\u0000${dependency.incarnation_id}`;
      if (previousKey !== undefined && key <= previousKey) {
        ctx.addIssue({
          code: "custom",
          message: "read dependencies must be unique and in canonical capability/incarnation order",
          path,
        });
      }
      previousKey = key;
    }
  }
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
    validateListInputEntry(fieldsByName, actualFields, entry, index, ctx);
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

function validateListInputEntry(
  fieldsByName: ReadonlyMap<string, SpecField>,
  actualFields: readonly string[],
  entry: ListInputIntent,
  index: number,
  ctx: z.RefinementCtx,
): void {
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
}

function validateShowsList(
  surface: "item",
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

function validateActionShapePair(
  spec: Pick<CapabilitySpec, "tools" | "read_dependencies">,
  ctx: z.RefinementCtx,
): void {
  const dependencyKeys = Object.keys(spec.read_dependencies);
  if (!sameOrderedStrings(dependencyKeys, FULL_CAPABILITY_TOOLS)) {
    ctx.addIssue({
      code: "custom",
      message: "tools and read_dependencies must be the complete fixed five-Action shape",
      path: ["read_dependencies"],
    });
  }
}

function hasExactRequiredFieldsErrors(
  errorCases: readonly BehavioralErrorCase[],
  requiredFieldNames: readonly string[],
): boolean {
  const requiredCases = errorCases.filter(
    (errorCase) =>
      errorCase.trigger === MISSING_REQUIRED_FIELDS_ERROR_CODE ||
      errorCase.code === MISSING_REQUIRED_FIELDS_ERROR_CODE,
  );
  if (requiredFieldNames.length === 0) return requiredCases.length === 0;
  // The writing Actions that revalidate required fields, in canonical order.
  const expectedActions = ["create", "update"] as const;
  return (
    requiredCases.length === expectedActions.length &&
    requiredCases.every(
      (errorCase, index) =>
        errorCase.action === expectedActions[index] &&
        errorCase.trigger === MISSING_REQUIRED_FIELDS_ERROR_CODE &&
        errorCase.code === MISSING_REQUIRED_FIELDS_ERROR_CODE &&
        sameOrderedStrings(errorCase.fields, requiredFieldNames),
    )
  );
}

function sameOrderedStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
