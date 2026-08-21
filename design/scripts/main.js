// @ts-check
/**
 * Bootstrap.
 *
 * Mounts the document's own windows, then the live surfaces inside them.
 * Nothing here is a build step: this is a static page of ES modules, loaded
 * directly, in the same spirit as the runtime it documents.
 */

import { CAPABILITIES } from "./data/capabilities.js";
import { Desk } from "./desk.js";
import { startInk } from "./ink.js";
import { renderCollection, renderRecordForm } from "./patterns.js";
import { mountLineBench } from "./sections/line-bench.js";
import { mountPalette } from "./sections/palette.js";
import { wireSectionWindows } from "./sections/section-window.js";
import { mountWindowBench } from "./sections/window-bench.js";
import { mountWindows } from "./window.js";

/** @typedef {import("./window.js").AlunaWindow} AlunaWindow */
/** @typedef {import("./data/capabilities.js").Capability} Capability */

/**
 * Every section that needs JavaScript, and the one hook it hangs from.
 *
 * Records rather than pairs: a two-element array of unlike things widens to a
 * union on the way in, and every use then has to argue its way back out.
 */
const SECTIONS = [
  { selector: "[data-section='window']", mount: mountWindowBench },
  { selector: "[data-section='palette']", mount: mountPalette },
  { selector: "[data-section='line']", mount: mountLineBench },
];

/**
 * A fixture by position, or null once the fixtures no longer reach that far —
 * the page then renders one pattern fewer rather than throwing on boot.
 *
 * @param {number} index
 * @returns {Capability | null}
 */
const fixture = (index) => CAPABILITIES[index] ?? null;

/**
 * The patterns, rendered by the same code the desk uses — deliberately, so a
 * pattern cannot look right here and wrong in a window.
 */
const PATTERNS = [
  {
    selector: "[data-pattern-collection]",
    render: () => {
      const capability = fixture(0);
      return capability && renderCollection(capability);
    },
  },
  {
    selector: "[data-pattern-form]",
    render: () => {
      const capability = fixture(1);
      return capability && renderRecordForm(capability);
    },
  },
  {
    selector: "[data-pattern-grid]",
    render: () => {
      const capability = fixture(2);
      return capability && renderCollection(capability, { layout: "grid" });
    },
  },
];

function bootDesk() {
  const host = document.querySelector("[data-desk]");
  if (!(host instanceof HTMLElement)) return;

  /*
   * The address readout is this page's furniture, not the product's. D14 gives
   * the window a path, and a desk embedded in a section of a document cannot
   * own the real address bar — so it says what the address would read instead.
   */
  const address = document.querySelector("[data-desk-address]");
  const desk = new Desk(host, CAPABILITIES, {
    onAddress: (path) => {
      if (address instanceof HTMLElement) address.textContent = path;
    },
  });
  document.querySelector("[data-desk-reset]")?.addEventListener("click", () => desk.resetLayout());
}

function boot() {
  wireSectionWindows(mountWindows(document));

  bootDesk();

  for (const { selector, render } of PATTERNS) {
    const node = render();
    if (node) document.querySelector(selector)?.append(node);
  }

  for (const { selector, mount } of SECTIONS) {
    const host = document.querySelector(selector);
    if (host instanceof HTMLElement) mount(host);
  }

  /*
   * Last, once the document has stopped being rearranged — mounting windows
   * moves their contents into a body, and the sections above build theirs.
   * From here the ink system watches the document and needs telling nothing:
   * a repainted collection, a window opening, a capability being grown are all
   * just elements arriving, and they arrive drawn.
   */
  startInk();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
