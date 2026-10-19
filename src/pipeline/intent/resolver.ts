// Classification-only resolver call.
//
// This assembles the registry context the Intent Resolver needs and sends exactly
// one structured request through the existing provider contract. It deliberately
// does not decide whether to proceed or deflect; that business path is wired
// into the build job.

import type { Database } from "bun:sqlite";
import type { Provider, TokenUsage } from "../../platform/provider/index.ts";
import {
  type ActiveRegistryCatalog,
  type CapabilityRow,
  canonicalCapabilityLabel,
  readActiveRegistryCatalog,
} from "../../registry/index.ts";
import { renderPromptNotice } from "../../server/http/fragments/fragments.ts";
import { type IntentClassification, intentClassificationSchema } from "./schema.ts";

/**
 * What the existing `target_capability` field means on a question. The rule
 * beside it enumerates the build intents and leaves a question's unsaid, so the field arrives
 * null whatever is standing; this is the sentence that lets the open window through it.
 */
export const INTENT_DATA_QUERY_CONTEXT_RULE =
  "- On a data_query, target_capability is the active capability when the question leans on it for a vague word — these, ones, how many did I add — and null when the question names its own subject. It says what those words point at; it never limits what may be searched.";

export const INTENT_RESOLUTION_NARRATION =
  "I'm sorting out whether this is a new place or belongs with something you've already started. ";

/**
 * Aluna working out what a sentence is belongs on the prompt bar, not in a window. It used to
 * ride `narration`, which lands in the window and so reveals a frame the prompt stood up before
 * anything is known — a frame a question never wanted, which then read as a
 * window minimising when the answer opened elsewhere. Nothing is placed in a window now.
 */
export function renderResolvingNotice(): string {
  return renderPromptNotice(INTENT_RESOLUTION_NARRATION.trim());
}

export type IntentResolverSend = (event: "narration" | "fragment", data: string) => Promise<void>;

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
    // The effective label, which is the name the person would use for this in a prompt.
    // A capability they renamed is one they will ask for by its new name.
    `  label: ${canonicalCapabilityLabel(capability)}`,
    `  noun: ${capability.noun}`,
    `  plural_noun: ${capability.plural_noun}`,
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

/**
 * The opening line of every classification prompt. A fake provider matches the resolver's own
 * call against this constant, so neither queue position nor a reworded copy can drift from it.
 */
export const INTENT_RESOLVER_PROMPT_PREFIX = "You are Aluna's Intent Resolver.";

export function buildIntentPrompt(context: IntentPromptContext): string {
  return [
    `${INTENT_RESOLVER_PROMPT_PREFIX} Classify the prompt bar text into one structured intent.`,
    "",
    "Use the complete intent type language exactly as provided by the schema:",
    "- new_capability: the user wants Aluna to keep track of a new kind of thing.",
    "- extend_capability: the user wants the records an existing capability already keeps to hold or do something more or different, or asks again for what it already keeps.",
    "- ui_change: the user wants the presentation or interaction of an existing capability to change.",
    "- data_query: the user wants to find, summarize, filter, or ask about stored data.",
    "- reject: the prompt is unclear, unsafe, unrelated to Aluna, or cannot be handled as an app-building intent.",
    "",
    "Existing capability and overlap check — do this before deciding:",
    "- The registry context below is the complete list of existing capabilities Aluna already has.",
    "- Compare the prompt against every capability's id, label, noun, plural_noun, prompt_context, and content-free field catalog.",
    "- The active capability is strong context for vague references such as 'this', 'these', or an unnamed change.",
    "- Explicit wording overrides active context when the user names another capability or asks for a distinct context/lifecycle.",
    "- Choose extend_capability when each record the request describes is still one of that capability's records, in the same lifecycle.",
    "- A request whose records are not already an existing capability's records, but each name one record another capability holds, is a new capability, even when its wording names that capability's subject: a count of the copies of a book is a record of its own about one book. Choose new_capability with resolution new, and flag the capability that holds those records (see the related-capability check below).",
    "- Choose new_capability with resolution namespace when the request keeps the same kind of record as an existing capability but explicitly separates a distinct context or lifecycle. A request whose records each name a record an existing capability holds is never a namespace of it.",
    "- A namespace resolution creates one fully independent capability. Its label and eventual id must carry the meaningful distinction, such as Work contacts / work_contacts, never contacts_2.",
    "- Do not choose extend_capability just because a generic capability could technically hold the information as unstructured text.",
    "- Do not overspecialize an existing capability with fields or behavior that belong to a different real-world thing.",
    "- Choose new_capability when the prompt names a distinct kind of thing with its own natural structure, even if an existing capability could store it loosely.",
    "- Repeated requests, renamed wording, richer wording, or overlapping field ideas are not new capabilities when their records are still the same capability's records.",
    "- Example: if Notes exists, 'I want to keep track of my recipes' is new_capability, because recipes naturally have ingredients, steps, cuisine, and meal structure.",
    "- Example: if Notes exists, 'add due dates to my notes' is extend_capability, because it evolves Notes itself.",
    "- Example: if Notes exists, 'let me store notes with images' is extend_capability, because it still targets notes.",
    "- Example: if Books exists, 'add the number of pages to my books' is extend_capability, because each record is still one of the books.",
    "- Example: if Contacts exists, 'track my work contacts separately' is new_capability with resolution namespace, because it asks for an independent work lifecycle. The meaningful name is Work contacts, not contacts_2.",
    "",
    "Related-capability check — do this with the overlap check:",
    "- related_capabilities names the other existing capabilities whose records this request is about. Judge each one by its prompt_context and its noun, never by its field names: Movies, Books and Articles each have a title, and none of them is about another's records.",
    "- Ask of each other existing capability: does each record this request creates, or the field an extension adds to each record, name one record that capability already holds? Never ask whether the request's fields exist elsewhere.",
    "- Read the request's wording: 'copies of each book' and 'which book' point at records already there, while 'track my movies' and 'keep my recipes' start collections of their own.",
    "- [] is the ordinary answer. Most requests start something of their own, so flag a capability only when the request's records point at its records.",
    "- Example: if Books exists, 'keep count of the copies I own of each book' is new_capability with related_capabilities [\"books\"]: each record counts the copies of one book that Books already holds.",
    "- Example: if Books exists, 'log the films I see' is new_capability with related_capabilities []: a film is its own kind of record, though films and books both have a title.",
    "- Example: if Books exists, 'what I thought of each book I finish' is new_capability with related_capabilities [\"books\"]: each review is about one book.",
    "- Example: if Books exists, 'my board games' is new_capability with related_capabilities []: a board game is not one of the books.",
    "- Example: if Books and Authors exist, 'add the author to each of my books' is extend_capability of books with related_capabilities [\"authors\"]: the field it adds names one author that Authors holds.",
    "- Example: if Books and Authors exist, 'add the number of pages to my books' is extend_capability of books with related_capabilities []: a page count names no record.",
    "- Some requests read either way. A wish list beside Books, or a reading list beside a reading log, may hold the books already kept or books of its own; decide from the wording, and flag the capability only when the wording points at records it already holds.",
    "- A flag never changes target_capability or proposed_identity: both are decided exactly as above.",
    "",
    "Capability-outcome scope:",
    "- Users state outcomes. Ignore requests to choose field types, migrations, frameworks, generated code, CSS tokens, or repair steps.",
    "- Existing field types never change in place.",
    "- ui_change is limited to capability labels, the word a capability calls one of its records, field labels, detail visibility/order, item direction/dependencies, feed or grid layout, active string[] list input modes, whether an active string field is typed into a multi-line box, and the one line of guidance shown under a field. Use the field catalog to verify type and lifecycle before classifying.",
    '- Example: "give me more room to write in the notes field" and "put a hint under the date field saying it defaults to today" are both ui_change: neither stores anything new, and neither changes what a record means.',
    "- A presentation request outside that closed list is reject, never ui_change. How a thing looks — its colour, size, spacing, position, type, or any other art direction — is Aluna's to decide, not the user's to state, so there is nothing to classify as a change.",
    '- Example: "move this 2px right", "add more padding", and "make it blue and bigger" are all reject, because each states presentation rather than an outcome.',
    "- Adding/hiding data, changing requiredness, or changing behavior is extend_capability even when phrased cosmetically, such as 'show a new due date prominently'.",
    "- A compact comma-separated list input is suitable only for comma-free atomic elements such as tags, genres, categories, or skills.",
    "- Quotes, addresses, citations, and names as entered may contain commas. Never propose comma-separated input for them merely to make a form compact.",
    "- There is no preview-adjust-approve coding loop.",
    "",
    "Structured-output rules:",
    "- resolution is new for a new capability keeping a kind of record no existing capability keeps, including one whose records each name a record another capability holds; namespace for a meaningfully separate capability keeping the same kind of record as an existing one; extend for extend_capability/ui_change; and none for data_query/reject.",
    '- proposed_identity is { id, label } only for namespace: bind the meaningful distinction independently before Builder work (for example { id: "work_contacts", label: "Work contacts" }). It is null for every other resolution.',
    "- target_capability is the overlapping existing capability id for namespace and the existing target for extend/ui_change; it is null for reject and for a new capability with resolution new, whatever related_capabilities names.",
    INTENT_DATA_QUERY_CONTEXT_RULE,
    "- related_capabilities lists ids from the registry context, each at most once, and never names target_capability. It is [] when the request is about no record another capability keeps, and always [] on ui_change, data_query and reject.",
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

/**
 * The flagged ids naming an active capability other than the answer's target, once each, in catalog
 * order, on a new capability or an extension only. A capability links only to another,
 * and a namespace keeps its target's kind of record rather than naming its records.
 */
function flaggedActiveIds(intent: IntentClassification, catalog: ActiveRegistryCatalog): string[] {
  if (intent.type !== "new_capability" && intent.type !== "extend_capability") return [];
  const flagged = new Set(intent.related_capabilities);
  return catalog.capabilities
    .filter(({ id }) => flagged.has(id) && id !== intent.target_capability)
    .map(({ id }) => id);
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
  await input.send?.("fragment", renderResolvingNotice());
  const startedAt = performance.now();
  const result = input.provider.generate(prompt, intentClassificationSchema);
  const parsed = intentClassificationSchema.parse(await result.object);
  const intent = {
    ...parsed,
    related_capabilities: flaggedActiveIds(parsed, catalog),
  };
  const usage = await result.usage;

  return {
    intent,
    usage,
    durationMs: performance.now() - startedAt,
    catalogFingerprint: catalog.fingerprint,
  };
}
