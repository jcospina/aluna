// The link step (ADR-0011). It returns relations only, its answer is checked entry by entry in
// `link-relations.ts`, and a call that fails in any way links nothing.

import { z } from "zod";
import type { Provider, TokenUsage } from "../../platform/provider/index.ts";
import {
  type CapabilityRow,
  isLinkableField,
  type RelatedCapability,
  type Relation,
  relationOf,
} from "../../registry/index.ts";
import {
  type RelatedCapabilityView,
  relatedCapabilityView,
  type ViewedCapability,
} from "../spec/related-capabilities.ts";
import { admittedRelations } from "./link-relations.ts";

/** The opening line of the step's prompt, which a fake provider routes the call by. */
export const LINK_STEP_PROMPT_PREFIX = "You are Aluna's link step.";

/** The answer. A stray key is stripped, so it cannot cost the whole answer. */
export const linkStepAnswerSchema = z.object({
  relations: z.array(
    z.object({ field: z.string(), capability: z.string(), target_field: z.string() }),
  ),
});

/** The capability whose fields the step links: what a relation reads, and what the prompt names. */
export type LinkSource = RelatedCapability & ViewedCapability;

export interface LinkStepInput {
  readonly provider: Provider;
  /** The user's request, as the spec writer read it. */
  readonly request: string;
  readonly source: LinkSource;
  /** The flagged capabilities, read under the build lease, in the desk's order. */
  readonly flagged: readonly CapabilityRow[];
  /** The active desk they were read from, which the loop rule walks. */
  readonly catalog: readonly CapabilityRow[];
  /** The only fields the step may link, on an evolution the ones it adds: absent, any open field. */
  readonly fields?: readonly string[];
}

export interface LinkStepResult {
  readonly relations: readonly Relation[];
  /** What the call cost: null when no call was made, or its cost never arrived. */
  readonly usage: TokenUsage | null;
  /** Why a call linked nothing, for the caller to log. */
  readonly failure?: unknown;
}

const NO_RELATIONS: LinkStepResult = { relations: [], usage: null };

type TextFields = RelatedCapabilityView["single_line_text_fields"];

/** The source's single-line text fields that hold no relation yet: the only ones it may link. */
function openFields(source: LinkSource, only: readonly string[] | undefined): TextFields {
  return source.schema.fields
    .filter((field) => isLinkableField(source.ui_intent.form, field))
    .filter((field) => !relationOf(source.relations, field.name))
    .filter((field) => only?.includes(field.name) ?? true)
    .map(({ name, label, max_length }) => ({ name, label, max_length: max_length ?? null }));
}

function buildLinkStepPrompt(
  request: string,
  source: LinkSource,
  fields: TextFields,
  flagged: readonly (RelatedCapabilityView & { readonly id: string })[],
): string {
  const built = { ...relatedCapabilityView(source), single_line_text_fields: fields };
  return [
    `${LINK_STEP_PROMPT_PREFIX} Decide which fields of the capability being built name records that a flagged capability already keeps.`,
    "",
    "The Intent Resolver flagged the existing capabilities below as related to this request. A flag says a field may name their records, not that one does.",
    "",
    "Rules:",
    "- A relation points one single-line text field of the capability being built at one single-line text field of a flagged capability: each record's value in the field is that field's text on one of the flagged capability's records.",
    "- Point at the field that names the flagged capability's records, such as a title or a name.",
    "- Relate a field only when its values would name the flagged capability's records, judged from what both capabilities keep. A shared field name alone relates nothing: two capabilities that both have a title may keep unrelated things.",
    "- Return no relation for a flagged capability when no field of the capability being built names its records. An empty list is a fine answer.",
    "- Give each field of the capability being built at most one relation.",
    "- A max_length is the most characters a field holds, and null means no limit. A field with a limit can only point at a field whose limit is no larger.",
    "- Answer relations only. Never add, remove, rename or edit a field, and use field names and capability ids exactly as listed.",
    "",
    "Answer with exactly this shape. Every key is present and every value is a string:",
    '{ "relations": [ { "field": "<a field of the capability being built>", "capability": "<the id of a flagged capability>", "target_field": "<a field of that capability>" } ] }',
    "",
    "The capability being built, with the single-line text fields it may link:",
    JSON.stringify(built, null, 2),
    "",
    "The flagged capabilities, each with its id and single-line text fields:",
    JSON.stringify(flagged, null, 2),
    "",
    "User's request:",
    request,
  ].join("\n");
}

/**
 * Runs the step. The call starts before the first await, so the step is under way when this
 * returns. It makes none when no relation could join the two sides, and it never rejects.
 */
export async function runLinkStep(input: LinkStepInput): Promise<LinkStepResult> {
  try {
    const fields = openFields(input.source, input.fields);
    const targets = input.flagged
      .map((row) => ({ row, view: { id: row.id, ...relatedCapabilityView(row) } }))
      .filter(({ view }) => view.single_line_text_fields.length > 0);
    if (fields.length === 0 || targets.length === 0) return NO_RELATIONS;
    const prompt = buildLinkStepPrompt(
      input.request,
      input.source,
      fields,
      targets.map(({ view }) => view),
    );
    const result = input.provider.generate(prompt, linkStepAnswerSchema);
    const [answer, cost] = await Promise.allSettled([result.object, result.usage]);
    const usage = cost.status === "fulfilled" ? cost.value : null;
    if (answer.status === "rejected") return { ...NO_RELATIONS, usage, failure: answer.reason };
    const parsed = linkStepAnswerSchema.safeParse(answer.value);
    if (!parsed.success) return { ...NO_RELATIONS, usage, failure: parsed.error };
    // An entry is dropped when its field was not offered or it names no flagged capability.
    const offered = (field: string) => fields.some(({ name }) => name === field);
    const candidates = parsed.data.relations.map((entry) => ({
      field: entry.field,
      target: offered(entry.field)
        ? targets.find(({ row }) => row.id === entry.capability)?.row
        : undefined,
      targetField: entry.target_field,
    }));
    const relations = admittedRelations(input.source, candidates, input.catalog);
    if (relations.length < candidates.length) {
      console.log(
        `omni-crud's link step for ${input.source.id} kept ${relations.length} of the ${candidates.length} relations it proposed`,
      );
    }
    return { relations, usage };
  } catch (failure) {
    return { ...NO_RELATIONS, failure };
  }
}
