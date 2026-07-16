// @ts-check

import { refreshCommittedRecords } from "./detail-modal-refresh.js";
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
    if (!modal || typeof modal.showModal !== "function") return;
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

  /** @param {HTMLFormElement} form @param {boolean} pending */
  function setDeletePending(form, pending) {
    setRequestPending(form, pending, "Deleting…", "Delete record");
    const modal = getModal();
    const close = modal?.querySelector(".detail-modal__close");
    const cancel = form.querySelector(CANCEL_DELETE_SELECTOR);
    if (close instanceof HTMLButtonElement) close.disabled = pending;
    if (cancel instanceof HTMLButtonElement) cancel.disabled = pending;
    if (modal) modal.dataset.deleteBusy = pending ? "true" : "false";
  }

  document.addEventListener("htmx:beforeRequest", (event) => {
    const editForm = requestForm(event, EDIT_FORM_SELECTOR);
    if (editForm) {
      setRequestPending(editForm, true, "Saving…", "Save");
      return;
    }
    const deleteForm = requestForm(event, DELETE_FORM_SELECTOR);
    if (deleteForm) setDeletePending(deleteForm, true);
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
    const region = document.getElementById(form.dataset.recordsTargetId ?? "");
    const readUrl = form.dataset.readUrl;
    if (!(region instanceof HTMLElement) || !readUrl) return null;
    const htmx = /** @type {Window & { htmx?: { process(node: Element): void } }} */ (window).htmx;
    return refreshCommittedRecords({
      region,
      readUrl,
      process: (refreshed) => {
        if (refreshed instanceof Element) htmx?.process(refreshed);
      },
    });
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

  /** @param {HTMLFormElement} form @param {boolean} successful */
  function handleEditAfterRequest(form, successful) {
    if (successful) {
      document.dispatchEvent(
        new CustomEvent(RECORD_UPDATED_EVENT, {
          detail: { itemTargetId: form.dataset.itemTargetId },
        }),
      );
      return;
    }
    setRequestPending(form, false, "Saving…", "Save");
    const fields = form.querySelector(".capability-edit-form__fields");
    if (fields instanceof HTMLElement) fields.scrollTop = 0;
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

  /** @param {HTMLFormElement} deleteForm @param {boolean} successful */
  async function handleDeleteAfterRequest(deleteForm, successful) {
    const ownsActiveModal = getBody()?.querySelector(DELETE_FORM_SELECTOR) === deleteForm;
    if (!successful) {
      finishFailedDelete(deleteForm, ownsActiveModal);
      return;
    }

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

  /** @param {Event} event */
  async function afterRequest(event) {
    const custom = /** @type {CustomEvent<{ successful?: boolean }>} */ (event);
    const successful = custom.detail?.successful === true;
    const editForm = requestForm(event, EDIT_FORM_SELECTOR);
    if (editForm) {
      handleEditAfterRequest(editForm, successful);
      return;
    }
    const deleteForm = requestForm(event, DELETE_FORM_SELECTOR);
    if (deleteForm) await handleDeleteAfterRequest(deleteForm, successful);
  }

  document.addEventListener("htmx:afterRequest", (event) => {
    void afterRequest(event);
  });

  document.addEventListener(RECORD_UPDATED_EVENT, (event) => {
    const custom = /** @type {CustomEvent<{ itemTargetId?: string }>} */ (event);
    const modal = getModal();
    if (modal?.open) modal.close();
    requestAnimationFrame(() => {
      const updatedItem = custom.detail?.itemTargetId
        ? document.getElementById(custom.detail.itemTargetId)
        : null;
      updatedItem?.focus();
    });
  });

  document.addEventListener("click", (event) => {
    const modal = getModal();
    if (modal && event.target === modal && modal.dataset.deleteBusy !== "true") modal.close();
  });

  document.addEventListener(
    "cancel",
    (event) => {
      const modal = getModal();
      if (event.target === modal && modal?.dataset.deleteBusy === "true") event.preventDefault();
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
