// @ts-check

/**
 * Where a validation error is said, and what stops a submission before it is sent. The outline
 * says that something is wrong and the sentence says what, so each is said in its own place.
 */

import { FILE_FIELD_CHANGE, FILE_FIELD_HOOKS } from "../design/scripts/file-field.js";
import { FILE_FIELD_ATTRIBUTES } from "./shell-dom.js";

const FIELD = ".field";
const GUIDANCE = "[data-field-guidance]";
const ERROR_CLASS = "field__guidance--error";
const INVALID_CLASS = "is-invalid";
/**
 * Where the slot's words wait while the error stands in their place, and what the slot was before
 * it: a control that writes its own refusals into the slot, the photo's, may have been saying one.
 */
const STASH = "data-field-guidance-text";
const PRIOR = "data-field-guidance-prior";
const MARKED = `[${STASH}]`;
/**
 * A picker's value rides this hidden input, which no browser validates, so a required picker left
 * empty used to sail past the browser and be refused by the server a round trip later.
 */
const MISSING_CHOICE = "[data-choice-value][data-choice-required]";
/**
 * A `string[]` field the spec declares required, in the mode that draws rows. `required` per row
 * would refuse a list that is complete, so the field says the word and the submit enforces it.
 */
const REQUIRED_LIST = "[data-list-required]";
/**
 * A required file field's value, which the photo control keeps in a hidden input. Holding nothing
 * is an empty value, or the clear the server drew for it once the file it held is taken away.
 */
const REQUIRED_FILE = `[${FILE_FIELD_ATTRIBUTES.value}][${FILE_FIELD_ATTRIBUTES.required}]`;
const LIST_ROW_INPUT = "[data-list-field-row] input";
const NOTICE = "[data-error-fields]";
/**
 * The live slot a refusal is retargeted into, in every form that has one. The sentence leaves it
 * in the turn it arrives — too early to be announced — so a reader hears the field on focus.
 */
const ERROR_REGION = '[aria-live="polite"]';

/**
 * The elements a field's state is said on: the ones that take `aria-invalid`, the first of which
 * is where focus lands. A repeatable list is the one field that answers with more than one.
 */
const SPEAKS_FOR =
  ".listbox__button, .field__textarea, .field__input, .field__checkbox, .choice-set, .segmented";
/** The photo control's own buttons, which a refusal reaches but a button cannot be invalid. */
const FILE_FOCUS = `[${FILE_FIELD_HOOKS.focus}]`;

/**
 * What a field name may be, checked before it is spent in a selector. `data-error-fields` is read
 * off a generated Handler's response, and a Handler is code rather than an authored capability.
 */
const FIELD_NAME = /^[a-z][a-z0-9_]*$/;

/**
 * @param {Element} field
 * @returns {HTMLElement[]}
 */
function speaksFor(field) {
  const controls = [];
  for (const control of field.querySelectorAll(SPEAKS_FOR)) {
    if (control instanceof HTMLElement) controls.push(control);
  }
  return controls;
}

/**
 * Where focus lands for a field that has just been marked. The two grouped controls are
 * not focusable themselves, so it goes to the first option that would accept a press.
 *
 * @param {Element} field
 * @returns {HTMLElement | null}
 */
function focusTarget(field) {
  const control = speaksFor(field)[0] ?? field.querySelector(FILE_FOCUS);
  if (!(control instanceof HTMLElement)) return null;
  if (!control.classList.contains("choice-set") && !control.classList.contains("segmented")) {
    return control;
  }
  for (const option of control.querySelectorAll(".choice__input, button")) {
    if (option instanceof HTMLElement && !(/** @type {{disabled?: boolean}} */ (option).disabled)) {
      return option;
    }
  }
  return null;
}

/**
 * The one slot a field says things about itself in, carried whether or not a hint was declared
 * and already named by `aria-describedby`. Missing is a rendering bug, said rather than papered.
 *
 * @param {Element} field
 * @returns {HTMLElement}
 */
function guidanceSlot(field) {
  const slot = field.querySelector(GUIDANCE);
  if (!(slot instanceof HTMLElement)) {
    throw new Error("A field must carry a guidance slot for its error to be said in.");
  }
  return slot;
}

/**
 * Say one sentence in one field, in the guidance's place. The hint is stashed on the first
 * marking only, or a field marked twice would stash the error and restore that instead.
 *
 * @param {Element} field
 * @param {string} sentence
 */
export function markFieldError(field, sentence) {
  const slot = guidanceSlot(field);
  if (!slot.hasAttribute(STASH)) {
    slot.setAttribute(STASH, slot.textContent ?? "");
    const prior = [
      field.classList.contains(INVALID_CLASS) ? INVALID_CLASS : "",
      slot.classList.contains(ERROR_CLASS) ? ERROR_CLASS : "",
    ];
    slot.setAttribute(PRIOR, prior.join(" ").trim());
  }
  slot.textContent = sentence;
  slot.hidden = false;
  slot.classList.add(ERROR_CLASS);
  field.classList.add(INVALID_CLASS);
  for (const control of speaksFor(field)) control.setAttribute("aria-invalid", "true");
}

/**
 * Put the field back the way it was rendered: the declared hint returns, and a field that
 * never declared one goes back to saying nothing at all.
 *
 * @param {Element} field
 * @returns {boolean} whether there was anything to clear
 */
export function clearFieldError(field) {
  const slot = field.querySelector(GUIDANCE);
  if (!(slot instanceof HTMLElement) || !slot.hasAttribute(STASH)) return false;
  const hint = slot.getAttribute(STASH) ?? "";
  const prior = (slot.getAttribute(PRIOR) ?? "").split(" ");
  slot.textContent = hint;
  slot.hidden = hint === "";
  slot.classList.toggle(ERROR_CLASS, prior.includes(ERROR_CLASS));
  slot.removeAttribute(STASH);
  slot.removeAttribute(PRIOR);
  field.classList.toggle(INVALID_CLASS, prior.includes(INVALID_CLASS));
  for (const control of speaksFor(field)) control.removeAttribute("aria-invalid");
  return true;
}

/**
 * Let go of a verdict without putting anything back: the photo control has just said everything
 * about itself again, in the same slot, from its own state.
 *
 * @param {Element} field
 */
function forgetFieldError(field) {
  const slot = field.querySelector(GUIDANCE);
  slot?.removeAttribute(STASH);
  slot?.removeAttribute(PRIOR);
}

/** @param {Element} form */
function clearFormErrors(form) {
  for (const field of form.querySelectorAll(FIELD)) clearFieldError(field);
}

/**
 * The field one name stands for. Every control the renderer draws posts under the schema field's
 * own name, which is the same token `data-error-fields` names it by.
 *
 * @param {Element} form
 * @param {string} name
 * @returns {Element | null}
 */
function fieldNamed(form, name) {
  if (!FIELD_NAME.test(name)) return null;
  return form.querySelector(`[name="${name}"]`)?.closest(FIELD) ?? null;
}

/**
 * Move one marked refusal into the fields it names — moved, not copied, since two places saying
 * the same thing is one being ignored. Taken as text and written as text, never as markup.
 *
 * @param {Element} form
 * @param {Element} notice
 * @returns {Element[]} the fields it reached, in the order the marker named them
 */
export function relocateFieldError(form, notice) {
  const sentence = (notice.textContent ?? "").trim();
  if (sentence === "") return [];
  const reached = [];
  for (const name of (notice.getAttribute("data-error-fields") ?? "").split(" ")) {
    if (name === "") continue;
    const field = fieldNamed(form, name);
    if (field) reached.push(field);
  }
  // Every slot is found before any is written to: a field missing one is a rendering bug, and it
  // says so with the sentence still in the region rather than half relocated.
  for (const field of reached) guidanceSlot(field);
  for (const field of reached) markFieldError(field, sentence);
  return reached;
}

/**
 * Every required field this form is holding nothing for. Asked of the fields rather than the
 * carriers, so they come back in document order, and the first is where the person is put.
 *
 * @param {Element} form
 * @returns {Element[]}
 */
export function missingRequiredValues(form) {
  const missing = [];
  for (const field of form.querySelectorAll(FIELD)) {
    if (holdsNothing(field)) missing.push(field);
  }
  return missing;
}

/**
 * @param {Element} field
 * @returns {boolean}
 */
function holdsNothing(field) {
  const carrier = field.querySelector(MISSING_CHOICE);
  if (carrier) return carrier instanceof HTMLInputElement && carrier.value.trim() === "";
  const file = field.querySelector(REQUIRED_FILE);
  if (file instanceof HTMLInputElement) {
    return file.value === "" || file.value === file.getAttribute(FILE_FIELD_ATTRIBUTES.clearValue);
  }
  if (!field.matches(REQUIRED_LIST)) return false;
  const rows = [...field.querySelectorAll(LIST_ROW_INPUT)];
  return rows.every((row) => !(row instanceof HTMLInputElement) || row.value.trim() === "");
}

/**
 * The platform's sentence for an empty field, as the server wrote it onto this form. A form
 * without it is a rendering bug: the alternative is a client authoring copy of its own.
 *
 * @param {HTMLElement} form
 * @returns {string}
 */
function requiredSentence(form) {
  const sentence = form.dataset.requiredMessage ?? "";
  if (sentence === "") {
    throw new Error("A capability form must carry the platform's required sentence.");
  }
  return sentence;
}

/**
 * Mark every required field the form is holding nothing for. Used by the `invalid` handler alone;
 * the submit handler needs the refusal first, so it spells the steps out in its own order.
 *
 * @param {HTMLElement} form
 * @returns {Element[]} the fields marked
 */
function markMissingRequired(form) {
  const missing = missingRequiredValues(form);
  if (missing.length === 0) return missing;
  const sentence = requiredSentence(form);
  for (const field of missing) markFieldError(field, sentence);
  return missing;
}

/**
 * A refusal moves the person to the field it is about. That move is the product's, so the ring is
 * asked for: a control that is not a text input rings on keyboard focus only.
 *
 * @param {Element | null} field
 */
function focusField(field) {
  const control = field ? focusTarget(field) : null;
  if (control) control.focus({ focusVisible: true });
}

/** True while one validation pass is still running, so it lands the person once. */
let reporting = false;

/**
 * Finish a pass of the browser's own validation by standing on the first field it marked: the UA
 * focuses only controls whose `invalid` survived, and this cancels every one.
 *
 * @param {HTMLElement} form
 */
function endReportingPass(form) {
  if (reporting) return;
  reporting = true;
  // A microtask, because the pass is not over: `invalid` fires once per invalid control, and the
  // first field in the form is not always the first event.
  queueMicrotask(() => {
    reporting = false;
    focusField(form.querySelector(MARKED)?.closest(FIELD) ?? null);
  });
}

/**
 * Every listener the module installs, in one place and taking the document it listens on, so the
 * rules run in Bun. All delegated: forms arrive by swap, by a clone and by three `innerHTML`s.
 *
 * @param {Document} root
 */
export function startFieldErrors(root) {
  // `invalid` does not bubble, so this captures. Cancelling the default action takes the browser's
  // bubble away and leaves the field free to say the sentence itself.
  root.addEventListener(
    "invalid",
    (event) => {
      const control = event.target;
      if (!(control instanceof HTMLElement)) return;
      const form = /** @type {{ form?: unknown }} */ (control).form;
      const validity = /** @type {{ validity?: ValidityState }} */ (control).validity;
      // Anything but a missing value keeps the browser's words: the platform authored one
      // sentence for one failure and none for the rest.
      if (!(form instanceof HTMLFormElement) || validity?.valueMissing !== true) return;
      const field = control.closest(FIELD);
      if (!field) return;
      // Marked first, cancelled second: cancelling takes the browser's bubble away, and a throw
      // between the two would leave a refusal with no author at all.
      markFieldError(field, requiredSentence(form));
      event.preventDefault();
      // The browser's pass and this module's in one press. Native validation refuses the submit
      // below before it fires, so a form missing both kinds of field would refuse twice.
      markMissingRequired(form);
      endReportingPass(form);
    },
    true,
  );

  // Captured, and on the document, so it runs before the htmx listener on the form itself:
  // a refusal here must stop the request, not follow it.
  root.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      // Somebody earlier in the same phase already refused this: the destructive question over a
      // record form (`public/record-mutations.js`) owns both the screen and the focus.
      if (event.defaultPrevented) return;
      const missing = missingRequiredValues(form);
      if (missing.length === 0) return;
      // Refused first, said second — the opposite order to `invalid` above. Here this is the only
      // refusal, so a throw while finding the words must not let an empty field through as well.
      event.preventDefault();
      event.stopPropagation();
      const sentence = requiredSentence(form);
      for (const field of missing) markFieldError(field, sentence);
      focusField(missing[0] ?? null);
    },
    true,
  );

  // Correcting the field clears it, whatever correcting means: typing, ticking, choosing a radio,
  // or the bubbling `change` the picker and the segmented row announce (`public/choice-picker.js`).
  const corrected = (/** @type {Event} */ event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const field = target.closest(FIELD);
    if (field) clearFieldError(field);
  };
  root.addEventListener("input", corrected);
  root.addEventListener("change", corrected);
  root.addEventListener(FILE_FIELD_CHANGE, (event) => {
    if (event.target instanceof Element) forgetFieldError(event.target);
  });

  // A reset is the draft being put down — create's Cancel, and the form a committed create
  // empties. Every verdict on it goes with it.
  root.addEventListener("reset", (event) => {
    const form = event.target;
    if (form instanceof HTMLFormElement) clearFormErrors(form);
  });

  // An answer landed in the form's error region. Take it out and say it in the fields it names;
  // leave it standing when it names none this form draws, or the person is answered with silence.
  root.addEventListener("htmx:afterSwap", (event) => {
    const region = event.target;
    if (!(region instanceof HTMLElement) || !region.matches(ERROR_REGION)) return;
    const form = region.closest("form");
    if (!form) return;
    // Cleared for every answer, marked or not: half the refusals here name no field at all, and
    // one arriving over a field still saying it is too long would describe a verdict not given.
    clearFormErrors(form);
    const notice = region.querySelector(NOTICE);
    if (!notice) return;
    const reached = relocateFieldError(form, notice);
    if (reached.length === 0) return;
    notice.remove();
    focusField(reached[0] ?? null);
  });
}

if (typeof document !== "undefined") startFieldErrors(document);
