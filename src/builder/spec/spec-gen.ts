// Spec generation (ARCH §6.2 "Capability Builder" step 1,
// §9.1, PLAN decision 8 & flow step 3).
//
// The first real stage of the build job's pipeline: prompt + resolved intent → the
// capability **spec** (`schema + ui_intent + behavior` plus identity and resolver
// context), authored by the model through the provider contract and validated
// against the registry's Zod spec shape. The spec is the diffable source of truth
// everything downstream derives from (ARCH §9.1: "Spec is the source of truth;
// handlers, HTML, and tests always follow"), so this stage is the single gate it
// must clear before anything else sees it.
//
// Validation is the gate into the pipeline. A non-conforming model output is never
// a silently accepted malformed spec flowing downstream — it surfaces as a thrown
// error here, which the build job maps onto its failure path (the warm apology,
// nothing committed). The provider contract already rejects non-conforming objects
// on `.object`; re-parsing here makes the gate this stage's own, not merely the
// spine's, so even a lax provider cannot smuggle a bad spec past it.
//
// The field/action pantry and M3 presentation intent contract are enforced twice
// over: the prompt steers the model inside them (the fixed five Actions, the field
// types, reshaped `ui_intent`, platform-owned columns excluded) and
// `capabilitySpecSchema` is the hard wall that rejects anything outside it.

import type { IntentClassification } from "../../intent-resolver/index.ts";
import type { SendBuildEvent } from "../../pipeline/jobs/build-jobs.ts";
import type { Provider, TokenUsage } from "../../provider/index.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  CHOICE_PRESENTATIONS,
  capabilitySpecSchema,
  FULL_CAPABILITY_TOOLS,
  fieldTypeSchema,
  LOGO_HUE_FAMILIES,
  MAX_CAPABILITY_NOUN_LENGTH,
  MAX_LOGO_SUBJECT_LENGTH,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
  PLATFORM_COLUMNS,
  promptCapabilitySpecSchema,
  uiCollectionLayoutSchema,
} from "../../registry/index.ts";

export interface GenerateSpecInput {
  readonly provider: Provider;
  // The prompt bar text — what the user wants Aluna to keep track of.
  readonly prompt: string;
  // The resolved intent. In M2 the builder only acts on `new_capability`; the
  // stage reads `proposed_action` and `user_facing_label` for context and
  // narration. Carried as the existing classification type so wiring the resolver
  // in front is a pass-through, no shape change here.
  readonly intent: IntentClassification;
  // The job's stream. Narration rides it in product voice while the spec generates.
  readonly send: SendBuildEvent;
}

/**
 * What the stage hands the rest of the pipeline: the validated spec plus the two
 * measurements the build's metrics row records. The metrics *writer* is
 * epic 2.7; this stage's job is to produce the numbers, not persist them.
 */
export interface SpecGenResult {
  readonly spec: CapabilitySpec;
  readonly durationMs: number;
  readonly usage: TokenUsage;
}

/**
 * The instructions the model authors the spec from. Engineering language is fine
 * here — this prompt is model-facing, never user-visible (CONTEXT.md / ARCH §9.7's
 * hard rule governs only what the *user* sees; that is the narration, not this).
 * The pantry lists are read off the registry's own enums so the prompt can never
 * drift from the schema that ultimately gates the output.
 */
export function buildSpecPrompt(input: GenerateSpecInput): string {
  const fieldTypes = fieldTypeSchema.options.join(" | ");
  const collectionLayouts = uiCollectionLayoutSchema.options.join(" | ");
  const choicePresentations = CHOICE_PRESENTATIONS.join(" | ");
  const tools = FULL_CAPABILITY_TOOLS.join(", ");
  const platformColumns = PLATFORM_COLUMNS.join(", ");
  const hues = LOGO_HUE_FAMILIES.join(" | ");

  return [
    "You are Aluna's Capability Builder. Author the capability spec for what the user wants to keep track of.",
    "",
    "The spec is one structured object. Everything else Aluna builds — the data table, the handlers, the presentation surface, the tests — is derived from it, so it must be complete and exact.",
    "",
    "Spec pantry — stay strictly inside it:",
    `- tools: exactly [${tools}] in that canonical order.`,
    '- read_dependencies: exactly five keys in canonical order: { "create": [], "read": [], "update": [], "delete": [], "search": [] }. A fresh capability has no declared external dependencies, so every array is empty.',
    '- schema.fields: at least one field; each field has a stable name, a user-facing label, a type, required (a boolean), and lifecycle: "active".',
    `- a field's type is one of: ${fieldTypes}. string[] is the only list type; no files or relations.`,
    "- a field declares values and groups only when its type is choice. Every other field omits both keys entirely (send null for them in the structured output).",
    "- a choice field declares values: an ordered array of at least one { value, label } option. value is the stored wire value — short, stable, lowercase — and label is the wording a person reads. Values are unique within the field. Use choice whenever the thing being tracked is one pick from a small closed set the user would recognize (a status, a priority, a category), and never a free string with a rule written about it.",
    "- a choice field also declares groups: [] — an empty array. Option grouping is not authored yet.",
    "- field names and the capability id are lowercase letters, digits, and underscores, starting with a letter.",
    `- ${platformColumns} are platform-owned columns Aluna adds automatically. Never include them as fields.`,
    '- created_at may appear only in item shows; its platform descriptor is fixed as name "created_at", label "Created", type "datetime", read-only.',
    "- field names must be unique; tools must be unique.",
    "",
    "Presentation intent:",
    "- ui_intent.item.direction is one concise sentence of capability-specific item design direction.",
    "- ui_intent.form.list_inputs contains exactly one { field, mode } entry for every active string[] field, in schema-field order. It contains no scalar, inactive, or unknown fields.",
    "- list input mode is exactly comma_separated | repeatable. Choose comma_separated only for short atomic values whose grammar cannot meaningfully contain commas (tags, genres, categories, skills). Choose repeatable when an element may contain a comma (quotes, addresses, citations, or names as entered). There is no quoting or escaping in comma_separated mode, so never choose it for comma-bearing element semantics.",
    "- ui_intent.form.choice_inputs contains exactly one { field, presentation } entry for every active choice field, in schema-field order. It contains no non-choice, inactive, or unknown fields.",
    `- choice presentation is exactly ${choicePresentations}.`,
    "- ui_intent.item.shows is the ordered list of active schema field names the item renderer may receive; it may also include created_at.",
    `- ui_intent.collection.layout is one of: ${collectionLayouts}. Use feed for text-forward lists and grid for visually dominant collections.`,
    "- Do not include ui_intent.views. Do not author how a record opens; opening one swaps the collection for its form inside the window, and that is the platform's, not authored state.",
    "",
    "Identity:",
    "- id is the engineering identity (it becomes a table and folder name). Short, lowercase, never shown to the user.",
    '- label is the short user-facing capability name written under its logo on the desk, like "Notes" or "Reading list". It must be a name, not a sentence, narration, promise, or confirmation.',
    "- Every distinct capability must use a meaningful semantic label and id derived from the user's wording. Never create a mechanical numbered or versioned duplicate.",
    `- noun is the singular common noun for one stored record, lowercase, at most ${MAX_CAPABILITY_NOUN_LENGTH} characters — "note", "recipe", "contact". It completes desk copy such as "add your first <noun> above", so it is a bare noun, never a phrase or a plural.`,
    "",
    "The capability's logo — you choose the drawing's subject and its two hues, and nothing else:",
    `- subject is a short noun phrase naming one concrete object that stands for this capability, at most ${MAX_LOGO_SUBJECT_LENGTH} characters — "an open notebook", "a brass telescope", "a stack of recipe cards". One object, plainly named. Never letters, words, initials, logos, or a described scene; never a style, medium, palette, layout, or composition instruction.`,
    "- Derive the subject from what the capability is for, never from art direction in the user's words. This is one instruction about where the subject comes from, not a second refusal: a request that only asks for a particular drawing never reaches you, because the intent classifier refuses presentation-steering prompts the way it refuses any other.",
    `- ground is exactly one of: ${hues}. It is the hue of the flat colour the whole square is filled with, behind the object. Name the hue and nothing more: Aluna resolves which of that hue's four shades this capability actually wears, so two capabilities naming the same hue still come out different colours. Naming the same hue another capability already has is fine.`,
    `- companion is exactly one of the same list and must never be the same value as ground. It is the hue the object itself is drawn in, so name what the object should look like standing on that ground. If the object's own hue is the one you named for the ground, move one of them: two of the same value is not a drawing, it is an object the colour of the wall behind it.`,
    "- There is no default hue and no safe choice. Every hue in the list is equally available to every capability, and none of them is the one a background is normally expected to be. When the subject has no colour of its own — a notebook, a clipboard, a ledger — take the hue from what the capability is *for*, never from what a backdrop usually looks like.",
    "- These three are chosen once, at birth, and can never be changed afterwards. Choose them for the capability as a whole, not for today's wording.",
    ...(input.intent.proposed_identity
      ? [
          "Resolver-owned distinct identity — return these values exactly:",
          `- id: ${input.intent.proposed_identity.id}`,
          `- label: ${input.intent.proposed_identity.label}`,
        ]
      : []),
    "",
    "Other fields:",
    "- behavior: one or two plain sentences describing how this capability behaves (what is required, default ordering). Aluna generates tests from this, so state intent, not implementation.",
    "- behavioral_errors: structured validation-error cases. Product copy is not the contract.",
    `  - If any schema fields are required, include exactly two cases in this order: action "create", then action "update". Both use trigger/code "${MISSING_REQUIRED_FIELDS_ERROR_CODE}", fields set to every active required field name in schema order, and expected_markers exactly ${JSON.stringify(BEHAVIORAL_ERROR_MARKERS)}.`,
    "  - If no fields are required, use an empty array.",
    "  - record_not_found and invalid_choice are platform-owned refusals Aluna answers itself; never author a case for either.",
    "- prompt_context: one concise sentence describing what this capability stores, used later to recognise related requests.",
    "",
    "Resolved intent:",
    `- type: ${input.intent.type}`,
    `- proposed_action: ${input.intent.proposed_action}`,
    `- user_facing_label: ${input.intent.user_facing_label}`,
    "",
    "User's request:",
    input.prompt,
  ].join("\n");
}

/**
 * Run the stage. Narrate in product voice (driven by the intent's
 * `user_facing_label` — never internals: no "spec", no "schema" reaches the user),
 * generate the spec through the contract, validate it as the gate into the
 * pipeline, and capture how long it took and what it cost.
 */
export async function generateSpec(input: GenerateSpecInput): Promise<SpecGenResult> {
  // The one user-visible line for this stage. The label is the intent's warm
  // sentence; nothing about how the spec is built crosses into it.
  await input.send("narration", input.intent.user_facing_label);

  const startedAt = performance.now();

  const result = input.provider.generate(buildSpecPrompt(input), promptCapabilitySpecSchema);
  // The gate. `await result.object` already rejects on non-conformance (the
  // contract's guarantee); re-parsing makes the refusal this stage's own so a
  // malformed spec can never continue downstream regardless of the provider.
  const spec = capabilitySpecSchema.parse(await result.object);
  const usage = await result.usage;

  const durationMs = performance.now() - startedAt;

  return { spec, durationMs, usage };
}
