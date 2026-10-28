// @ts-check
/**
 * Everything that moves the deck: the rail, Make it, the address, the keys a presenter's clicker
 * sends, and a swipe. Escape closes an open detail window first, and only then stops presenting;
 * every other key pressed inside that window scrolls it, as it would any page.
 */

/** @typedef {import("./deck.js").Deck} Deck */
/** @typedef {{ isOpen: () => boolean, close: () => void }} Closable */

const TYPING = "input, textarea, select, [contenteditable]";

/** The detail window reads like a page, so its keys are its own. */
const READING = "[data-detail-window]";

/** Space presses these. A link does not take Space, so there it turns the slide. */
const PRESSABLE = "button, summary";

/** Keys that flip something, which a held key must not flip back and forth. */
const TOGGLES = new Set(["p", "f", "Escape"]);

/** The smallest sideways travel, in CSS pixels, that counts as a swipe. */
const SWIPE = 48;

/** @type {Record<string, (deck: Deck, event: KeyboardEvent) => void>} */
const MOVES = {
  ArrowRight: (deck) => deck.next(),
  ArrowLeft: (deck) => deck.prev(),
  " ": (deck, event) => (event.shiftKey ? deck.prev() : deck.next()),
  PageDown: (deck) => deck.next(),
  PageUp: (deck) => deck.prev(),
  Home: (deck) => deck.first(),
  End: (deck) => deck.last(),
};

/**
 * The slide id an address names, or nothing when the address cannot be decoded.
 *
 * @param {string} hash
 */
export function slideIdFrom(hash) {
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return "";
  }
}

/**
 * @param {Deck} deck
 * @param {Closable} detail
 * @param {() => void} present
 * @returns {boolean} whether Escape had anything of the deck's to close
 */
function closeWithEscape(deck, detail, present) {
  if (detail.isOpen()) detail.close();
  else if (deck.doc.body.classList.contains("is-presenting")) present();
  else return false;
  return true;
}

/**
 * @param {KeyboardEvent} event
 * @param {Deck} deck
 * @param {Closable} detail
 * @param {() => void} present
 * @returns {boolean} whether the key belonged to the deck
 */
function handleKey(event, deck, detail, present) {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(TYPING)) return false;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (event.repeat && TOGGLES.has(key)) return true;
  if (key === "Escape") return closeWithEscape(deck, detail, present);
  if (target?.closest(READING)) return false;
  if (key === "p" || key === "f") {
    present();
    return true;
  }
  return runMove(key, target, deck, event);
}

/**
 * @param {string} key
 * @param {Element | null} target
 * @param {Deck} deck
 * @param {KeyboardEvent} event
 */
function runMove(key, target, deck, event) {
  const move = MOVES[key];
  if (!move) return false;
  if (key === " " && target?.closest(PRESSABLE)) return false;
  move(deck, event);
  return true;
}

/**
 * A sideways swipe on a touch screen turns the slide, unless it starts in a window that scrolls.
 *
 * @param {Deck} deck
 */
function bindSwipe(deck) {
  /** @type {{ x: number, y: number, id: number } | null} */
  let start = null;
  deck.root.addEventListener("pointerdown", (event) => {
    const inWindow = event.target instanceof Element && event.target.closest(".window__body");
    start =
      event.pointerType === "touch" && !inWindow
        ? { x: event.clientX, y: event.clientY, id: event.pointerId }
        : null;
  });
  deck.root.addEventListener("pointercancel", () => {
    start = null;
  });
  deck.root.addEventListener("pointerup", (event) => {
    if (!start || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start = null;
    if (Math.abs(dx) < SWIPE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) deck.next();
    else deck.prev();
  });
}

/**
 * A mouse press on the rail hands focus back to the desk, so the next Space turns the slide
 * instead of pressing the same button again.
 *
 * @param {Deck} deck
 * @param {Document} doc
 */
function bindButtons(deck, doc) {
  /** @type {Array<[string, () => void]>} */
  const presses = [
    ['[data-go="prev"]', () => deck.prev()],
    ['[data-go="next"]', () => deck.next()],
    ["[data-make]", () => deck.next()],
  ];
  for (const [selector, move] of presses) {
    for (const button of doc.querySelectorAll(selector)) {
      button.addEventListener("click", (event) => {
        move();
        if (event instanceof MouseEvent && event.detail > 0)
          deck.root.focus({ preventScroll: true });
      });
    }
  }
}

/**
 * An address that names no slide, like the skip link's, is put back to the slide on show, so a
 * reload or a shared link opens what the reader was looking at.
 *
 * @param {Deck} deck
 * @param {Document} doc
 */
function bindAddress(deck, doc) {
  doc.defaultView?.addEventListener("hashchange", () => {
    const index = deck.indexOf(slideIdFrom(doc.location.hash));
    if (index < 0) history.replaceState(null, "", `#${deck.current.el.id}`);
    else if (index !== deck.index) deck.go(index);
    deck.root.focus({ preventScroll: true });
  });
}

/**
 * @param {Deck} deck
 * @param {Document} doc
 * @param {Closable} detail
 * @param {() => void} present
 */
export function bindControls(deck, doc, detail, present) {
  bindButtons(deck, doc);
  doc.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (handleKey(event, deck, detail, present)) event.preventDefault();
  });
  bindSwipe(deck);
  bindAddress(deck, doc);
}
