// Canonical per-Action behavioral test inputs: the *total* set one Action's behavioral tests may
// be generated from — free-text `behavior`, that Action's own `behavioral_errors` and their
// stable markers, its declared dependency identities, and the closed schema projection tabulated
// in modules/04 PLAN.md. Handler source is never an input, nor is anything presentational —
// labels, field order, `ui_intent`, `prompt_context` — nor a dependency's schema: a dependency
// contributes its identity only.
//
// This module is the one place that projection is computed, and it computes it canonically:
// everything sorted, and every object key sorted at serialization. Two specs differing only in a
// label or a field's position hash to the same digest, so *a label-only change regenerates no
// tests* is a fact about a content address rather than a claim about a prompt.

import { canonicalizeJson, compareStrings } from "../../../../../platform/canonical-json.ts";
import {
  activeSpecFields,
  type BehavioralErrorCase,
  type CapabilitySpec,
  type CapabilityTool,
  choiceFieldOptions,
  type FieldType,
  FULL_CAPABILITY_TOOLS,
  isSearchableTextType,
  type ReadDependency,
  type SpecField,
  selectableChoiceValues,
} from "../../../../../registry/index.ts";
import { contentDigest } from "../../../../artifacts/inventory/artifact-digests.ts";

/** The `q`-only search input every capability's search Action receives. */
const SEARCH_QUERY_INPUT = { name: "q", type: "string" } as const;

/**
 * create/update: the writable contract — name, type, requiredness, and a choice's admitted
 * values. The admitted set is validation shape (ADR-0006); a label or a group stays out.
 */
export interface ActionSchemaField {
  readonly name: string;
  readonly type: FieldType;
  readonly required: boolean;
  /** Declared option values, in authored order; absent on every non-choice field. */
  readonly values?: readonly string[];
  /**
   * The declared length bound, absent when a field has none. Validation shape: the platform
   * refuses a longer write before the Handler runs, so the limit moves the digest (ADR-0006).
   */
  readonly max_length?: number;
}

/** search: only the text-shaped fields a query can mechanically match. */
export interface ActionSearchableField {
  readonly name: string;
  readonly type: FieldType;
}

export interface ActionSearchSchemaInput {
  readonly input: typeof SEARCH_QUERY_INPUT;
  readonly searchable_fields: readonly ActionSearchableField[];
}

/** read/delete project an empty array: their mechanics belong to always-on smoke. */
export type ActionSchemaTestInput = readonly ActionSchemaField[] | ActionSearchSchemaInput;

/**
 * The complete, closed input set for one Action's behavioral tests: the prompt builder takes
 * this object and never the spec, so nothing outside it can reach a generation prompt.
 */
export interface ActionTestInputs {
  readonly action: CapabilityTool;
  /** Free text cannot be scoped to an Action, so it is conservatively an input to all. */
  readonly behavior: string;
  readonly schema: ActionSchemaTestInput;
  /** Only the cases this Action owns, each carrying its stable marker contract. */
  readonly behavioral_errors: readonly BehavioralErrorCase[];
  /** Declared dependency identities — never their schemas. */
  readonly read_dependencies: readonly ReadDependency[];
}

/**
 * The synthetic-row vocabulary a case builds fixtures from: scratch-fixture context that
 * reaches the prompt but is absent from {@link ActionTestInputs}, and so from the digest.
 */
export interface ActionFixtureVocabulary {
  readonly row_fields: readonly ActionFixtureField[];
}

/** One field a synthetic row may carry; a choice also carries the values it still offers. */
export interface ActionFixtureField {
  readonly name: string;
  readonly type: FieldType;
  readonly values?: readonly string[];
}

export function actionFixtureVocabulary(spec: CapabilitySpec): ActionFixtureVocabulary {
  return {
    row_fields: [...activeSpecFields(spec.schema.fields)].sort(byName).map((field) => ({
      name: field.name,
      type: field.type,
      ...(field.values === undefined ? {} : { values: choiceTestValues(field) }),
    })),
  };
}

/** Discriminate the two projection shapes; only `search` carries the `q` input shape. */
export function isSearchSchemaInput(
  schema: ActionSchemaTestInput,
): schema is ActionSearchSchemaInput {
  return !Array.isArray(schema);
}

/** Project one Action's total test inputs from the spec, in canonical form. */
export function actionTestInputs(spec: CapabilitySpec, action: CapabilityTool): ActionTestInputs {
  return {
    action,
    behavior: spec.behavior,
    schema: canonicalSchemaInput(spec, action),
    behavioral_errors: canonicalBehavioralErrors(spec, action),
    read_dependencies: canonicalReadDependencies(spec, action),
  };
}

/** Every Action the spec declares, in the platform's canonical Action order. */
export function specActionTestInputs(spec: CapabilitySpec): readonly ActionTestInputs[] {
  return FULL_CAPABILITY_TOOLS.filter((action) => spec.tools.includes(action)).map((action) =>
    actionTestInputs(spec, action),
  );
}

/**
 * The content address of one Action's total test inputs. Byte-identical inputs are the sole
 * criterion decision 23 admits for reusing a prior tier-on suite.
 */
export function actionTestInputDigest(inputs: ActionTestInputs): string {
  return contentDigest(canonicalTestInputJson(inputs));
}

/**
 * Deterministic serialization: keys sorted at every depth, arrays left as canonicalized here.
 * These bytes are both hashed into the snapshot and handed to the model verbatim.
 */
export function canonicalTestInputJson(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value), null, 2);
}

function canonicalSchemaInput(spec: CapabilitySpec, action: CapabilityTool): ActionSchemaTestInput {
  // read/delete assert canonical-row and delete mechanics through always-on smoke, so
  // schema shape is not a behavioral input for them at all.
  if (action === "read" || action === "delete") return [];
  const active = [...activeSpecFields(spec.schema.fields)].sort(byName);
  if (action === "search") {
    return {
      input: SEARCH_QUERY_INPUT,
      searchable_fields: active
        .filter((field) => isSearchableTextType(field.type))
        .map(({ name, type }) => ({ name, type })),
    };
  }
  return active.map((field) => ({
    name: field.name,
    type: field.type,
    required: field.required,
    ...(field.values === undefined ? {} : choiceSchemaInput(field)),
    // Absent rather than zero on a field with no bound, so a capability built before any
    // of this digests exactly as it did.
    ...(field.max_length === undefined ? {} : { max_length: field.max_length }),
  }));
}

/**
 * A choice's admitted set, split as create/update validation splits it; both halves are digest
 * input (ADR-0006). `retired_values` is absent, not empty, so an older capability digests same.
 */
function choiceSchemaInput(field: SpecField): {
  values: readonly string[];
  retired_values?: readonly string[];
} {
  const retired = choiceFieldOptions(field)
    .filter((option) => option.disabled === true)
    .map((option) => option.value)
    .sort();
  return {
    values: choiceTestValues(field),
    ...(retired.length === 0 ? {} : { retired_values: retired }),
  };
}

/**
 * The selectable choice values a generated test may write, sorted: seeding a disabled option
 * would author a test the capability can never pass, and draw order is View work.
 */
function choiceTestValues(field: SpecField): readonly string[] {
  return [...selectableChoiceValues(field)].sort();
}

function canonicalBehavioralErrors(
  spec: CapabilitySpec,
  action: CapabilityTool,
): readonly BehavioralErrorCase[] {
  return spec.behavioral_errors
    .filter((errorCase) => errorCase.action === action)
    .map((errorCase) => ({
      action: errorCase.action,
      trigger: errorCase.trigger,
      code: errorCase.code,
      // `fields` is compared as a set everywhere it is honored, so its authored order
      // is not semantic and must not move the digest.
      fields: [...errorCase.fields].sort(compareStrings),
      expected_markers: errorCase.expected_markers,
    }))
    .sort(
      (left, right) =>
        compareStrings(left.code, right.code) ||
        compareStrings(left.trigger, right.trigger) ||
        compareStrings(left.fields.join(" "), right.fields.join(" ")),
    );
}

function canonicalReadDependencies(
  spec: CapabilitySpec,
  action: CapabilityTool,
): readonly ReadDependency[] {
  return [...spec.read_dependencies[action]]
    .map(({ capability_id, incarnation_id }) => ({ capability_id, incarnation_id }))
    .sort(
      (left, right) =>
        compareStrings(left.capability_id, right.capability_id) ||
        compareStrings(left.incarnation_id, right.incarnation_id),
    );
}

/**
 * Searchability, decided as the Diff Engine decides it (`diff-engine.ts`). They must move
 * together: a new list type would otherwise leave this projection carrying a stale suite.
 */
function byName(left: { readonly name: string }, right: { readonly name: string }): number {
  return compareStrings(left.name, right.name);
}
