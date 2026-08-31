// The chrome around one control: the shell it sits in, the marker on its label, and the
// one or two lines the field says about itself underneath.
//
// **The shell.** A drawn boundary is two SVG layers sandwiching real content, so the
// element carrying it has to be able to have children — and `<input>` is a void element
// and `<select>` admits only `<option>`. Every text control is therefore a shell plus a
// bare native element: `.field__control` carries the boundary, the fill, the padding and
// every state, and `.field__input`/`.field__textarea` carries the caret and the text and
// nothing else (`design/design-system.md`, "Forms"). Until this split the product put
// `.field__control` straight on the `<input>`, so the design's `:focus-within`,
// `:has(:disabled)` and `.is-invalid` rules had nothing to attach to and the disabled
// state — which the platform's own form lifecycle already sets during a submission — could
// not be drawn at all.
//
// **What a field says.** Guidance is one declared line under the field, and it survives
// typing, which is exactly when a format hint is being used; that is why there is no
// placeholder key. The character counter is the second line, and it lives in the same slot
// because that slot is where a field already says things about itself
// (`design/controls.html`, "With a limit"). Both are referenced by `aria-describedby`
// rather than left as visual-only text.
//
// **The marker.** Optional is marked and required is not, because the other way round
// spends an asterisk on most of the fields on screen. It is the inversion of a key the
// spec already has, so it costs nothing but this renderer — and read-only is not a third
// state, since the form is the only view a record has.

import { fieldGuidanceText, type SpecField, type UiFormIntent } from "../registry/index.ts";
import { escapeHtml } from "../web/html.ts";

/** The rows a long-text control opens at, and the height it stops growing past. */
export const LONG_TEXT_ROWS = 3;
export const LONG_TEXT_GROW_MAX_PX = 260;

/**
 * The counter's words, and the one place the platform writes them.
 * `public/long-text-field.js` recomputes the identical sentence on every keystroke, so the
 * server's first paint and the client's next one cannot disagree.
 *
 * Lengths count UTF-16 code units throughout — server validation, this sentence and the
 * client's — because that is what the native `maxlength` attribute counts. The number a
 * browser stops typing at has to be the number the server enforces, or a limit means two
 * different things on the two sides of one declaration.
 */
export function characterCountSentence(limit: number, used: number): string {
  const left = limit - used;
  if (left < 0) return `${-left} over the limit`;
  return `${left} character${left === 1 ? "" : "s"} left`;
}

/** The shell every text control sits in. `area` is the block variant a textarea needs. */
export function controlShell(control: string, area = false): string {
  return `<span class="field__control${area ? " field__control--area" : ""}">${control}</span>`;
}

/**
 * The native limit, plus what the counter script needs to find its own output. One
 * declaration drives all three: this attribute stops the typing, `data-length-limit` is
 * what the counter counts down from, and platform mutation validation enforces the same
 * number server-side.
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
  /** ` aria-describedby="…"`, or `""` when the field says nothing about itself. */
  readonly describedBy: string;
  /** The guidance and counter elements, in that order, after the control. */
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
  if (guidance !== undefined) {
    const id = `${inputId}-guidance`;
    ids.push(id);
    trailing += `<p class="field__guidance" id="${id}">${escapeHtml(guidance)}</p>`;
  }

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
