// The records linking to a record: a section per relation pointing in, between the record's form
// and its action row (`design/index.html`, "The records linking here"). Platform chrome around
// cards the linking capability's own presentation adapter drew, so this frames already-safe
// markup and never re-parses it.

import { RECORD_LINKS_REST_ATTRIBUTE } from "#shell/core/shell-dom.js";
import { escapeHtml } from "../../../server/http/html.ts";
import { busyLabelAttribute, GETTING_REST_LABEL } from "../../controls/busy-label.ts";
import { type CollectionLayout, collectionLayoutClass } from "../collection/list-container.ts";

/** How many records linking here a section lists before "Show all". */
export const LISTED_AT_FIRST = 5;

/** What fetches the rest of a section into it, and then goes away. */
export const SHOW_ALL_LABEL = "Show all";

/** One relation's records linking here, drawn. */
export interface LinkingSection {
  /** The linking capability's id, label and collection layout, which its cards are drawn in. */
  readonly capability: { readonly id: string; readonly label: string };
  readonly layout: CollectionLayout;
  /** The linking field, which tells two sections of one capability apart. */
  readonly field: string;
  /** How many of its records link here, of which `cards` are the first. */
  readonly count: number;
  readonly cards: string;
  /** Where "Show all" fetches the rest from, when `cards` are not all of them. */
  readonly rest?: string;
}

/**
 * One section, headed "Books · 3": always open, never collapsed. Two relations from one
 * capability give two sections headed alike, told apart by their ids alone.
 */
export function renderLinkingSection(section: LinkingSection): string {
  const headingId = escapeHtml(`record-links-${section.capability.id}-${section.field}`);
  const heading = `${escapeHtml(section.capability.label)} · ${section.count}`;
  const more =
    section.rest === undefined
      ? ""
      : `<button type="button" class="btn btn--outline btn--sm record-links__more"` +
        ` aria-describedby="${headingId}"${busyLabelAttribute(GETTING_REST_LABEL)}` +
        ` ${RECORD_LINKS_REST_ATTRIBUTE}="${escapeHtml(section.rest)}">${SHOW_ALL_LABEL}</button>`;
  // The heading takes the focus "Show all" had, when the rest brought no card a press opens.
  return (
    `<section class="record-links" aria-labelledby="${headingId}">` +
    `<h3 id="${headingId}" class="record-links__heading caps" tabindex="-1">${heading}</h3>` +
    `<div class="capability-records ${collectionLayoutClass(section.layout)} record-links__records">` +
    `${section.cards}</div>` +
    more +
    `</section>`
  );
}
