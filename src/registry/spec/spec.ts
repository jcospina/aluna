// The capability spec shape: the structured object the AI authors and the platform derives
// everything else from — DDL, handlers, presentation intent, behavioral tests. It is the
// only artifact that cannot be reconstructed from something else, so this shape is the
// single gate every generated spec must clear before anything downstream sees it.
// Validation is loud on purpose: a non-conforming spec throws here rather than flowing
// onward malformed, and the spec-gen stage maps that throw onto the build's failure path.
//
// The pantry is deliberately tiny:
//
//   - Field types: `string | number | boolean | datetime | date | choice | string[]`, each
//     with `required`. (`date` is a calendar day, distinct from the `datetime` instant.)
//     `choice` is the one type that carries data of its own: the ordered `values` it admits.
//     No other list types, no `file`/`file[]`, and no relations — there are no foreign keys.
//     Every object is strict, so any extra key fails validation.
//   - `ui_intent` records only capability-specific presentation choices: item direction,
//     the closed collection layout (`feed | grid`), one closed input mode for every active
//     `string[]`, and one closed presentation for every active `choice`. It never stores
//     `views` or how a record opens — the view swap into the window is the platform's.
//     `tools` is the fixed five-Action tuple;
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
import {
  behavioralErrorCaseSchema,
  MAX_BEHAVIORAL_ERRORS,
  validateActionShapePair,
  validateBehavioralErrors,
} from "../fields/behavioral-errors.ts";
import {
  type ChoiceOption,
  choiceGroupSchema,
  choiceInputIntentSchema,
  choiceOptionSchema,
  promptChoiceOptionSchema,
  validateChoiceFields,
  validateChoiceInputs,
} from "../fields/choice.ts";
import {
  fieldGuidanceSchema,
  longTextIntentSchema,
  validateFieldGuidance,
  validateLongTextInputs,
} from "../fields/form-intent.ts";
import { maxLengthSchema, validateMaxLength } from "../fields/max-length.ts";
import { incarnationIdSchema } from "../identifiers.ts";
import { isCapabilityNameLabel } from "../labels.ts";
import { capabilityLogoStateSchema, logoHueFamilySchema, logoSeedSchema } from "../logo.ts";
import { capabilityToolsSchema, readDependenciesSchema } from "../tools.ts";
import {
  allUnique,
  nonBlankText,
  SQL_NAME_MESSAGE,
  SQL_NAME_PATTERN,
  sameOrderedStrings,
  singleLinePhrase,
  sqlNameText,
} from "./spec-text.ts";

/**
 * Columns every capability data table gets from the platform, never from the
 * spec: `id` (PK), `created_at` (uniform — pre-pays M5's
 * NL→SQL catalog), `extra` (the JSON escape-hatch column, present from birth).
 * Exported for the 2.2 spec→DDL mapper, which emits them on every table.
 */
export const PLATFORM_COLUMNS = ["id", "created_at", "extra"] as const;

export {
  BEHAVIORAL_ERROR_MARKERS,
  type BehavioralErrorCase,
  type BehavioralErrorMarkers,
  behavioralErrorCaseSchema,
  behavioralErrorMarkersSchema,
  defaultBehavioralErrorsForSchema,
  MAX_BEHAVIORAL_ERRORS,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../fields/behavioral-errors.ts";
export {
  admittedChoiceValues,
  CHOICE_DISABLED_ERROR_CODE,
  CHOICE_FIELD_TYPE,
  CHOICE_PRESENTATIONS,
  type ChoiceFieldType,
  type ChoiceGroup,
  type ChoiceInputIntent,
  type ChoiceOption,
  type ChoiceOptionRun,
  type ChoicePresentation,
  choiceFieldGroups,
  choiceFieldOptions,
  choiceGroupSchema,
  choiceInputIntentSchema,
  choiceOptionRuns,
  choiceOptionSchema,
  choicePresentationSchema,
  INVALID_CHOICE_ERROR_CODE,
  isChoiceFieldType,
  MAX_CHOICE_GROUP_HEADING_LENGTH,
  MAX_CHOICE_GROUPS,
  MAX_CHOICE_OPTION_LABEL_LENGTH,
  MAX_CHOICE_OPTION_NOTE_LENGTH,
  MAX_CHOICE_OPTION_VALUE_LENGTH,
  MAX_CHOICE_OPTIONS,
  selectableChoiceValues,
} from "../fields/choice.ts";
export {
  type FieldGuidance,
  fieldGuidanceSchema,
  fieldGuidanceText,
  isLongTextField,
  longTextIntentSchema,
  MAX_FIELD_GUIDANCE_LENGTH,
} from "../fields/form-intent.ts";
export {
  MAX_DECLARED_MAX_LENGTH,
  MAX_LENGTH_EXCEEDED_ERROR_CODE,
  MIN_DECLARED_MAX_LENGTH,
  maxLengthSchema,
  maxLengthsByField,
} from "../fields/max-length.ts";
export { incarnationIdSchema } from "../identifiers.ts";
export {
  type CapabilityTool,
  capabilityToolSchema,
  FULL_CAPABILITY_TOOLS,
  type ReadDependencies,
  type ReadDependency,
  readDependenciesSchema,
  readDependencySchema,
} from "../tools.ts";
export { SQL_NAME_PATTERN } from "./spec-text.ts";

export const ALUNA_RESERVED_FIELD_PREFIX = "__aluna_";

const capabilityNameText = nonBlankText.refine(
  isCapabilityNameLabel,
  "must be a short capability name, not a sentence",
);

export const MAX_LOGO_SUBJECT_LENGTH = 80;
export const MAX_CAPABILITY_NOUN_LENGTH = 32;

/** The subject phrase alone — the registry re-validates it when a claim hands it out. */
export const logoSubjectSchema = singleLinePhrase(MAX_LOGO_SUBJECT_LENGTH);

export const SCALAR_FIELD_TYPES = [
  "string",
  "number",
  "boolean",
  "datetime",
  "date",
  "choice",
] as const;
export const LIST_FIELD_TYPES = ["string[]"] as const;

/**
 * The closed field pantry. A new scalar type extends SCALAR_FIELD_TYPES and a new list
 * type extends LIST_FIELD_TYPES first, which makes every exhaustive FieldType consumer
 * fail type-check until it handles the new storage, Gate, and presentation behavior.
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
 * One user field: name, type, required, plus the two collections only a choice field
 * carries. Strictness is what rejects ARCH §6.3's `auto` example key, per the PLAN's
 * recorded deviation.
 *
 * `values` and `groups` are absent on every non-choice field and present on every choice
 * field; `validateChoiceFields` enforces both directions. `max_length` is the third
 * optional key, and unlike those two it is optional in both directions: a scalar `string`
 * may or may not declare a limit, and every other type is refused one
 * (`validateMaxLength`). A provider's strict structured-output schema cannot express an
 * absent key, so the wire shape ({@link promptCapabilitySpecSchema}) spells absence `null`
 * and normalizes it away on the way in — the shape stored, diffed and rendered is this one.
 */
const specFieldShape = {
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
};

export const specFieldSchema = z.strictObject({
  ...specFieldShape,
  values: z.array(choiceOptionSchema).optional(),
  groups: z.array(choiceGroupSchema).optional(),
  max_length: maxLengthSchema.optional(),
});
export type SpecField = z.infer<typeof specFieldSchema>;

/** The `schema` key of a spec, over whichever spelling of the field shape is in play. */
/**
 * The most fields one capability may declare.
 *
 * Nothing bounded this, and everything downstream is linear or worse in it: the DDL, the
 * form the platform draws, every probe the design-lint rung renders, the behavioral suite,
 * and the per-(row × term × field) work a search does. A model that authored a hundred
 * fields would author a build nobody could afford and a form nobody could fill.
 *
 * Well above anything a real capability needs — the largest the gallery, the fixtures and
 * the live builds have produced is a handful — and well below where the cost stops being
 * linear in anything that matters.
 */
export const MAX_SPEC_FIELDS = 40;

function specSchemaShapeOf(fieldSchema: z.ZodType<SpecField, unknown>) {
  return z.strictObject({
    fields: z
      .array(fieldSchema)
      .min(1)
      .max(MAX_SPEC_FIELDS)
      .refine(
        (fields) => allUnique(fields.map((field) => field.name)),
        "field names must be unique",
      ),
  });
}

export const CREATED_AT_DESCRIPTOR = {
  name: "created_at",
  label: "Created",
  type: "datetime",
  readOnly: true,
} as const;

/**
 * One option as the item renderer needs it, and no more: the value a row stores and the
 * wording to show for it. The group it stands under, the note beside it and whether it is
 * still on offer are all form facts — the card presents one record's own value, never the
 * list it came from — so they stay out of the renderer's generation context. What is not
 * in the context cannot go stale in a copied unit, which is what lets the Diff matrix map
 * those three facts to platform work alone.
 */
export interface PresentationChoiceOption {
  readonly value: string;
  readonly label: string;
}

export type PresentationFieldDescriptor =
  | (Pick<SpecField, "name" | "label" | "type"> & {
      readonly values?: readonly PresentationChoiceOption[];
    })
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
  field: sqlNameText,
  mode: listInputModeSchema,
});
export type ListInputIntent = z.infer<typeof listInputIntentSchema>;

/**
 * The form's declared presentation.
 *
 * The four collections split into two kinds. `list_inputs` and `choice_inputs` are
 * **total** over their field type — every active `string[]` has a mode and every active
 * choice has a presentation, because neither can be drawn at all without one.
 * `long_text` and `guidance` are **subsets**: a string field renders perfectly well as a
 * single-line input and a field is complete without a hint, so naming one is opting it in.
 * Both kinds are ordered by schema-field order, and both refuse an unknown, inactive,
 * duplicate or wrong-type entry.
 *
 * `long_text` is a bare name list because there is nothing else to say: a field either
 * gets the multi-line control or it does not. Which of the two a string field wants is not
 * something its type can decide — a title and three paragraphs of notes are both a
 * `string` — so it is a presentation choice and belongs here, beside `collection.layout`
 * and `item.shows`, rather than in the schema (`design/controls.html`, "What decides
 * between an input and a textarea").
 */
export const uiFormIntentSchema = z.strictObject({
  list_inputs: z.array(listInputIntentSchema),
  choice_inputs: z.array(choiceInputIntentSchema),
  long_text: longTextIntentSchema,
  guidance: fieldGuidanceSchema.array(),
});
export type UiFormIntent = z.infer<typeof uiFormIntentSchema>;

/** The canonical empty value of every form-intent collection this Module added. */
const EMPTY_FORM_INTENT_COLLECTIONS = ["choice_inputs", "long_text", "guidance"] as const;

export const uiIntentSchema = z.strictObject({
  form: uiFormIntentSchema,
  item: z.strictObject({
    direction: nonBlankText,
    shows: z.array(sqlNameText).min(1).refine(allUnique, "item fields must be unique"),
  }),
  collection: z.strictObject({
    layout: uiCollectionLayoutSchema,
  }),
});
export type UiIntent = z.infer<typeof uiIntentSchema>;

// The spec proper — everything the AI authors (ARCH §2: schema + ui_intent +
// behavior, plus the identity and resolver context the registry row carries,
// §6.3). `version` and `artifacts_path` are deliberately absent: the platform
// assigns those at commit, the AI never does.
const commonSpecShape = {
  // Engineering identity — becomes the `cap_<id>` table name and the artifacts
  // directory; never user-facing (CONTEXT.md "Engineering language").
  id: sqlNameText,
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
  schema: specSchemaShapeOf(specFieldSchema),
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
 * The provider wire shape — the only schema handed to `provider.generate`, and the only
 * place the spec is written any way but the one `capabilitySpecSchema` defines.
 *
 * It is not looser. Every rule is the same one, run by the same `validateSpecSemantics`;
 * the single difference is how a choice field's absent collections are spelled. A strict
 * structured-output schema (OpenAI's, and any provider that mirrors it) requires every
 * declared property to be required, so "this field carries no options" has to arrive as
 * an explicit `null` rather than a missing key. The transform drops those nulls, so what
 * comes back out is the domain spec exactly — nothing downstream ever sees the wire
 * spelling, and a spec already in hand is validated with `capabilitySpecSchema`.
 */
const promptSpecFieldSchema = z
  .strictObject({
    ...specFieldShape,
    values: z.array(promptChoiceOptionSchema).nullable(),
    groups: z.array(choiceGroupSchema).nullable(),
    max_length: maxLengthSchema.nullable(),
  })
  .transform(
    ({ values, groups, max_length, ...field }): SpecField => ({
      ...field,
      ...(values === null ? {} : { values }),
      ...(groups === null ? {} : { groups }),
      ...(max_length === null ? {} : { max_length }),
    }),
  );

export const promptCapabilitySpecSchema = z
  .strictObject({
    ...commonSpecShape,
    label: capabilityNameText,
    schema: specSchemaShapeOf(promptSpecFieldSchema),
  })
  .superRefine(validateSpecSemantics);

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
    // What the user renamed this capability to, and `null` while they have not. Row-only
    // for the same reason the logo lifecycle is: a write shape that could carry it is a
    // write that could wipe a rename, and an evolution builds its write from a row read
    // seconds earlier. Only `renameCapability` in `store.ts` moves this value.
    display_label_override: z.string().nullable(),
  })
  .superRefine(validateSpecSemantics);
export type CapabilityRow = z.infer<typeof capabilityRowSchema>;

/**
 * Fill this Module's newly added form-intent collections on a value read back from durable
 * storage. A registry row or a published `spec.json` written before the choice cut carries
 * no `choice_inputs`, and no reset is available this late in the module — logo credits and
 * user records already exist. Absence is canonically the empty collection, so an older
 * shape parses without rewriting an immutable historical snapshot or manufacturing a
 * version, and absence therefore compares equal to explicit empty wherever the Diff and
 * canonical equality look.
 *
 * A pre-choice field needs nothing: `values` and `groups` are absent on a non-choice field
 * by contract, which is exactly how history already stored it.
 *
 * Only the storage read boundaries call this. Anything the model authors goes to the
 * strict schema unchanged, so a generated spec that omitted a collection still fails.
 */
export function canonicalizeStoredCapabilityShape(value: unknown): unknown {
  if (!isPlainRecord(value)) return value;
  const canonical: Record<string, unknown> = { ...value };

  const uiIntent = canonical.ui_intent;
  if (isPlainRecord(uiIntent) && isPlainRecord(uiIntent.form)) {
    const form: Record<string, unknown> = { ...uiIntent.form };
    for (const collection of EMPTY_FORM_INTENT_COLLECTIONS) {
      form[collection] ??= [];
    }
    canonical.ui_intent = { ...uiIntent, form };
  }

  return canonical;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
  validateLongTextInputs(spec, ctx);
  validateFieldGuidance(spec, ctx);
  validateChoiceFields(spec, ctx);
  validateChoiceInputs(spec, ctx);
  validateMaxLength(spec, ctx);
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
  validateItemShows(spec.ui_intent.item.shows, fieldsByName, ctx);
}

function validateItemShows(
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
      message: `item field "${fieldName}" must be an active schema field or created_at`,
      path: ["ui_intent", "item", "shows", index],
    });
  }
}
export function activeSpecFields(fields: readonly SpecField[]): readonly SpecField[] {
  return fields.filter((field) => field.lifecycle === "active");
}

function itemRendererOptions(values: readonly ChoiceOption[]): readonly PresentationChoiceOption[] {
  return values
    .map(({ value, label }) => ({ value, label }))
    .sort((left, right) => (left.value < right.value ? -1 : 1));
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
    // A choice brings its options so the item renderer can present the label a person
    // reads rather than the wire value the row stores. Without them a status card says
    // "in_progress", which is the whole point of the value/label split defeated. It brings
    // nothing else, and it brings them in value order rather than authored order, so that
    // reordering, noting, grouping or retiring an option leaves this byte-identical — see
    // {@link PresentationChoiceOption}.
    return {
      name: field.name,
      label: field.label,
      type: field.type,
      ...(field.values === undefined ? {} : { values: itemRendererOptions(field.values) }),
    };
  });
}
