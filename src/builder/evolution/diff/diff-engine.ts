// The Diff Engine (ADR-0006): every admitted committed→candidate difference becomes a typed
// change fact, and the union of those facts projects onto platform work, unit selection,
// behavioral-test effect, and Gate work. A new spec fact means extending the normative
// change-fact matrix and this module together.
//
// Three invariants hold the contract. The union is monotone — facts only add work, so a unit is
// copied only when no fact selects it. It fails closed: once every fact-covered region is
// accounted for, the residual of the two canonical specs must be identical, and any leftover
// difference throws {@link UnmappedChangeFactError} before publication rather than becoming a
// silent no-op or an unproven copy. Equality is canonical — key order is ignored, set-like facts
// use a defined order, and ordered product facts preserve order and therefore diff.

import { compareStrings } from "../../../platform/canonical-json.ts";
import {
  type CapabilitySpec,
  type CapabilityTool,
  type FieldType,
  FULL_CAPABILITY_TOOLS,
  isChoiceFieldType,
  isListFieldType,
  isSearchableTextType,
  type SpecField,
  sameOrderedStrings,
} from "../../../registry/index.ts";
import { canonicalCapabilityLabel } from "../../../registry/labels.ts";
import { handlersWithMovedFileContract } from "../../generated-code-check.ts";
import { detectChoiceFacts } from "./diff-choice.ts";
import { detectFormIntentFacts } from "./diff-form-intent.ts";
import { assertTotalCoverage } from "./diff-totality.ts";

export { UnmappedChangeFactError } from "./diff-totality.ts";

// ── The typed change facts ──────────────────────────────────────────────────
// One variant per matrix row that makes a fact; the no-op, invalid and unmapped rows make none.

export type ChangeFact =
  | { readonly kind: "capability_label" }
  | { readonly kind: "capability_nouns" }
  | { readonly kind: "prompt_context" }
  | { readonly kind: "field_order" }
  | { readonly kind: "new_active_field"; readonly field: string; readonly fieldType: FieldType }
  | { readonly kind: "required_change"; readonly field: string }
  | { readonly kind: "max_length"; readonly field: string }
  | { readonly kind: "field_label"; readonly field: string }
  | {
      readonly kind: "field_lifecycle";
      readonly field: string;
      readonly transition: "hide" | "reactivate";
    }
  | { readonly kind: "list_input_mode"; readonly field: string }
  | { readonly kind: "long_text_input"; readonly field: string }
  | { readonly kind: "field_guidance"; readonly field: string }
  | { readonly kind: "choice_values"; readonly field: string }
  | { readonly kind: "choice_option_disabled"; readonly field: string }
  | { readonly kind: "choice_option_labels"; readonly field: string }
  | { readonly kind: "choice_option_notes"; readonly field: string }
  | { readonly kind: "choice_option_order"; readonly field: string }
  | { readonly kind: "choice_option_groups"; readonly field: string }
  | { readonly kind: "choice_presentation"; readonly field: string }
  | { readonly kind: "item_presentation" }
  | { readonly kind: "collection_layout" }
  | { readonly kind: "read_dependencies"; readonly action: CapabilityTool }
  | { readonly kind: "behavior" }
  | { readonly kind: "behavioral_errors"; readonly actions: readonly CapabilityTool[] };

export type ChangeFactKind = ChangeFact["kind"];

// The order the result and dev preview present: schema identity, platform presentation, then
// behavior. Deterministic, so two runs over the same difference emit byte-identical facts.
const FACT_KIND_ORDER: readonly ChangeFactKind[] = [
  "capability_label",
  "capability_nouns",
  "prompt_context",
  "field_order",
  "new_active_field",
  "required_change",
  "max_length",
  "field_label",
  "field_lifecycle",
  "list_input_mode",
  "long_text_input",
  "field_guidance",
  "choice_values",
  "choice_option_disabled",
  "choice_option_labels",
  "choice_option_notes",
  "choice_option_order",
  "choice_option_groups",
  "choice_presentation",
  "item_presentation",
  "collection_layout",
  "read_dependencies",
  "behavior",
  "behavioral_errors",
];

// ── The work plan the matrix projects ───────────────────────────────────────

/**
 * The six generated units the diff selects between: the five Action handlers and
 * the item renderer. Every unit not selected is copied byte-for-byte.
 */
export const GENERATED_UNITS = [...FULL_CAPABILITY_TOOLS, "item"] as const;
export type GeneratedUnitName = (typeof GENERATED_UNITS)[number];

/**
 * The closed vocabulary of platform work the matrix's first column names — one tag per cell,
 * no generated units and no model context. Extending the matrix extends this list.
 */
export const PLATFORM_WORK_KINDS = [
  "registry_and_view_copy", // capability label → registry row + logo/View copy
  "platform_noun_copy", // noun or plural → the platform collection's empty state and count
  "resolver_catalog", // prompt_context → intent-resolver catalog
  "platform_field_order", // field order → platform form order + list-input entry order
  "add_column", // new active field → nullable ADD COLUMN
  "platform_form_detail", // new/label/lifecycle field → platform form + detail View
  "resulting_record_validation", // required change → resulting-record validation
  "max_length_validation", // max_length → mutation validation + the native limit and counter
  "list_input_intent", // hide/reactivate → remove/require active list-input intent
  "form_subset_intent", // hide/reactivate → remove/require a long_text or guidance entry
  "list_input_form_normalization", // list input mode → create/edit form + raw-input normalization
  "long_text_form_control", // long_text → which control a string field's form draws
  "field_guidance_copy", // guidance → the line under a field, and its describedby wiring
  "choice_admitted_values", // appended option → platform mutation validation + the control
  "choice_option_presentation", // option label/note/order → the control's wording and its order
  "choice_option_grouping", // option groups → the control's headings and the runs under them
  "choice_input_form_control", // choice presentation → which of the three controls is drawn
  "choice_input_intent", // hide/reactivate a choice → remove/require its form intent
  "platform_list_container", // collection feed|grid → platform list container
  "read_catalog", // read_dependencies → read catalog / reverse index
  "behavioral_error_contract", // behavioral_errors → stable semantic contract
] as const;
export type PlatformWorkKind = (typeof PLATFORM_WORK_KINDS)[number];

/** The behavioral-tier effect the diff projects; meaningful only when the tier is on. */
export interface BehavioralTestPlan {
  /** The Action test suites to generate/run (decision 23 narrows execution later). */
  readonly actions: readonly CapabilityTool[];
  /** Free-text `behavior` selects the complete candidate suite, not named Actions. */
  readonly fullSuite: boolean;
}

/** Gate work the matrix footer fixes for any real build (an empty-fact no-op runs no Gate). */
export interface DiffGatePlan {
  /** Structural/interface validation runs against every candidate snapshot. */
  readonly structural: boolean;
  /** The full-CRUD/search smoke runs against every candidate snapshot. */
  readonly smoke: boolean;
  /** Design lint runs whenever the item renderer regenerates. */
  readonly designLint: boolean;
  /** The behavioral tier follows the projected test plan. */
  readonly behavioral: BehavioralTestPlan;
}

/** The unioned downstream work a set of change facts requires. */
export interface DiffWorkPlan {
  readonly platformWork: readonly PlatformWorkKind[];
  readonly regeneratedUnits: readonly GeneratedUnitName[];
  readonly gate: DiffGatePlan;
}

/** The Diff Engine's output: the typed facts, their unioned work, and the no-op flag. */
export interface CapabilityDiff {
  readonly facts: readonly ChangeFact[];
  readonly workPlan: DiffWorkPlan;
  /** True exactly when `facts` is empty — the canonical no-op. */
  readonly isNoop: boolean;
}

/**
 * Diff a committed spec against a validated candidate; an unexplained difference throws
 * {@link UnmappedChangeFactError}. Both inputs are already valid, so nothing is re-checked.
 */
export function diffCapabilitySpec(
  committed: CapabilitySpec,
  candidate: CapabilitySpec,
): CapabilityDiff {
  const facts = detectFacts(committed, candidate);
  assertTotalCoverage(committed, candidate);
  const workPlan = projectWorkPlan(facts, committed, candidate);
  return { facts, workPlan, isNoop: facts.length === 0 };
}

// ── Fact detection ──────────────────────────────────────────────────────────

function detectFacts(committed: CapabilitySpec, candidate: CapabilitySpec): readonly ChangeFact[] {
  const facts: ChangeFact[] = [];

  // Authored labels, canonicalized. The override a rename writes stays out: it makes no
  // version and reaches no candidate, so a diff stays over what the model wrote.
  const authored = (spec: CapabilitySpec) => ({ ...spec, display_label_override: null });
  if (
    canonicalCapabilityLabel(authored(committed)) !== canonicalCapabilityLabel(authored(candidate))
  ) {
    facts.push({ kind: "capability_label" });
  }
  // `noun` and `plural_noun` move platform copy only. `subject`, `ground` and `companion` are birth
  // facts: validation rejects a candidate that moved one, and the residual check catches it.
  if (committed.noun !== candidate.noun || committed.plural_noun !== candidate.plural_noun) {
    facts.push({ kind: "capability_nouns" });
  }
  if (committed.prompt_context !== candidate.prompt_context) {
    facts.push({ kind: "prompt_context" });
  }

  detectSchemaFacts(committed, candidate, facts);
  detectListInputModeFacts(committed, candidate, facts);
  detectFormIntentFacts(committed, candidate, facts);
  detectChoiceFacts(committed, candidate, facts);
  detectPresentationFacts(committed, candidate, facts);
  detectReadDependencyFacts(committed, candidate, facts);

  if (committed.behavior !== candidate.behavior) {
    facts.push({ kind: "behavior" });
  }
  const behavioralErrorActions = changedBehavioralErrorActions(committed, candidate);
  if (behavioralErrorActions.length > 0) {
    facts.push({ kind: "behavioral_errors", actions: behavioralErrorActions });
  }

  return sortFacts(facts);
}

// schema.fields is the busiest region. Name and type are immutable (validated upstream), so
// they never diff here — they anchor the residual totality check instead.
function detectSchemaFacts(
  committed: CapabilitySpec,
  candidate: CapabilitySpec,
  facts: ChangeFact[],
): void {
  const committedNames = new Set(committed.schema.fields.map((field) => field.name));
  const committedByName = new Map(committed.schema.fields.map((field) => [field.name, field]));

  // Field order only: the relative order of the fields present in both. A new
  // field inserted between existing fields is a new_active_field fact, not a reorder.
  const committedOrder = committed.schema.fields.map((field) => field.name);
  const candidateCommittedOrder = candidate.schema.fields
    .filter((field) => committedNames.has(field.name))
    .map((field) => field.name);
  if (!sameOrderedStrings(committedOrder, candidateCommittedOrder)) {
    facts.push({ kind: "field_order" });
  }

  for (const candidateField of candidate.schema.fields) {
    facts.push(...fieldFacts(committedByName.get(candidateField.name), candidateField));
  }
}

// One candidate field's facts: a new field, or the union of attribute changes over a
// returned committed field. Name and type never diff (validation), so they are absent.
function fieldFacts(
  committedField: SpecField | undefined,
  candidateField: SpecField,
): readonly ChangeFact[] {
  if (!committedField) {
    // Validation already proved a new field is born active.
    return [
      { kind: "new_active_field", field: candidateField.name, fieldType: candidateField.type },
    ];
  }
  const facts: ChangeFact[] = [];
  if (committedField.required !== candidateField.required) {
    facts.push({ kind: "required_change", field: candidateField.name });
  }
  // Absence and a number compare alike: adding a limit, removing one and moving one are
  // the same platform work, and the pre-activation scan reads the direction for itself.
  if (committedField.max_length !== candidateField.max_length) {
    facts.push({ kind: "max_length", field: candidateField.name });
  }
  if (committedField.label !== candidateField.label) {
    facts.push({ kind: "field_label", field: candidateField.name });
  }
  if (committedField.lifecycle !== candidateField.lifecycle) {
    facts.push({
      kind: "field_lifecycle",
      field: candidateField.name,
      transition: committedField.lifecycle === "active" ? "hide" : "reactivate",
    });
  }
  return facts;
}

// Only a field that is an active string[] in *both* specs makes this fact; one that gained
// or lost that status is already a new_active_field or field_lifecycle fact.
function detectListInputModeFacts(
  committed: CapabilitySpec,
  candidate: CapabilitySpec,
  facts: ChangeFact[],
): void {
  const committedModes = listInputModesByField(committed);
  const candidateModes = listInputModesByField(candidate);
  for (const [field, committedMode] of committedModes) {
    const candidateMode = candidateModes.get(field);
    if (candidateMode !== undefined && candidateMode !== committedMode) {
      facts.push({ kind: "list_input_mode", field });
    }
  }
}

function detectPresentationFacts(
  committed: CapabilitySpec,
  candidate: CapabilitySpec,
  facts: ChangeFact[],
): void {
  const committedItem = committed.ui_intent.item;
  const candidateItem = candidate.ui_intent.item;
  if (
    committedItem.direction !== candidateItem.direction ||
    !sameOrderedStrings(committedItem.shows, candidateItem.shows)
  ) {
    facts.push({ kind: "item_presentation" });
  }
  if (committed.ui_intent.collection.layout !== candidate.ui_intent.collection.layout) {
    facts.push({ kind: "collection_layout" });
  }
}

// One fact per Action whose declared dependency identities changed. The arrays are validated
// canonical-ordered but compare as sets, so a serialization reorder manufactures no fact.
function detectReadDependencyFacts(
  committed: CapabilitySpec,
  candidate: CapabilitySpec,
  facts: ChangeFact[],
): void {
  for (const action of FULL_CAPABILITY_TOOLS) {
    const before = canonicalDependencyKeys(committed.read_dependencies[action]);
    const after = canonicalDependencyKeys(candidate.read_dependencies[action]);
    if (!sameOrderedStrings(before, after)) {
      facts.push({ kind: "read_dependencies", action });
    }
  }
}

// Every Action owning an added or removed canonical case. Cases compare as a set with
// canonical-ordered fields, so reordering the array or an error's fields is not a change.
function changedBehavioralErrorActions(
  committed: CapabilitySpec,
  candidate: CapabilitySpec,
): readonly CapabilityTool[] {
  const before = behavioralErrorCasesByKey(committed);
  const after = behavioralErrorCasesByKey(candidate);
  const actions = new Set<CapabilityTool>();
  for (const [key, action] of before) if (!after.has(key)) actions.add(action);
  for (const [key, action] of after) if (!before.has(key)) actions.add(action);
  return FULL_CAPABILITY_TOOLS.filter((action) => actions.has(action));
}

// ── Work-plan projection ────────────────────────────────────────────────────

interface WorkSink {
  readonly platform: Set<PlatformWorkKind>;
  readonly units: Set<GeneratedUnitName>;
  readonly tests: Set<CapabilityTool>;
  fullSuite: boolean;
}

function projectWorkPlan(
  facts: readonly ChangeFact[],
  committed: CapabilitySpec,
  candidate: CapabilitySpec,
): DiffWorkPlan {
  const sink: WorkSink = {
    platform: new Set(),
    units: new Set(),
    tests: new Set(),
    fullSuite: false,
  };
  for (const fact of facts) contributeFact(fact, candidate, sink);
  for (const action of handlersWithMovedFileContract(committed, candidate)) {
    sink.units.add(action);
    sink.tests.add(action);
  }

  const regeneratedUnits = orderBy(sink.units, GENERATED_UNITS);
  const building = facts.length > 0;
  const behavioral: BehavioralTestPlan = sink.fullSuite
    ? { actions: [...FULL_CAPABILITY_TOOLS], fullSuite: true }
    : { actions: orderBy(sink.tests, FULL_CAPABILITY_TOOLS), fullSuite: false };

  return {
    platformWork: orderBy(sink.platform, PLATFORM_WORK_KINDS),
    regeneratedUnits,
    gate: {
      structural: building,
      smoke: building,
      designLint: sink.units.has("item"),
      behavioral,
    },
  };
}

type FieldScopedFact = Extract<
  ChangeFact,
  {
    kind:
      | "new_active_field"
      | "required_change"
      | "field_label"
      | "field_lifecycle"
      | "choice_values"
      | "choice_option_labels";
  }
>;
type GlobalScopedFact = Exclude<ChangeFact, FieldScopedFact>;

// Each fact only adds to the sink, so the union is monotone by construction. Field-scoped
// facts split out: their work depends on the field's type and its place in item.shows.
function contributeFact(fact: ChangeFact, candidate: CapabilitySpec, sink: WorkSink): void {
  switch (fact.kind) {
    case "new_active_field":
    case "required_change":
    case "field_label":
    case "field_lifecycle":
    case "choice_values":
    case "choice_option_labels":
      contributeFieldFact(fact, candidate, sink);
      return;
    default:
      contributeGlobalFact(fact, sink);
  }
}

function contributeFieldFact(
  fact: FieldScopedFact,
  candidate: CapabilitySpec,
  sink: WorkSink,
): void {
  switch (fact.kind) {
    case "new_active_field":
      sink.platform.add("add_column");
      sink.platform.add("platform_form_detail");
      selectWrites(sink);
      if (isSearchableTextType(fact.fieldType)) selectSearch(sink);
      // The item renderer follows the separate item.shows fact, never this one.
      return;
    case "required_change":
      sink.platform.add("resulting_record_validation");
      selectWrites(sink);
      return;
    case "field_label":
      sink.platform.add("platform_form_detail");
      if (candidate.ui_intent.item.shows.includes(fact.field)) sink.units.add("item");
      return;
    case "choice_values":
      // Create/update validation shape (ADR-0006); storage and search are untouched. It
      // reaches the card too: a copied renderer has no label and shows the raw wire string.
      sink.platform.add("choice_admitted_values");
      selectWrites(sink);
      if (candidate.ui_intent.item.shows.includes(fact.field)) sink.units.add("item");
      return;
    case "choice_option_labels":
      // The control's wording, and the card's where the field is shown: the renderer has the
      // old option label written into it, exactly as a field relabel leaves it stale.
      sink.platform.add("choice_option_presentation");
      if (candidate.ui_intent.item.shows.includes(fact.field)) sink.units.add("item");
      return;
    case "field_lifecycle":
      contributeLifecycleFact(fact.field, candidate, sink);
      return;
  }
}

/**
 * Hiding or reactivating one field, following the Module 4 matrix row. The item renderer
 * follows the required `item.shows` change (`item_presentation`), never this fact.
 */
function contributeLifecycleFact(name: string, candidate: CapabilitySpec, sink: WorkSink): void {
  sink.platform.add("platform_form_detail");
  sink.platform.add("list_input_intent");
  // A hidden field loses its `long_text` and `guidance` entries, a reactivated one may take
  // them back. Unconditional: the work is settling form intent, not "this field had a hint".
  sink.platform.add("form_subset_intent");
  selectWrites(sink);
  const field = candidate.schema.fields.find((entry) => entry.name === name);
  if (!field) return;
  if (isChoiceFieldType(field.type)) sink.platform.add("choice_input_intent");
  if (isSearchableTextType(field.type)) selectSearch(sink);
}

function contributeGlobalFact(fact: GlobalScopedFact, sink: WorkSink): void {
  switch (fact.kind) {
    case "capability_label":
      sink.platform.add("registry_and_view_copy");
      return;
    case "capability_nouns":
      // Platform copy rendered from the row. No generated unit reads a noun — a handler never
      // emits its own empty state or count — so every unit is copied.
      sink.platform.add("platform_noun_copy");
      return;
    case "prompt_context":
      sink.platform.add("resolver_catalog");
      return;
    case "field_order":
      sink.platform.add("platform_field_order");
      return;
    case "list_input_mode":
      sink.platform.add("list_input_form_normalization");
      return;
    case "max_length":
      // Validation shape, so both writing suites' digests move. The Handlers are not: the
      // limit never enters their prompt (`builder/units/generation/unit-prompts.ts`), the
      // proof ADR-0006 wants.
      sink.platform.add("max_length_validation");
      selectWriteTests(sink);
      return;
    case "long_text_input":
      // Which control a string field's form draws. Nothing is stored differently, nothing
      // validates differently, and a Handler is never told what drew a value.
      sink.platform.add("long_text_form_control");
      return;
    case "field_guidance":
      // One line under a field. Platform copy rendered from the row, the way the empty
      // state's noun is, and no generated unit reads it.
      sink.platform.add("field_guidance_copy");
      return;
    case "choice_option_disabled":
      // Validation shape, like an appended option; a row already holding the value keeps it.
      // A retired option is still admitted, so no Handler prompt moves (`choice-prompt.test.ts`).
      sink.platform.add("choice_admitted_values");
      selectWriteTests(sink);
      return;
    case "choice_option_notes":
    case "choice_option_order":
      // The note beside a row and the order rows are drawn in: not stored, and every unit is
      // handed values in value order (`registry/spec/spec.ts`,
      // `builder/units/generation/unit-prompts.ts`).
      sink.platform.add("choice_option_presentation");
      return;
    case "choice_option_groups":
      sink.platform.add("choice_option_grouping");
      return;
    case "choice_presentation":
      sink.platform.add("choice_input_form_control");
      return;
    case "item_presentation":
      sink.units.add("item");
      return;
    case "collection_layout":
      sink.platform.add("platform_list_container");
      sink.units.add("item");
      return;
    case "read_dependencies":
      sink.platform.add("read_catalog");
      sink.units.add(fact.action);
      sink.tests.add(fact.action);
      return;
    case "behavior":
      // Free text cannot identify one Action: regenerate all five Handlers and run
      // the complete candidate suite.
      for (const action of FULL_CAPABILITY_TOOLS) sink.units.add(action);
      sink.fullSuite = true;
      return;
    case "behavioral_errors":
      sink.platform.add("behavioral_error_contract");
      for (const action of fact.actions) {
        sink.units.add(action);
        sink.tests.add(action);
      }
      return;
  }
}

// A schema write change (new field, required change, hide/reactivate) regenerates
// the two writing Handlers and their tests; text/list-text fields also touch search.
function selectWrites(sink: WorkSink): void {
  sink.units.add("create");
  sink.units.add("update");
  selectWriteTests(sink);
}

/**
 * The writing Actions' suites without their Handlers — for a fact that changes what the
 * platform admits but provably cannot reach the code that writes it.
 */
function selectWriteTests(sink: WorkSink): void {
  sink.tests.add("create");
  sink.tests.add("update");
}

function selectSearch(sink: WorkSink): void {
  sink.units.add("search");
  sink.tests.add("search");
}

// ── Canonicalization + small helpers ────────────────────────────────────────

function listInputModesByField(spec: CapabilitySpec): Map<string, string> {
  const active = new Set(
    spec.schema.fields
      .filter((field) => field.lifecycle === "active" && isListFieldType(field.type))
      .map((field) => field.name),
  );
  const modes = new Map<string, string>();
  for (const entry of spec.ui_intent.form.list_inputs) {
    if (active.has(entry.field)) modes.set(entry.field, entry.mode);
  }
  return modes;
}

function canonicalDependencyKeys(
  dependencies: CapabilitySpec["read_dependencies"][CapabilityTool],
): readonly string[] {
  return dependencies
    .map((dependency) => `${dependency.capability_id}\u0000${dependency.incarnation_id}`)
    .sort(compareStrings);
}

function behavioralErrorCasesByKey(spec: CapabilitySpec): Map<string, CapabilityTool> {
  const byKey = new Map<string, CapabilityTool>();
  for (const errorCase of spec.behavioral_errors) {
    const key = JSON.stringify({
      action: errorCase.action,
      trigger: errorCase.trigger,
      code: errorCase.code,
      fields: [...errorCase.fields].sort(compareStrings),
    });
    byKey.set(key, errorCase.action);
  }
  return byKey;
}

function sortFacts(facts: readonly ChangeFact[]): readonly ChangeFact[] {
  return [...facts].sort((left, right) => {
    const byKind = FACT_KIND_ORDER.indexOf(left.kind) - FACT_KIND_ORDER.indexOf(right.kind);
    if (byKind !== 0) return byKind;
    return compareStrings(factSubject(left), factSubject(right));
  });
}

// The within-kind tiebreaker: field name, Action name, or "" for the whole-spec facts.
function factSubject(fact: ChangeFact): string {
  if ("field" in fact) return fact.field;
  if ("action" in fact) return fact.action;
  if (fact.kind === "behavioral_errors") return fact.actions.join(",");
  return "";
}

function orderBy<T>(values: ReadonlySet<T>, order: readonly T[]): readonly T[] {
  return order.filter((value) => values.has(value));
}
