// @ts-check

/**
 * What a record mutation looks like while it is happening: the server owns every record-bound
 * surface, and this module owns only request feedback — pending labels and disabled controls.
 */

import { leavingIsBeingAsked } from "./leaving-a-run.js";
import { PROMPT_BAR_MESSAGE_EVENT } from "./prompt-bar.js";
import { leaveRecordView } from "./record-view.js";
import { refreshCommittedRecordsForMutation } from "./records-refresh.js";
import { registerRegionRelease } from "./region-scope.js";
import { BUSY_LABEL_ATTRIBUTE, IDLE_LABEL_ATTRIBUTE } from "./shell-dom.js";

const EDIT_FORM_SELECTOR = "[data-record-edit-form]";
const CREATE_FORM_SELECTOR = '[data-post-mutation-refresh][data-mutation-kind="create"]';
const CREATE_CANCEL_SELECTOR = "[data-create-cancel]";
const RECORD_CANCEL_SELECTOR = "[data-record-cancel]";
const DELETE_FORM_SELECTOR = "[data-record-delete-form]";
const DELETE_TRIGGER_SELECTOR = "[data-record-delete]";
const DELETE_CANCEL_SELECTOR = "[data-record-cancel-delete]";
const LIVE_REGION_SELECTOR = '[aria-live="polite"]';
const EDIT_ACTIONS_SELECTOR = ".capability-edit-form__actions";
const BACK_SELECTOR = "[data-record-form-back]";
const RECORD_VIEW_SELECTOR = "[data-record-view]";
const SUBMIT_BUTTON_SELECTOR = 'button[type="submit"]';
const HELD_SAVE_LABEL_SELECTOR = "[data-held-save-label]";
const FILE_FIELD_SELECTOR = "[data-file-field]";
const RECORD_CREATED_EVENT = "aluna:record-created";

/**
 * @param {Event} event
 * @param {string} selector
 * @returns {HTMLFormElement | null}
 */
function requestForm(event, selector) {
  const custom = /** @type {CustomEvent<{ elt?: Element }>} */ (event);
  const form = custom.detail?.elt;
  return form instanceof HTMLFormElement && form.matches(selector) ? form : null;
}

/**
 * Swap a submit control between its idle text and the sentence the server gave it to say. Both
 * come off the markup: the browser restating either meant a renamed button reverted to the
 * browser's spelling the first time it was pressed. A save a file can hold keeps its words in a
 * label of their own, which the hold writes too, so that label is what changes.
 *
 * @param {HTMLButtonElement} submit
 * @param {boolean} pending
 */
function sayWhatItIsDoing(submit, pending) {
  const label = submit.querySelector(HELD_SAVE_LABEL_SELECTOR) ?? submit;
  if (pending) {
    if (!submit.hasAttribute(IDLE_LABEL_ATTRIBUTE)) {
      submit.setAttribute(IDLE_LABEL_ATTRIBUTE, label.textContent ?? "");
    }
    label.textContent = submit.getAttribute(BUSY_LABEL_ATTRIBUTE) ?? label.textContent;
    return;
  }
  const idle = submit.getAttribute(IDLE_LABEL_ATTRIBUTE);
  if (idle !== null) label.textContent = idle;
}

/**
 * A file picked while a save is out would change a draft the server may have saved without it.
 *
 * @param {HTMLFormElement} form
 * @param {boolean} frozen
 */
function freezeFileFields(form, frozen) {
  for (const field of form.querySelectorAll(FILE_FIELD_SELECTOR)) {
    if (field instanceof HTMLElement) field.inert = frozen;
  }
}

/**
 * A save was refused, so its form's file fields take picks again, before `htmx` swaps in the
 * refusal that focus has to reach them to say. A save that went through keeps them frozen until
 * the form is put back.
 *
 * @param {Event} event
 */
export function thawFileFields(event) {
  const detail = /** @type {CustomEvent<{ xhr?: XMLHttpRequest }>} */ (event).detail;
  if ((detail?.xhr?.status ?? 0) < 400) return;
  const form = requestForm(event, EDIT_FORM_SELECTOR) ?? requestForm(event, CREATE_FORM_SELECTOR);
  if (form) freezeFileFields(form, false);
}

/**
 * @param {HTMLFormElement} form
 * @param {boolean} pending
 * @param {string} cancelSelector
 */
export function setPending(form, pending, cancelSelector) {
  form.setAttribute("aria-busy", pending ? "true" : "false");
  const submit = form.querySelector(SUBMIT_BUTTON_SELECTOR);
  if (submit instanceof HTMLButtonElement) {
    sayWhatItIsDoing(submit, pending);
    submit.disabled = pending;
  }
  const cancel = form.querySelector(cancelSelector);
  if (cancel instanceof HTMLButtonElement) cancel.disabled = pending;
  freezeFileFields(form, pending);
  // The bar is the form's own sibling, in the record view and the create view alike. Disabled
  // while a mutation runs, like Cancel: a save the server may have committed is not cancellable.
  const back = form.parentElement?.querySelector(BACK_SELECTOR);
  if (back instanceof HTMLButtonElement) back.disabled = pending;
}

/** @param {HTMLFormElement} form @param {boolean} pending */
function setEditPending(form, pending) {
  setPending(form, pending, RECORD_CANCEL_SELECTOR);
}

/** @param {HTMLFormElement} form @param {boolean} pending */
function setCreatePending(form, pending) {
  setPending(form, pending, CREATE_CANCEL_SELECTOR);
}

/** @param {HTMLFormElement} form @param {boolean} pending */
function setDeletePending(form, pending) {
  setPending(form, pending, DELETE_CANCEL_SELECTOR);
}

/**
 * The rule the confirmation follows, provable without a browser: the action row and the question
 * are siblings and exactly one is shown, so nothing moves and the record stays readable.
 *
 * @template T
 * @param {{
 *   confirming: boolean,
 *   actions: { hidden: boolean, trigger: T | null },
 *   question: { hidden: boolean, cancel: T | null, clearError: () => void },
 *   focus: (control: T) => void,
 * }} toggle
 */
export function applyDeleteConfirmation({ confirming, actions, question, focus }) {
  actions.hidden = confirming;
  question.hidden = !confirming;
  // Every asking is a fresh one: a refusal left standing would describe an attempt the user has
  // not made, and the one saying the entry is already gone is the worst to read that way.
  question.clearError();
  // Opening lands on Cancel, not the destructive control; cancelling gives focus back to the
  // Delete that opened it, because hiding the control a keyboard user stands on drops them.
  const landing = confirming ? question.cancel : actions.trigger;
  if (landing) focus(landing);
}

/** @param {HTMLElement} view @param {boolean} confirming */
function setDeleteConfirming(view, confirming) {
  const row = view.querySelector(EDIT_ACTIONS_SELECTOR);
  const form = view.querySelector(DELETE_FORM_SELECTOR);
  if (!(row instanceof HTMLElement) || !(form instanceof HTMLFormElement)) return;
  applyDeleteConfirmation({
    confirming,
    actions: {
      set hidden(value) {
        row.hidden = value;
      },
      get hidden() {
        return row.hidden;
      },
      trigger: row.querySelector(DELETE_TRIGGER_SELECTOR),
    },
    question: {
      set hidden(value) {
        form.hidden = value;
      },
      get hidden() {
        return form.hidden;
      },
      cancel: form.querySelector(DELETE_CANCEL_SELECTOR),
      clearError: () => form.querySelector(LIVE_REGION_SELECTOR)?.replaceChildren(),
    },
    /* Asked for visibly: the move is the product's, not a keystroke of the person's,
       and a control that is not a text input rings on keyboard focus alone. */
    focus: (control) => {
      if (control instanceof HTMLElement) control.focus({ focusVisible: true });
    },
  });
}

/**
 * The confirmation standing in this record view, or null when the question is not asked.
 * @param {HTMLElement} view
 * @returns {HTMLFormElement | null}
 */
function standingDeleteConfirmation(view) {
  const form = view.querySelector(DELETE_FORM_SELECTOR);
  return form instanceof HTMLFormElement && !form.hidden ? form : null;
}

/**
 * A mutation aborted by the region rule used to write its sentence into the form's own live
 * region — inside the subtree being destroyed in the same tick, so it was thrown away at once.
 *
 * @type {WeakMap<HTMLFormElement, { surfaceGone: boolean, deregister: () => void }>}
 */
const mutationSurfaceClaims = new WeakMap();

/**
 * Register with the region's scope, whose release runs before the abort does
 * (`releaseRegionContent`). The claim lives as long as the request, so nothing is left armed.
 * @param {HTMLFormElement} form
 */
function claimMutationSurface(form) {
  releaseMutationSurface(form);
  const claim = { surfaceGone: false, deregister: /** @type {() => void} */ (() => {}) };
  claim.deregister = registerRegionRelease(form, "record mutation", () => {
    claim.surfaceGone = true;
  });
  mutationSurfaceClaims.set(form, claim);
}

/**
 * End the claim and say whether the surface went while the request was out. A form whose surface
 * is gone says its piece on the prompt bar instead.
 * @param {HTMLFormElement} form
 * @returns {boolean}
 */
function releaseMutationSurface(form) {
  const claim = mutationSurfaceClaims.get(form);
  if (!claim) return false;
  claim.deregister();
  mutationSurfaceClaims.delete(form);
  return claim.surfaceGone;
}

/**
 * The prompt bar's standing slot, reached the way `capability-deletion.js` reaches it.
 * @param {string} sentence
 */
function tellThePromptBar(sentence) {
  document.dispatchEvent(
    new CustomEvent(PROMPT_BAR_MESSAGE_EVENT, { detail: { sentence, refused: false } }),
  );
}

/**
 * What an unconfirmed outcome says when the form it belongs to is not there to say it.
 * "Go back and check" names a control the person no longer has.
 */
export const UNCONFIRMED_ON_THE_DESK =
  "I couldn’t confirm that change. Open it again to see where it landed.";

/**
 * Where an unconfirmed outcome is said, as a value rather than an effect, so the rule can be
 * executed instead of read. A surface that is going away cannot hold a sentence.
 *
 * @param {{ surfaceGone: boolean, hasField: boolean, inField: string }} outcome
 * @returns {{ where: "field" | "prompt-bar", sentence: string }}
 */
export function unconfirmedMutationAnswer({ surfaceGone, hasField, inField }) {
  return surfaceGone || !hasField
    ? { where: "prompt-bar", sentence: UNCONFIRMED_ON_THE_DESK }
    : { where: "field", sentence: inField };
}

/** @param {HTMLFormElement} form @param {string} message @param {boolean} [surfaceGone] */
function showMutationNotice(form, message, surfaceGone = false) {
  const target = form.querySelector(LIVE_REGION_SELECTOR);
  const answer = unconfirmedMutationAnswer({
    surfaceGone,
    hasField: target instanceof HTMLElement,
    inField: message,
  });
  if (answer.where === "prompt-bar" || !(target instanceof HTMLElement)) {
    tellThePromptBar(answer.sentence);
    return;
  }
  const notice = document.createElement("p");
  notice.className = "notice";
  notice.dataset.role = "error";
  notice.dataset.errorCode = "mutation_outcome_unknown";
  notice.textContent = answer.sentence;
  target.replaceChildren(notice);
}

/**
 * @param {HTMLFormElement} form
 * @returns {Promise<HTMLElement | null>}
 */
async function refreshCommittedRead(form) {
  const htmx = /** @type {Window & { htmx?: { process(node: Element): void } }} */ (window).htmx;
  const result = await refreshCommittedRecordsForMutation({
    form,
    process: (refreshed) => {
      if (refreshed instanceof Element) htmx?.process(refreshed);
    },
  });
  return result?.region ?? null;
}

/** @param {HTMLFormElement} form @returns {Promise<boolean>} */
async function reconcileUnknownCreate(form) {
  try {
    await refreshCommittedRead(form);
    return true;
  } catch {
    window.location.reload();
    return false;
  }
}

/** @param {HTMLFormElement} form */
async function finishCommittedCreate(form) {
  try {
    await refreshCommittedRead(form);
  } catch {
    window.location.reload();
    return;
  }
  setCreatePending(form, false);
  form.reset();
  form.dispatchEvent(
    new CustomEvent(RECORD_CREATED_EVENT, {
      bubbles: true,
      detail: { capabilityId: form.dataset.capabilityId },
    }),
  );
}

/**
 * Create sits inside the collection, whose records region is still on screen, so a committed
 * create refreshes that region in place and an unknown outcome reconciles by re-reading.
 * @param {HTMLFormElement} form @param {boolean} successful @param {boolean} outcomeUnknown
 * @param {boolean} surfaceGone
 */
async function handleCreateOutcome(form, successful, outcomeUnknown, surfaceGone) {
  if (successful) {
    await finishCommittedCreate(form);
    return;
  }
  // A surface that has gone cannot be refreshed, and re-reading it would only race the
  // thing that replaced it. Say what happened where it can be read, and stop.
  if (surfaceGone) {
    if (outcomeUnknown) showMutationNotice(form, "", true);
    return;
  }
  if (outcomeUnknown && !(await reconcileUnknownCreate(form))) return;
  setCreatePending(form, false);
  if (outcomeUnknown) {
    showMutationNotice(
      form,
      "I couldn’t confirm that change. I refreshed what’s here — please check before trying again.",
    );
  }
}

/**
 * Update sits inside the record view, whose region is off screen, so a committed update leaves
 * the record and going back is itself the fresh read.
 * @param {HTMLFormElement} form @param {boolean} successful @param {boolean} outcomeUnknown
 * @param {boolean} surfaceGone
 */
function handleEditOutcome(form, successful, outcomeUnknown, surfaceGone) {
  setEditPending(form, false);
  if (successful) {
    const view = form.closest(RECORD_VIEW_SELECTOR);
    if (view instanceof HTMLElement) leaveRecordView(view);
    return;
  }
  if (outcomeUnknown) {
    showMutationNotice(
      form,
      "I couldn’t confirm that change. Go back and check before trying again.",
      surfaceGone,
    );
  }
  // Back to the top, unless a refusal has just put the person on a field lower down.
  const fields = form.querySelector(".capability-edit-form__fields");
  if (fields instanceof HTMLElement && !fields.contains(document.activeElement)) {
    fields.scrollTop = 0;
  }
}

/**
 * Where a finished delete leaves the user, as a value so the acceptance criterion can be run. A
 * refusal keeps the question standing: the router retargets it into that form's live region.
 *
 * @param {{ successful: boolean, outcomeUnknown: boolean }} outcome
 * @returns {"leave" | "stand" | "stand-and-say"}
 */
export function deleteOutcomeDisposition({ successful, outcomeUnknown }) {
  if (successful) return "leave";
  return outcomeUnknown ? "stand-and-say" : "stand";
}

/**
 * Delete sits inside the record view too, its confirmation replacing the action row in place,
 * and a committed delete leaves the record the way a committed update does.
 * @param {HTMLFormElement} form @param {boolean} successful @param {boolean} outcomeUnknown
 * @param {boolean} surfaceGone
 */
function handleDeleteOutcome(form, successful, outcomeUnknown, surfaceGone) {
  setDeletePending(form, false);
  const disposition = deleteOutcomeDisposition({ successful, outcomeUnknown });
  if (disposition === "leave") {
    const view = form.closest(RECORD_VIEW_SELECTOR);
    if (view instanceof HTMLElement) leaveRecordView(view);
    return;
  }
  if (disposition === "stand-and-say") {
    showMutationNotice(
      form,
      "I couldn’t confirm that change. Go back and check before trying again.",
      surfaceGone,
    );
  }
}

// Every listener the module installs, in one place and behind a document check, so the
// rules above can be evaluated and exercised in Bun without a browser.
function installRecordMutations() {
  // Delegated and document-level, so it covers every record view the swap brings in later.
  // Pressing Delete only asks the question; the confirmation below invokes the server Action.
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const control = target.closest(`${DELETE_TRIGGER_SELECTOR}, ${DELETE_CANCEL_SELECTOR}`);
    const view = control?.closest(RECORD_VIEW_SELECTOR);
    if (!control || !(view instanceof HTMLElement)) return;
    setDeleteConfirming(view, control.matches(DELETE_TRIGGER_SELECTOR));
  });

  // A hidden submit button is still the form's default button, so Enter in any field would save
  // under a standing question. Captured, because htmx listens on the form and must come second.
  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.matches(EDIT_FORM_SELECTOR)) return;
      const view = form.closest(RECORD_VIEW_SELECTOR);
      if (!(view instanceof HTMLElement) || !standingDeleteConfirmation(view)) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );

  // Escape keeps the exit the modal had, the one thing a view swap could not inherit from a
  // `<dialog>`. Refused mid-delete for the reason Cancel is: the server may have committed.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    // One press, one question. A record view with a standing confirmation can sit behind the
    // question a navigation asks (`public/leaving-a-run.js`); that one is on screen, so it wins.
    if (leavingIsBeingAsked()) return;
    // Asked of the document rather than of what has focus: the window holds one record view
    // at a time, and a user who has clicked away still means this question by Escape.
    const view = document.querySelector(RECORD_VIEW_SELECTOR);
    if (!(view instanceof HTMLElement)) return;
    const cancel = standingDeleteConfirmation(view)?.querySelector(DELETE_CANCEL_SELECTOR);
    if (!(cancel instanceof HTMLButtonElement) || cancel.disabled) return;
    setDeleteConfirming(view, false);
  });

  document.addEventListener("htmx:beforeRequest", (event) => {
    const editForm = requestForm(event, EDIT_FORM_SELECTOR);
    if (editForm) {
      claimMutationSurface(editForm);
      setEditPending(editForm, true);
      return;
    }
    const deleteForm = requestForm(event, DELETE_FORM_SELECTOR);
    if (deleteForm) {
      claimMutationSurface(deleteForm);
      setDeletePending(deleteForm, true);
      return;
    }
    const createForm = requestForm(event, CREATE_FORM_SELECTOR);
    if (createForm) {
      claimMutationSurface(createForm);
      setCreatePending(createForm, true);
    }
  });

  document.addEventListener("htmx:beforeSwap", thawFileFields);

  document.addEventListener("htmx:afterRequest", (event) => {
    const custom = /** @type {CustomEvent<{ successful?: boolean, xhr?: XMLHttpRequest }>} */ (
      event
    );
    const successful = custom.detail?.successful === true;
    // A severed connection resolves with no status at all, which is the only outcome the
    // browser cannot tell apart from a commit it never heard about.
    const outcomeUnknown = (custom.detail?.xhr?.status ?? 0) === 0;

    const editForm = requestForm(event, EDIT_FORM_SELECTOR);
    if (editForm) {
      handleEditOutcome(editForm, successful, outcomeUnknown, releaseMutationSurface(editForm));
      return;
    }
    const deleteForm = requestForm(event, DELETE_FORM_SELECTOR);
    if (deleteForm) {
      handleDeleteOutcome(
        deleteForm,
        successful,
        outcomeUnknown,
        releaseMutationSurface(deleteForm),
      );
      return;
    }
    const createForm = requestForm(event, CREATE_FORM_SELECTOR);
    if (createForm) {
      void handleCreateOutcome(
        createForm,
        successful,
        outcomeUnknown,
        releaseMutationSurface(createForm),
      );
    }
  });

  // The datetime control the user types into is a local-time `datetime-local`; the exact stored
  // value rides a hidden twin, so a round-trip never rewrites precision the user did not touch.
  document.addEventListener("input", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.matches("[data-edit-datetime-input]"))
      return;
    const fieldName = input.dataset.editDatetimeInput;
    const exactValue = fieldName ? input.form?.elements.namedItem(fieldName) : null;
    if (
      exactValue instanceof HTMLInputElement &&
      exactValue.matches("[data-edit-datetime-value]")
    ) {
      exactValue.value = input.value;
    }
  });
}

if (typeof document !== "undefined") installRecordMutations();
