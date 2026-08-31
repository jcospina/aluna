// Candidate-spec generation (PLAN decisions 1, 2, 4, 22;
// ADR-0006 candidate ownership; ARCH §6.2 evolution steps 1–2).
//
// Evolution's first stage: the AI authors one complete candidate spec for an
// existing capability. It receives exactly four inputs — the
// current committed spec *including every inactive field*, the resolved intent,
// the full field-lifecycle catalog, and the lease-frozen dependency-generation
// catalog — and returns the same canonical authored shape a new capability
// uses. The platform owns lifecycle metadata (incarnation, version, build id,
// snapshot metadata, artifacts_path) and computes every consequence; the AI
// never returns those, nor a patch, migration, or regeneration list.
//
// The two context exclusions are contractual: the capability's own
// inactive fields ARE present (so the model can preserve or reactivate them),
// while inactive *external* fields are NOT (the catalog carries active fields
// only). The context test pins both directions.
//
// Validation is this stage's own gate, exactly like v1 spec-gen: the provider's
// schema conformance is re-checked by `validateCandidateSpec`, which also
// enforces the cross-spec field-lifecycle contract and frozen-catalog
// resolution before anything downstream sees the candidate.

import type { IntentClassification } from "../../intent-resolver/index.ts";
import type { SendBuildEvent } from "../../pipeline/jobs/build-jobs.ts";
import type { Provider, TokenUsage } from "../../provider/index.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilityRow,
  type CapabilitySpec,
  CHOICE_PRESENTATIONS,
  FULL_CAPABILITY_TOOLS,
  fieldTypeSchema,
  LIST_INPUT_MODES,
  MAX_CHOICE_GROUP_HEADING_LENGTH,
  MAX_CHOICE_GROUPS,
  MAX_CHOICE_OPTION_LABEL_LENGTH,
  MAX_CHOICE_OPTION_NOTE_LENGTH,
  MAX_CHOICE_OPTION_VALUE_LENGTH,
  MAX_CHOICE_OPTIONS,
  MAX_DECLARED_MAX_LENGTH,
  MAX_FIELD_GUIDANCE_LENGTH,
  MIN_DECLARED_MAX_LENGTH,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
  PLATFORM_COLUMNS,
  promptCapabilitySpecSchema,
  uiCollectionLayoutSchema,
} from "../../registry/index.ts";
import { committedSpecView, validateCandidateSpec } from "./candidate-validation.ts";
import type { DependencyGenerationCatalogEntry } from "./dependency-catalog.ts";

export interface GenerateCandidateSpecInput {
  readonly provider: Provider;
  /** The exact committed row being evolved — every inactive field included. */
  readonly committed: CapabilityRow;
  /** The Intent Resolver's classification of the typed prompt this evolution answers. */
  readonly intent: IntentClassification;
  /** The immutable active dependency-generation catalog, frozen under the lease. */
  readonly dependencyCatalog: readonly DependencyGenerationCatalogEntry[];
  /** The job's stream. Narration rides it in product voice while the candidate generates. */
  readonly send: SendBuildEvent;
}

export interface CandidateSpecGenResult {
  /** The validated canonical candidate — what the Diff stage receives. */
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
  const choicePresentations = CHOICE_PRESENTATIONS.join(" | ");
  const tools = FULL_CAPABILITY_TOOLS.join(", ");
  const platformColumns = PLATFORM_COLUMNS.join(", ");

  return [
    "You are Aluna's Capability Builder. Evolve an existing capability: author its complete next candidate spec.",
    "",
    "Return one complete candidate spec in the same authored shape as a new capability. The platform owns lifecycle metadata and computes every consequence of your changes. Never return incarnation, version, build id, snapshot metadata, or artifacts_path; never return a patch, a migration, or a regeneration list.",
    "",
    "Evolution contract — the platform validates all of this before anything is built:",
    `- id is immutable. Return exactly "${committed.id}".`,
    `- subject, ground and companion are the logo's birth facts and are immutable. Return exactly "${committed.subject}", "${committed.ground}" and "${committed.companion}". The artwork was drawn once from them and is never redrawn, so a changed value is refused.`,
    "- Return every committed field exactly once, active and inactive alike. Never omit a committed field, rename one, duplicate one, or change an existing field's type. Omission is not a hide.",
    "- A committed choice field's option values are stored data and are immutable. Return every committed value string; you may append new options and you may change everything else an option carries — its label, its note, the group it stands under, whether it is still offered, and the order the options are drawn in. Never remove or rename a committed value.",
    "- Set an option's disabled to true to retire it: records already holding it keep it and go on rendering it, and nobody may newly choose it. This is how an option is taken out of use, because removing it is refused.",
    "- A committed option group's id is fixed. You may reword a heading, reorder the groups, move an option between them, and add a group; you may not rename an id or drop a group an option still names.",
    '- A field committed with lifecycle "inactive" and returned "inactive" must be returned identically.',
    '- Hiding a field (lifecycle "active" → "inactive") may change only its lifecycle — keep its label, required and any declared values exactly as committed.',
    '- Reactivating a field ("inactive" → "active") may also change its label and required.',
    '- A newly introduced field must start lifecycle "active".',
    `- tools: exactly [${tools}] in that canonical order — evolution never changes the Action set.`,
    '- read_dependencies: exactly five keys in canonical order: "create", "read", "update", "delete", "search". Each is an array of { capability_id, incarnation_id } pairs taken exactly from the dependency-generation catalog below, unique and sorted by capability_id then incarnation_id. Never declare this capability itself; keep an Action\'s array empty when it reads nothing external.',
    "- behavioral_errors: every case names one owning action from tools plus trigger, code, fields (active fields only), and expected_markers.",
    `  - If any active fields are required, include exactly two cases in this order: action "create", then action "update". Both use trigger/code "${MISSING_REQUIRED_FIELDS_ERROR_CODE}", fields set to every active required field name in schema order, and expected_markers exactly ${JSON.stringify(BEHAVIORAL_ERROR_MARKERS)}.`,
    "  - If no active fields are required, include no missing_required_fields cases.",
    '  - record_not_found, invalid_choice, choice_disabled and max_length_exceeded are platform-owned; never author any of them. Behavior-specific cases beyond the required pair may target any action in tools; keep every "action"/"trigger"/"code" combination unique.',
    "",
    "Field pantry:",
    `- a field's type is one of: ${fieldTypes}. string[] is the only list type; no files or relations.`,
    "- a field declares values and groups only when its type is choice. Every other field omits both keys entirely (send null for them in the structured output).",
    `- a choice field declares values: an ordered array of at least one option. An option is { value, label, group, note, disabled }, and every option sends all five keys — send null for group, note and disabled when it has none. Values are unique within the field. A note is one short qualifying phrase of at most ${MAX_CHOICE_OPTION_NOTE_LENGTH} characters.`,
    `- an option's value and label are each one line of at most ${MAX_CHOICE_OPTION_VALUE_LENGTH} and ${MAX_CHOICE_OPTION_LABEL_LENGTH} characters, and no authored string an option or a group carries may hold a control character.`,
    `- a choice field declares at most ${MAX_CHOICE_OPTIONS} options and at most ${MAX_CHOICE_GROUPS} groups. Every option is written into the generated code's own instructions, so a set that large is a sign the thing being tracked is a record of its own rather than one pick.`,
    `- a choice field also declares groups: an ordered array of { id, heading }, where heading is at most ${MAX_CHOICE_GROUP_HEADING_LENGTH} characters. Declare groups only when the options fall into named sets a person would look for by heading; [] is the ordinary answer. Every declared group must be named by at least one option, and every option's group must be an id declared on its own field.`,
    `- a field declares max_length only when its type is string. It is a positive integer between ${MIN_DECLARED_MAX_LENGTH} and ${MAX_DECLARED_MAX_LENGTH}, and it is the number of characters that field holds — it drives the character counter under the control, the browser's own stop on typing, and Aluna's own refusal of anything longer. Declare it where a real bound is part of what the field is (a summary that must stay short, a headline, a one-line note); omit it (send null) everywhere else, including on every non-string field. Preserve a hidden field's max_length exactly; only a reactivation may change it. Adding a limit, or lowering one, is refused when any record already holds a longer value, so never tighten a limit the committed data cannot fit.`,
    "- field names and the capability id are lowercase letters, digits, and underscores, starting with a letter. Never use the __aluna_ prefix.",
    `- ${platformColumns} are platform-owned columns Aluna adds automatically. Never include them as fields.`,
    "",
    "Presentation intent:",
    "- ui_intent.item.direction is one concise sentence of capability-specific item design direction.",
    "- ui_intent.form.list_inputs contains exactly one { field, mode } entry for every active string[] field, in schema-field order — no scalar, inactive, or unknown fields. A hidden string[] field loses its entry; a new or reactivated active string[] field gains one.",
    `- list input mode is exactly ${listInputModes}. Choose comma_separated only for short atomic values whose grammar cannot meaningfully contain commas (tags, genres, categories, skills). Choose repeatable when an element may contain a comma (quotes, addresses, citations, or names as entered).`,
    "- ui_intent.form.choice_inputs contains exactly one { field, presentation } entry for every active choice field, in schema-field order — no non-choice, inactive, or unknown fields. A hidden choice field loses its entry; a new or reactivated active choice field gains one.",
    "- ui_intent.form.long_text lists the active string fields drawn as a multi-line box instead of a single-line input, in schema-field order, with no repeats and no non-string, inactive or unknown names. Name every field that holds more than a line — notes, descriptions, summaries, reviews, journal entries, addresses — and leave out titles, names, codes and anything else a single line holds. [] is a fine answer for a capability of short fields. A hidden field loses its entry; a reactivated one may gain it back.",
    `- ui_intent.form.guidance lists { field, text } hints shown under a field, in schema-field order, with no repeats and no inactive or unknown names. text is one line of at most ${MAX_FIELD_GUIDANCE_LENGTH} characters. Use it where the field alone leaves a real question — the format a value should take, what a value will be used for, or the sentence announcing a default ("Defaults to today."). There is no placeholder key: guidance stays visible while the field is being typed into, which is when a hint is being read. Most fields need none, and [] is the ordinary answer. A hidden field loses its entry.`,
    `- choice presentation is exactly ${choicePresentations}, declared per field and never inferred from how many options there happen to be.`,
    "- picker is a drawn dropdown that stays one row tall however long the list is: more than about five options, anything with groups or notes, or a handful drawn out of a larger domain.",
    "- radio stands every option in a column with room for a note under each label: a short set of roughly two to five where seeing them all at once is the point.",
    "- segmented is one joined row of buttons for two or three mutually exclusive states with one- or two-word labels. It is bare buttons with nowhere for a heading or a second line, so a field drawn as segmented must declare no groups and no option notes; declaring either is refused. A set that wants a heading or a note is one the picker or the radio group should draw instead.",
    "- ui_intent.item.shows is an ordered list of active schema field names; it may also include created_at. Never show an inactive field.",
    `- ui_intent.collection.layout is one of: ${collectionLayouts}.`,
    "- Do not include ui_intent.views. Do not author how a record opens; opening one swaps the collection for its form inside the window, and that is the platform's.",
    "",
    "Identity and text:",
    '- label is the short user-facing capability name, like "Notes" or "Reading list" — a name, not a sentence. You may refine it.',
    "- behavior is the capability's semantic contract, not an inventory of its fields or presentation. Preserve the committed behavior byte-for-byte unless the resolved intent explicitly changes a user-observable business rule implemented by one or more Actions.",
    '- Adding, hiding, relabelling, reordering, or visually emphasizing a field does not by itself authorize a behavior rewrite. Put schema facts in schema and visual direction such as "make it stand out" in ui_intent.',
    "- When the intent explicitly changes behavior, return one or two plain sentences of stated intent. Aluna conservatively regenerates every Action's behavioral tests when these bytes change.",
    "- prompt_context describes what the capability stores. Preserve it byte-for-byte unless the resolved intent changes the capability's purpose.",
    '- noun is the singular common noun for one stored record, used in desk copy such as "add your first <noun> above". Preserve it byte-for-byte unless the capability now holds a different kind of thing.',
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
