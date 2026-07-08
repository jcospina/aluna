// @ts-check
//
// Shared read-only detail modal controller — Module 3, epic 3.2/04.
// Authored browser glue served verbatim from /static/detail-modal.js (no build step,
// the no-build rule); `// @ts-check` + JSDoc type-check it via tsconfig.browser.json.
//
// The markup is one shared native <dialog> (src/presentation/detail-modal.ts,
// renderDetailModal). This controller only PREFILLS and OPENS it — the browser owns the
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

(() => {
  // Kept in sync with the exported constants in src/presentation/detail-modal.ts (a test
  // pins that they match). Plain strings because this file cannot import the .ts module.
  const MODAL_ID = "aluna-detail-modal";
  const TITLE_ID = "aluna-detail-modal-title";
  const BODY_ID = "aluna-detail-modal-body";
  const OPEN_EVENT = "aluna:open-detail";

  /**
   * The one shared modal instance, or null if this page has none (the controller then
   * no-ops — safe to load anywhere).
   * @returns {HTMLDialogElement | null}
   */
  function getModal() {
    const el = document.getElementById(MODAL_ID);
    return el instanceof HTMLDialogElement ? el : null;
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
    body.replaceChildren();

    const source = payload.sourceId ? document.getElementById(payload.sourceId) : null;
    if (source instanceof HTMLTemplateElement) {
      body.appendChild(source.content.cloneNode(true));
    }
    return true;
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
    if (!prefill(payload)) return;
    modal.showModal();
  }

  // Open on the seam event — the only way in. `detail` is the { title, sourceId } payload.
  document.addEventListener(OPEN_EVENT, (event) => {
    const custom = /** @type {CustomEvent<{ title?: string, sourceId?: string }>} */ (event);
    openDetail(custom.detail ?? {});
  });

  // Light dismiss: a click on the backdrop (the dialog element itself — the padded panel
  // catches every click inside the card) closes the modal, restoring focus like the close
  // button and Escape. Guarded to the shared instance so it never touches other dialogs.
  document.addEventListener("click", (event) => {
    const modal = getModal();
    if (modal && event.target === modal) modal.close();
  });
})();
