// The chrome around one control: the shell it sits in, the marker on its label, and the one or
// two lines the field says about itself underneath.
//
// A drawn boundary is two SVG layers sandwiching real content, so the element carrying it has to
// be able to have children — and `<input>` is void while `<select>` admits only `<option>`. Every
// text control is a shell plus a bare native element: `.field__control` carries the boundary and
// every state, `.field__input` the caret. Until the split, `:focus-within`, `:has(:disabled)` and
// `.is-invalid` had nothing to attach to.
//
// Guidance is one declared line that survives typing, which is why there is no placeholder key.
// The counter is the second line in the same slot and an error is the third, so the client writes
// one sentence into one element it can always find. Optional is marked, required is not.

import { characterCountSentence } from "#shell/character-count.js";
import { fieldGuidanceText, type SpecField, type UiFormIntent } from "../../registry/index.ts";
import { escapeHtml } from "../../server/http/html.ts";

/** The rows a long-text control opens at, and the height it stops growing past. */
export const LONG_TEXT_ROWS = 3;
export const LONG_TEXT_GROW_MAX_PX = 260;

/**
 * The one sentence the platform authored for a field left empty, said in the field itself. The
 * form carries it in `data-required-message`, so the client never holds a second copy of copy.
 */
export const REQUIRED_FIELD_SENTENCE = "I still need this one.";

/**
 * The counter's words. The server paints the sentence and the browser repaints it on the first
 * keystroke, so a second copy here made a wording change rewrite the counter in front of the user.
 * Lengths count UTF-16 code units, the unit native `maxlength` counts.
 */
export { characterCountSentence } from "#shell/character-count.js";

/** The shell every text control sits in. `area` is the block variant a textarea needs. */
export function controlShell(control: string, area = false): string {
  return `<span class="field__control${area ? " field__control--area" : ""}">${control}</span>`;
}

/**
 * The native limit, plus what the counter script needs to find its own output. One declaration
 * drives all three: this attribute, `data-length-limit`, and server-side mutation validation.
 */
export function lengthAttributes(inputId: string, field: SpecField): string {
  if (field.max_length === undefined) return "";
  return (
    ` maxlength="${field.max_length}" data-length-limit="${field.max_length}"` +
    ` data-length-counter="${counterId(inputId)}"`
  );
}

/** The attributes that make a textarea grow to fit and then scroll, never drag. */
export function growAttributes(): string {
  return ` rows="${LONG_TEXT_ROWS}" data-grow data-grow-max="${LONG_TEXT_GROW_MAX_PX}"`;
}

export interface FieldChrome {
  /** Appended inside the `<label>`, after the field's own words. */
  readonly labelSuffix: string;
  /** ` aria-describedby="…"`. Never empty: every field carries a guidance slot. */
  readonly describedBy: string;
  /**
   * The guidance slot and the counter, in that order, after the control. The slot is always
   * written — empty and `hidden` when nothing is declared — because an error is said there too.
   */
  readonly trailing: string;
}

export interface FieldChromeOptions {
  /**
   * Whether the control can be left empty, and so whether "optional" means anything on it.
   * A checkbox always yields a definite value, so a boolean is never marked optional.
   */
  readonly emptyable: boolean;
  /** The value the field opens with, which is what the counter starts from. */
  readonly value?: unknown;
  /** Ids of description elements the control renders for itself (a list-input hint). */
  readonly extraDescribedIds?: readonly string[];
}

export function fieldChrome(
  inputId: string,
  field: SpecField,
  form: UiFormIntent,
  options: FieldChromeOptions,
): FieldChrome {
  const ids = [...(options.extraDescribedIds ?? [])];
  let trailing = "";

  const guidance = fieldGuidanceText(form, field.name);
  const guidanceId = `${inputId}-guidance`;
  ids.push(guidanceId);
  trailing +=
    `<p class="field__guidance" id="${guidanceId}" data-field-guidance` +
    `${guidance === undefined ? " hidden" : ""}>` +
    `${guidance === undefined ? "" : escapeHtml(guidance)}</p>`;

  if (field.max_length !== undefined) {
    const id = counterId(inputId);
    ids.push(id);
    const sentence = characterCountSentence(field.max_length, openingLength(options.value));
    trailing +=
      `<p class="field__guidance field__guidance--count" id="${id}">` +
      `${escapeHtml(sentence)}</p>`;
  }

  return {
    labelSuffix: optionalMarker(field, options.emptyable),
    describedBy: ids.length > 0 ? ` aria-describedby="${ids.join(" ")}"` : "",
    trailing,
  };
}

function optionalMarker(field: SpecField, emptyable: boolean): string {
  if (field.required || !emptyable) return "";
  return ` <span class="field__optional">optional</span>`;
}

function counterId(inputId: string): string {
  return `${inputId}-count`;
}

function openingLength(value: unknown): number {
  return value === null || value === undefined ? 0 : String(value).length;
}
