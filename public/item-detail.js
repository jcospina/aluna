// @ts-check
//
// Item click-to-open controller — Module 3, epic 3.3/02.
// Authored browser glue served verbatim from /static/item-detail.js (no build step, the
// no-build rule); `// @ts-check` + JSDoc type-check it via tsconfig.browser.json.
//
// This is the seam between the accessible item wrapper (src/presentation/list-container.ts,
// renderItemWrapper) and the shared detail modal's mechanics (public/detail-modal.js). Each
// wrapped record is a `role="button"` trigger carrying two platform hooks — the id of its
// inert detail <template> (data-detail-template) and the modal title (data-detail-title).
// On a click or a keyboard activation of that trigger this file dispatches the modal's open
// event with { title, sourceId }; detail-modal.js clones the <template> into the one shared
// <dialog> and opens it. So the shell stays dumb (ARCH §6.1: it may open/prefill/focus the
// shared modal, never infer intent), the model authors no modal wiring (ADR-0005 §3), and
// the full record shows via the server-rendered template even when the item truncates —
// no client-side field formatting, no read-single route.
//
// Delegated + document-level so it works for items present at load AND items htmx swaps in
// later (a freshly created record, a toolbar-loaded list) without re-binding.

(() => {
  // Kept in sync with src/presentation/list-container.ts (ITEM_TRIGGER_CLASS,
  // ITEM_DETAIL_TEMPLATE_ATTR, ITEM_DETAIL_TITLE_ATTR) and detail-modal.ts
  // (OPEN_DETAIL_EVENT). A platform test pins that these strings match. Plain strings
  // because this file cannot import the .ts modules.
  const ITEM_SELECTOR = ".capability-item";
  const OPEN_EVENT = "aluna:open-detail";

  /**
   * The item trigger an event landed on, or null. Uses closest() so a click/keypress on the
   * generated inner markup still resolves to the platform wrapper that owns the open hooks.
   * @param {EventTarget | null} target
   * @returns {HTMLElement | null}
   */
  function itemFrom(target) {
    if (!(target instanceof Element)) return null;
    const item = target.closest(ITEM_SELECTOR);
    return item instanceof HTMLElement ? item : null;
  }

  /**
   * Open the shared detail modal for one item: read its template id + title from the
   * platform hooks and dispatch the open event detail-modal.js listens for. No template id
   * → no-op (never open an empty modal). The event bubbles to document, where the modal
   * controller is listening.
   * @param {HTMLElement} item
   */
  function openDetailFor(item) {
    const sourceId = item.dataset.detailTemplate;
    if (!sourceId) return;
    const title = item.dataset.detailTitle ?? "";
    item.dispatchEvent(new CustomEvent(OPEN_EVENT, { bubbles: true, detail: { title, sourceId } }));
  }

  // Pointer activation.
  document.addEventListener("click", (event) => {
    const item = itemFrom(event.target);
    if (item) openDetailFor(item);
  });

  // Keyboard activation of the role="button" trigger: Enter and Space, the two keys a
  // native button honors. preventDefault stops Space from scrolling the page (and Enter
  // from any default) so activation matches a real button.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const item = itemFrom(event.target);
    if (!item) return;
    event.preventDefault();
    openDetailFor(item);
  });
})();
