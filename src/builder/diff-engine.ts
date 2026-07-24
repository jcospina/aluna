// The Diff Engine — Module 4.6/02 (PLAN decisions 21, 22, 37 and the normative
// "Total Diff Engine change-fact matrix"; ADR-0006 total unit diffs).
//
// One total, monotone change-fact contract. Given the committed spec and the
// already-validated candidate (4.6/01 rejected every invalid difference before
// this stage), it converts every admitted committed→candidate difference into a
// typed change fact and projects the union of those facts onto the four kinds of
// downstream work the platform must perform: schema/platform work, generated-unit
// selection, behavioral-test effect, and Gate work. The mapping IS the PLAN's
// normative matrix — the table there is authoritative, and admitting a new spec
// fact requires extending both the table and this module (decision 21).
//
// Three invariants hold this contract together:
//
//   - **Monotone union (decision 21).** Multiple facts union every column; one
//     fact can never subtract work another fact requires. A unit is copied only
//     when *no* fact selects it — the matrix positively proving it unaffected.
//   - **Fails closed on the unknown (decision 21).** After accounting for every
//     region a change fact covers, the residual of the two canonical specs must
//     be identical. Any leftover difference — a future admitted fact without a
//     matrix row, or an immutable region that validation should have frozen — is
//     an unmapped difference and throws {@link UnmappedChangeFactError} before any
//     publication, never a silent no-op or an unproven copy.
//   - **Canonical, not raw (decision 37).** Equality is over the validated
//     semantic value: object-key order is ignored and set-like facts (dependency
//     arrays, error cases, error-field sets) use a defined canonical order, while
//     ordered product facts (`schema.fields`, item/detail `shows`, item
//     `direction`) preserve order and therefore diff. A zero-fact candidate is the
//     canonical no-op (decision 37): the caller performs no work and finalizes
//     `success/no_change`.

import {
  type CapabilitySpec,
  type CapabilityTool,
  type FieldType,
  FULL_CAPABILITY_TOOLS,
  isListFieldType,
  type SpecField,
} from "../registry/index.ts";
import { canonicalCapabilityLabel } from "../registry/labels.ts";

// ── The typed change facts ──────────────────────────────────────────────────
// One variant per matrix row that produces a fact. The invalid-candidate row and
// the two terminal rows (no-op, unmapped) are not facts: invalidity is rejected
// upstream in 4.6/01, the no-op is the empty fact set, and the unmapped case
// throws. Field- and Action-scoped facts carry their subject so the union and the
// dev preview can name exactly what changed.

export type ChangeFact =
  | { readonly kind: "capability_label" }
  | { readonly kind: "prompt_context" }
  | { readonly kind: "field_order" }
  | { readonly kind: "new_active_field"; readonly field: string; readonly fieldType: FieldType }
  | { readonly kind: "required_change"; readonly field: string }
  | { readonly kind: "field_label"; readonly field: string }
  | {
      readonly kind: "field_lifecycle";
      readonly field: string;
      readonly transition: "hide" | "reactivate";
    }
  | { readonly kind: "list_input_mode"; readonly field: string }
  | { readonly kind: "detail_shows" }
  | { readonly kind: "item_presentation" }
  | { readonly kind: "collection_layout" }
  | { readonly kind: "read_dependencies"; readonly action: CapabilityTool }
  | { readonly kind: "behavior" }
  | { readonly kind: "behavioral_errors"; readonly actions: readonly CapabilityTool[] };

export type ChangeFactKind = ChangeFact["kind"];

// The canonical fact order the result and the dev preview present — schema
// identity first, then platform presentation, then behavior. Deterministic so two
// runs over the same difference emit byte-identical facts (and metrics stay
// comparable in M8).
const FACT_KIND_ORDER: readonly ChangeFactKind[] = [
  "capability_label",
  "prompt_context",
  "field_order",
  "new_active_field",
  "required_change",
  "field_label",
  "field_lifecycle",
  "list_input_mode",
  "detail_shows",
  "item_presentation",
  "collection_layout",
  "read_dependencies",
  "behavior",
  "behavioral_errors",
];

// ── The work plan the matrix projects ───────────────────────────────────────

// The six generated units the diff selects between: the five Action handlers and
// the item renderer. Every unit not selected is copied byte-for-byte (decision 21).
export const GENERATED_UNITS = ["create", "read", "update", "delete", "search", "item"] as const;
export type GeneratedUnitName = (typeof GENERATED_UNITS)[number];

// The closed vocabulary of platform/schema work the matrix's first column names.
// Each tag is one cell's worth of platform-owned work — no generated units, no
// model context. Extending the matrix extends this list.
export const PLATFORM_WORK_KINDS = [
  "registry_and_view_copy", // capability label → registry row + toolbar/View copy
  "resolver_catalog", // prompt_context → intent-resolver catalog
  "platform_field_order", // field order → platform form order + list-input entry order
  "add_column", // new active field → nullable ADD COLUMN
  "platform_form_detail", // new/label/lifecycle field → platform form + detail View
  "resulting_record_validation", // required change → resulting-record validation
  "list_input_intent", // hide/reactivate → remove/require active list-input intent
  "list_input_form_normalization", // list input mode → create/edit form + raw-input normalization
  "platform_detail_view", // detail.shows/order → platform detail View
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
  /** The behavioral tier follows the projected test plan (decision 23). */
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
  /** True exactly when `facts` is empty — the canonical no-op (decision 37). */
  readonly isNoop: boolean;
}

/**
 * The fail-closed guard (decision 21): a committed→candidate difference the matrix
 * does not map. It carries the residual JSON of both sides so the shared build-error
 * preview surfaces exactly what could not be explained.
 */
export class UnmappedChangeFactError extends Error {
  override readonly name = "UnmappedChangeFactError";
  readonly diagnostic: { readonly committedResidual: unknown; readonly candidateResidual: unknown };

  constructor(committedResidual: unknown, candidateResidual: unknown) {
    super(
      "Unmapped evolution difference: the candidate differs from the committed spec in a " +
        "region no change-fact row covers; failing closed before publication.",
    );
    this.diagnostic = { committedResidual, candidateResidual };
  }
}

/**
 * Diff one committed spec against one validated candidate. Returns the typed
 * facts, the unioned work plan, and the no-op flag; throws
 * {@link UnmappedChangeFactError} if any difference is left unexplained.
 *
 * Both inputs are the validated canonical value (the committed row's authored view
 * and the 4.6/01-validated candidate), so this never re-checks the invalid-candidate
 * row — it only classifies admitted differences and proves totality.
 */
export function diffCapabilitySpec(
  committed: CapabilitySpec,
  candidate: CapabilitySpec,
): CapabilityDiff {
  const facts = detectFacts(committed, candidate);
  assertTotalCoverage(committed, candidate);
  const workPlan = projectWorkPlan(facts, candidate);
  return { facts, workPlan, isNoop: facts.length === 0 };
}

// ── Fact detection ──────────────────────────────────────────────────────────

function detectFacts(committed: CapabilitySpec, candidate: CapabilitySpec): readonly ChangeFact[] {
  const facts: ChangeFact[] = [];

  if (canonicalCapabilityLabel(committed) !== canonicalCapabilityLabel(candidate)) {
    facts.push({ kind: "capability_label" });
  }
  if (committed.prompt_context !== candidate.prompt_context) {
    facts.push({ kind: "prompt_context" });
  }

  detectSchemaFacts(committed, candidate, facts);
  detectListInputModeFacts(committed, candidate, facts);
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

// schema.fields is the busiest region: order is an ordered product fact, new
// fields, label/required/lifecycle each map to their own fact. Name and type are
// immutable (validated in 4.6/01), so they never diff here — they anchor the
// residual totality check instead.
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
  if (!sameSequence(committedOrder, candidateCommittedOrder)) {
    facts.push({ kind: "field_order" });
  }

  for (const candidateField of candidate.schema.fields) {
    facts.push(...fieldFacts(committedByName.get(candidateField.name), candidateField));
  }
}

// The per-field facts of one candidate field: a new field, or the union of the
// attribute changes over a returned committed field. Name and type never diff
// (validation), so they are absent from this set by construction.
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

// A list-input mode fact is only the mode change of a field that is an active
// string[] in *both* specs; a field that gained or lost that status is already a
// new_active_field or field_lifecycle fact.
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
  if (!sameSequence(committed.ui_intent.detail.shows, candidate.ui_intent.detail.shows)) {
    facts.push({ kind: "detail_shows" });
  }
  const committedItem = committed.ui_intent.item;
  const candidateItem = candidate.ui_intent.item;
  if (
    committedItem.direction !== candidateItem.direction ||
    !sameSequence(committedItem.shows, candidateItem.shows)
  ) {
    facts.push({ kind: "item_presentation" });
  }
  if (committed.ui_intent.collection.layout !== candidate.ui_intent.collection.layout) {
    facts.push({ kind: "collection_layout" });
  }
}

// read_dependencies is one fact per Action whose declared dependency identities
// changed. The arrays are validated canonical-ordered, but compare as sets so a
// serialization reorder could never manufacture a fact (decision 37).
function detectReadDependencyFacts(
  committed: CapabilitySpec,
  candidate: CapabilitySpec,
  facts: ChangeFact[],
): void {
  for (const action of FULL_CAPABILITY_TOOLS) {
    const before = canonicalDependencyKeys(committed.read_dependencies[action]);
    const after = canonicalDependencyKeys(candidate.read_dependencies[action]);
    if (!sameSequence(before, after)) {
      facts.push({ kind: "read_dependencies", action });
    }
  }
}

// The behavioral_errors fact names every Action whose error contract changed —
// the union of the Actions owning each added or removed canonical case. Cases are
// compared as a set with canonical-ordered fields, so reordering the array or an
// error's fields is not a change (decision 37).
function changedBehavioralErrorActions(
  committed: CapabilitySpec,
  candidate: CapabilitySpec,
): readonly CapabilityTool[] {
  const before = behavioralErrorCasesByKey(committed);
  const after = behavioralErrorCasesByKey(candidate);
  const actions = new Set<CapabilityTool>();
  for (const [key, action] of before) {
    if (!after.has(key)) actions.add(action);
  }
  for (const [key, action] of after) {
    if (!before.has(key)) actions.add(action);
  }
  return FULL_CAPABILITY_TOOLS.filter((action) => actions.has(action));
}

// ── Work-plan projection ────────────────────────────────────────────────────

interface WorkSink {
  readonly platform: Set<PlatformWorkKind>;
  readonly units: Set<GeneratedUnitName>;
  readonly tests: Set<CapabilityTool>;
  fullSuite: boolean;
}

function projectWorkPlan(facts: readonly ChangeFact[], candidate: CapabilitySpec): DiffWorkPlan {
  const sink: WorkSink = {
    platform: new Set(),
    units: new Set(),
    tests: new Set(),
    fullSuite: false,
  };
  for (const fact of facts) contributeFact(fact, candidate, sink);

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
  { kind: "new_active_field" | "required_change" | "field_label" | "field_lifecycle" }
>;
type GlobalScopedFact = Exclude<ChangeFact, FieldScopedFact>;

// Each fact contributes only additions to the sink — the union is monotone by
// construction, so no fact can ever remove work another fact required (decision 21).
// Field-scoped facts split out because their work depends on the field's type and
// its place in the candidate's item.shows.
function contributeFact(fact: ChangeFact, candidate: CapabilitySpec, sink: WorkSink): void {
  switch (fact.kind) {
    case "new_active_field":
    case "required_change":
    case "field_label":
    case "field_lifecycle":
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
    case "field_lifecycle": {
      sink.platform.add("platform_form_detail");
      sink.platform.add("list_input_intent");
      selectWrites(sink);
      const field = candidate.schema.fields.find((entry) => entry.name === fact.field);
      if (field && isSearchableTextType(field.type)) selectSearch(sink);
      // The item renderer follows the required item.shows change (item_presentation).
      return;
    }
  }
}

function contributeGlobalFact(fact: GlobalScopedFact, sink: WorkSink): void {
  switch (fact.kind) {
    case "capability_label":
      sink.platform.add("registry_and_view_copy");
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
    case "detail_shows":
      sink.platform.add("platform_detail_view");
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
      // the complete candidate suite (decision 22).
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
  sink.tests.add("create");
  sink.tests.add("update");
}

function selectSearch(sink: WorkSink): void {
  sink.units.add("search");
  sink.tests.add("search");
}

function isSearchableTextType(type: FieldType): boolean {
  return type === "string" || isListFieldType(type);
}

// ── Totality: fail closed on the unexplained ────────────────────────────────

// A control-character sentinel that stands in for every region a change fact
// covers. Regions left un-neutralized are the immutable invariants (id, tools,
// each committed field's name/type) plus anything a future spec adds without a
// matrix row — those must be identical, or the difference is unmapped.
const RESIDUAL_SENTINEL = "\u0000diff-covered\u0000";

function assertTotalCoverage(committed: CapabilitySpec, candidate: CapabilitySpec): void {
  const committedNames = new Set(committed.schema.fields.map((field) => field.name));
  const committedResidual = residualProjection(committed, committedNames);
  const candidateResidual = residualProjection(candidate, committedNames);
  // Both residuals are deeply key-sorted, so stringify is an order-stable deep-equal.
  if (JSON.stringify(committedResidual) !== JSON.stringify(candidateResidual)) {
    throw new UnmappedChangeFactError(committedResidual, candidateResidual);
  }
}

// Reduce a spec to only what no change fact explains: canonicalize the whole
// value, then blank every fact-bearing region. What survives — id, tools, and the
// committed fields' name/type — is the equality the diff cannot manufacture and
// must never silently ignore. A new admitted top-level key survives here too, so
// an unextended matrix fails closed rather than dropping it.
function residualProjection(spec: CapabilitySpec, committedNames: ReadonlySet<string>): unknown {
  const canonical = canonicalize(spec) as Record<string, unknown>;
  canonical.label = RESIDUAL_SENTINEL;
  canonical.prompt_context = RESIDUAL_SENTINEL;
  canonical.behavior = RESIDUAL_SENTINEL;
  canonical.behavioral_errors = RESIDUAL_SENTINEL;
  canonical.read_dependencies = RESIDUAL_SENTINEL;
  canonical.ui_intent = RESIDUAL_SENTINEL;
  canonical.schema = {
    fields: spec.schema.fields
      .filter((field) => committedNames.has(field.name))
      .map(
        (field): Record<string, unknown> => ({
          ...(canonicalize(field) as Record<string, unknown>),
          label: RESIDUAL_SENTINEL,
          required: RESIDUAL_SENTINEL,
          lifecycle: RESIDUAL_SENTINEL,
        }),
      )
      .sort((left, right) => compareStrings(String(left.name), String(right.name))),
  };
  return canonical;
}

// ── Canonicalization + small helpers ────────────────────────────────────────

// Deep clone with object keys sorted; arrays keep their order (an ordered product
// fact), primitives pass through. This is what makes object-key reordering a no-op
// while preserving ordered facts (decision 37).
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      compareStrings(left, right),
    );
    return Object.fromEntries(entries.map(([key, nested]) => [key, canonicalize(nested)]));
  }
  return value;
}

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

function sameSequence(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
