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
import { PROMPT_BAR_MESSAGE_EVENT } from "./prompt-bar.js";
import { leaveRecordView } from "./record-view.js";
import { refreshCommittedRecordsForMutation } from "./records-refresh.js";
import { registerRegionRelease } from "./region-scope.js";

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

/**
 * What a mutation's surface owes while its request is in flight.
 *
 * A record mutation aborted by the region rule — the window put away, another capability
 * opened, a build taking the window — resolves with status 0, which is the one outcome the
 * browser cannot tell from a commit it never heard about. The sentence for that was written
 * into the form's own live region: *inside the subtree being destroyed in the same tick*.
 * It was written and immediately thrown away, and the server may have committed the write.
 * For a delete that contradicts this file's own opening rule — a destructive action must
 * never look like it did nothing.
 *
 * So each in-flight mutation registers with the region's scope, and the release runs before
 * the abort does (`releaseRegionContent`, `public/region-scope.js`). A form whose surface is
 * gone says its piece on the prompt bar instead, which is the rescue `capability-deletion.js`
 * already proves. The claim lives exactly as long as the request, so nothing is left armed.
 *
 * @type {WeakMap<HTMLFormElement, { surfaceGone: boolean, deregister: () => void }>}
 */
const mutationSurfaceClaims = new WeakMap();

/** @param {HTMLFormElement} form */
function claimMutationSurface(form) {
  releaseMutationSurface(form);
  const claim = { surfaceGone: false, deregister: /** @type {() => void} */ (() => {}) };
  claim.deregister = registerRegionRelease(form, "record mutation", () => {
    claim.surfaceGone = true;
  });
  mutationSurfaceClaims.set(form, claim);
}

/**
 * End the claim and say whether the surface went while the request was out.
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
 * Where an unconfirmed outcome is said, as a value rather than an effect, so the rule can
 * be executed instead of read — the way `deleteOutcomeDisposition` beside it is.
 *
 * A surface that is going away cannot hold a sentence: writing one into it is writing it
 * and throwing it away in the same tick, which is how a delete the server may have
 * committed came to look like it did nothing at all.
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

/**
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
