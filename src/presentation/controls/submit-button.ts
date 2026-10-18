import { FILE_FIELD_HOOKS } from "#design/files/file-field.js";
import { escapeHtml } from "../../server/http/html.ts";
import { busyLabelAttribute } from "./busy-label.ts";

/**
 * A form's primary submit. One holding a file field has a save the control can hold while an
 * upload travels (`design/scripts/files/file-field.js`), saying what it waits on in its label's place.
 * `owner` is the ` form="…"` attribute of a submit standing outside its form.
 */
export function submitButton(label: string, busy: string, holdsFiles: boolean, owner = ""): string {
  const words = escapeHtml(label);
  const held = holdsFiles ? ` ${FILE_FIELD_HOOKS.save}` : "";
  const text = holdsFiles ? `<span ${FILE_FIELD_HOOKS.saveLabel}>${words}</span>` : words;
  return `<button class="btn btn--primary" type="submit"${owner}${busyLabelAttribute(busy)}${held}>${text}</button>`;
}
