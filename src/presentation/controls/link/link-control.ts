// The Link control inside a single-line text field (`design/controls.html` § Links): the chain
// is the drawn listbox's own button, sitting in the field's shell, and its panel
// is the chooser. The panel arrives empty and `public/controls/link-control.js` reads it whole when
// it opens, because its targets are other capabilities' fields read under their own read tokens.
//
// The Edit form is rendered into a record's template inside a Handler fragment, where the fragment
// scrub runs: nothing here may carry an Alpine, `on*` or `hx-on` attribute.

import { capabilityLinkUrl } from "#shell/core/routes.js";
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
}

/** The chain, as `design/controls.html` draws it. */
const CHAIN_GLYPH =
  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"` +
  ` stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  `<path d="M10 13.5a4 4 0 0 0 5.66 0l3-3a4 4 0 1 0-5.66-5.66l-1.15 1.15"></path>` +
  `<path d="M14 10.5a4 4 0 0 0-5.66 0l-3 3a4 4 0 1 0 5.66 5.66l1.15-1.15"></path></svg>`;

/** Whether this field carries the chain: an active single-line text field holding no relation. */
export function offersLink(capability: LinkableCapability, field: SpecField): boolean {
  const { relations } = capability;
  if (relations === undefined || !isLinkableField(capability.form, field)) return false;
  return relationOf(relations, field.name) === undefined;
}

/**
 * The field's shell around `input`, with the chain and its chooser when the field offers a link.
 * A field already linked keeps its plain shell, to be drawn as a dropdown. The panel is drawn
 * empty: every record's Edit form carries this, and the chooser's words arrive when it opens.
 */
export function linkableShell(
  capability: LinkableCapability,
  field: SpecField,
  inputId: string,
  input: string,
): string {
  if (!offersLink(capability, field)) return controlShell(input);
  const list = `${inputId}-link-list`;
  return (
    `<div class="listbox link-control" data-link-control` +
    ` data-link-url="${escapeHtml(capabilityLinkUrl(capability.id, field.name))}">` +
    controlShell(
      `${input}<button class="listbox__button link-control__button" type="button"` +
        ` aria-label="${escapeHtml(connectFieldName(capability.noun, field))}"` +
        ` aria-haspopup="listbox" aria-expanded="false" aria-controls="${list}">` +
        `${CHAIN_GLYPH}<span class="listbox__value" hidden></span></button>`,
    ) +
    `<div class="listbox__panel link-control__panel" hidden>` +
    `<div class="listbox__scroll" id="${list}"></div></div>` +
    `</div>`
  );
}
