// @ts-check

/**
 * Repeated-value controls — the rows a list field is typed into.
 *
 * Platform presentation with no product logic in it: a field declared as a list renders
 * one row plus **Add another** (`field-renderer.ts`), and this is what makes the rows
 * behave. Event delegation on the document, because the forms these live in are swapped
 * in by htmx long after page load and a per-form script tag would have to be written
 * into every one of them.
 *
 * A module of its own rather than another item in the shell's leftovers
 * (`public/app.js`): the rows are a subject, they are reached only through events, and
 * nothing about them has to be in place before Alpine starts.
 */

/**
 * The DOM facts this module needs — a root to listen on. Structural on purpose, the way
 * `desk-logos.js`'s root is, so the rules can be exercised without a browser.
 *
 * @typedef {{ addEventListener?: (type: string, listener: (event: Event) => void) => void }} ListFieldRoot
 */

/** @param {HTMLButtonElement} button */
export function addListFieldRow(button) {
  const field = button.closest("[data-list-field]");
  const values = field?.querySelector("[data-list-field-values]");
  const firstRow = values?.querySelector("[data-list-field-row]");
  if (!(field instanceof HTMLElement) || !(values instanceof HTMLElement) || !firstRow) return;

  const row = firstRow.cloneNode(true);
  if (!(row instanceof HTMLElement)) return;
  const input = row.querySelector("input");
  if (input instanceof HTMLInputElement) input.value = "";
  values.append(row);
  syncListFieldRows(field);
  input?.focus();
}

/** @param {HTMLButtonElement} button */
export function removeListFieldRow(button) {
  const field = button.closest("[data-list-field]");
  const row = button.closest("[data-list-field-row]");
  if (!(field instanceof HTMLElement) || !(row instanceof HTMLElement)) return;

  const rows = field.querySelectorAll("[data-list-field-row]");
  if (rows.length === 1) {
    const input = row.querySelector("input");
    if (input instanceof HTMLInputElement) input.value = "";
    input?.focus();
    return;
  }
  row.remove();
  syncListFieldRows(field);
}

/** @param {HTMLFormElement} form */
export function collapseListFieldRows(form) {
  for (const field of Element.prototype.querySelectorAll.call(form, "[data-list-field]")) {
    if (!(field instanceof HTMLElement)) continue;
    const rows = [...field.querySelectorAll("[data-list-field-row]")];
    for (const row of rows.slice(1)) row.remove();
    syncListFieldRows(field);
  }
}

/**
 * Row identity is positional, so it is restated after every add and remove: the id the
 * label points at, and the two labels a screen reader reads the row by.
 * @param {HTMLElement} field
 */
export function syncListFieldRows(field) {
  const label = field.dataset.listFieldLabel ?? "Value";
  const inputId = field.dataset.listInputId ?? "list-value";
  const rows = field.querySelectorAll("[data-list-field-row]");

  rows.forEach((row, index) => {
    const input = row.querySelector("input");
    const remove = row.querySelector("[data-list-field-remove]");
    if (input instanceof HTMLInputElement) {
      input.id = `${inputId}-${index + 1}`;
      input.setAttribute("aria-label", `${label} ${index + 1}`);
    }
    if (remove instanceof HTMLButtonElement) {
      remove.setAttribute("aria-label", `Remove ${label} value ${index + 1}`);
    }
  });
}

/**
 * Wire the rows' three obligations onto a document: the add/remove presses, and the two
 * ways a create form finishes — committed or cancelled — both of which put the field
 * back to the one empty row it was rendered with.
 * @param {ListFieldRoot} root
 */
export function startListFields(root) {
  root.addEventListener?.("click", (event) => {
    if (!(event.target instanceof Element)) return;

    const button = event.target.closest("[data-list-field-add], [data-list-field-remove]");
    if (!(button instanceof HTMLButtonElement)) return;
    if (button.hasAttribute("data-list-field-add")) addListFieldRow(button);
    else removeListFieldRow(button);
  });

  root.addEventListener?.("aluna:record-created", (event) => {
    if (event.target instanceof HTMLFormElement) collapseListFieldRows(event.target);
  });

  root.addEventListener?.("aluna:create-cancelled", (event) => {
    const trigger = event.target;
    const form =
      trigger instanceof Element ? Element.prototype.closest.call(trigger, "form") : null;
    if (form instanceof HTMLFormElement) collapseListFieldRows(form);
  });
}

if (typeof document !== "undefined") startListFields(document);
