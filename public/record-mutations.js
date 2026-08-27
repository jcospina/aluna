// @ts-check

/**
 * What a record mutation looks like while it is happening.
 *
 * The server owns every record-bound surface; this module owns only request feedback —
 * the pending label on the submit button, the controls it disables while a request is in
 * flight, and where the user ends up once the outcome is known. Two forms reach it:
 *
 *   • CREATE, inside the collection. Its records region is still on screen, so a
 *     committed create refreshes that region in place and hands the collection back.
 *   • UPDATE, inside the record view. Its region is not on screen — the record replaced
 *     the collection — so a committed update leaves the record instead, and going back is
 *     itself the fresh read.
 *
 * A request whose outcome is unknown (a severed connection: status 0) is the one case
 * neither of those covers. Create reconciles by re-reading and says so; update keeps the
 * form standing and says so there, because the form still holds what was typed.
 *
 * Both forms sit under a back control, and leaving a record aborts whatever it still has
 * in flight. So the back control is disabled for exactly as long as a mutation is running,
 * the way Cancel is: a save the server may already have committed must not be cancellable
 * from above the form.
 */

import { leaveRecordView } from "./record-view.js";
import { refreshCommittedRecordsForMutation } from "./records-refresh.js";

const EDIT_FORM_SELECTOR = "[data-record-edit-form]";
const CREATE_FORM_SELECTOR = '[data-post-mutation-refresh][data-mutation-kind="create"]';
const CREATE_CANCEL_SELECTOR = "[data-create-cancel]";
const RECORD_CANCEL_SELECTOR = "[data-record-cancel]";
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

/** @param {HTMLFormElement} form @param {string} message */
function showMutationNotice(form, message) {
  const target = form.querySelector('[aria-live="polite"]');
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

document.addEventListener("htmx:beforeRequest", (event) => {
  const editForm = requestForm(event, EDIT_FORM_SELECTOR);
  if (editForm) {
    setEditPending(editForm, true);
    return;
  }
  const createForm = requestForm(event, CREATE_FORM_SELECTOR);
  if (createForm) setCreatePending(createForm, true);
});

document.addEventListener("htmx:afterRequest", (event) => {
  const custom = /** @type {CustomEvent<{ successful?: boolean, xhr?: XMLHttpRequest }>} */ (event);
  const successful = custom.detail?.successful === true;
  // A severed connection resolves with no status at all, which is the only outcome the
  // browser cannot tell apart from a commit it never heard about.
  const outcomeUnknown = (custom.detail?.xhr?.status ?? 0) === 0;

  const editForm = requestForm(event, EDIT_FORM_SELECTOR);
  if (editForm) {
    handleEditOutcome(editForm, successful, outcomeUnknown);
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
  if (!(input instanceof HTMLInputElement) || !input.matches("[data-edit-datetime-input]")) return;
  const fieldName = input.dataset.editDatetimeInput;
  const exactValue = fieldName ? input.form?.elements.namedItem(fieldName) : null;
  if (exactValue instanceof HTMLInputElement && exactValue.matches("[data-edit-datetime-value]")) {
    exactValue.value = input.value;
  }
});
