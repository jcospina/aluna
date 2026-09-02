// The choice field type: the one entry in the field pantry that carries data of its own.
//
// A choice stores a single stable string drawn from the ordered options its field
// declares. Values are the wire values — immutable for the life of the capability, and
// append-only through evolution, so a committed row can never end up holding data the
// spec no longer admits. Everything else an option carries is presentation: its label,
// the group it sits under, the note beside it, and whether it may still be chosen.
//
// Everything here is authored by the model and gated before anything downstream sees it:
// the DDL mapper, the form renderer, mutation validation and the Diff matrix all read a
// choice field that has already been proved well-formed.

import { z } from "zod";

import type { CapabilitySpec, SpecField } from "../spec/spec.ts";
import { sameOrderedStrings, singleLinePhrase, sqlNameText } from "../spec/spec-text.ts";

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
 * The refusal a *newly chosen* disabled option earns. Separate from `invalid_choice`
 * because the value is declared and the row that already holds it stays valid — what is
 * refused is arriving at it, not carrying it.
 */
export const CHOICE_DISABLED_ERROR_CODE = "choice_disabled";

/** A group heading and an option note are both one short line beside a row. */
export const MAX_CHOICE_GROUP_HEADING_LENGTH = 32;
export const MAX_CHOICE_OPTION_NOTE_LENGTH = 48;

/**
 * An option's label is the wording on one row of a control. It is bounded and single-line
 * for the same reason its note is: a row is a row. Left as bare non-blank text it admitted
 * a newline and any length at all, and a control drew whatever arrived.
 */
export const MAX_CHOICE_OPTION_LABEL_LENGTH = 64;

/**
 * A wire value is bounded for the same reason a label is, and for two more: it is written
 * into an HTML attribute on every row of every control, and it is serialized into the item
 * renderer's and both writing Handlers' generation prompts.
 */
export const MAX_CHOICE_OPTION_VALUE_LENGTH = 48;

/**
 * How many options and groups one field may declare. Not a rendering limit — the picker
 * scrolls — but a generation one: every option is serialized into the item renderer's and
 * both writing Handlers' prompts, so an unbounded collection is an unbounded prompt.
 */
export const MAX_CHOICE_OPTIONS = 64;
export const MAX_CHOICE_GROUPS = 16;

/**
 * A wire value is a stored string that also joins the Diff's own NUL-delimited keys and
 * lands in an HTML attribute, so it holds no control characters at all. The same rule
 * covers every authored string an option carries: nothing on one row of a control has a
 * use for one, and admitting them makes every downstream separator depend on an unstated
 * invariant.
 */
const printableText = (text: string) => !/\p{Cc}/u.test(text);
const PRINTABLE_MESSAGE = "must not contain control characters";
const printablePhrase = (max: number) =>
  singleLinePhrase(max).refine(printableText, PRINTABLE_MESSAGE);

/**
 * One declared option.
 *
 * `value` and `label` are the pair every option carries. The three optional keys are the
 * picker's own feature set: `group` names a group this field declares, `note` is the
 * short phrase that rides the row, and `disabled` says the option is present but may not
 * be newly chosen.
 *
 * `disabled` is `true` or absent rather than a boolean, so an enabled option has exactly
 * one spelling. Two specs that differ only in `disabled: false` versus no key at all
 * would otherwise compare unequal and manufacture an evolution fact for a change nobody
 * made.
 */
export const choiceOptionSchema = z.strictObject({
  value: printablePhrase(MAX_CHOICE_OPTION_VALUE_LENGTH),
  label: printablePhrase(MAX_CHOICE_OPTION_LABEL_LENGTH),
  group: sqlNameText.optional(),
  note: printablePhrase(MAX_CHOICE_OPTION_NOTE_LENGTH).optional(),
  disabled: z.literal(true).optional(),
});
export type ChoiceOption = z.infer<typeof choiceOptionSchema>;

/**
 * The provider spelling of an option. A strict structured-output schema cannot express an
 * absent key, so every optional key is declared required-nullable and transformed back to
 * absence on the way in. `disabled: false` lands as absence for the same reason the domain
 * shape refuses it: an enabled option has one representation.
 */
export const promptChoiceOptionSchema = z
  .strictObject({
    value: printablePhrase(MAX_CHOICE_OPTION_VALUE_LENGTH),
    label: printablePhrase(MAX_CHOICE_OPTION_LABEL_LENGTH),
    group: sqlNameText.nullable(),
    note: printablePhrase(MAX_CHOICE_OPTION_NOTE_LENGTH).nullable(),
    disabled: z.boolean().nullable(),
  })
  .transform(
    ({ group, note, disabled, ...option }): ChoiceOption => ({
      ...option,
      ...(group === null ? {} : { group }),
      ...(note === null ? {} : { note }),
      ...(disabled === true ? { disabled: true } : {}),
    }),
  );

/**
 * One declared option group. The collection is ordered, and that order is the order the
 * headings appear in; an option names a group by id, and the id never changes once
 * committed while the heading is wording and evolves freely.
 */
export const choiceGroupSchema = z.strictObject({
  id: sqlNameText,
  heading: printablePhrase(MAX_CHOICE_GROUP_HEADING_LENGTH),
});
export type ChoiceGroup = z.infer<typeof choiceGroupSchema>;

/**
 * The closed set of controls a choice field may render as. All three draw the same
 * declared values and store the same string; which one a field uses is authored per field
 * rather than inferred from how many options it happens to have. An unknown one fails the
 * build closed exactly as an unknown field type does.
 */
export const CHOICE_PRESENTATIONS = ["picker", "radio", "segmented"] as const;
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

/** The declared groups of one choice field, in the order their headings appear. */
export function choiceFieldGroups(
  field: Pick<SpecField, "name" | "type" | "groups">,
): readonly ChoiceGroup[] {
  if (!isChoiceFieldType(field.type) || field.groups === undefined) {
    throw new Error(`Field "${field.name}" is not a choice field carrying declared groups.`);
  }
  return field.groups;
}

/** The wire values one choice field admits, for platform mutation validation. */
export function admittedChoiceValues(
  field: Pick<SpecField, "name" | "type" | "values">,
): ReadonlySet<string> {
  return new Set(choiceFieldOptions(field).map((option) => option.value));
}

/**
 * The wire values a *new* selection may name. A disabled option stays admitted — a row
 * already holding it is still valid data — but it can no longer be arrived at.
 */
export function selectableChoiceValues(
  field: Pick<SpecField, "name" | "type" | "values">,
): ReadonlySet<string> {
  return new Set(
    choiceFieldOptions(field)
      .filter((option) => option.disabled !== true)
      .map((option) => option.value),
  );
}

/** One run of options under one heading, or the leading run that sits under none. */
export interface ChoiceOptionRun {
  readonly group: ChoiceGroup | undefined;
  readonly options: readonly ChoiceOption[];
}

/**
 * The options of one choice field in the order a control draws them: the ungrouped ones
 * first, then each declared group in the order the field declares it, each group's own
 * options in authored order.
 *
 * Grouping is what decides the visual order, not the options array — otherwise an option
 * authored between two groups would force its heading to appear twice.
 *
 * Every option comes out exactly once. An option naming a group its field never declared
 * would otherwise fall out of every run and vanish from the control, so it fails loudly
 * here the way {@link choiceFieldOptions} does: the spec gate refuses that spec, and a
 * field reaching a renderer without having passed it is a bypass, not a rendering problem.
 */
export function choiceOptionRuns(
  field: Pick<SpecField, "name" | "type" | "values" | "groups">,
): readonly ChoiceOptionRun[] {
  const options = choiceFieldOptions(field);
  const declared = new Set(choiceFieldGroups(field).map((group) => group.id));
  for (const option of options) {
    if (option.group === undefined || declared.has(option.group)) continue;
    throw new Error(
      `Field "${field.name}" option "${option.value}" names undeclared group "${option.group}".`,
    );
  }

  const ungrouped = options.filter((option) => option.group === undefined);
  const runs: ChoiceOptionRun[] =
    ungrouped.length > 0 ? [{ group: undefined, options: ungrouped }] : [];

  for (const group of choiceFieldGroups(field)) {
    runs.push({ group, options: options.filter((option) => option.group === group.id) });
  }
  return runs;
}

/**
 * The choice field's own fail-closed rules, in both directions. A non-choice field that
 * carried options would be declaring a vocabulary nothing enforces; a choice field
 * without them would be a text input with a picker painted on it. Blank values, blank
 * labels, over-long notes and over-long headings are already refused per option and per
 * group — what only the whole field can see is that its values are unique, that it has
 * any at all, and that its groups and its options agree about which groups exist.
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
  } else if (field.values.length > MAX_CHOICE_OPTIONS) {
    addFieldIssue(
      ctx,
      index,
      "values",
      `a choice field declares at most ${MAX_CHOICE_OPTIONS} options`,
    );
  } else {
    validateUniqueOptionValues(ctx, index, field.values);
    validateSomethingRemainsChoosable(ctx, index, field.values);
  }

  if (field.groups === undefined) {
    addFieldIssue(ctx, index, "groups", "a choice field must declare its groups collection");
  } else if (field.groups.length > MAX_CHOICE_GROUPS) {
    addFieldIssue(
      ctx,
      index,
      "groups",
      `a choice field declares at most ${MAX_CHOICE_GROUPS} groups`,
    );
  } else {
    validateOptionGroups(ctx, index, field.groups, field.values ?? []);
  }
}

/**
 * Groups and the options that name them, checked against each other in both directions. A
 * group nothing names is a heading with nothing under it, which renders as nothing at all
 * — admitting it would let a stored spec claim structure no surface shows.
 */
function validateOptionGroups(
  ctx: z.RefinementCtx,
  fieldIndex: number,
  groups: readonly ChoiceGroup[],
  options: readonly ChoiceOption[],
): void {
  const declared = declaredGroupIds(ctx, fieldIndex, groups);
  const named = validateOptionGroupReferences(ctx, fieldIndex, declared, options);

  for (const [index, group] of groups.entries()) {
    if (named.has(group.id)) continue;
    ctx.addIssue({
      code: "custom",
      message: `option group "${group.id}" is declared but no option names it`,
      path: ["schema", "fields", fieldIndex, "groups", index, "id"],
    });
  }
}

/** The group ids this field declares, refusing a second declaration of one. */
function declaredGroupIds(
  ctx: z.RefinementCtx,
  fieldIndex: number,
  groups: readonly ChoiceGroup[],
): ReadonlySet<string> {
  const declared = new Set<string>();
  for (const [index, group] of groups.entries()) {
    if (declared.has(group.id)) {
      ctx.addIssue({
        code: "custom",
        message: `option group "${group.id}" is declared more than once`,
        path: ["schema", "fields", fieldIndex, "groups", index, "id"],
      });
    }
    declared.add(group.id);
  }
  return declared;
}

/** The group ids the options actually name, refusing any the field never declared. */
function validateOptionGroupReferences(
  ctx: z.RefinementCtx,
  fieldIndex: number,
  declared: ReadonlySet<string>,
  options: readonly ChoiceOption[],
): ReadonlySet<string> {
  const named = new Set<string>();
  for (const [index, option] of options.entries()) {
    if (option.group === undefined) continue;
    named.add(option.group);
    if (declared.has(option.group)) continue;
    ctx.addIssue({
      code: "custom",
      message: `option group "${option.group}" is not declared by this field`,
      path: ["schema", "fields", fieldIndex, "values", index, "group"],
    });
  }
  return named;
}

/**
 * A choice must always leave something to choose. Disabling every option would make a
 * required field impossible to fill and an optional one a control with nothing live in it
 * — and it would leave the platform's own fixtures, which write a real admitted value,
 * with nothing to write. Retiring options is how a set is narrowed; emptying it is not.
 */
function validateSomethingRemainsChoosable(
  ctx: z.RefinementCtx,
  fieldIndex: number,
  options: readonly ChoiceOption[],
): void {
  if (options.some((option) => option.disabled !== true)) return;
  ctx.addIssue({
    code: "custom",
    message: "a choice field must leave at least one option choosable",
    path: ["schema", "fields", fieldIndex, "values"],
  });
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
 *
 * It is also where the one rule that spans both halves of the spec lives: a segmented
 * control is a joined row of buttons with no room for a heading between them or a second
 * line inside one, so it admits neither groups nor notes. Refusing here is the same
 * fail-closed instinct as an unknown presentation — the alternative is a spec that
 * declares structure the control it asked for can never show.
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
  } else {
    validateSegmentedCapacity(ctx, index, entry, field);
  }

  if (actualFields.indexOf(entry.field) !== index) {
    addChoiceInputIssue(ctx, index, `field "${entry.field}" appears more than once`);
  }
}

function validateSegmentedCapacity(
  ctx: z.RefinementCtx,
  index: number,
  entry: ChoiceInputIntent,
  field: SpecField,
): void {
  if (entry.presentation !== "segmented") return;
  if ((field.groups ?? []).length > 0) {
    addChoiceInputIssue(
      ctx,
      index,
      `field "${entry.field}" groups its options, which a segmented control cannot show; ` +
        "use the picker or the radio group",
    );
  }
  if ((field.values ?? []).some((option) => option.note !== undefined)) {
    addChoiceInputIssue(
      ctx,
      index,
      `field "${entry.field}" notes an option, which a segmented control cannot show; ` +
        "use the picker or the radio group",
    );
  }
}

function addChoiceInputIssue(ctx: z.RefinementCtx, index: number, message: string): void {
  ctx.addIssue({
    code: "custom",
    message,
    path: ["ui_intent", "form", "choice_inputs", index, "field"],
  });
}
