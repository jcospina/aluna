// @ts-check

/**
 * Repeated-value controls — the product's half of the seam.
 *
 * `design/scripts/list-rows.js` is the control itself and ships as it stands, the way
 * `design/styles/` and `design/scripts/ink.js` do: what a row is, how it moves, and what
 * every row is called once it has. This file is what the product adds around it — the
 * delegation, and the two ways a create form finishes.
 *
 * Event delegation on the document, because the forms these live in are swapped in by
 * htmx long after page load and a per-form script tag would have to be written into every
 * one of them.
 *
 * The import climbs out of `/static/`, which is `public/` (src/app/app.ts), so
 * `../design/scripts/list-rows.js` is the same path in the browser and on disk.
 */

import {
  addListRow,
  pressListRow,
  removeListRow,
  syncListRows,
  wireListRows,
} from "../design/scripts/list-rows.js";

/* The control's own surface, re-exported so the product has one import for the rows whether
   it is answering a gesture or driving one directly. `mountListRows` is deliberately not
   among them: the server writes every row's naming into the form it renders, so the product
   has nothing to put right on arrival, and a re-export nothing here calls is a seam that
   looks wired and is not. The design page, whose rows are authored by hand, is where it is
   called. */
export { addListRow, pressListRow, removeListRow, syncListRows };

/**
 * The DOM facts this module needs — a root to listen on. Structural on purpose, the way
 * `desk-logos.js`'s root is, so the rules can be exercised without a browser.
 *
 * @typedef {import("../design/scripts/list-rows.js").ListRowRoot} ListFieldRoot
 */

/**
 * A finished create form goes back to the one empty row it was rendered with.
 * @param {HTMLFormElement} form
 */
export function collapseListFieldRows(form) {
  for (const field of Element.prototype.querySelectorAll.call(form, "[data-list-field]")) {
    if (!(field instanceof HTMLElement)) continue;
    const rows = [...field.querySelectorAll("[data-list-field-row]")];
    for (const row of rows.slice(1)) row.remove();
    syncListRows(field);
  }
}

/**
 * Wire the rows' three obligations onto a document: the presses, and the two ways a create
 * form finishes — committed or cancelled — both of which put the field back to the one
 * empty row it was rendered with.
 * @param {ListFieldRoot} root
 */
export function startListFields(root) {
  // Every gesture — the presses, the drag and the keyboard's grab — belongs to the control,
  // and this asks for all of them at once. A second dispatcher here is how the design page
  // and the product drift into answering the same press differently.
  wireListRows(root);

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
