// @ts-check

/**
 * The open icon inside a linked field: an anchor to the record a save would post, at its record
 * address (ADR-0010), which `linked-field.js` points as the pick moves. A plain press opens that
 * record in the window the way a pressed name in an answer does, under the desk's question. Any
 * other press is the browser's own and opens the address in a new tab, and a plain one no desk is
 * there to answer follows it in this tab.
 */

import { OPEN_ICON, openRecordName } from "../../../design/scripts/controls/open-record.js";
import { isAddressableRecord, recordAddress } from "../../core/routes.js";
import { isPlainPress, OPEN_THE_RECORD_EVENT } from "../../desk/desk-address.js";

/** The icon as a linked field is drawn with it, opening nothing until the field names a record. */
export const OPENER = `<a class="linked-field__open" hidden>${OPEN_ICON}</a>`;

/** What the bar says when the field's list could not be read to tell where a press goes. */
export const OPEN_UNREAD = "I couldn’t open that. Try again?";

/**
 * What the bar says of a record its field still names when the record's capability was built in
 * another tab after this desk was drawn. A new tab draws a desk that has it, and this one loses
 * nothing.
 */
export const OPEN_ELSEWHERE = "I can’t open that here yet. Try opening it in a new tab?";

/**
 * @typedef {{ capability: string, record: string, name: string }} NamedRecord
 * @typedef {{ pressed: () => void, gone: (pressed: NamedRecord, focused: boolean) => void }}
 *   OpenerAnswers what the field does as a plain press opens its record, and when the desk has no
 *   window for that record's capability, told whether the icon held the focus
 */

/** The icon in one linked field, and the record it opens. */
export class RecordOpener {
  /**
   * @param {HTMLElement} anchor the field's `.linked-field__open`
   * @param {AbortSignal} signal what lets go of the press, with the rest of the field's wiring
   * @param {OpenerAnswers} answers
   */
  constructor(anchor, signal, answers) {
    this.anchor = anchor;
    this.answers = answers;
    /** @type {NamedRecord | null} */
    this.named = null;
    /** Where the field last asked the icon to point, which it shows once nothing holds it. */
    /** @type {NamedRecord | null} */
    this.wanted = null;
    /** Whether the icon is held hidden while the field reads why a press went nowhere. */
    this.held = false;
    anchor.addEventListener("click", (press) => this.open(press), { signal });
  }

  /**
   * Point the icon at `named`, or hide it while the field names no record an address carries.
   * @param {NamedRecord | null} named
   */
  point(named) {
    this.wanted = named;
    const opens =
      !this.held && named !== null && isAddressableRecord(named.capability, named.record);
    this.named = opens ? named : null;
    this.anchor.hidden = this.named === null;
    if (this.named === null) {
      this.anchor.removeAttribute("href");
      this.anchor.removeAttribute("aria-label");
      return;
    }
    this.anchor.setAttribute("href", recordAddress(this.named.capability, this.named.record));
    this.anchor.setAttribute("aria-label", openRecordName(this.named.name));
  }

  /** @param {MouseEvent} press */
  open(press) {
    const named = this.named;
    if (named === null || !isPlainPress(press)) return;
    const doc = this.anchor.ownerDocument;
    const active = doc.activeElement;
    const focused = active === this.anchor || active === doc.body;
    // The record lands in the window with its first field focused, as an address lands it. A field
    // never links its own capability, so the record is never the one already open.
    /** @type {{ capability: string, record: string, outcome?: unknown }} */
    const detail = { capability: named.capability, record: named.record };
    this.answers.pressed();
    doc.dispatchEvent(new CustomEvent(OPEN_THE_RECORD_EVENT, { detail }));
    if (detail.outcome === undefined || detail.outcome === null) return;
    press.preventDefault();
    if (detail.outcome !== "gone") return;
    // Held hidden while the field reads its list again to say why, so a second press cannot ask.
    this.held = true;
    this.point(this.wanted);
    this.answers.gone(named, focused);
  }

  /** Show the icon again where the field last pointed it, once the field has said why. */
  release() {
    this.held = false;
    this.point(this.wanted);
  }
}
