// The chooser's list (`design/controls.html` § Links): a Suggested group first, then one group
// per capability whose options are its fields, each with a few of its values. A target that
// cannot be picked is never handed to this module.

import type { SpecField } from "../../../registry/index.ts";
import { escapeHtml } from "../../../server/http/html.ts";
import {
  CHOOSER_EMPTY,
  chooserHeading,
  chooserLine,
  SUGGESTED_GROUP,
  targetName,
} from "./link-copy.ts";

/** One field the clicked field could come from, as the chooser read it. */
export interface ChooserTarget {
  readonly capabilityId: string;
  readonly capabilityLabel: string;
  readonly field: SpecField;
  readonly preview: readonly string[];
  /** The form a press posts, naming both ends as they stood when the chooser read them. */
  readonly press: URLSearchParams;
}

export interface ChooserList {
  readonly suggested?: ChooserTarget;
  /** Every other target, grouped by capability in the order the groups are listed. */
  readonly groups: readonly (readonly ChooserTarget[])[];
}

/**
 * The chooser's whole panel: the heading, then the line and the list, or, with nothing to pick,
 * the heading over the empty sentence. The list is there even then, holding nothing, so the
 * chain's `aria-controls` names a listbox a screen reader can say is empty.
 */
export function renderChooserPanel(
  listId: string,
  clicked: { readonly noun: string; readonly field: Pick<SpecField, "label"> },
  list: ChooserList,
): string {
  const { noun, field } = clicked;
  const heading = `${listId}-heading`;
  const line = `${listId}-line`;
  const options = renderChooserList(listId, list);
  const empty = options === "";
  return (
    `<div class="link-control__head">` +
    `<p class="link-control__heading" id="${heading}">${escapeHtml(chooserHeading(noun, field))}</p>` +
    (empty
      ? ""
      : `<p class="link-control__line" id="${line}">${escapeHtml(chooserLine(noun, field))}</p>`) +
    `</div>` +
    `<div class="listbox__scroll" id="${listId}" role="listbox" tabindex="-1" data-listbox-list` +
    ` aria-labelledby="${heading}"${empty ? "" : ` aria-describedby="${line}"`}>${options}</div>` +
    (empty ? `<p class="listbox__empty" role="status">${escapeHtml(CHOOSER_EMPTY)}</p>` : "")
  );
}

/** The listbox's options, with ids under `prefix`. */
export function renderChooserList(prefix: string, list: ChooserList): string {
  let index = 0;
  const option = (target: ChooserTarget, label: string) =>
    renderOption(prefix, ++index, target, label);
  const suggested = list.suggested
    ? renderGroup(
        `${prefix}-suggested`,
        SUGGESTED_GROUP,
        option(list.suggested, targetName(list.suggested.capabilityLabel, list.suggested.field)),
      )
    : "";
  const groups = list.groups.map((targets) => {
    const [first] = targets;
    if (!first) return "";
    const options = targets.map((target) => option(target, target.field.label)).join("");
    return renderGroup(`${prefix}-group-${first.capabilityId}`, first.capabilityLabel, options);
  });
  return suggested + groups.join("");
}

// The wrapper is what makes the heading an announced option group; the heading itself stays
// presentational, since a non-option child would break the listbox's required children.
function renderGroup(headingId: string, heading: string, options: string): string {
  return (
    `<div role="group" aria-labelledby="${headingId}">` +
    `<div class="listbox__group caps" role="presentation" id="${headingId}">` +
    `${escapeHtml(heading)}</div>${options}</div>`
  );
}

function renderOption(prefix: string, index: number, target: ChooserTarget, label: string): string {
  const id = `${prefix}-option-${index}`;
  const preview = target.preview.join(", ");
  const note =
    preview === ""
      ? ""
      : `<span class="listbox__note" id="${id}-note" aria-hidden="true">${escapeHtml(preview)}</span>`;
  return (
    `<div class="listbox__option" role="option" id="${id}" aria-selected="false"` +
    ` data-value="${escapeHtml(`${target.capabilityId}.${target.field.name}`)}"` +
    ` data-link-press="${escapeHtml(target.press.toString())}"` +
    `${preview === "" ? "" : ` aria-describedby="${id}-note"`}>` +
    `${escapeHtml(label)}${note}</div>`
  );
}
