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
 * The form's `.field__control` is absent for the opposite reason it used to be. It was a
 * bare `<input>`, which cannot hold the two layers at all; since 5.10/03 it is the shell
 * around one, and the design system already names it in `INK_SELECTOR`. Nothing to add here.
 *
 * The developer panel's readouts are not in this list and no longer need to be. They
 * were ruled rather than drawn because they were hidden by `:empty`, which a drawn
 * element can never be — the two layers are children. In the panel's own window each
 * stage is a code block that stands whether a payload has arrived or not, so it asks
 * the ink system for its frame by name (`data-ink`, already in `INK_SELECTOR`) and
 * `design/scripts/devpanel.js` sets the attribute where it builds the block.
 */
const SHELL_INK = [
  /* The prompt rail. The button standing in it is a `.btn`, already drawn. */
  ".prompt__composer",
  /* Collection chrome — the search rail. The create panel is deliberately absent: it
     carries the record form, and a record's form is the window's whole surface, drawn
     around by the window's own frame and nothing else (public/css/record-view.css). The
     two ways into that form are the same surface, so a boundary here would be a line the
     record view does not have. */
  ".capability-search__control",
  /*
   * The records themselves. A record is what a user looks at longest, so a straight-edged
   * card on a drawn desk is the one that reads as unfinished. The card's hand comes from
   * the record's own id, written as `data-ink-seed` by the platform's item wrapper
   * (src/presentation/ink-seed.ts) — never from where the card sits, which would re-roll
   * on every reorder and every resize. Generated markup inside the card asks for nothing
   * and declares no boundary of its own; `border` is never-declared for a record now.
   */
  ".capability-item",
  /* What the platform says to the user */
  ".capability-deletion__notice",
  /* The question a navigation asks before it takes a live run away. It is read over the
     window it is about, so it is a box rather than a line of prose, and a box in this
     product is drawn (PLAN decision 17). */
  ".build-stream__leaving-panel",
  /* Form chrome the field renderer owns. The row's control is not here: it is a
     `.field__control` shell, which the design system draws already. */
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
