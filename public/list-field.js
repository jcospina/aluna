// @ts-check

/**
 * Repeated-value controls — the product's half of the seam. `design/scripts/list-rows.js` ships
 * the control; the import climbs out of `/static/`, which is `public/` (src/server/app.ts).
 */

import {
  addListRow,
  pressListRow,
  removeListRow,
  syncListRows,
  wireListRows,
} from "../design/scripts/list-rows.js";
import { onCreateFinished } from "./shell-dom.js";

/* One import for the rows, gesture or not. `mountListRows` is absent: the server writes every
   row's naming into the form, so only the design page's rows, authored by hand, need it. */
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
 * Wire the rows' three obligations: the presses, and the two ways a create form finishes —
 * committed or cancelled — each putting the field back to the one empty row it was rendered with.
 * @param {ListFieldRoot} root
 */
export function startListFields(root) {
  // Every gesture — presses, drag, the keyboard's grab — belongs to the control, asked for at
  // once. A second dispatcher here is how the design page and the product drift apart.
  wireListRows(root);

  const listen = root.addEventListener?.bind(root);
  if (listen) onCreateFinished({ addEventListener: listen }, collapseListFieldRows);
}

if (typeof document !== "undefined") startListFields(document);
