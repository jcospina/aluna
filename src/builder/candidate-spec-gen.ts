// Candidate-spec generation — Module 4.6/01 (PLAN decisions 1, 2, 4, 22;
// ADR-0006 candidate ownership; ARCH §6.2 evolution steps 1–2).
//
// Evolution's first stage: the AI authors one complete candidate spec for an
// existing capability. It receives exactly four inputs (decision 1) — the
// current committed spec *including every inactive field*, the resolved intent,
// the full field-lifecycle catalog, and the lease-frozen dependency-generation
// catalog — and returns the same canonical authored shape a new capability
// uses. The platform owns lifecycle metadata (incarnation, version, build id,
// snapshot metadata, artifacts_path) and computes every consequence; the AI
// never returns those, nor a patch, migration, or regeneration list.
//
// The two context exclusions are contractual (decision 2): the capability's own
// inactive fields ARE present (so the model can preserve or reactivate them),
// while inactive *external* fields are NOT (the catalog carries active fields
// only). The context test pins both directions.
//
// Validation is this stage's own gate, exactly like v1 spec-gen: the provider's
// schema conformance is re-checked by `validateCandidateSpec`, which also
// enforces the cross-spec field-lifecycle contract and frozen-catalog
// resolution before anything downstream sees the candidate.

import type { SendBuildEvent } from "../build-jobs.ts";
import type { IntentClassification } from "../intent-resolver/index.ts";
import type { Provider, TokenUsage } from "../provider/index.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilityRow,
  type CapabilitySpec,
  FULL_CAPABILITY_TOOLS,
  fieldTypeSchema,
  LIST_INPUT_MODES,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
  PLATFORM_COLUMNS,
  promptCapabilitySpecSchema,
  uiCollectionLayoutSchema,
} from "../registry/index.ts";
import { committedSpecView, validateCandidateSpec } from "./candidate-validation.ts";
import type { DependencyGenerationCatalogEntry } from "./dependency-catalog.ts";

export interface GenerateCandidateSpecInput {
  readonly provider: Provider;
  /** The exact committed row being evolved — every inactive field included. */
  readonly committed: CapabilityRow;
  /**
   * The resolved intent. Until epic 4.8 wires the real resolver in front, this
   * is hand-supplied through the dev tracer seam (`handSuppliedEvolutionIntent`).
   */
  readonly intent: IntentClassification;
  /** The immutable active dependency-generation catalog, frozen under the lease. */
  readonly dependencyCatalog: readonly DependencyGenerationCatalogEntry[];
  /** The job's stream. Narration rides it in product voice while the candidate generates. */
  readonly send: SendBuildEvent;
}

export interface CandidateSpecGenResult {
  /** The validated canonical candidate — what the Diff stage (4.6/02) receives. */
  readonly candidate: CapabilitySpec;
  readonly durationMs: number;
  readonly usage: TokenUsage;
}

/**
 * The instructions the model authors the candidate from. Engineering language is
 * fine here — model-facing, never user-visible (ARCH §9.7 governs narration
 * only). Pantry lists are read off the registry's own enums so the prompt can
 * never drift from the schema that gates the output.
 */
export function buildCandidateSpecPrompt(input: GenerateCandidateSpecInput): string {
  const committed = committedSpecView(input.committed);
  const fieldTypes = fieldTypeSchema.options.join(" | ");
  const collectionLayouts = uiCollectionLayoutSchema.options.join(" | ");
  const listInputModes = LIST_INPUT_MODES.join(" | ");
  const tools = FULL_CAPABILITY_TOOLS.join(", ");
  const platformColumns = PLATFORM_COLUMNS.join(", ");

  return [
    "You are Aluna's Capability Builder. Evolve an existing capability: author its complete next candidate spec.",
    "",
    "Return one complete candidate spec in the same authored shape as a new capability. The platform owns lifecycle metadata and computes every consequence of your changes. Never return incarnation, version, build id, snapshot metadata, or artifacts_path; never return a patch, a migration, or a regeneration list.",
    "",
    "Evolution contract — the platform validates all of this before anything is built:",
    `- id is immutable. Return exactly "${committed.id}".`,
    "- Return every committed field exactly once, active and inactive alike. Never omit a committed field, rename one, duplicate one, or change an existing field's type. Omission is not a hide.",
    '- A field committed with lifecycle "inactive" and returned "inactive" must be returned identically.',
    '- Hiding a field (lifecycle "active" → "inactive") may change only its lifecycle — keep its label and required exactly as committed.',
    '- Reactivating a field ("inactive" → "active") may also change its label and required.',
    '- A newly introduced field must start lifecycle "active".',
    `- tools: exactly [${tools}] in that canonical order — evolution never changes the Action set.`,
    '- read_dependencies: exactly five keys in canonical order: "create", "read", "update", "delete", "search". Each is an array of { capability_id, incarnation_id } pairs taken exactly from the dependency-generation catalog below, unique and sorted by capability_id then incarnation_id. Never declare this capability itself; keep an Action\'s array empty when it reads nothing external.',
    "- behavioral_errors: every case names one owning action from tools plus trigger, code, fields (active fields only), and expected_markers.",
    `  - If any active fields are required, include exactly two cases in this order: action "create", then action "update". Both use trigger/code "${MISSING_REQUIRED_FIELDS_ERROR_CODE}", fields set to every active required field name in schema order, and expected_markers exactly ${JSON.stringify(BEHAVIORAL_ERROR_MARKERS)}.`,
    "  - If no active fields are required, include no missing_required_fields cases.",
    '  - record_not_found is platform-owned; never author it. Behavior-specific cases beyond the required pair may target any action in tools; keep every "action"/"trigger"/"code" combination unique.',
    "",
    "Field pantry:",
    `- a field's type is one of: ${fieldTypes}. string[] is the only list type; no files or relations.`,
    "- field names and the capability id are lowercase letters, digits, and underscores, starting with a letter. Never use the __aluna_ prefix.",
    `- ${platformColumns} are platform-owned columns Aluna adds automatically. Never include them as fields.`,
    "",
    "Presentation intent:",
    "- ui_intent.item.direction is one concise sentence of capability-specific item design direction.",
    "- ui_intent.form.list_inputs contains exactly one { field, mode } entry for every active string[] field, in schema-field order — no scalar, inactive, or unknown fields. A hidden string[] field loses its entry; a new or reactivated active string[] field gains one.",
    `- list input mode is exactly ${listInputModes}. Choose comma_separated only for short atomic values whose grammar cannot meaningfully contain commas (tags, genres, categories, skills). Choose repeatable when an element may contain a comma (quotes, addresses, citations, or names as entered).`,
    "- ui_intent.item.shows and ui_intent.detail.shows are ordered lists of active schema field names; they may also include created_at. Never show an inactive field.",
    `- ui_intent.collection.layout is one of: ${collectionLayouts}.`,
    "- Do not include ui_intent.views. Do not include modal: true; the shared modal is a platform invariant.",
    "",
    "Identity and text:",
    '- label is the short user-facing capability name, like "Notes" or "Reading list" — a name, not a sentence. You may refine it.',
    "- behavior: one or two plain sentences of stated intent. Aluna generates tests from this.",
    "- prompt_context: one concise sentence describing what this capability stores.",
    "",
    "Current committed spec (including inactive fields):",
    JSON.stringify(committed, null, 2),
    "",
    "Field-lifecycle catalog — every committed field you must return exactly once:",
    ...committed.schema.fields.map(
      (field) =>
        `- ${field.name} (${field.type}) — lifecycle ${field.lifecycle}, label "${field.label}", required ${field.required}`,
    ),
    "",
    "Dependency-generation catalog — every other capability you may declare a read dependency on (active fields only):",
    ...(input.dependencyCatalog.length > 0
      ? [JSON.stringify(input.dependencyCatalog, null, 2)]
      : ["- none: declare no external dependencies."]),
    "",
    "Resolved intent:",
    `- type: ${input.intent.type}`,
    `- target_capability: ${input.intent.target_capability ?? committed.id}`,
    `- proposed_action: ${input.intent.proposed_action}`,
    "",
    "Apply the resolved intent to the committed spec and return the complete candidate. Change only what the intent asks for and what the contract requires to keep the candidate consistent.",
  ].join("\n");
}

/**
 * Run the stage: narrate in product voice, author the candidate through the
 * provider contract, and validate it completely — structural shape, cross-spec
 * field lifecycle, and frozen-catalog resolution — before anything downstream
 * sees it. Throws `CandidateValidationError` on rejection.
 */
export async function generateCandidateSpec(
  input: GenerateCandidateSpecInput,
): Promise<CandidateSpecGenResult> {
  await input.send("narration", input.intent.user_facing_label);

  const startedAt = performance.now();

  const result = input.provider.generate(
    buildCandidateSpecPrompt(input),
    promptCapabilitySpecSchema,
  );
  // The gate is this stage's own: even a lax provider cannot smuggle a candidate
  // past the total validation contract.
  const candidate = validateCandidateSpec({
    committed: input.committed,
    candidate: await result.object,
    dependencyCatalog: input.dependencyCatalog,
  });
  const usage = await result.usage;

  const durationMs = performance.now() - startedAt;

  return { candidate, durationMs, usage };
}

/**
 * TEMPORARY dev tracer seam — Module 4.6/01. Until epic 4.8 wires the real
 * Intent Resolver in front of evolution, the resolved intent is hand-supplied:
 * a developer targets a live capability and types the change in plain words.
 * This constructs the same `IntentClassification` shape the resolver will emit,
 * so 4.8 replaces this function with a real classification, nothing downstream
 * changes shape, and the seam disappears with 4.6/05's tracer cleanup.
 */
export function handSuppliedEvolutionIntent(
  committed: Pick<CapabilityRow, "id">,
  typedIntent: string,
): IntentClassification {
  return {
    type: "extend_capability",
    confidence: 1,
    target_capability: committed.id,
    proposed_action: typedIntent,
    user_facing_label: "Let me think through that change.",
    requires_confirmation: false,
  };
}
