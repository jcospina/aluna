// @ts-check
/**
 * The ink system, started for the product.
 *
 * `design/scripts/ink.js` is the system itself and ships as it stands, the way `design/styles/`
 * does; this file is the product's half of the seam and starts it once the document is parsed.
 *
 * The import climbs out of `/static/`, which is `public/` (src/server/app.ts), so
 * `../design/scripts/ink.js` is the same path in the browser and on disk with no build step.
 *
 * A selector is absent from `SHELL_INK` when `INK_SELECTOR` already names it: `.field__control`
 * (a shell around an `<input>` since 5.10/03), `.btn`, and the dev panel's stages, which carry
 * `data-ink` set by `design/scripts/devpanel.js`. The readouts were ruled rather than drawn
 * while `:empty` hid them; a drawn element can never be `:empty`, since its layers are children.
 */

import { drawAlso, redrawInk, startInk } from "../design/scripts/ink.js";

/**
 * The Module 1–4 shell's own boundaries. Each declares a `border` its stylesheet still
 * reserves, the drawn line is what you see instead, and the list goes with the markup.
 */
const SHELL_INK = [
  /* The prompt rail. The button standing in it is a `.btn`, already drawn. */
  ".prompt__composer",
  /* Collection chrome — the search rail. The create panel is absent: it carries the record
     form, which the window's own frame already draws around (public/css/record-view.css). */
  ".capability-search__control",
  /*
   * The records themselves. The card's hand comes from the record's own id via `data-ink-seed`
   * (src/presentation/records/ink-seed.ts), never from where it sits, which re-rolls on
   * reorder or resize.
   */
  ".capability-item",
  /* What the platform says to the user */
  ".capability-deletion__notice",
  /* The question a navigation asks before it takes a live run away. It is read over the window
     it is about, so it is a box, and a box in this product is drawn (PLAN decision 17). */
  ".build-stream__leaving-panel",
].join(",");

drawAlso(SHELL_INK);

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => startInk(), { once: true });
} else {
  startInk();
}

/*
 * The two faces load `font-display: swap`, and the swap resizes a text-driven box without
 * resizing its container or touching the DOM, so neither watch sees it. One redraw is the fix.
 */
document.fonts?.ready.then(() => redrawInk());
