// @ts-check

/**
 * The window does not exist until something asks for one, so a press on the ground must stand
 * one up before htmx resolves its target, or the target resolves against a desk with none.
 */

import { registerRegionRelease } from "./region-scope.js";

/**
 * A control on the ground whose answer needs a window to land in. Today only Delete on a
 * capability's context menu (PLAN decision 20), hung off the logo and never the chrome (D3).
 */
export const WINDOW_DOORWAY_SELECTOR = "[data-window-doorway]";

/**
 * As much of the window as a doorway asks for, and no more, so this never imports the window
 * and the dependency runs one way.
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
 * A press on desk furniture that is about to fill the window; a press on a logo is answered in
 * the capture phase instead (`public/desk-window.js`).
 *
 * @param {Document} root
 * @param {Element} doorway
 * @param {WindowForDoorways} window_
 */
export function answerDoorway(root, doorway, window_) {
  /* A run owns the window it narrates into and the prompt bar refuses this press for that
   * reason (`public/app.js`, PLAN decision 20); renaming its frame anyway would change it. */
  if (window_.isNarrating()) return;
  const logo = window_.logoFor(doorway.getAttribute("data-capability-id") ?? "");
  /* A window already standing is renamed: a destructive question under another capability's
   * name is where a misattributed title costs most. */
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
 * unsuccessful — shared by the two presses that stand a window up before htmx fetches anything.
 *
 * @param {Document} root @param {Element} asking @param {() => void} stand
 */
export function whenTheRequestFails(root, asking, stand) {
  const stop = () => {
    root.removeEventListener("htmx:afterRequest", settle);
    release();
  };
  /** @param {Event} done */
  const settle = (done) => {
    const detail = /** @type {CustomEvent<{ elt?: unknown, successful?: boolean }>} */ (done)
      .detail;
    if (detail?.elt !== asking) return;
    stop();
    if (detail.successful === false) stand();
  };
  root.addEventListener("htmx:afterRequest", settle);
  // The second ending: htmx fires `htmx:afterRequest` after the swap, so when a deletion's
  // out-of-band `delete:` detaches the doorway the event never reaches `root` and this leaks.
  const release = registerRegionRelease(asking, "doorway settle", () =>
    root.removeEventListener("htmx:afterRequest", settle),
  );
}
