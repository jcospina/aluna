// @ts-check

import { refreshCommittedRecordsForMutation } from "./detail-modal-refresh.js";
import { DETAIL_MODAL_MODE, transitionDetailModalMode } from "./detail-modal-state.js";

// Shared read/edit/delete-confirmation modal controller — Module 4, epic 4.3.
// The server renders every record-bound surface. This browser module owns only local
// presentation state, native-dialog mechanics, request feedback, and committed-read
// refresh after a confirmed delete.

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one closure intentionally owns the shared modal's complete delegated event surface without leaking globals.
(() => {
  const MODAL_ID = "aluna-detail-modal";
  const TITLE_ID = "aluna-detail-modal-title";
  const BODY_ID = "aluna-detail-modal-body";
  const OPEN_EVENT = "aluna:open-detail";
  const RECORD_UPDATED_EVENT = "aluna:record-updated";
  const READ_MODE_SELECTOR = "[data-detail-read-mode]";
  const EDIT_MODE_SELECTOR = "[data-detail-edit-mode]";
  const READ_ACTIONS_SELECTOR = "[data-detail-read-actions]";
  const EDIT_TRIGGER_SELECTOR = "[data-detail-edit]";
  const CANCEL_EDIT_SELECTOR = "[data-detail-cancel-edit]";
  const DELETE_TRIGGER_SELECTOR = "[data-detail-delete]";
  const CANCEL_DELETE_SELECTOR = "[data-detail-cancel-delete]";
  const EDIT_FORM_SELECTOR = "[data-modal-edit-form]";
  const DELETE_FORM_SELECTOR = "[data-modal-delete-form]";
  const MUTATION_REFRESH_FORM_SELECTOR = "[data-post-mutation-refresh]";
  const SUBMIT_BUTTON_SELECTOR = 'button[type="submit"]';
  const ITEM_SELECTOR = "[data-detail-template]";

  /** @type {{ title?: string, sourceId?: string } | null} */
  let currentPayload = null;
  /** @type {import("./detail-modal-state.js").DetailModalMode} */
  let currentMode = DETAIL_MODAL_MODE.read;

  /** @returns {HTMLDialogElement | null} */
  function getModal() {
    const element = document.getElementById(MODAL_ID);
    return element instanceof HTMLDialogElement ? element : null;
  }

  /** @returns {HTMLElement | null} */
  function getBody() {
    const element = document.getElementById(BODY_ID);
    return element instanceof HTMLElement ? element : null;
  }

  /**
   * @param {HTMLElement} body
   * @param {string | undefined} sourceId
   */
  function cloneSourceInto(body, sourceId) {
    body.replaceChildren();
    const source = sourceId ? document.getElementById(sourceId) : null;
    if (!(source instanceof HTMLTemplateElement)) return;
    body.appendChild(source.content.cloneNode(true));
    const htmx = /** @type {Window & { htmx?: { process(node: Element): void } }} */ (window).htmx;
    htmx?.process(body);
  }

  /** @param {HTMLElement} body */
  function modeSurfaces(body) {
    const read = body.querySelector(READ_MODE_SELECTOR);
    const edit = body.querySelector(EDIT_MODE_SELECTOR);
    return read instanceof HTMLElement && edit instanceof HTMLElement ? { read, edit } : null;
  }

  /** @param {HTMLElement} read */
  function applyReadActionVisibility(read) {
    const readActions = read.querySelector(READ_ACTIONS_SELECTOR);
    const deleteForm = read.querySelector(DELETE_FORM_SELECTOR);
    if (readActions instanceof HTMLElement) {
      readActions.hidden = currentMode !== DETAIL_MODAL_MODE.read;
    }
    if (deleteForm instanceof HTMLFormElement) {
      deleteForm.hidden = currentMode !== DETAIL_MODAL_MODE.deleteConfirm;
    }
  }

  /** @param {HTMLElement} read @param {HTMLElement} edit */
  function focusCurrentMode(read, edit) {
    if (currentMode === DETAIL_MODAL_MODE.edit) {
      const firstControl = edit.querySelector('input:not([type="hidden"]), select, textarea');
      if (firstControl instanceof HTMLElement) firstControl.focus();
      return;
    }
    if (currentMode !== DETAIL_MODAL_MODE.deleteConfirm) return;
    const cancel = read.querySelector(CANCEL_DELETE_SELECTOR);
    if (cancel instanceof HTMLButtonElement) cancel.focus();
  }

  /**
   * Render the current local mode. Delete confirmation keeps the read surface visible and
   * replaces only its docked action area.
   * @param {boolean} focusModeTarget
   */
  function applyModePresentation(focusModeTarget = false) {
    const body = getBody();
    if (!body) return;
    const surfaces = modeSurfaces(body);
    if (!surfaces) return;
    const { read, edit } = surfaces;
    read.hidden = currentMode === DETAIL_MODAL_MODE.edit;
    edit.hidden = currentMode !== DETAIL_MODAL_MODE.edit;
    applyReadActionVisibility(read);
    body.dataset.detailMode = currentMode === DETAIL_MODAL_MODE.edit ? "edit" : "read";
    if (focusModeTarget) focusCurrentMode(read, edit);
  }

  /** @param {import("./detail-modal-state.js").DetailModalEvent} event */
  function transition(event, focusModeTarget = false) {
    currentMode = transitionDetailModalMode(currentMode, event);
    applyModePresentation(focusModeTarget);
  }

  /**
   * @param {{ title?: string, sourceId?: string }} payload
   * @returns {boolean}
   */
  function prefill(payload) {
    const title = document.getElementById(TITLE_ID);
    const body = getBody();
    if (!(title instanceof HTMLElement) || !body) return false;
    title.textContent = payload.title ?? "";
    cloneSourceInto(body, payload.sourceId);
    transition("open");
    return true;
  }

  /** @param {{ title?: string, sourceId?: string }} payload */
  function openDetail(payload) {
    const modal = getModal();
    if (!modal || typeof modal.showModal !== "function" || modal.dataset.mutationBusy === "true") {
      return;
    }
    currentPayload = payload;
    if (!prefill(payload)) return;
    modal.showModal();
    const title = document.getElementById(TITLE_ID);
    if (title instanceof HTMLElement) title.focus();
  }

  document.addEventListener(OPEN_EVENT, (event) => {
    const custom = /** @type {CustomEvent<{ title?: string, sourceId?: string }>} */ (event);
    openDetail(custom.detail ?? {});
  });

  document.addEventListener(
    "close",
    (event) => {
      if (event.target !== getModal()) return;
      transition("close");
      currentPayload = null;
    },
    true,
  );

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
   */
  function setRequestPending(form, pending, pendingLabel, idleLabel) {
    const submit = form.querySelector(SUBMIT_BUTTON_SELECTOR);
    form.setAttribute("aria-busy", pending ? "true" : "false");
    if (!(submit instanceof HTMLButtonElement)) return;
    submit.textContent = pending ? pendingLabel : idleLabel;
    submit.disabled = pending;
  }

  /** @param {HTMLFormElement} form @param {boolean} pending @param {string} cancelSelector */
  function setModalMutationPending(form, pending, cancelSelector) {
    const modal = getModal();
    const close = modal?.querySelector(".detail-modal__close");
    const cancel = form.querySelector(cancelSelector);
    if (close instanceof HTMLButtonElement) close.disabled = pending;
    if (cancel instanceof HTMLButtonElement) cancel.disabled = pending;
    if (modal) modal.dataset.mutationBusy = pending ? "true" : "false";
  }

  /** @param {HTMLFormElement} form @param {boolean} pending */
  function setEditPending(form, pending) {
    setRequestPending(form, pending, "I’m saving…", "Save");
    setModalMutationPending(form, pending, CANCEL_EDIT_SELECTOR);
  }

  /** @param {HTMLFormElement} form @param {boolean} pending */
  function setDeletePending(form, pending) {
    setRequestPending(form, pending, "I’m deleting…", "Delete record");
    setModalMutationPending(form, pending, CANCEL_DELETE_SELECTOR);
  }

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
    const createForm = requestForm(event, MUTATION_REFRESH_FORM_SELECTOR);
    if (createForm?.dataset.mutationKind === "create") {
      setRequestPending(createForm, true, "I’m adding…", "Add");
    }
  });

  document.addEventListener("input", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.matches("[data-edit-datetime-input]")) {
      return;
    }
    const fieldName = input.dataset.editDatetimeInput;
    const exactValue = fieldName ? input.form?.elements.namedItem(fieldName) : null;
    if (
      exactValue instanceof HTMLInputElement &&
      exactValue.matches("[data-edit-datetime-value]")
    ) {
      exactValue.value = input.value;
    }
  });

  /** @param {HTMLFormElement} form */
  function itemIndexBeforeDelete(form) {
    const region = document.getElementById(form.dataset.recordsTargetId ?? "");
    const item = document.getElementById(form.dataset.itemTargetId ?? "");
    if (!(region instanceof HTMLElement) || !(item instanceof HTMLElement)) return 0;
    return Math.max(0, [...region.querySelectorAll(ITEM_SELECTOR)].indexOf(item));
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

  /** @param {HTMLElement | null} region @param {number} deletedIndex */
  function focusAfterDelete(region, deletedIndex) {
    if (!region) return;
    const items = [...region.querySelectorAll(ITEM_SELECTOR)];
    const fallback = items[Math.min(deletedIndex, Math.max(0, items.length - 1))];
    if (fallback instanceof HTMLElement) {
      fallback.focus();
      return;
    }
    const addButton = region
      .closest(".capability-collection")
      ?.querySelector(".capability-collection__new");
    if (addButton instanceof HTMLElement) addButton.focus();
  }

  /** @param {HTMLFormElement} form */
  async function handleCreateAfterRequest(form) {
    try {
      await refreshCommittedRead(form);
    } catch {
      window.location.reload();
      return;
    }
    setRequestPending(form, false, "I’m adding…", "Add");
    form.reset();
    form.dispatchEvent(
      new CustomEvent("aluna:record-created", {
        bubbles: true,
        detail: { capabilityId: form.dataset.capabilityId },
      }),
    );
  }

  /** @param {HTMLFormElement} form */
  function showUnknownMutationFailure(form) {
    const target = form.querySelector('[aria-live="polite"]');
    if (!(target instanceof HTMLElement)) return;
    const message = document.createElement("p");
    message.className = "notice";
    message.dataset.role = "error";
    message.dataset.errorCode = "mutation_outcome_unknown";
    message.textContent =
      "I couldn’t confirm that change. I refreshed what’s here — please check before trying again.";
    target.replaceChildren(message);
  }

  /** @param {HTMLFormElement} form */
  async function reconcileUnknownMutation(form) {
    try {
      await refreshCommittedRead(form);
      return true;
    } catch {
      window.location.reload();
      return false;
    }
  }

  /** @param {HTMLFormElement} form @param {boolean} ownsActiveModal */
  async function finishSuccessfulEdit(form, ownsActiveModal) {
    let region = null;
    try {
      region = await refreshCommittedRead(form);
    } catch {
      window.location.reload();
      return;
    }
    if (!ownsActiveModal) return;
    setEditPending(form, false);
    document.dispatchEvent(
      new CustomEvent(RECORD_UPDATED_EVENT, {
        detail: { itemTargetId: form.dataset.itemTargetId, regionId: region?.id },
      }),
    );
  }

  /** @param {HTMLFormElement} form @param {boolean} ownsActiveModal @param {boolean} outcomeUnknown */
  async function finishFailedEdit(form, ownsActiveModal, outcomeUnknown) {
    if (outcomeUnknown && !(await reconcileUnknownMutation(form))) return;
    if (!ownsActiveModal) return;
    setEditPending(form, false);
    if (outcomeUnknown) showUnknownMutationFailure(form);
    const fields = form.querySelector(".capability-edit-form__fields");
    if (fields instanceof HTMLElement) fields.scrollTop = 0;
  }

  /** @param {HTMLFormElement} form @param {boolean} successful @param {boolean} outcomeUnknown */
  async function handleEditAfterRequest(form, successful, outcomeUnknown) {
    const ownsActiveModal = getBody()?.querySelector(EDIT_FORM_SELECTOR) === form;
    if (successful) {
      await finishSuccessfulEdit(form, ownsActiveModal);
      return;
    }
    await finishFailedEdit(form, ownsActiveModal, outcomeUnknown);
  }

  /** @param {HTMLFormElement} deleteForm @param {boolean} ownsActiveModal */
  function finishFailedDelete(deleteForm, ownsActiveModal) {
    if (!ownsActiveModal) return;
    setDeletePending(deleteForm, false);
    transition("delete-failed");
  }

  /** @param {HTMLFormElement} deleteForm @param {boolean} ownsActiveModal */
  function recoverFailedCommittedRead(deleteForm, ownsActiveModal) {
    if (ownsActiveModal) {
      setDeletePending(deleteForm, false);
      const modal = getModal();
      if (modal?.open) modal.close();
    }
    window.location.reload();
  }

  /** @param {HTMLElement | null} region @param {number} deletedIndex */
  function finishSuccessfulDelete(region, deletedIndex) {
    transition("delete-succeeded");
    const modal = getModal();
    if (modal?.open) modal.close();
    requestAnimationFrame(() => focusAfterDelete(region, deletedIndex));
  }

  /**
   * @param {{ itemTargetId?: string, regionId?: string }} detail
   */
  function focusAfterUpdate(detail) {
    const updatedItem = detail.itemTargetId ? document.getElementById(detail.itemTargetId) : null;
    if (updatedItem instanceof HTMLElement) {
      updatedItem.focus();
      return;
    }
    const region = detail.regionId ? document.getElementById(detail.regionId) : null;
    const fallback = region?.querySelector(ITEM_SELECTOR);
    if (fallback instanceof HTMLElement) fallback.focus();
  }

  /** @param {HTMLFormElement} deleteForm @param {boolean} ownsActiveModal */
  async function finishCommittedDelete(deleteForm, ownsActiveModal) {
    const deletedIndex = itemIndexBeforeDelete(deleteForm);
    let region = null;
    try {
      region = await refreshCommittedRead(deleteForm);
    } catch {
      recoverFailedCommittedRead(deleteForm, ownsActiveModal);
      return;
    }
    if (!ownsActiveModal) return;
    setDeletePending(deleteForm, false);
    finishSuccessfulDelete(region, deletedIndex);
  }

  /** @param {HTMLFormElement} deleteForm @param {boolean} ownsActiveModal @param {boolean} outcomeUnknown */
  async function finishRejectedDelete(deleteForm, ownsActiveModal, outcomeUnknown) {
    if (outcomeUnknown && !(await reconcileUnknownMutation(deleteForm))) return;
    finishFailedDelete(deleteForm, ownsActiveModal);
    if (outcomeUnknown && ownsActiveModal) showUnknownMutationFailure(deleteForm);
  }

  /** @param {HTMLFormElement} deleteForm @param {boolean} successful @param {boolean} outcomeUnknown */
  async function handleDeleteAfterRequest(deleteForm, successful, outcomeUnknown) {
    const ownsActiveModal = getBody()?.querySelector(DELETE_FORM_SELECTOR) === deleteForm;
    if (successful) {
      await finishCommittedDelete(deleteForm, ownsActiveModal);
      return;
    }
    await finishRejectedDelete(deleteForm, ownsActiveModal, outcomeUnknown);
  }

  /** @param {CustomEvent<{ successful?: boolean, xhr?: XMLHttpRequest }>} event */
  function requestOutcome(event) {
    const status = event.detail?.xhr?.status ?? 0;
    return {
      successful: event.detail?.successful === true,
      outcomeUnknown: status === 0,
    };
  }

  /** @param {HTMLFormElement} form @param {boolean} successful @param {boolean} outcomeUnknown */
  async function handleCreateAfterRequestOutcome(form, successful, outcomeUnknown) {
    if (successful) {
      await handleCreateAfterRequest(form);
      return;
    }
    if (outcomeUnknown && !(await reconcileUnknownMutation(form))) return;
    setRequestPending(form, false, "I’m adding…", "Add");
    if (outcomeUnknown) showUnknownMutationFailure(form);
  }

  /** @param {Event} event */
  async function afterRequest(event) {
    const custom = /** @type {CustomEvent<{ successful?: boolean, xhr?: XMLHttpRequest }>} */ (
      event
    );
    const { successful, outcomeUnknown } = requestOutcome(custom);
    const editForm = requestForm(event, EDIT_FORM_SELECTOR);
    if (editForm) {
      await handleEditAfterRequest(editForm, successful, outcomeUnknown);
      return;
    }
    const deleteForm = requestForm(event, DELETE_FORM_SELECTOR);
    if (deleteForm) {
      await handleDeleteAfterRequest(deleteForm, successful, outcomeUnknown);
      return;
    }
    const refreshForm = requestForm(event, MUTATION_REFRESH_FORM_SELECTOR);
    if (refreshForm?.dataset.mutationKind !== "create") return;
    await handleCreateAfterRequestOutcome(refreshForm, successful, outcomeUnknown);
  }

  document.addEventListener("htmx:afterRequest", (event) => {
    void afterRequest(event);
  });

  document.addEventListener(RECORD_UPDATED_EVENT, (event) => {
    const custom = /** @type {CustomEvent<{ itemTargetId?: string, regionId?: string }>} */ (event);
    const modal = getModal();
    if (modal?.open) modal.close();
    requestAnimationFrame(() => focusAfterUpdate(custom.detail ?? {}));
  });

  document.addEventListener("click", (event) => {
    const modal = getModal();
    if (modal && event.target === modal && modal.dataset.mutationBusy !== "true") modal.close();
  });

  document.addEventListener(
    "cancel",
    (event) => {
      const modal = getModal();
      if (event.target === modal && modal?.dataset.mutationBusy === "true") {
        event.preventDefault();
      }
    },
    true,
  );

  /** @param {Element} target */
  function handleEditClick(target) {
    if (target.closest(EDIT_TRIGGER_SELECTOR)) {
      transition("request-edit", true);
      return true;
    }
    if (target.closest(CANCEL_EDIT_SELECTOR) && currentPayload) {
      prefill(currentPayload);
      const edit = getBody()?.querySelector(EDIT_TRIGGER_SELECTOR);
      if (edit instanceof HTMLButtonElement) edit.focus();
      return true;
    }
    return false;
  }

  /** @param {Element} target */
  function handleDeleteClick(target) {
    if (target.closest(DELETE_TRIGGER_SELECTOR)) {
      transition("request-delete", true);
      return;
    }
    if (target.closest(CANCEL_DELETE_SELECTOR)) {
      transition("cancel-delete");
      const remove = getBody()?.querySelector(DELETE_TRIGGER_SELECTOR);
      if (remove instanceof HTMLButtonElement) remove.focus();
    }
  }

  document.addEventListener("click", (event) => {
    const modal = getModal();
    const target = event.target;
    if (!modal || !(target instanceof Element) || !modal.contains(target)) return;
    if (!handleEditClick(target)) handleDeleteClick(target);
  });
})();
