// @ts-check
/**
 * Bootstrap for the logo contract page.
 *
 * The third sibling of `main.js` and `controls-main.js`, and thin for the same
 * reason they are separate: this page boots no window manager, no benches and
 * no controls. It is a specification, and the only live things on it are the
 * section windows, the drawn line, and the logo specimens — which are the
 * contract's own output rather than a rendering of it.
 *
 * The specimens are the eight-line answer to "does the contract describe what
 * is on the desk": they are the same files, at the same sizes, under the same
 * label treatment. If this page and the desk ever disagree, one of them is a
 * bug rather than a variation.
 */

import { dressGrounds } from "../desk/wallpaper.js";
import { startInk } from "../ink/ink.js";
import { wireSectionWindows } from "../sections/section-window.js";
import { mountWindows } from "../window/window.js";

function boot() {
  wireSectionWindows(mountWindows(document));
  dressGrounds();

  /*
   * Last, once the document has stopped being rearranged — mounting a window
   * moves its contents into a body.
   */
  startInk();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
