// @ts-check
/**
 * Presenting: the deck takes the whole screen and the menubar goes. The rail and the
 * pointer fade after a moment of stillness and come back on the next move, press or
 * focus. Where the browser has no full screen, the deck still presents inside the
 * window.
 */

import { redrawInk } from "../../design/scripts/ink/ink.js";

/** @typedef {import("./deck.js").Deck} Deck */
/** @typedef {import("./controls.js").Closable} Closable */

const STILL_MS = 2500;

/**
 * Chromium can hand a short Escape to the page while it is full screen, so Escape
 * closes an open detail window before it ends presenting. A long press still leaves
 * full screen.
 */
function lockEscape() {
  const keyboard = /** @type {{ lock?: (keys: string[]) => Promise<void> } | undefined} */ (
    Reflect.get(navigator, "keyboard")
  );
  keyboard?.lock?.(["Escape"]).catch(() => {});
}

/**
 * @param {Deck} deck
 * @param {Document} doc
 * @param {Closable} detail
 * @returns {() => void} the toggle, for the keyboard to share
 */
export function bindPresenter(deck, doc, detail) {
  const { body } = doc;
  const button = doc.querySelector('[data-go="present"]');
  const presenting = () => body.classList.contains("is-presenting");
  let timer = 0;

  const wake = () => {
    body.classList.remove("is-idle");
    clearTimeout(timer);
    if (presenting()) timer = window.setTimeout(() => body.classList.add("is-idle"), STILL_MS);
  };

  /* The root size changes with presenting, and a box that changes size with it but
     whose container does not, like the rail, would keep its old line. */
  /** @param {boolean} on */
  const set = (on) => {
    body.classList.toggle("is-presenting", on);
    if (button) button.textContent = on ? "Exit" : "Present";
    wake();
    requestAnimationFrame(() => redrawInk());
  };

  /* Full screen is asked for and never waited on: a browser may refuse it, or never
     answer, and the deck presents either way. */
  const toggle = () => {
    const on = !presenting();
    set(on);
    if (on && doc.fullscreenEnabled && !doc.fullscreenElement) {
      doc.documentElement
        .requestFullscreen()
        .then(() => (presenting() ? lockEscape() : doc.exitFullscreen()))
        .catch(() => {});
    } else if (!on && doc.fullscreenElement) {
      doc.exitFullscreen().catch(() => {});
    }
    deck.root.focus({ preventScroll: true });
  };

  /* A browser that keeps Escape for itself leaves full screen first. That press was
     meant for an open detail window, so it closes that and goes on presenting in the
     window. */
  let full = false;
  doc.addEventListener("fullscreenchange", () => {
    if (doc.fullscreenElement) {
      full = true;
      return;
    }
    if (!full) return;
    full = false;
    // Exit and P end presenting themselves before full screen ends; only Escape is left here.
    if (!presenting()) return;
    if (detail.isOpen()) detail.close();
    else set(false);
  });
  doc.addEventListener("pointermove", wake);
  doc.addEventListener("pointerdown", wake, { capture: true });
  doc.addEventListener("focusin", wake);
  button?.addEventListener("click", toggle);
  return toggle;
}
