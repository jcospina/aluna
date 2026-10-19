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

export function relatedCapabilityView(row: CapabilityRow): RelatedCapabilityView {
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
    "Existing capabilities this request is about — each record of the capability you author may name one of their records. Each is listed with its name, description, record noun and single-line text fields; a max_length of null means the field has no limit:",
    JSON.stringify(related, null, 2),
    "- Do not add a text field one of them already holds: a fact one of their records keeps stays with that record. The exception is a field naming which of their records each record of yours is about: Inventory built beside Books gets a book field and no author or ISBN of its own, because a book's author and ISBN are Books' fields.",
    "- A field naming one of their records is a string field left out of ui_intent.form.long_text, and it holds the text of one of that record's single-line text fields, such as a book's title: give it no max_length when that field's max_length is null, and otherwise no max_length or one at least as large.",
    "",
  ];
}
