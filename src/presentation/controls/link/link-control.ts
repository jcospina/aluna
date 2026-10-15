// The Link control inside a single-line text field (`design/controls.html` § Links): the chain
// is the drawn listbox's own button, sitting in the field's shell, and its panel
// is the chooser. The panel arrives empty and `public/controls/link-control.js` reads it whole when
// it opens, because its targets are other capabilities' fields read under their own read tokens.
// A linked field is drawn as a dropdown by `public/controls/linked-field.js` from the same shell,
// which is how a field linked from an open form becomes one in place.
//
// The Edit form is rendered into a record's template inside a Handler fragment, where the fragment
// scrub runs: nothing here may carry an Alpine, `on*` or `hx-on` attribute.

import { CHAIN } from "#shell/controls/listbox-glyphs.js";
import { capabilityLinkUrl, capabilityPickUrl } from "#shell/core/routes.js";
import {
  isLinkableField,
  type Relation,
  relationOf,
  type SpecField,
  type UiFormIntent,
} from "../../../registry/index.ts";
import { escapeHtml } from "../../../server/http/html.ts";
import { controlShell } from "../../fields/chrome/field-chrome.ts";
import { connectFieldName } from "./link-copy.ts";

/** What the control needs to know about the capability whose form it sits in. */
export interface LinkableCapability {
  readonly id: string;
  readonly noun: string;
  readonly form: Pick<UiFormIntent, "long_text">;
  /** The registry row's relations; absent where a form is only inspected, as the Gate's spec is. */
  readonly relations?: readonly Relation[];
  /** The fields whose relation holds against the desk as it is (`holdingRelations`). */
  readonly linkedFields?: readonly string[];
}

/** Whether this field carries the chain: an active single-line text field holding no relation. */
export function offersLink(capability: LinkableCapability, field: SpecField): boolean {
  return linkState(capability, field) === "offered";
}

/** Whether this field is a dropdown: an active single-line text field holding a relation. */
export function isLinkedField(capability: LinkableCapability, field: SpecField): boolean {
  return linkState(capability, field) === "linked";
}

/** A field whose relation is dormant draws neither: it cannot take another, and is plain text. */
function linkState(capability: LinkableCapability, field: SpecField): "offered" | "linked" | null {
  const { relations } = capability;
  if (relations === undefined || !isLinkableField(capability.form, field)) return null;
  if (relationOf(relations, field.name) === undefined) return "offered";
  return capability.linkedFields?.includes(field.name) ? "linked" : null;
}

/**
 * The field's shell around `input`, with the chain and its chooser when the field offers a link,
 * or marked for its dropdown when it is linked. The chooser's panel is drawn empty: every record's
 * Edit form carries this, and its words arrive when it opens, as a dropdown's records do.
 */
export function linkableShell(
  capability: LinkableCapability,
  field: SpecField,
  inputId: string,
  input: string,
): string {
  if (isLinkedField(capability, field)) {
    return (
      `<div class="listbox linked-field" data-linked-field` +
      ` data-pick-url="${escapeHtml(capabilityPickUrl(capability.id, field.name))}">` +
      `${controlShell(input)}</div>`
    );
  }
  if (!offersLink(capability, field)) return controlShell(input);
  const list = `${inputId}-link-list`;
  return (
    `<div class="listbox link-control" data-link-control` +
    ` data-link-url="${escapeHtml(capabilityLinkUrl(capability.id, field.name))}">` +
    controlShell(
      `${input}<button class="listbox__button link-control__button" type="button"` +
        ` aria-label="${escapeHtml(connectFieldName(capability.noun, field))}"` +
        ` aria-haspopup="listbox" aria-expanded="false" aria-controls="${list}">` +
        `${CHAIN}<span class="listbox__value" hidden></span></button>`,
    ) +
    `<div class="listbox__panel link-control__panel" hidden>` +
    `<div class="listbox__scroll" id="${list}"></div></div>` +
    `</div>`
  );
}
