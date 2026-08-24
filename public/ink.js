// @ts-check
/**
 * The ink system, started for the product.
 *
 * `design/scripts/ink.js` is the system itself and ships as it stands, the way
 * `design/styles/` does. This file is the product's half of the seam and nothing
 * more: the temporary shell's own chrome asks to be drawn here, and the system
 * starts once the document has been parsed.
 *
 * The import climbs out of `/static/`, which is `public/` (src/app/app.ts). That
 * makes `../design/scripts/ink.js` the same path in the browser and on disk, so the
 * page and the type-checker agree with no build step between them.
 */

import { drawAlso, redrawInk, startInk } from "../design/scripts/ink.js";

/**
 * The Module 1–4 shell's own boundaries, named here rather than in the design
 * system: this is chrome the repo owns and the Desk deletes, and the list goes with
 * the markup. Every one of them declares a `border` its stylesheet still reserves;
 * the drawn line is what you see there instead.
 *
 * Three absences are deliberate. Generated record markup is 5.2/02. The form's
 * `.field__control` is still the bare `<input>` rather than the shell around one, so
 * it cannot hold the two layers — the split that fixes it is 5.10/03. And the
 * developer panel's raw payload readouts are hidden by `:empty`, which a drawn
 * element can never be, because the two layers are children: they stay ruled until
 * 5.6/04 gives that panel a window of its own.
 */
const SHELL_INK = [
  /* The prompt rail. The button standing in it is a `.btn`, already drawn. */
  ".prompt__composer",
  /* The shell's own toggles */
  ".sidebar-toggle",
  /* The content region */
  ".intro__output",
  /* Collection chrome — the search rail and the create panel, never the records */
  ".capability-search__control",
  ".capability-collection__create",
  /* What the platform says to the user */
  ".capability-deletion__notice",
  /* The shared record modal, until the window replaces it */
  ".detail-modal__panel",
  /* Form chrome the field renderer owns */
  ".field-list__remove",
].join(",");

drawAlso(SHELL_INK);

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => startInk(), { once: true });
} else {
  startInk();
}

/*
 * The two faces load `font-display: swap`, so every text-driven box measured before
 * they land is measured against a fallback. The swap resizes those boxes without
 * resizing anything that holds them and without touching the DOM, so neither the
 * container watch nor the mutation pass can see it. One redraw once the faces are
 * ready is the whole fix, and it costs nothing where a box has not moved.
 */
document.fonts?.ready.then(() => redrawInk());
