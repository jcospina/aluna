// @ts-check
/**
 * Boots the deck: the desk and its build window, the pencil over them, the detail window, the deck
 * and its controls, then hands the drawn line everything the deck draws. The ink starts last, so no
 * later change to the page can leave a drawing behind.
 */

import { drawAlso, redrawInk, startInk } from "../../design/scripts/ink/ink.js";
import { bindControls, slideIdFrom } from "./controls.js";
import { Deck } from "./deck.js";
import { bindDetail } from "./detail.js";
import { Marks } from "./marks.js";
import { bindPresenter } from "./present.js";
import { Stage } from "./stage.js";

const DRAWN = [".plate", ".deck-rail", ".spec-card", ".plan-part", ".path-step"].join(", ");

const root = document.querySelector(".deck");
const marksLayer = document.querySelector("[data-marks]");
const detailWindow = document.querySelector("[data-detail-window]");
if (
  root instanceof HTMLElement &&
  marksLayer instanceof HTMLElement &&
  detailWindow instanceof HTMLElement
) {
  const marks = new Marks(root, marksLayer);
  const stage = new Stage(root, () => marks.release());
  const detail = bindDetail(document, detailWindow);
  const deck = new Deck(root, document);
  let shown = -1;
  deck.onChange(({ current, index, step }) => {
    if (index !== shown && detail.isOpen()) {
      const focused = detailWindow.contains(document.activeElement);
      detail.closeQuietly();
      if (focused) root.focus({ preventScroll: true });
    }
    shown = index;
    marks.show(current.el, stage.show(current.el, step));
  });
  bindControls(deck, document, detail, bindPresenter(deck, document, detail));
  deck.go(Math.max(deck.indexOf(slideIdFrom(location.hash)), 0));
}

drawAlso(DRAWN);
startInk();

/* The fonts swap in after the first drawing, and a box sized to its text changes size with them. */
document.fonts?.ready.then(() => redrawInk());
