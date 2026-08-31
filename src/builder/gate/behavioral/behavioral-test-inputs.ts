// Canonical per-Action behavioral test inputs: the *total* input set one Action's
// behavioral tests may be generated from — free-text `behavior`, that Action's own
// `behavioral_errors` plus their stable markers, its declared dependency identities, and a
// closed schema projection:
//
//   | Action           | Canonical schema test input                                |
//   | ---------------- | ---------------------------------------------------------- |
//   | create, update   | active field name/type/required + a choice's admitted values|
//   | search           | active string/choice/string[] field names/types             |
//   | read, delete     | none; canonical-row/delete mechanics stay in always-on smoke|
//
// Handler source is never an input. Neither is anything presentational — field labels,
// field order, `ui_intent`, the capability label, `prompt_context` — nor a dependency's
// schema: a dependency contributes its *identity* only.
//
// This module is the one place that projection is computed, and it computes it
// *canonically*: active fields sorted by name, each error case's fields sorted, error cases
// and dependency identities sorted by their own stable identity, and every object key
// sorted at serialization. Two specs differing only in a label or a field's position
// therefore serialize to identical bytes and hash to the same digest — which is what makes
// "a label-only or field-order-only change regenerates no tests" a mechanical fact about a
// content address rather than a claim about a prompt.

import {
  activeSpecFields,
  type BehavioralErrorCase,
  type CapabilitySpec,
  type CapabilityTool,
  type FieldType,
  FULL_CAPABILITY_TOOLS,
  isChoiceFieldType,
  isListFieldType,
  type ReadDependency,
} from "../../../registry/index.ts";
import { contentDigest } from "../../artifacts/artifact-digests.ts";

/** The `q`-only search input every capability's search Action receives. */
const SEARCH_QUERY_INPUT = { name: "q", type: "string" } as const;

/**
 * create/update: the writable contract — name, type, requiredness, and, for a choice, the
 * values it admits. The admitted set is part of the *validation shape* these Actions are
 * tested against (ADR-0006), so appending an option moves the digest and the suite
 * regenerates; a label or a group is presentation and stays out.
 */
export interface ActionSchemaField {
  readonly name: string;
  readonly type: FieldType;
  readonly required: boolean;
  /** Declared option values, in authored order; absent on every non-choice field. */
  readonly values?: readonly string[];
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
 * The complete, closed input set for one Action's behavioral tests. Everything a test
 * generation prompt is allowed to see is reachable from this object — and nothing else
 * is, because the prompt builder takes this and never the spec.
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
 * The synthetic-row vocabulary a generated case may build fixtures from: every active
 * field, whatever the Action is. This is **scratch-fixture context, never a versioned
 * equality input** — it reaches the prompt and is deliberately absent
 * from {@link ActionTestInputs} and therefore from the digest.
 *
 * It has to be said out loud because `read` and `delete` project no schema at all, so
 * their prompts would otherwise name no legal row field while still requiring a setup
 * row — leaving the model to either seed an empty row (proving nothing) or invent a
 * field name (failing the build). A capability's rows are the same rows for every
 * Action; only the *contract* differs per Action, and that is what `schema` carries.
 *
 * A choice field brings its admitted values here for the same reason it brings its name:
 * a value is as much a fixture mechanic as a field is, and a row can be made of nothing
 * else. Without them a `read` case has no legal status to seed and invents one, which the
 * platform then refuses.
 */
export interface ActionFixtureVocabulary {
  readonly row_fields: readonly ActionFixtureField[];
}

/** One field a synthetic row may carry; a choice also carries the values it admits. */
export interface ActionFixtureField {
  readonly name: string;
  readonly type: FieldType;
  readonly values?: readonly string[];
}

export function actionFixtureVocabulary(spec: CapabilitySpec): ActionFixtureVocabulary {
  return {
    row_fields: [...activeSpecFields(spec.schema.fields)]
      .sort(byName)
      .map(({ name, type, values }) => ({
        name,
        type,
        ...(values === undefined ? {} : { values: values.map((option) => option.value) }),
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
 * The content address of one Action's total test inputs. Equal digests mean the Action's
 * generation inputs are byte-identical, which is the sole criterion decision 23 admits
 * for reusing a prior tier-on suite instead of regenerating it.
 */
export function actionTestInputDigest(inputs: ActionTestInputs): string {
  return contentDigest(canonicalTestInputJson(inputs));
}

/**
 * Deterministic serialization: object keys sorted at every depth, arrays left in the
 * order this module already canonicalized. Key order is never allowed to be an accident
 * of construction or of a schema's field declaration order, because these bytes are both
 * hashed into the snapshot and handed to the model verbatim.
 */
export function canonicalTestInputJson(value: unknown): string {
  return JSON.stringify(sortObjectKeysDeep(value), null, 2);
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
  return active.map(({ name, type, required, values }) => ({
    name,
    type,
    required,
    ...(values === undefined ? {} : { values: values.map((option) => option.value) }),
  }));
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
      fields: [...errorCase.fields].sort(compareText),
      expected_markers: errorCase.expected_markers,
    }))
    .sort(
      (left, right) =>
        compareText(left.code, right.code) ||
        compareText(left.trigger, right.trigger) ||
        compareText(left.fields.join(" "), right.fields.join(" ")),
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
        compareText(left.capability_id, right.capability_id) ||
        compareText(left.incarnation_id, right.incarnation_id),
    );
}

/**
 * Searchability, decided the same way the Diff Engine decides it (`diff-engine.ts`). Both
 * must move together or a new list type would make the Diff select `search` tests for a
 * field this projection ignores — a stale carried suite, silently. Going through
 * `isListFieldType` is what makes `LIST_FIELD_TYPES` the one place that changes. A choice
 * stores a string in a TEXT column, so it searches exactly as a `string` field does.
 */
function isSearchableTextType(type: FieldType): boolean {
  return type === "string" || isChoiceFieldType(type) || isListFieldType(type);
}

function byName(left: { readonly name: string }, right: { readonly name: string }): number {
  return compareText(left.name, right.name);
}

/** Codepoint order — deliberately locale-independent, unlike `localeCompare`. */
function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function sortObjectKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeysDeep);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, entry]) => [key, sortObjectKeysDeep(entry)]),
  );
}
