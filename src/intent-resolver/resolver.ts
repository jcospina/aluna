// Classification-only resolver call - Module 2, Epic 2.4.
//
// This assembles the registry context the Intent Resolver needs and sends exactly
// one structured request through the existing provider contract. It deliberately
// does not decide whether to proceed or deflect; issue 02 wires that business
// path into the build job.

import type { Database } from "bun:sqlite";
import type { Provider } from "../provider/index.ts";
import { type CapabilityRow, listCapabilities } from "../registry/index.ts";
import { type IntentClassification, intentClassificationSchema } from "./schema.ts";

export interface ClassifyIntentInput {
  readonly provider: Provider;
  readonly prompt: string;
  readonly activeCapabilityId?: string | null;
  readonly database?: Database;
}

export interface IntentPromptContext {
  readonly prompt: string;
  readonly capabilities: readonly CapabilityRow[];
  readonly activeCapabilityId?: string | null;
}

function formatCapability(capability: CapabilityRow): string {
  return [
    `- id: ${capability.id}`,
    `  label: ${capability.label}`,
    `  version: ${capability.version}`,
    `  prompt_context: ${capability.prompt_context}`,
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

  return [
    `id: ${active.id}`,
    `label: ${active.label}`,
    `version: ${active.version}`,
    `prompt_context: ${active.prompt_context}`,
  ].join("\n");
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
    "Rules:",
    "- Read every registry row's prompt_context before deciding overlap.",
    "- If the prompt overlaps an existing capability, choose extend_capability; do not invent suffixed duplicate ids.",
    "- target_capability is the existing capability id when one is targeted, otherwise null.",
    "- user_facing_label must be one warm product-voice sentence for the user; do not expose internals.",
    "- requires_confirmation must be false in Module 2.",
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
  const capabilities = listCapabilities(input.database);
  const prompt = buildIntentPrompt({
    prompt: input.prompt,
    capabilities,
    activeCapabilityId: input.activeCapabilityId ?? null,
  });
  const result = input.provider.generate(prompt, intentClassificationSchema);

  return intentClassificationSchema.parse(await result.object);
}
