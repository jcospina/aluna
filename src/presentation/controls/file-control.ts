// The file field's place in the form, until 7.1/08 draws the upload control there.
//
// It shows the field's label and its declared hint and submits nothing: no control and no presence
// marker. A create therefore stores `NULL`, and an edit leaves the stored reference alone under the
// merge-patch rule every unsubmitted field follows. The label and hint follow the drawn control's
// markup (`design/controls.html`), but not its mount hook, which would claim a control not built.

import type { SpecField, UiFormIntent } from "../../registry/index.ts";
import { escapeHtml } from "../../server/http/html.ts";
import { fieldChrome } from "../fields/field-chrome.ts";

export function renderFileField(inputId: string, field: SpecField, form: UiFormIntent): string {
  const chrome = fieldChrome(inputId, field, form, { emptyable: true });
  return (
    `<div class="field" data-file-stand-in="${escapeHtml(field.name)}">` +
    `<span class="field__label caps" id="${inputId}-label">` +
    `${escapeHtml(field.label)}${chrome.labelSuffix}</span>` +
    chrome.trailing +
    `</div>`
  );
}
