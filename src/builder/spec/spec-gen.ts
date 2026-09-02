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

import type { IntentClassification } from "../../pipeline/intent/index.ts";
import type { SendBuildEvent } from "../../pipeline/jobs/build-jobs.ts";
import type { Provider, TokenUsage } from "../../platform/provider/index.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  CHOICE_PRESENTATIONS,
  capabilitySpecSchema,
  FULL_CAPABILITY_TOOLS,
  fieldTypeSchema,
  LOGO_HUE_FAMILIES,
  MAX_CAPABILITY_NOUN_LENGTH,
  MAX_CHOICE_GROUP_HEADING_LENGTH,
  MAX_CHOICE_GROUPS,
  MAX_CHOICE_OPTION_LABEL_LENGTH,
  MAX_CHOICE_OPTION_NOTE_LENGTH,
  MAX_CHOICE_OPTION_VALUE_LENGTH,
  MAX_CHOICE_OPTIONS,
  MAX_DECLARED_MAX_LENGTH,
  MAX_FIELD_GUIDANCE_LENGTH,
  MAX_LOGO_SUBJECT_LENGTH,
  MIN_DECLARED_MAX_LENGTH,
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
    "- a choice field declares values: an ordered array of at least one option. An option is { value, label, group, note, disabled }, and every option sends all five keys — send null for group, note and disabled when the option has none. value is the stored wire value — short, stable, lowercase — and label is the wording a person reads. Values are unique within the field. Use choice whenever the thing being tracked is one pick from a small closed set the user would recognize (a status, a priority, a category), and never a free string with a rule written about it.",
    `- an option's value and label are each one line of at most ${MAX_CHOICE_OPTION_VALUE_LENGTH} and ${MAX_CHOICE_OPTION_LABEL_LENGTH} characters, and no authored string an option or a group carries may hold a control character.`,
    `- a choice field declares at most ${MAX_CHOICE_OPTIONS} options and at most ${MAX_CHOICE_GROUPS} groups. Every option is written into the generated code's own instructions, so a set that large is a sign the thing being tracked is a record of its own rather than one pick.`,
    `- an option's note is one short qualifying phrase of at most ${MAX_CHOICE_OPTION_NOTE_LENGTH} characters, such as "closes the record" or "needs a reason". Use it only where the label alone leaves a real question; most options carry none.`,
    "- an option's disabled is true for an option that existing records may still hold but nobody may newly choose. A capability being built for the first time has retired nothing, so send null for every option.",
    `- a choice field also declares groups: an ordered array of { id, heading }, where heading is at most ${MAX_CHOICE_GROUP_HEADING_LENGTH} characters. Declare groups only when the options fall into named sets a person would look for by heading — currencies by continent, statuses by open and closed. A short flat list needs none, and [] is the ordinary answer. Every declared group must be named by at least one option, and every option's group must be an id declared on its own field.`,
    `- a field declares max_length only when its type is string. It is a positive integer between ${MIN_DECLARED_MAX_LENGTH} and ${MAX_DECLARED_MAX_LENGTH}, and it is the number of characters that field holds — it drives the character counter under the control, the browser's own stop on typing, and Aluna's own refusal of anything longer. Declare it where a real bound is part of what the field is (a summary that must stay short, a headline, a one-line note); omit it (send null) everywhere else, including on every non-string field.`,
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
    "- ui_intent.form.long_text lists the active string fields drawn as a multi-line box instead of a single-line input, in schema-field order, with no repeats and no non-string, inactive or unknown names. Name every field that holds more than a line — notes, descriptions, summaries, reviews, journal entries, addresses — and leave out titles, names, codes and anything else a single line holds. [] is a fine answer for a capability of short fields.",
    `- ui_intent.form.guidance lists { field, text } hints shown under a field, in schema-field order, with no repeats and no inactive or unknown names. text is one line of at most ${MAX_FIELD_GUIDANCE_LENGTH} characters. Use it where the field alone leaves a real question — the format a value should take, what a value will be used for, or the sentence announcing a default ("Defaults to today."). There is no placeholder key: guidance stays visible while the field is being typed into, which is when a hint is being read. Most fields need none, and [] is the ordinary answer.`,
    `- choice presentation is exactly ${choicePresentations}, declared per field and never inferred from how many options there happen to be.`,
    "- picker is a drawn dropdown that stays one row tall however long the list is, and it is the control that scales. Choose it for more than about five options, for anything with groups or notes, and whenever the options are a handful drawn out of a larger domain — a currency, a country, one category out of thirty.",
    "- radio stands every option in a column, each with room for a note under its label. Choose it for a short set of roughly two to five where seeing all the options at once is the point, such as payment terms or a delivery speed. It shows groups and notes as the picker does, at the cost of a column of space.",
    "- segmented is one joined row of buttons, read at a glance and switched between. Choose it only for two or three mutually exclusive states whose labels are one or two words — feed and grid, draft and published, day and week and month. It is a row of bare buttons with nowhere to put a heading or a second line, so a field drawn as segmented must declare no groups and no option notes; declaring either is refused. A set that wants a heading or a note is one the picker or the radio group should draw instead.",
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
    "  - record_not_found, invalid_choice, choice_disabled and max_length_exceeded are platform-owned refusals Aluna answers itself; never author a case for any of them.",
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
