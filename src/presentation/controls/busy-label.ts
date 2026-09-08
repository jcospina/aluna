import { BUSY_LABEL_ATTRIBUTE } from "#shell/shell-dom.js";
import { escapeHtml } from "../../server/http/html.ts";

export { BUSY_LABEL_ATTRIBUTE } from "#shell/shell-dom.js";

/** The attribute, ready to interpolate into a control's markup. */
export function busyLabelAttribute(label: string): string {
  return ` ${BUSY_LABEL_ATTRIBUTE}="${escapeHtml(label)}"`;
}

/** What each of the platform's own submit controls says while it waits. */
export const ADDING_LABEL = "I’m adding…";
export const SAVING_RECORD_LABEL = "I’m saving…";
export const DELETING_RECORD_LABEL = "I’m deleting…";
