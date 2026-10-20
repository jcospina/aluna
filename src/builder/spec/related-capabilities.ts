// What the spec writer reads of each capability the Intent Resolver flagged: its name,
// description, record noun and single-line text fields with their length limits,
// and nothing else. A flag is a judgment for one build, never a `read_dependency`.

import type { Database } from "bun:sqlite";
import {
  type CapabilityRow,
  canonicalCapabilityLabel,
  getCapability,
  isLinkableField,
} from "../../registry/index.ts";

export interface RelatedCapabilityView {
  readonly name: string;
  readonly description: string;
  readonly record_noun: string;
  readonly single_line_text_fields: readonly {
    readonly name: string;
    readonly label: string;
    readonly max_length: number | null;
  }[];
}

/** What the view reads of a capability: a registry row, or a spec about to become one. */
export type ViewedCapability = Pick<
  CapabilityRow,
  "id" | "label" | "display_label_override" | "prompt_context" | "noun" | "schema" | "ui_intent"
>;

export function relatedCapabilityView(row: ViewedCapability): RelatedCapabilityView {
  return {
    name: canonicalCapabilityLabel(row),
    description: row.prompt_context,
    record_noun: row.noun,
    single_line_text_fields: row.schema.fields
      .filter((field) => isLinkableField(row.ui_intent.form, field))
      .map((field) => ({
        name: field.name,
        label: field.label,
        max_length: field.max_length ?? null,
      })),
  };
}

/** The flagged capabilities as the registry holds them now; the caller holds the build lease. */
export function readRelatedCapabilities(
  ids: readonly string[],
  database: Database,
): RelatedCapabilityView[] {
  return ids.flatMap((id) => {
    const row = getCapability(id, database);
    return row ? [relatedCapabilityView(row)] : [];
  });
}

/** The spec writer's lines about the flagged capabilities: none at all when nothing is flagged. */
export function relatedCapabilityPromptLines(related: readonly RelatedCapabilityView[]): string[] {
  if (related.length === 0) return [];
  return [
    "Existing capabilities this request is related to. A field of the capability you author may name one of their records, and Aluna then connects it, so the person picks that record instead of typing it again. Each is listed with its name, description, record noun and single-line text fields; a max_length of null means the field has no limit:",
    JSON.stringify(related, null, 2),
    "- Choose the fields this request needs as you would without this list, with one exception. A field of yours names one of their records when it holds the text one of their single-line text fields holds for that record, whatever you call the field. When one does, leave out the facts that record already keeps: they are read through the connection, and a copy would drift from the record it copies.",
    "- A field that names one of their records is a string field left out of ui_intent.form.long_text, holding the text of one of that record's single-line text fields: give it no max_length when that field's max_length is null, and otherwise no max_length or one at least as large.",
    "",
  ];
}
