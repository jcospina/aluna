import {
  capitalized,
  everyRecordsField,
  targetName,
} from "../../presentation/controls/link/link-copy.ts";
import { type CapabilityRow, canonicalCapabilityLabel } from "../../registry/index.ts";
import { escapeHtml } from "../../server/http/html.ts";
import { type LinkEnd, type LinkRefusalCode, linkableField } from "./rules.ts";

/** A press that read a row which has since changed, or gone: nothing about the pick was wrong. */
export const LINK_STALE_CODE = "link_stale";

/** A press whose form names no versions: only a forged one, since the chooser always writes them. */
export const LINK_UNREADABLE_CODE = "link_unreadable";

/** A dropdown asked for its records by a field holding no relation that still holds. */
export const FIELD_NOT_LINKED_CODE = "field_not_linked";

/** What the person is told instead of a link: which rule refused, or which end moved. */
export type LinkNotice =
  | { readonly code: LinkRefusalCode; readonly source: LinkEnd; readonly target?: LinkEnd }
  | {
      readonly code: typeof LINK_STALE_CODE;
      readonly moved: CapabilityRow | null;
      /** The chooser was being opened, so nothing was about to be connected. */
      readonly opening?: true;
    }
  | { readonly code: typeof LINK_UNREADABLE_CODE }
  | { readonly code: typeof FIELD_NOT_LINKED_CODE; readonly source: LinkEnd };

/**
 * Why a field was not connected, in the product's voice. The chooser never offers a pick a rule
 * refuses, so a rule's sentence is read only when the desk changed under it or a press was forged.
 */
export function linkNoticeSentence(notice: LinkNotice): string {
  if (notice.code === LINK_UNREADABLE_CODE) return "I couldn’t read that pick. Try again?";
  if (notice.code === LINK_STALE_CODE) {
    return notice.opening ? "That was deleted after you opened this." : staleSentence(notice.moved);
  }
  if (notice.code === FIELD_NOT_LINKED_CODE) {
    return capitalized(`${phraseOf(notice.source, "this field")} isn’t connected anymore.`);
  }
  const pressed = phraseOf(notice.source, "this field");
  const picked = notice.target ? nameOf(notice.target) : "that field";
  switch (notice.code) {
    case "source_not_linkable":
      return capitalized(`${pressed} can’t be connected.`);
    case "source_already_linked":
      return capitalized(`${pressed} is already connected.`);
    case "target_is_source":
      return capitalized(
        `${pressed} can’t come from ${canonicalCapabilityLabel(notice.source.row)} itself.`,
      );
    case "target_not_linkable":
      return capitalized(`${pressed} can’t come from ${picked}.`);
    case "target_too_long":
      return capitalized(
        `${pressed} holds up to ${linkableField(notice.source)?.max_length} characters, and ${picked} can be longer.`,
      );
    case "link_would_loop":
      return capitalized(`${picked} already follows ${pressed}, so they can’t follow each other.`);
  }
}

function phraseOf(end: LinkEnd, fallback: string): string {
  const field = end.row.schema.fields.find((candidate) => candidate.name === end.field);
  return field ? everyRecordsField(end.row.noun, field) : fallback;
}

function nameOf(end: LinkEnd): string {
  const field = end.row.schema.fields.find((candidate) => candidate.name === end.field);
  return field ? targetName(canonicalCapabilityLabel(end.row), field) : "that field";
}

/** The end that moved is named, so the person knows which capability to look at again. */
function staleSentence(moved: CapabilityRow | null): string {
  if (moved === null) return "That was deleted after you opened this, so I didn’t connect it.";
  return `${canonicalCapabilityLabel(moved)} changed after you opened this, so I didn’t connect it. Try again?`;
}

/** The notice as the client reads it: a code naming the rule or the move, and the sentence. */
export function renderLinkNotice(notice: LinkNotice): string {
  return (
    `<p class="notice" data-role="error" data-error-code="${notice.code}">` +
    `${escapeHtml(linkNoticeSentence(notice))}</p>`
  );
}
