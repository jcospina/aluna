// Classification-only resolver call - Module 2, Epic 2.4.
//
// This assembles the registry context the Intent Resolver needs and sends exactly
// one structured request through the existing provider contract. It deliberately
// does not decide whether to proceed or deflect; issue 02 wires that business
// path into the build job.

import type { Database } from "bun:sqlite";
import type { Provider, TokenUsage } from "../provider/index.ts";
import {
  type ActiveRegistryCatalog,
  type CapabilityRow,
  readActiveRegistryCatalog,
} from "../registry/index.ts";
import { type IntentClassification, intentClassificationSchema } from "./schema.ts";

export const INTENT_RESOLUTION_NARRATION =
  "I'm sorting out whether this is a new place or belongs with something you've already started. ";

export type IntentResolverSend = (event: "narration", data: string) => Promise<void>;

export interface ClassifyIntentInput {
  readonly provider: Provider;
  readonly prompt: string;
  readonly activeCapabilityId?: string | null;
  /** One already-read resolver catalog. When present, the resolver performs no registry read. */
  readonly catalog?: ActiveRegistryCatalog;
  readonly database?: Database;
  readonly send?: IntentResolverSend;
}

export interface IntentPromptContext {
  readonly prompt: string;
  readonly capabilities: readonly CapabilityRow[];
  readonly activeCapabilityId?: string | null;
}

export interface ClassifyIntentResult {
  readonly intent: IntentClassification;
  readonly usage: TokenUsage;
  readonly durationMs: number;
  readonly catalogFingerprint: string;
}

function formatCapability(capability: CapabilityRow): string {
  const listInputModes = new Map(
    capability.ui_intent.form.list_inputs.map((entry) => [entry.field, entry.mode]),
  );
  const fields = capability.schema.fields.map((field) => {
    const mode = listInputModes.get(field.name);
    return `    - ${field.name}: ${field.type}, lifecycle ${field.lifecycle}${mode ? `, list_input ${mode}` : ""}`;
  });
  return [
    `- id: ${capability.id}`,
    `  label: ${capability.label}`,
    `  version: ${capability.version}`,
    `  prompt_context: ${capability.prompt_context}`,
    "  content_free_field_catalog:",
    ...fields,
  ].join("\n");
}

function formatRegistry(capabilities: readonly CapabilityRow[]): string {
  if (capabilities.length === 0) {
    return "- none";
  }

  return capabilities.map(formatCapability).join("\n");
}

function formatActiveCapability(context: IntentPromptContext): string {
  if (!context.activeCapabilityId) {
    return "none";
  }

  const active = context.capabilities.find(
    (capability) => capability.id === context.activeCapabilityId,
  );

  if (!active) {
    return `${context.activeCapabilityId} (not found in registry)`;
  }

  return formatCapability(active).replace(/^- /, "");
}

export function buildIntentPrompt(context: IntentPromptContext): string {
  return [
    "You are Aluna's Intent Resolver. Classify the prompt bar text into one structured intent.",
    "",
    "Use the complete intent type language exactly as provided by the schema:",
    "- new_capability: the user wants Aluna to keep track of a new kind of thing.",
    "- extend_capability: the user wants to add, change, or keep tracking something that overlaps an existing capability.",
    "- ui_change: the user wants the presentation or interaction of an existing capability to change.",
    "- data_query: the user wants to find, summarize, filter, or ask about stored data.",
    "- reject: the prompt is unclear, unsafe, unrelated to Aluna, or cannot be handled as an app-building intent.",
    "",
    "Existing capability and overlap check — do this before deciding:",
    "- The registry context below is the complete list of existing capabilities Aluna already has.",
    "- Compare the prompt against every capability's id, label, prompt_context, and content-free field catalog.",
    "- The active capability is strong context for vague references such as 'this', 'these', or an unnamed change.",
    "- Explicit wording overrides active context when the user names another capability or asks for a distinct context/lifecycle.",
    "- Choose extend_capability when the request changes the same collection, subject, or lifecycle.",
    "- Choose new_capability with resolution namespace when the request overlaps an existing subject but explicitly separates a distinct context or lifecycle.",
    "- A namespace resolution creates one fully independent capability. Its label and eventual id must carry the meaningful distinction, such as Work contacts / work_contacts, never contacts_2.",
    "- Do not choose extend_capability just because a generic capability could technically hold the information as unstructured text.",
    "- Do not overspecialize an existing capability with fields or behavior that belong to a different real-world thing.",
    "- Choose new_capability when the prompt names a distinct kind of thing with its own natural structure, even if an existing capability could store it loosely.",
    "- Repeated requests, renamed wording, richer wording, or overlapping field ideas are not new capabilities when they keep the same subject.",
    "- Example: if Notes exists, 'I want to keep track of my recipes' is new_capability, because recipes naturally have ingredients, steps, cuisine, and meal structure.",
    "- Example: if Notes exists, 'add due dates to my notes' is extend_capability, because it evolves Notes itself.",
    "- Example: if Notes exists, 'let me store notes with images' is extend_capability, because it still targets notes.",
    "- Example: if Contacts exists, 'track my work contacts separately' is new_capability with resolution namespace, because it asks for an independent work lifecycle. The meaningful name is Work contacts, not contacts_2.",
    "",
    "Capability-outcome scope:",
    "- Users state outcomes. Ignore requests to choose field types, migrations, frameworks, generated code, CSS tokens, or repair steps.",
    "- Existing field types never change in place.",
    "- ui_change is limited to capability labels, field labels, detail visibility/order, item direction/dependencies, feed or grid layout, and active string[] list input modes. Use the field catalog to verify type and lifecycle before classifying.",
    "- Adding/hiding data, changing requiredness, or changing behavior is extend_capability even when phrased cosmetically, such as 'show a new due date prominently'.",
    "- A compact comma-separated list input is suitable only for comma-free atomic elements such as tags, genres, categories, or skills.",
    "- Quotes, addresses, citations, and names as entered may contain commas. Never propose comma-separated input for them merely to make a form compact.",
    "- There is no preview-adjust-approve coding loop.",
    "",
    "Structured-output rules:",
    "- resolution is new for an unrelated new capability, namespace for a meaningfully separate overlapping capability, extend for extend_capability/ui_change, and none for data_query/reject.",
    '- proposed_identity is { id, label } only for namespace: bind the meaningful distinction independently before Builder work (for example { id: "work_contacts", label: "Work contacts" }). It is null for every other resolution.',
    "- target_capability is the overlapping existing capability id for namespace and the existing target for extend/ui_change; it is null for unrelated new capabilities and reject.",
    "- user_facing_label must be one warm product-voice sentence for the user; do not expose internals.",
    "- requires_confirmation must be false in the explicit loop.",
    "",
    "Registry context:",
    formatRegistry(context.capabilities),
    "",
    "Active capability:",
    formatActiveCapability(context),
    "",
    "Prompt bar text:",
    context.prompt,
  ].join("\n");
}

export async function classifyIntent(input: ClassifyIntentInput): Promise<IntentClassification> {
  return (await classifyIntentWithUsage(input)).intent;
}

export async function classifyIntentWithUsage(
  input: ClassifyIntentInput,
): Promise<ClassifyIntentResult> {
  const catalog = input.catalog ?? readActiveRegistryCatalog(input.database);
  const prompt = buildIntentPrompt({
    prompt: input.prompt,
    capabilities: catalog.capabilities,
    activeCapabilityId: input.activeCapabilityId ?? null,
  });
  await input.send?.("narration", INTENT_RESOLUTION_NARRATION);
  const startedAt = performance.now();
  const result = input.provider.generate(prompt, intentClassificationSchema);
  const intent = intentClassificationSchema.parse(await result.object);
  const usage = await result.usage;

  return {
    intent,
    usage,
    durationMs: performance.now() - startedAt,
    catalogFingerprint: catalog.fingerprint,
  };
}
