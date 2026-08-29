// @ts-check

/**
 * Desk furniture whose answer fills the window.
 *
 * The window is made by the client and does not exist until something asks for one, so a
 * control standing on the ground that swaps into `#spec-build-output` has to be answered
 * before htmx resolves its target — or the target is resolved against a desk that has no
 * window and the press raises instead of opening anything. That is the same reason a press
 * on a logo is answered in the capture phase (`public/desk-window.js`), and this is the
 * other half of it: the presses that are not on a logo.
 *
 * Today there is one, and it is the doorway 5.9 finally hangs — Delete on a capability's
 * context menu, whose confirmation fills the window (PLAN decision 20). The doorway is on
 * the logo and never on the window chrome, which is what leaves D3 standing.
 *
 * A module of its own rather than another few lines inside the window: the window owns
 * when a window exists and what is in it, and this owns which presses on the ground are
 * owed one. It reaches into the window through a small handful of named operations rather
 * than importing it, so the direction of the dependency stays what it is.
 */

/** A control on the ground whose answer needs a window to land in. */
export const WINDOW_DOORWAY_SELECTOR = "[data-window-doorway]";

/**
 * As much of the window as a doorway asks for, and no more.
 *
 * @typedef {{
 *   isNarrating(): boolean,
 *   logoFor(id: string): Element | null,
 *   titleOf(logo: Element): string,
 *   fallbackTitle: string,
 *   openWindow(title: string, openedBy: Element | null): HTMLElement,
 *   putAwayUnfilled(region: HTMLElement): void,
 * }} WindowForDoorways
 */

/**
 * A press on desk furniture that is about to fill the window.
 *
 * @param {Document} root
 * @param {Element} doorway
 * @param {WindowForDoorways} window_
 */
export function answerDoorway(root, doorway, window_) {
  /* A run owns the window it is narrating into, and this press is about to be refused on
   * the prompt bar for exactly that reason (`public/app.js`, PLAN decision 20). Renaming
   * its frame for a request that never lands would be this press changing something after
   * all, so the run is left holding everything it holds. */
  if (window_.isNarrating()) return;
  const logo = window_.logoFor(doorway.getAttribute("data-capability-id") ?? "");
  /* A window that is already standing is renamed: the confirmation about to fill it is
   * about *this* capability, and a destructive question under another capability's name is
   * the one place a misattributed title is least affordable. */
  const region = window_.openWindow(
    logo === null ? window_.fallbackTitle : window_.titleOf(logo),
    logo,
  );
  /* And a press that fails must not leave an empty window standing — the same promise an
   * unsuccessful press on a logo already keeps. */
  whenTheRequestFails(root, doorway, () => window_.putAwayUnfilled(region));
}

/**
 * Run something once, if and only if the request this exact element made comes back
 * unsuccessful.
 *
 * Shared by the two presses that stand a window up before htmx has decided to fetch
 * anything, so neither can leave an empty one behind.
 *
 * @param {Document} root @param {Element} asking @param {() => void} stand
 */
export function whenTheRequestFails(root, asking, stand) {
  /** @param {Event} done */
  const settle = (done) => {
    const detail = /** @type {CustomEvent<{ elt?: unknown, successful?: boolean }>} */ (done)
      .detail;
    if (detail?.elt !== asking) return;
    root.removeEventListener("htmx:afterRequest", settle);
    if (detail.successful === false) stand();
  };
  root.addEventListener("htmx:afterRequest", settle);
}
