// @ts-check

/**
 * What a record form holds that no save has: a field changed since the person started on the
 * form, or an upload no save claimed. The leave question asks this before any exit takes the form
 * (Module 7 PLAN decision 32, widened by the owner in 7.3/03 to every unsaved change). A form is
 * read the first time it is touched, so a field put back the way it was is no change, and one a
 * save is carrying is the save's.
 */

import { losesIn } from "../../design/scripts/files/file-field.js";
import { holdsUpload } from "../controls/held-uploads.js";
import { RECORD_FORM_SELECTOR } from "../core/shell-dom.js";

export { RECORD_FORM_SELECTOR };

/**
 * The exact datetime a field was drawn with, rewritten to the minute by any edit to the field it
 * stands behind (`record-mutations.js`); the field itself says whether it changed.
 */
const DATETIME_TWIN = "data-edit-datetime-value";
const DATETIME_FIELD = "data-edit-datetime-input";

/** A row of a list field, typed into one value at a time. */
const LIST_ROW = "[data-list-field-row]";

/** The moments a person starts on a form, each one before the change it brings. */
const STARTING = ["focusin", "pointerdown", "dragenter"];

/**
 * As much of a form and its fields as the reading needs, so a plain object stands in for one.
 *
 * @typedef {{
 *   value?: string,
 *   checked?: boolean,
 *   disabled?: boolean,
 *   getAttribute(name: string): string | null,
 *   closest?: (selector: string) => unknown,
 * }} Field
 * @typedef {{
 *   querySelectorAll(selector: string): Iterable<unknown>,
 *   getAttribute(name: string): string | null,
 *   closest?: (selector: string) => unknown,
 *   matches?: (selector: string) => boolean,
 * }} RecordForm
 */

/** @type {WeakMap<object, string>} what each form held when the person started on it */
const started = new WeakMap();

/**
 * Forms a confirmed leave let go of: not asked about while the press is made again, and asked about
 * once more if the person touches the form again, which a leave that failed leaves standing.
 *
 * @type {WeakSet<object>}
 */
const waived = new WeakSet();

/** @type {WeakMap<object, string>} what a record form's save in flight sent */
const sending = new WeakMap();

/**
 * What a form would send, by field name. A file picker is left out: what it picked is an upload,
 * which the bookkeeping counts, and the key it lands under is a field of its own. A datetime is
 * read off the field typed into, which is named by its data attribute; the exact value behind it
 * is rewritten to the minute by any edit. A blank list row is nothing: the server drops it.
 *
 * @param {RecordForm} form
 * @returns {string}
 */
export function formState(form) {
  /** @type {[string, string][]} */
  const sent = [];
  for (const node of form.querySelectorAll("input, select, textarea")) {
    const field = /** @type {Field} */ (node);
    const name = field.getAttribute("name") ?? field.getAttribute(DATETIME_FIELD);
    if (name && !leftOut(field)) sent.push([name, field.value ?? ""]);
  }
  return JSON.stringify(sent);
}

/** @param {Field} field @returns {boolean} whether the field says nothing a leave would lose */
function leftOut(field) {
  const type = field.getAttribute("type");
  if (field.disabled || type === "file" || field.getAttribute(DATETIME_TWIN) !== null) return true;
  if ((type === "checkbox" || type === "radio") && !field.checked) return true;
  return (field.value ?? "").trim() === "" && field.closest?.(LIST_ROW) != null;
}

/** @param {unknown} target @returns {RecordForm | null} */
function recordFormOf(target) {
  const found = /** @type {{ closest?: (s: string) => unknown }} */ (target)?.closest?.(
    RECORD_FORM_SELECTOR,
  );
  return /** @type {RecordForm | null} */ (found ?? null);
}

/** The person started on the form `target` stands in, or came back to one a leave let go of. */
export function startedOn(/** @type {unknown} */ target) {
  const form = recordFormOf(target);
  if (form === null) return;
  waived.delete(form);
  if (!started.has(form)) started.set(form, formState(form));
}

/**
 * A form put back to what it was drawn with starts from what it holds once the put-back is done:
 * a create's controls are restored after the reset, in the same task.
 *
 * @param {RecordForm} form
 */
export function startedAgain(form) {
  waived.delete(form);
  queueMicrotask(() => started.set(form, formState(form)));
}

/** @param {RecordForm} form */
function changed(form) {
  const before = started.get(form);
  return before !== undefined && before !== formState(form);
}

/** @param {RecordForm} scope @returns {RecordForm[]} the record forms `scope` is or holds */
function recordFormsIn(scope) {
  const inside = /** @type {RecordForm[]} */ ([...scope.querySelectorAll(RECORD_FORM_SELECTOR)]);
  return scope.matches?.(RECORD_FORM_SELECTOR) ? [scope, ...inside] : inside;
}

/**
 * A confirmed leave: what the forms in `scope` hold is no longer anything to ask about, so the
 * press made again after it goes through.
 *
 * @param {RecordForm} scope
 */
export function letGoOfChanges(scope) {
  for (const form of recordFormsIn(scope)) waived.add(form);
}

/**
 * Whether leaving `scope` would lose anything: an upload no save claimed, a file still travelling,
 * a recording made or kept unsent, which exists nowhere but the tab, or a field changed in a record
 * form no save is carrying.
 *
 * @param {RecordForm} scope the window, or the one form's view a close takes
 */
export function hasUnsavedChanges(scope) {
  // A window known only by what it holds, with no way to search it, holds no form.
  if (typeof scope.querySelectorAll !== "function") return false;
  if (holdsUpload(/** @type {never} */ (scope))) return true;
  if (losesIn(/** @type {never} */ (scope))) return true;
  return recordFormsIn(scope).some(
    (form) => !waived.has(form) && form.getAttribute("aria-busy") !== "true" && changed(form),
  );
}

/** @param {Event} event @returns {RecordForm | null} the record form a request went out from */
function requestingForm(event) {
  const elt = /** @type {CustomEvent<{ elt?: RecordForm }>} */ (event).detail?.elt;
  return elt?.matches?.(RECORD_FORM_SELECTOR) ? elt : null;
}

/**
 * A save that committed: what it sent is the record now, even when the read that would have taken
 * the form away fails and leaves it standing, and typing went on after it was sent.
 *
 * @param {Event} event
 */
function savedFrom(event) {
  const form = requestingForm(event);
  if (form === null) return;
  const sent = sending.get(form);
  sending.delete(form);
  if (/** @type {CustomEvent<{ successful?: boolean }>} */ (event).detail?.successful !== true) {
    return;
  }
  waived.delete(form);
  started.set(form, sent ?? formState(form));
}

/** @param {Pick<Document, "addEventListener">} root */
export function startUnsavedChanges(root) {
  for (const type of STARTING)
    root.addEventListener(type, (event) => startedOn(event.target), true);
  root.addEventListener(
    "reset",
    (event) => startedAgain(/** @type {RecordForm} */ (/** @type {unknown} */ (event.target))),
    true,
  );
  root.addEventListener("htmx:beforeSend", (event) => {
    const form = requestingForm(event);
    if (form !== null) sending.set(form, formState(form));
  });
  root.addEventListener("htmx:afterRequest", savedFrom);
}

if (typeof document !== "undefined") startUnsavedChanges(document);
