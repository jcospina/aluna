// Spec generation — Module 2, Epic 2.5 (ARCH §6.2 "Capability Builder" step 1,
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
// over: the prompt steers the model inside them (create+read tools, the field
// types, reshaped `ui_intent`, platform-owned columns excluded) and
// `capabilitySpecSchema` is the hard wall that rejects anything outside it.

import type { SendBuildEvent } from "../build-jobs.ts";
import type { IntentClassification } from "../intent-resolver/index.ts";
import type { Provider, TokenUsage } from "../provider/index.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  capabilitySpecSchema,
  capabilityToolSchema,
  fieldTypeSchema,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
  PLATFORM_COLUMNS,
  uiCollectionLayoutSchema,
} from "../registry/index.ts";

export interface GenerateSpecInput {
  readonly provider: Provider;
  // The prompt bar text — what the user wants Aluna to keep track of.
  readonly prompt: string;
  // The resolved intent. In M2 the builder only acts on `new_capability`; the
  // stage reads `proposed_action` and `user_facing_label` for context and
  // narration. Carried as the existing classification type so wiring the resolver
  // in front (epic 2.4) is a pass-through, no shape change here.
  readonly intent: IntentClassification;
  // The job's stream. Narration rides it in product voice while the spec generates.
  readonly send: SendBuildEvent;
}

// What the stage hands the rest of the pipeline: the validated spec plus the two
// measurements the build's metrics row records (ARCH §6.2). The metrics *writer* is
// epic 2.7; this stage's job is to produce the numbers, not persist them.
export interface SpecGenResult {
  readonly spec: CapabilitySpec;
  readonly durationMs: number;
  readonly usage: TokenUsage;
}

// The instructions the model authors the spec from. Engineering language is fine
// here — this prompt is model-facing, never user-visible (CONTEXT.md / ARCH §9.7's
// hard rule governs only what the *user* sees; that is the narration, not this).
// The pantry lists are read off the registry's own enums so the prompt can never
// drift from the schema that ultimately gates the output.
export function buildSpecPrompt(input: GenerateSpecInput): string {
  const fieldTypes = fieldTypeSchema.options.join(" | ");
  const collectionLayouts = uiCollectionLayoutSchema.options.join(" | ");
  const tools = capabilityToolSchema.options.join(", ");
  const platformColumns = PLATFORM_COLUMNS.join(", ");

  return [
    "You are Aluna's Capability Builder. Author the capability spec for what the user wants to keep track of.",
    "",
    "The spec is one structured object. Everything else Aluna builds — the data table, the handlers, the presentation surface, the tests — is derived from it, so it must be complete and exact.",
    "",
    "Spec pantry — stay strictly inside it:",
    `- tools: only ${tools}.`,
    "- schema.fields: at least one field; each field has a name, a type, and required (a boolean).",
    `- a field's type is one of: ${fieldTypes}. No list types, no files, no relations.`,
    "- field names and the capability id are lowercase letters, digits, and underscores, starting with a letter.",
    `- ${platformColumns} are platform-owned columns Aluna adds automatically. Never include them as fields.`,
    "- field names must be unique; tools must be unique.",
    "",
    "Presentation intent:",
    "- ui_intent.item is one concise sentence of capability-specific item design direction.",
    `- ui_intent.collection.layout is one of: ${collectionLayouts}. Use feed for text-forward lists and grid for visually dominant collections.`,
    "- ui_intent.detail.shows is the ordered list of schema field names the read-only detail surface should show.",
    "- Do not include ui_intent.views. Do not include modal: true; the shared modal is a platform invariant, not authored state.",
    "",
    "Identity:",
    "- id is the engineering identity (it becomes a table and folder name). Short, lowercase, never shown to the user.",
    '- label is the short user-facing capability name shown in the toolbar, like "Notes" or "Reading list". It must be a name, not a sentence, narration, promise, or confirmation.',
    "",
    "Other fields:",
    "- behavior: one or two plain sentences describing how this capability behaves (what is required, default ordering). Aluna generates tests from this, so state intent, not implementation.",
    "- behavioral_errors: structured validation-error cases. Product copy is not the contract.",
    `  - If any schema fields are required, include one case with action "create", trigger/code "${MISSING_REQUIRED_FIELDS_ERROR_CODE}", fields set to every required field name in schema order, and expected_markers exactly ${JSON.stringify(BEHAVIORAL_ERROR_MARKERS)}.`,
    "  - If no fields are required, use an empty array.",
    "- prompt_context: one concise sentence describing what this capability stores, used later to recognise related requests.",
    "",
    "Resolved intent:",
    `- proposed_action: ${input.intent.proposed_action}`,
    `- user_facing_label: ${input.intent.user_facing_label}`,
    "",
    "User's request:",
    input.prompt,
  ].join("\n");
}

// Run the stage. Narrate in product voice (driven by the intent's
// `user_facing_label` — never internals: no "spec", no "schema" reaches the user),
// generate the spec through the contract, validate it as the gate into the
// pipeline, and capture how long it took and what it cost.
export async function generateSpec(input: GenerateSpecInput): Promise<SpecGenResult> {
  // The one user-visible line for this stage. The label is the intent's warm
  // sentence; nothing about how the spec is built crosses into it.
  await input.send("narration", input.intent.user_facing_label);

  const startedAt = performance.now();

  const result = input.provider.generate(buildSpecPrompt(input), capabilitySpecSchema);
  // The gate. `await result.object` already rejects on non-conformance (the
  // contract's guarantee); re-parsing makes the refusal this stage's own so a
  // malformed spec can never continue downstream regardless of the provider.
  const spec = capabilitySpecSchema.parse(await result.object);
  const usage = await result.usage;

  const durationMs = performance.now() - startedAt;

  return { spec, durationMs, usage };
}

// Until the intent resolver is wired in front of the builder (epic 2.4), the build
// pipeline runs spec generation from a hardcoded `new_capability` intent — the
// PLAN's build order is explicit that 2.5 lands "hardcoded intent first," before
// 2.4 moves in front (PLAN §"Sensible build order"). This produces that stand-in
// from the raw prompt so the stage is exercisable end-to-end before the resolver
// exists; once it does, a real `IntentClassification` flows through unchanged.
export function hardcodedNewCapabilityIntent(prompt: string): IntentClassification {
  return {
    type: "new_capability",
    confidence: 1,
    target_capability: null,
    proposed_action: `Build a new capability for: ${prompt}`,
    user_facing_label: "Got it. I'm putting that together now.",
    requires_confirmation: false,
  };
}
