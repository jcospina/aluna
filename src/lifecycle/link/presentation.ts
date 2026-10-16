import type { Context } from "hono";
import {
  capitalized,
  connectFieldName,
  everyRecordsField,
  targetName,
} from "../../presentation/controls/link/link-copy.ts";
import { type CapabilityRow, canonicalCapabilityLabel } from "../../registry/index.ts";
import { NO_STORE } from "../../server/http/cache-headers.ts";
import { escapeHtml } from "../../server/http/html.ts";
import { type LinkEnd, type LinkRefusalCode, linkableField, sourceRefusal } from "./rules.ts";

/** A press that read a row which has since changed, or gone: nothing about the pick was wrong. */
export const LINK_STALE_CODE = "link_stale";

/** A press whose form names no versions: only a forged one, since the chooser always writes them. */
export const LINK_UNREADABLE_CODE = "link_unreadable";

/** A dropdown asked for its records by a field holding no relation that still holds. */
export const FIELD_NOT_LINKED_CODE = "field_not_linked";

/** The same ask, of a field that holds no relation at all and so draws its chain again. */
export const FIELD_UNLINKED_CODE = "field_unlinked";

/** What the person is told instead of a link: which rule refused, or which end moved. */
export type LinkNotice =
  | { readonly code: LinkRefusalCode; readonly source: LinkEnd; readonly target?: LinkEnd }
  | {
      readonly code: typeof LINK_STALE_CODE;
      readonly moved: CapabilityRow | null;
      /** The chooser was being opened, so nothing was about to be connected. */
      readonly opening?: true;
      /** The broken chain was pressed, so it was a disconnection that did not happen. */
      readonly disconnecting?: true;
    }
  | { readonly code: typeof LINK_UNREADABLE_CODE; readonly disconnecting?: true }
  | { readonly code: typeof FIELD_NOT_LINKED_CODE; readonly source: LinkEnd }
  | { readonly code: typeof FIELD_UNLINKED_CODE; readonly source: LinkEnd };

/**
 * What a field that is no dropdown says: the chain is back when it holds no relation and can take
 * one, and a dormant relation, or a field that can link nothing, leaves it plain text.
 */
export function notLinkedNotice(source: LinkEnd): LinkNotice {
  if (sourceRefusal(source) === null) return { code: FIELD_UNLINKED_CODE, source };
  return { code: FIELD_NOT_LINKED_CODE, source };
}

/**
 * Why a field was not connected, in the product's voice. The chooser never offers a pick a rule
 * refuses, so a rule's sentence is read only when the desk changed under it or a press was forged.
 */
export function linkNoticeSentence(notice: LinkNotice): string {
  if (notice.code === LINK_UNREADABLE_CODE || notice.code === LINK_STALE_CODE) {
    return unwrittenSentence(notice);
  }
  if (notice.code === FIELD_NOT_LINKED_CODE || notice.code === FIELD_UNLINKED_CODE) {
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

/** Why nothing was written, though nothing about the press was wrong. */
function unwrittenSentence(
  notice: Extract<LinkNotice, { code: typeof LINK_UNREADABLE_CODE | typeof LINK_STALE_CODE }>,
): string {
  if (notice.code === LINK_UNREADABLE_CODE) {
    return notice.disconnecting
      ? "I couldn’t tell what to disconnect. Try again?"
      : "I couldn’t read that pick. Try again?";
  }
  if (notice.opening) return "That was deleted after you opened this.";
  return staleSentence(notice.moved, notice.disconnecting ? "disconnect" : "connect");
}

/** The end that moved is named, so the person knows which capability to look at again. */
function staleSentence(moved: CapabilityRow | null, verb: "connect" | "disconnect"): string {
  if (moved === null) return `That was deleted after you opened this, so I didn’t ${verb} it.`;
  return `${canonicalCapabilityLabel(moved)} changed after you opened this, so I didn’t ${verb} it. Try again?`;
}

/**
 * The notice as the client reads it: a code naming the rule or the move, and the sentence. A field
 * that draws its chain again names it too, for the copies of it a page holds.
 */
export function renderLinkNotice(notice: LinkNotice): string {
  return (
    `<p class="notice" data-role="error" data-error-code="${notice.code}"${connectName(notice)}>` +
    `${escapeHtml(linkNoticeSentence(notice))}</p>`
  );
}

function connectName(notice: LinkNotice): string {
  if (notice.code !== FIELD_UNLINKED_CODE) return "";
  const field = linkableField(notice.source);
  if (!field) return "";
  return ` data-connect-name="${escapeHtml(connectFieldName(notice.source.row.noun, field))}"`;
}

/** A refusal is spoken on the prompt bar by the client, never swapped in. */
export function answerLinkNotice(c: Context, notice: LinkNotice): Response {
  const status = notice.code === LINK_STALE_CODE ? 409 : 422;
  return c.html(renderLinkNotice(notice), status, NO_STORE);
}
