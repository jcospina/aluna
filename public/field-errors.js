// @ts-check

/**
 * Where a validation error is said, and what stops a submission before it is sent.
 *
 * **The sentence belongs in the field.** An outline says that something is wrong and a
 * sentence says *what*, so the two are said in different places: the field takes
 * `.is-invalid`, which recolours its well, and the words go into the guidance's own slot
 * (`design/controls.html`, "The states"). Every field carries a `[data-field-guidance]`
 * slot whether or not it declared a hint (`src/presentation/field-chrome.ts`) — one per
 * field, which is what tells it apart from the platform's own line about commas and from
 * the character count, both of which are guidance too. So there is always exactly one
 * element to write into, it is already named by `aria-describedby`, and putting the hint
 * back is putting one string back.
 *
 * **A refusal is relocated, never rewritten.** The platform's structural refusals arrive
 * marked with `data-error-fields`, and until now nothing read it: the sentence landed in
 * the form's error region and stopped there. This moves that same sentence — a generated
 * Handler's own product-voice wording, when the refusal is one a capability declared — out
 * of the region and into each field the marker names. It is moved rather than copied,
 * because two places saying the same thing is one of them being ignored.
 *
 * **The browser's own check keeps its refusal and loses its tooltip.** Native `required`
 * still does the work everywhere a real control carries it; all that is taken off it is
 * the foreign bubble it paints, replaced by the platform's sentence in the same slot a
 * server refusal uses. Only a *missing* value is claimed that way — the platform has
 * authored one sentence, for one failure, and inventing a second for a failure it has not
 * written copy for would be the second copy source this whole slice exists to avoid.
 *
 * **The drawn picker had given that up entirely.** Its value rides a hidden input, and a
 * hidden input is barred from constraint validation, so a required picker left empty used
 * to sail past the browser and be refused by the server a round trip later. The carrier
 * says `data-choice-required` now, and the submit below is where that word is enforced —
 * the same place, the same sentence and the same slot a native control would have used.
 *
 * **Every path that marks a field ends by standing on it.** Two things make that
 * load-bearing rather than a nicety. Cancelling `invalid` takes the browser's *focus and
 * scroll* along with its bubble — the UA acts only on the controls whose event survived —
 * so a form taller than its scroller would otherwise be refused entirely off screen. And
 * the sentence leaves the form's `aria-live` region in the same turn it arrives, which is
 * a turn too early to be announced; what a screen reader hears instead is the field's own
 * description, which is read on focus. The description is the announcement.
 */

const FIELD = ".field";
const GUIDANCE = "[data-field-guidance]";
const ERROR_CLASS = "field__guidance--error";
const INVALID_CLASS = "is-invalid";
/** Where the declared hint waits while the error is standing in its place. */
const STASH = "data-field-guidance-text";
const MISSING_CHOICE = "[data-choice-value][data-choice-required]";
const NOTICE = "[data-error-fields]";
/** The live slot a refusal is retargeted into, in every form that has one. */
const ERROR_REGION = '[aria-live="polite"]';

/**
 * The elements a field's state is said on: the ones that take `aria-invalid`, the first of
 * which is where focus lands. Ordered by the document, not by the list — a field holds one
 * kind of these, and the picker's button is the only `.field__control` among them. A
 * repeatable list is the one field that answers with more than one, which is right: every
 * row of it is a control of the field the refusal is about.
 */
const SPEAKS_FOR =
  ".listbox__button, .field__textarea, .field__input, .field__checkbox, .choice-set, .segmented";

/**
 * What a field name is allowed to be, checked before it is spent in a selector.
 *
 * `data-error-fields` is read off a *generated* Handler's response. The spec validator
 * holds an authored capability to schema field names, but a Handler is code, and the one
 * thing a string interpolated into `querySelector` must never be is arbitrary.
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
  const control = speaksFor(field)[0];
  if (!control) return null;
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
 * The one slot a field says things about itself in — and a rendering bug when it is
 * missing, said out loud rather than papered over, the way a length counter without its
 * limit is (`public/long-text-field.js`).
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
 * Say one sentence in one field, in the guidance's place.
 *
 * The hint is stashed on the first marking only. A field marked twice without being
 * cleared in between — a server refusal landing on a field the browser had already
 * refused — would otherwise stash the error as if it were the hint and restore *that*.
 *
 * @param {Element} field
 * @param {string} sentence
 */
export function markFieldError(field, sentence) {
  const slot = guidanceSlot(field);
  if (!field.classList.contains(INVALID_CLASS)) {
    slot.setAttribute(STASH, slot.textContent ?? "");
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
  if (!field.classList.contains(INVALID_CLASS)) return false;
  const slot = field.querySelector(GUIDANCE);
  if (slot instanceof HTMLElement) {
    const hint = slot.getAttribute(STASH) ?? "";
    slot.textContent = hint;
    slot.hidden = hint === "";
    slot.classList.remove(ERROR_CLASS);
    slot.removeAttribute(STASH);
  }
  field.classList.remove(INVALID_CLASS);
  for (const control of speaksFor(field)) control.removeAttribute("aria-invalid");
  return true;
}

/** @param {Element} form */
function clearFormErrors(form) {
  for (const field of form.querySelectorAll(FIELD)) clearFieldError(field);
}

/**
 * The field one name stands for. Every control the renderer draws — text, textarea,
 * checkbox, the datetime mirror's exact twin, both choice carriers, the radio inputs —
 * posts under the schema field's own name, which is the same token `data-error-fields`
 * names it by.
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
 * Move one marked refusal into the fields it names.
 *
 * The sentence is taken as text and written as text: whatever a Handler returned is what
 * the person reads, unrewritten, and nothing in it can become markup on the way.
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
  // Every slot is found before any of them is written to. A field missing one is a
  // rendering bug and still says so, but it says so with the sentence still standing in
  // the region rather than half relocated — some fields marked, the rest not, and the
  // region repeating what two of them are already saying.
  for (const field of reached) guidanceSlot(field);
  for (const field of reached) markFieldError(field, sentence);
  return reached;
}

/**
 * Every required choice this form is holding nothing for — the check the browser cannot
 * run, because the value it would be checking rides a hidden input.
 *
 * @param {Element} form
 * @returns {Element[]}
 */
export function missingRequiredChoices(form) {
  const missing = [];
  for (const carrier of form.querySelectorAll(MISSING_CHOICE)) {
    if (!(carrier instanceof HTMLInputElement) || carrier.value.trim() !== "") continue;
    const field = carrier.closest(FIELD);
    if (field) missing.push(field);
  }
  return missing;
}

/**
 * The platform's sentence for an empty field, as the server wrote it onto this form.
 *
 * A capability form without it is a rendering bug and says so, the way a length counter
 * without its limit does: the alternative is a client quietly authoring copy of its own,
 * which is the one thing this module must never do.
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
 * Mark every required choice the form is holding nothing for. Used by the `invalid`
 * handler alone: the submit handler needs the refusal to land before the words are looked
 * for, so it spells the same three steps out in its own order.
 *
 * @param {HTMLElement} form
 * @returns {Element[]} the fields marked
 */
function markMissingChoices(form) {
  const missing = missingRequiredChoices(form);
  if (missing.length === 0) return missing;
  const sentence = requiredSentence(form);
  for (const field of missing) markFieldError(field, sentence);
  return missing;
}

/** @param {Element | null} field */
function focusField(field) {
  const control = field ? focusTarget(field) : null;
  if (control) control.focus();
}

/** True while one validation pass is still running, so it lands the person once. */
let reporting = false;

/**
 * Finish a pass of the browser's own validation by standing on the first field it marked.
 *
 * The UA does its own focusing and scrolling only for controls whose `invalid` survived,
 * and this module cancels every one, so without this a refusal happens off screen. It
 * waits a microtask because the pass is not over: `invalid` fires once per invalid
 * control, and the first field in the form is not always the first event.
 *
 * @param {HTMLElement} form
 */
function endReportingPass(form) {
  if (reporting) return;
  reporting = true;
  queueMicrotask(() => {
    reporting = false;
    focusField(form.querySelector(`${FIELD}.${INVALID_CLASS}`));
  });
}

/**
 * Every listener the module installs, in one place and taking the document it listens on,
 * so the rules above can be exercised in Bun without a browser (the shipped page passes
 * its own, at the foot of this file). All of them are delegated: forms arrive by htmx
 * swap, by a record view cloning a template and by three modules assigning `innerHTML`,
 * and none of those announce themselves.
 *
 * @param {Document} root
 */
export function startFieldErrors(root) {
  // `invalid` does not bubble, so this has to capture. The default action of the event is
  // the browser's own bubble, and cancelling it is what leaves the field free to say the
  // sentence itself. Anything other than a missing value keeps the browser's words,
  // because the platform has not authored any of its own for it.
  root.addEventListener(
    "invalid",
    (event) => {
      const control = event.target;
      if (!(control instanceof HTMLElement)) return;
      const form = /** @type {{ form?: unknown }} */ (control).form;
      const validity = /** @type {{ validity?: ValidityState }} */ (control).validity;
      if (!(form instanceof HTMLFormElement) || validity?.valueMissing !== true) return;
      const field = control.closest(FIELD);
      if (!field) return;
      // Marked first, cancelled second, and in that order deliberately. Cancelling is what
      // takes the browser's bubble away; a throw between the two would take the bubble
      // away and put nothing in its place, which is a refusal with no author at all.
      markFieldError(field, requiredSentence(form));
      event.preventDefault();
      // The browser's pass and this module's in the same press. Native validation refuses
      // the submit below before it fires, so a form missing both a typed field and a
      // picker would otherwise mark the typed one, be fixed, and only then admit that the
      // picker was empty too — two refusals for one filling-in.
      markMissingChoices(form);
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
      // Somebody earlier in the same phase has already refused this submission. The one
      // that does is the destructive question standing over a record form
      // (`public/record-mutations.js`), and while it stands it owns both the screen and
      // the focus — so nothing here may mark a field or take the person off its Cancel.
      if (event.defaultPrevented) return;
      const missing = missingRequiredChoices(form);
      if (missing.length === 0) return;
      // Refused first, said second — the opposite order to the `invalid` handler above,
      // and for the same reason. There the browser has already refused and cancelling is
      // the only thing left to lose; here this *is* the only refusal, because no browser
      // validates a hidden input, so a throw while finding the words must not let an empty
      // required field through as well as leaving it unexplained.
      event.preventDefault();
      event.stopPropagation();
      const sentence = requiredSentence(form);
      for (const field of missing) markFieldError(field, sentence);
      focusField(missing[0] ?? null);
    },
    true,
  );

  // Correcting the field is what clears it, whatever correcting means for the control:
  // typing, ticking, choosing a radio, or the bubbling `change` the drawn picker and the
  // segmented row announce on their carrier (`public/choice-picker.js`).
  const corrected = (/** @type {Event} */ event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const field = target.closest(FIELD);
    if (field) clearFieldError(field);
  };
  root.addEventListener("input", corrected);
  root.addEventListener("change", corrected);

  // A reset is the draft being put down — create's Cancel, and the form a committed create
  // empties. Every verdict on it goes with it.
  root.addEventListener("reset", (event) => {
    const form = event.target;
    if (form instanceof HTMLFormElement) clearFormErrors(form);
  });

  // An answer has landed in the form's error region. Take it out of there and say it in
  // the fields it names; leave it standing when it names none this form is drawing, since
  // a sentence moved to a slot that does not exist is a person answered with silence.
  root.addEventListener("htmx:afterSwap", (event) => {
    const region = event.target;
    if (!(region instanceof HTMLElement) || !region.matches(ERROR_REGION)) return;
    const form = region.closest("form");
    if (!form) return;
    // Cleared for every answer, marked or not. Half the refusals that land here name no
    // field at all — a held mutation lease, a record already gone — and one of those
    // arriving over a field still saying it is too long would leave that field describing
    // a verdict the server has just not given.
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
