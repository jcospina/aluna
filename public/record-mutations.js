// @ts-check

/**
 * What a record mutation looks like while it is happening.
 *
 * The server owns every record-bound surface; this module owns only request feedback —
 * the pending label on the submit button, the controls it disables while a request is in
 * flight, and where the user ends up once the outcome is known. Three forms reach it:
 *
 *   • CREATE, inside the collection. Its records region is still on screen, so a
 *     committed create refreshes that region in place and hands the collection back.
 *   • UPDATE, inside the record view. Its region is not on screen — the record replaced
 *     the collection — so a committed update leaves the record instead, and going back is
 *     itself the fresh read.
 *   • DELETE, inside the record view. Its confirmation replaces the form's action row in
 *     place, and a committed delete leaves the record the way a committed update does —
 *     the collection comes back as a fresh read, without the record in it.
 *
 * A request whose outcome is unknown (a severed connection: status 0) is the one case
 * neither of those covers. Create reconciles by re-reading and says so; update and delete
 * keep their surface standing and say so there, because the form still holds what was
 * typed and the confirmation still holds the question.
 *
 * Each of them sits under a back control, and leaving a record aborts whatever it still
 * has in flight. So the back control is disabled for exactly as long as a mutation is
 * running, the way Cancel is: a save the server may already have committed must not be
 * cancellable from above the form.
 */

import { leavingIsBeingAsked } from "./leaving-a-run.js";
import { leaveRecordView } from "./record-view.js";
import { refreshCommittedRecordsForMutation } from "./records-refresh.js";

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
 * @param {HTMLFormElement} form
 * @param {boolean} pending
 * @param {string} pendingLabel
 * @param {string} idleLabel
 * @param {string} cancelSelector
 */
function setPending(form, pending, pendingLabel, idleLabel, cancelSelector) {
  form.setAttribute("aria-busy", pending ? "true" : "false");
  const submit = form.querySelector(SUBMIT_BUTTON_SELECTOR);
  if (submit instanceof HTMLButtonElement) {
    submit.textContent = pending ? pendingLabel : idleLabel;
    submit.disabled = pending;
  }
  const cancel = form.querySelector(cancelSelector);
  if (cancel instanceof HTMLButtonElement) cancel.disabled = pending;
  // The bar is the form's own sibling, in the record view and in the create view alike.
  const back = form.parentElement?.querySelector(BACK_SELECTOR);
  if (back instanceof HTMLButtonElement) back.disabled = pending;
}

/** @param {HTMLFormElement} form @param {boolean} pending */
function setEditPending(form, pending) {
  setPending(form, pending, "I’m saving…", "Save", RECORD_CANCEL_SELECTOR);
}

/** @param {HTMLFormElement} form @param {boolean} pending */
function setCreatePending(form, pending) {
  setPending(form, pending, "I’m adding…", "Add", CREATE_CANCEL_SELECTOR);
}

/** @param {HTMLFormElement} form @param {boolean} pending */
function setDeletePending(form, pending) {
  setPending(form, pending, "I’m deleting…", "Delete record", DELETE_CANCEL_SELECTOR);
}

/**
 * The rule the confirmation follows, stated on its own so it can be proved without a
 * browser. The action row and the question are siblings and exactly one of them is ever
 * shown, which is the whole of "replaces it in place": nothing moves, and the record stays
 * readable above the question.
 *
 * Every asking is a fresh one, so the error region is cleared either way. A refusal left
 * standing from a previous attempt would sit under the new question describing something
 * the user has not tried yet, and the one that says the entry is already gone is the worst
 * of them to read that way.
 *
 * Focus follows what is now on screen. Opening lands on Cancel rather than the destructive
 * control, the way the deleted modal did; cancelling gives focus back to the Delete that
 * opened it, because hiding the control a keyboard user is standing on drops them at the
 * top of the desk.
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
  question.clearError();
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

/** @param {HTMLFormElement} form @param {string} message */
function showMutationNotice(form, message) {
  const target = form.querySelector(LIVE_REGION_SELECTOR);
  if (!(target instanceof HTMLElement)) return;
  const notice = document.createElement("p");
  notice.className = "notice";
  notice.dataset.role = "error";
  notice.dataset.errorCode = "mutation_outcome_unknown";
  notice.textContent = message;
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

/** @param {HTMLFormElement} form @param {boolean} successful @param {boolean} outcomeUnknown */
async function handleCreateOutcome(form, successful, outcomeUnknown) {
  if (successful) {
    await finishCommittedCreate(form);
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

/** @param {HTMLFormElement} form @param {boolean} successful @param {boolean} outcomeUnknown */
function handleEditOutcome(form, successful, outcomeUnknown) {
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
    );
  }
  const fields = form.querySelector(".capability-edit-form__fields");
  if (fields instanceof HTMLElement) fields.scrollTop = 0;
}

/**
 * Where a finished delete leaves the user, as a value rather than an effect, so the
 * acceptance criterion can be executed instead of read.
 *
 * A committed delete leaves the record the way a committed update does: the collection
 * comes back as a fresh read, and the record is not in it. A refused one leaves the
 * confirmation standing, because the router retargets its refusal into the live region
 * that form carries — a question that closed itself would take the answer with it. A
 * severed one keeps the question too, and adds the one thing the browser knows: that it
 * cannot say whether the record is gone.
 *
 * @param {{ successful: boolean, outcomeUnknown: boolean }} outcome
 * @returns {"leave" | "stand" | "stand-and-say"}
 */
export function deleteOutcomeDisposition({ successful, outcomeUnknown }) {
  if (successful) return "leave";
  return outcomeUnknown ? "stand-and-say" : "stand";
}

/** @param {HTMLFormElement} form @param {boolean} successful @param {boolean} outcomeUnknown */
function handleDeleteOutcome(form, successful, outcomeUnknown) {
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
    );
  }
}

// Every listener the module installs, in one place and behind a document check, so the
// rules above can be evaluated and exercised in Bun without a browser.
function installRecordMutations() {
  // Delegated and document-level, so it covers every record view the swap brings in later.
  // Pressing Delete only asks the question: the separately submitted confirmation below is
  // the one thing that can invoke the server Action.
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const control = target.closest(`${DELETE_TRIGGER_SELECTOR}, ${DELETE_CANCEL_SELECTOR}`);
    const view = control?.closest(RECORD_VIEW_SELECTOR);
    if (!control || !(view instanceof HTMLElement)) return;
    setDeleteConfirming(view, control.matches(DELETE_TRIGGER_SELECTOR));
  });

  // A destructive question standing over the form is the one moment the form beneath it must
  // not be submittable. The action row is hidden, but a hidden submit button is still the
  // form's default button, so Enter in any field would save — and once Delete record is
  // pressed, race the very delete it is answering. Captured, because htmx listens on the
  // form itself and this has to be the earlier of the two.
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

  // The question the modal dismissed with Escape keeps that exit, which is the one thing a
  // view swap could not inherit from a `<dialog>`. It is refused mid-delete for the same
  // reason Cancel is disabled there: the server may already have committed.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    // One press, one question. A run covers the collection without removing it, so a record
    // view with a standing confirmation can be sitting behind the question a navigation is
    // asking (`public/leaving-a-run.js`); that one is the one on screen and the one Escape
    // means, and answering both with a single press would close a question the person
    // never saw.
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
      setEditPending(editForm, true);
      return;
    }
    const deleteForm = requestForm(event, DELETE_FORM_SELECTOR);
    if (deleteForm) {
      setDeletePending(deleteForm, true);
      return;
    }
    const createForm = requestForm(event, CREATE_FORM_SELECTOR);
    if (createForm) setCreatePending(createForm, true);
  });

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
      handleEditOutcome(editForm, successful, outcomeUnknown);
      return;
    }
    const deleteForm = requestForm(event, DELETE_FORM_SELECTOR);
    if (deleteForm) {
      handleDeleteOutcome(deleteForm, successful, outcomeUnknown);
      return;
    }
    const createForm = requestForm(event, CREATE_FORM_SELECTOR);
    if (createForm) void handleCreateOutcome(createForm, successful, outcomeUnknown);
  });

  // The datetime control the user types into is a local-time `datetime-local`; the exact
  // stored value rides a hidden twin so a round-trip never rewrites precision the user did
  // not touch. Mirroring is presentation, not canonical state.
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
