// Shared fixtures for candidate generation + validation
// suite. One committed capability with active and inactive fields (scalar and
// string[]), one external dependency capability with an inactive field the
// context test proves absent, and a mutable candidate draft the rejection
// matrix edits freely. Not a test file itself; bun never runs it.

import type { ZodType } from "zod";

import type { IntentClassification } from "../../../pipeline/intent/index.ts";
import type { DeepPartial, GenerateResult, Provider } from "../../../platform/provider/index.ts";
import { type CapabilityRow, capabilitySpecFromRow } from "../../../registry/index.ts";
import { buildDependencyGenerationCatalog } from "../dependency-catalog.ts";

export const JOURNAL_INCARNATION_ID = "22222222-2222-4222-8222-222222222222";
export const SHELVES_INCARNATION_ID = "33333333-3333-4333-8333-333333333333";

/** Overrides a suite may apply, narrowed to the two types an evolution can answer. */
export type EvolutionIntentOverrides = Partial<Omit<IntentClassification, "type">> & {
  readonly type?: "extend_capability" | "ui_change";
};

/**
 * A resolver classification aimed at one committed capability — what the Intent Resolver
 * hands the evolution engine for `intentText`. Stands in for a real classification so a
 * suite can drive the engine without a resolver provider call of its own.
 */
export function evolutionIntentFor(
  committed: Pick<CapabilityRow, "id">,
  intentText: string,
  overrides: EvolutionIntentOverrides = {},
): IntentClassification & { readonly type: "extend_capability" | "ui_change" } {
  return {
    type: "extend_capability",
    confidence: 1,
    target_capability: committed.id,
    resolution: "extend",
    proposed_identity: null,
    proposed_action: intentText,
    user_facing_label: "Let me think through that change.",
    requires_confirmation: false,
    ...overrides,
  };
}

/**
 * The committed capability under evolution. Field-lifecycle coverage on
 * purpose: an active required scalar, an active optional `string[]` (with its
 * form list-input entry), an inactive scalar, an inactive `string[]` (the
 * reactivation targets), and an inactive number.
 */
export function journalCapabilityRow(overrides: Partial<CapabilityRow> = {}): CapabilityRow {
  return {
    id: "journal",
    label: "Journal",
    subject: "an open notebook",
    ground: "grass_green",
    companion: "coral_orange",
    noun: "journal entry",
    schema: {
      fields: [
        { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
        { name: "tags", label: "Tags", type: "string[]", required: false, lifecycle: "active" },
        {
          name: "archived_reason",
          label: "Archived reason",
          type: "string",
          required: false,
          lifecycle: "inactive",
        },
        {
          name: "old_labels",
          label: "Old labels",
          type: "string[]",
          required: false,
          lifecycle: "inactive",
        },
        {
          name: "old_rating",
          label: "Old rating",
          type: "number",
          required: false,
          lifecycle: "inactive",
        },
      ],
    },
    ui_intent: {
      form: {
        list_inputs: [{ field: "tags", mode: "comma_separated" }],
        choice_inputs: [],
        long_text: [],
        guidance: [],
      },
      item: {
        direction: "A title-forward card with its tags underneath.",
        shows: ["title", "tags"],
      },
      collection: { layout: "feed" },
    },
    behavior: "A title is required. Newest entries appear first.",
    behavioral_errors: [
      {
        action: "create",
        trigger: "missing_required_fields",
        code: "missing_required_fields",
        fields: ["title"],
        expected_markers: {
          role_attribute: "data-role",
          role: "error",
          code_attribute: "data-error-code",
          fields_attribute: "data-error-fields",
          fields_separator: " ",
        },
      },
      {
        action: "update",
        trigger: "missing_required_fields",
        code: "missing_required_fields",
        fields: ["title"],
        expected_markers: {
          role_attribute: "data-role",
          role: "error",
          code_attribute: "data-error-code",
          fields_attribute: "data-error-fields",
          fields_separator: " ",
        },
      },
    ],
    tools: ["create", "read", "update", "delete", "search"],
    read_dependencies: { create: [], read: [], update: [], delete: [], search: [] },
    prompt_context: "Stores the user's journal entries.",
    incarnation_id: JOURNAL_INCARNATION_ID,
    version: 1,
    artifacts_path: `capabilities/journal/${JOURNAL_INCARNATION_ID}/v1/`,
    seed: 184206,
    logo: { status: "absent", attempts: 0 },
    ...overrides,
  } as CapabilityRow;
}

/**
 * The external dependency capability. `shelf_secret` is inactive on purpose:
 * the context test pins that it never reaches candidate-generation context,
 * while `shelf_name` (active) does.
 */
export function shelvesCapabilityRow(overrides: Partial<CapabilityRow> = {}): CapabilityRow {
  return {
    id: "shelves",
    label: "Shelves",
    subject: "a wooden bookshelf",
    ground: "mustard_ochre",
    companion: "coral_orange",
    noun: "shelf",
    schema: {
      fields: [
        {
          name: "shelf_name",
          label: "Shelf name",
          type: "string",
          required: true,
          lifecycle: "active",
        },
        {
          name: "shelf_secret",
          label: "Shelf secret",
          type: "string",
          required: false,
          lifecycle: "inactive",
        },
      ],
    },
    ui_intent: {
      form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
      item: { direction: "A compact shelf name chip.", shows: ["shelf_name"] },
      collection: { layout: "grid" },
    },
    behavior: "A shelf name is required.",
    behavioral_errors: [
      {
        action: "create",
        trigger: "missing_required_fields",
        code: "missing_required_fields",
        fields: ["shelf_name"],
        expected_markers: {
          role_attribute: "data-role",
          role: "error",
          code_attribute: "data-error-code",
          fields_attribute: "data-error-fields",
          fields_separator: " ",
        },
      },
      {
        action: "update",
        trigger: "missing_required_fields",
        code: "missing_required_fields",
        fields: ["shelf_name"],
        expected_markers: {
          role_attribute: "data-role",
          role: "error",
          code_attribute: "data-error-code",
          fields_attribute: "data-error-fields",
          fields_separator: " ",
        },
      },
    ],
    tools: ["create", "read", "update", "delete", "search"],
    read_dependencies: { create: [], read: [], update: [], delete: [], search: [] },
    prompt_context: "Stores the user's labelled shelves.",
    incarnation_id: SHELVES_INCARNATION_ID,
    version: 1,
    artifacts_path: `capabilities/shelves/${SHELVES_INCARNATION_ID}/v1/`,
    seed: 730051,
    logo: { status: "absent", attempts: 0 },
    ...overrides,
  } as CapabilityRow;
}

/** The lease-frozen catalog for evolving `journal` beside `shelves`. */
export function evolutionDependencyCatalog() {
  return buildDependencyGenerationCatalog(
    [journalCapabilityRow(), shelvesCapabilityRow()],
    "journal",
  );
}

/**
 * A deeply-mutable candidate draft: the committed spec's authored shape as
 * plain JSON, cloned fresh so the rejection matrix can omit, rename, retype,
 * duplicate, and inject platform-owned keys without type friction.
 */
export interface CandidateDraft {
  id: string;
  label: string;
  schema: {
    fields: Array<{
      name: string;
      label: string;
      type: string;
      required: boolean;
      lifecycle: string;
      values?: Array<{
        value: string;
        label: string;
        group?: string;
        note?: string;
        disabled?: true;
      }>;
      groups?: Array<{ id: string; heading: string }>;
      max_length?: number;
    }>;
  };
  ui_intent: {
    form: {
      list_inputs: Array<{ field: string; mode: string }>;
      choice_inputs: Array<{ field: string; presentation: string }>;
      long_text: string[];
      guidance: Array<{ field: string; text: string }>;
    };
    item: { direction: string; shows: string[] };
    collection: { layout: string };
  };
  behavior: string;
  behavioral_errors: Array<{
    action: string;
    trigger: string;
    code: string;
    fields: string[];
    expected_markers: Record<string, string>;
  }>;
  tools: string[];
  read_dependencies: Record<string, Array<{ capability_id: string; incarnation_id: string }>>;
  prompt_context: string;
  [key: string]: unknown;
}

export function candidateFrom(row: CapabilityRow): CandidateDraft {
  return structuredClone(capabilitySpecFromRow(row)) as unknown as CandidateDraft;
}

/**
 * A single-shot fake provider for candidate generation: one canned structured
 * response, the prompt and schema recorded for context-pinning assertions.
 * No SDK, no network, no spend.
 */
export function makeCandidateProvider(response: unknown): {
  provider: Provider;
  prompts: string[];
  schemas: ZodType<unknown>[];
} {
  const prompts: string[] = [];
  const schemas: ZodType<unknown>[] = [];
  const provider: Provider = {
    generate<T>(prompt: string, schema: ZodType<T>): GenerateResult<T> {
      prompts.push(prompt);
      schemas.push(schema as ZodType<unknown>);
      async function* stream(): AsyncGenerator<DeepPartial<T>> {
        yield response as DeepPartial<T>;
      }
      return {
        partialStream: stream(),
        object: Promise.resolve(response as T),
        usage: Promise.resolve({ inputTokens: 64, outputTokens: 32, totalTokens: 96 }),
      };
    },
  };
  return { provider, prompts, schemas };
}
