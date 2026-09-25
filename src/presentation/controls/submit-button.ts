import { escapeHtml } from "../../server/http/html.ts";
import { busyLabelAttribute } from "./busy-label.ts";

/**
 * A form's primary submit. One holding a file field has a save the control can hold while an
 * upload travels (`design/scripts/file-field.js`), saying what it waits on in its label's place.
 */
export function submitButton(label: string, busy: string, holdsFiles: boolean): string {
  const words = escapeHtml(label);
  const held = holdsFiles ? " data-held-save" : "";
  const text = holdsFiles ? `<span data-held-save-label>${words}</span>` : words;
  return `<button class="btn btn--primary" type="submit"${busyLabelAttribute(busy)}${held}>${text}</button>`;
}
