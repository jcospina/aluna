// @ts-check
//
// Shared detail/edit modal controller — Module 4, epic 4.3.
// Authored browser glue served verbatim from /static/detail-modal.js (no build step,
// the no-build rule); `// @ts-check` + JSDoc type-check it via tsconfig.browser.json.
//
// The markup is one shared native <dialog> (src/presentation/detail-modal.ts,
// renderDetailModal). This controller PREFILLS, OPENS, and switches its local read/edit
// presentation mode. The browser owns the
// hard mechanics: <dialog>.showModal() traps focus inside the modal and restores it to
// the trigger on close, Escape closes, and ::backdrop dims the page. So there is no
// hand-rolled focus trap, and the shell stays dumb (ARCH §6.1: open / prefill / focus the
// shared modal, never infer intent or mutate state).
//
// Prefill clones an inert <template>'s content into the body — the record's detail, already
// rendered and escaped server-side by the centralized field renderer (never innerHTML from
// a string, never a server round-trip: no read-single route, ADR-0005 §3). The open call
// arrives as the `aluna:open-detail` event; the demo's dev trigger dispatches it now, and
// 3.3/02's item click-to-open will dispatch the same event — this file does not change.

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one closure intentionally owns the shared modal's complete event surface without leaking globals.
(() => {
  // Kept in sync with the exported constants in src/presentation/detail-modal.ts (a test
  // pins that they match). Plain strings because this file cannot import the .ts module.
  const MODAL_ID = "aluna-detail-modal";
  const TITLE_ID = "aluna-detail-modal-title";
  const BODY_ID = "aluna-detail-modal-body";
  const OPEN_EVENT = "aluna:open-detail";
  const RECORD_UPDATED_EVENT = "aluna:record-updated";
  const READ_MODE_SELECTOR = "[data-detail-read-mode]";
  const EDIT_MODE_SELECTOR = "[data-detail-edit-mode]";
  const EDIT_TRIGGER_SELECTOR = "[data-detail-edit]";
  const CANCEL_EDIT_SELECTOR = "[data-detail-cancel-edit]";
  const EDIT_FORM_SELECTOR = "[data-modal-edit-form]";
  const SAVE_BUTTON_SELECTOR = 'button[type="submit"]';

  /** @type {{ title?: string, sourceId?: string } | null} */
  let currentPayload = null;

  /**
   * The one shared modal instance, or null if this page has none (the controller then
   * no-ops — safe to load anywhere).
   * @returns {HTMLDialogElement | null}
   */
  function getModal() {
    const el = document.getElementById(MODAL_ID);
    return el instanceof HTMLDialogElement ? el : null;
  }

  /** @param {string | undefined} title */
  function labelEditTrigger(title) {
    const editTrigger = getModal()?.querySelector(EDIT_TRIGGER_SELECTOR);
    if (!(editTrigger instanceof HTMLButtonElement)) return;
    editTrigger.setAttribute("aria-label", title ? `Edit ${title}` : "Edit record");
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

  /**
   * Put one record's already-safe detail into the modal: set the accessible title (as
   * text, so it can never inject markup) and clone the source <template>'s inert content
   * into the body. Returns false if the modal chrome is missing.
   * @param {{ title?: string, sourceId?: string }} payload
   * @returns {boolean}
   */
  function prefill(payload) {
    const title = document.getElementById(TITLE_ID);
    const body = document.getElementById(BODY_ID);
    if (!title || !body) return false;

    title.textContent = payload.title ?? "";
    labelEditTrigger(payload.title);
    cloneSourceInto(body, payload.sourceId);
    setMode("read");
    return true;
  }

  /**
   * @param {HTMLElement} body
   * @param {HTMLElement} read
   * @param {HTMLElement} edit
   * @param {"read" | "edit"} mode
   */
  function applyModePresentation(body, read, edit, mode) {
    read.hidden = mode !== "read";
    edit.hidden = mode !== "edit";
    const editTrigger = getModal()?.querySelector(EDIT_TRIGGER_SELECTOR);
    if (editTrigger instanceof HTMLButtonElement) editTrigger.hidden = mode !== "read";
    body.dataset.detailMode = mode;
    body.scrollTop = 0;
    if (mode !== "edit") return;

    const firstControl = edit.querySelector('input:not([type="hidden"]), select, textarea');
    if (firstControl instanceof HTMLElement) firstControl.focus();
  }

  /**
   * Switch the one shared body between its server-rendered read and edit surfaces.
   * @param {"read" | "edit"} mode
   */
  function setMode(mode) {
    const body = document.getElementById(BODY_ID);
    if (!body) return;

    const read = body.querySelector(READ_MODE_SELECTOR);
    const edit = body.querySelector(EDIT_MODE_SELECTOR);
    if (!(read instanceof HTMLElement) || !(edit instanceof HTMLElement)) return;
    applyModePresentation(body, read, edit, mode);
  }

  /**
   * Prefill then open. showModal() (not the `open` attribute) is what gives the focus
   * trap + restore + Escape + backdrop, so a modal that cannot showModal is left closed
   * rather than opened non-modally.
   * @param {{ title?: string, sourceId?: string }} payload
   */
  function openDetail(payload) {
    const modal = getModal();
    if (!modal || typeof modal.showModal !== "function") return;
    currentPayload = payload;
    if (!prefill(payload)) return;
    modal.showModal();
  }

  // Open on the seam event — the only way in. `detail` is the { title, sourceId } payload.
  document.addEventListener(OPEN_EVENT, (event) => {
    const custom = /** @type {CustomEvent<{ title?: string, sourceId?: string }>} */ (event);
    openDetail(custom.detail ?? {});
  });

  /**
   * Resolve the persistent edit form that originated an HTMX lifecycle event.
   * @param {Event} event
   * @returns {HTMLFormElement | null}
   */
  function editFormFromRequestEvent(event) {
    const custom = /** @type {CustomEvent<{ elt?: Element }>} */ (event);
    const form = custom.detail?.elt;
    return form instanceof HTMLFormElement && form.matches(EDIT_FORM_SELECTOR) ? form : null;
  }

  /**
   * Give the first Save click immediate, stable feedback and prevent a second request
   * while the first is in flight. HTMX has already serialized the form before its
   * beforeRequest event, so disabling the button here cannot remove submitted values.
   * @param {HTMLFormElement} form
   * @param {boolean} saving
   */
  function setSaving(form, saving) {
    const submit = form.querySelector(SAVE_BUTTON_SELECTOR);
    form.setAttribute("aria-busy", saving ? "true" : "false");
    if (!(submit instanceof HTMLButtonElement)) return;

    if (saving) {
      submit.dataset.idleLabel = submit.textContent?.trim() || "Save";
      submit.textContent = "Saving…";
      submit.disabled = true;
      return;
    }
    submit.textContent = submit.dataset.idleLabel || "Save";
    delete submit.dataset.idleLabel;
    submit.disabled = false;
  }

  // Keep request feedback and close-on-success on this persistent controller, not on
  // handlers attached to a freshly cloned form. The first processed submission now owns
  // the complete lifecycle even while the item/template beside it are replaced.
  document.addEventListener("htmx:beforeRequest", (event) => {
    const form = editFormFromRequestEvent(event);
    if (form) setSaving(form, true);
  });

  document.addEventListener("htmx:afterRequest", (event) => {
    const form = editFormFromRequestEvent(event);
    if (!form) return;
    const custom = /** @type {CustomEvent<{ successful?: boolean }>} */ (event);
    if (custom.detail?.successful) {
      document.dispatchEvent(
        new CustomEvent(RECORD_UPDATED_EVENT, {
          detail: { itemTargetId: form.dataset.itemTargetId },
        }),
      );
      return;
    }

    setSaving(form, false);
    const fields = form.querySelector(".capability-edit-form__fields");
    if (fields instanceof HTMLElement) fields.scrollTop = 0;
  });

  // A committed update swaps the presented item before this event fires. Closing the
  // modal returns focus to the activating item while the refreshed wrapper/template are
  // already in place.
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

  // Light dismiss: a click on the backdrop (the dialog element itself — the padded panel
  // catches every click inside the card) closes the modal, restoring focus like the close
  // button and Escape. Guarded to the shared instance so it never touches other dialogs.
  document.addEventListener("click", (event) => {
    const modal = getModal();
    if (modal && event.target === modal) modal.close();
  });

  // Edit/Cancel are delegated to the shared modal so cloned templates need no scripts.
  document.addEventListener("click", (event) => {
    const modal = getModal();
    if (!modal || !(event.target instanceof Element) || !modal.contains(event.target)) return;

    if (event.target.closest(EDIT_TRIGGER_SELECTOR)) {
      setMode("edit");
      return;
    }
    if (event.target.closest(CANCEL_EDIT_SELECTOR) && currentPayload) {
      // Clone the inert source again instead of merely resetting controls: this also
      // restores repeatable-list rows removed or added during the cancelled edit.
      prefill(currentPayload);
    }
  });
})();
