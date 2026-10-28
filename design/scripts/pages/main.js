// @ts-check
/**
 * Bootstrap.
 *
 * Mounts the document's own windows, then the live surfaces inside them.
 * Nothing here is a build step: this is a static page of ES modules, loaded
 * directly, in the same spirit as the runtime it documents.
 */

import { CAPABILITIES, LINKED_RECORDS } from "../data/capabilities.js";
import { Desk } from "../desk/desk.js";
import { renderCollection, renderRecordForm, renderRecordView } from "../desk/patterns.js";
import { startInk } from "../ink/ink.js";
import { mountLineBench } from "../sections/line-bench.js";
import { mountPalette } from "../sections/palette.js";
import { mountScales } from "../sections/scales.js";
import { wireSectionWindows } from "../sections/section-window.js";
import { swapStates, wireStates } from "../sections/state-picker.js";
import { mountWindowBench } from "../sections/window-bench.js";
import { mountWindows } from "../window/window.js";

/** @typedef {import("../window/window.js").AlunaWindow} AlunaWindow */
/** @typedef {import("../data/capabilities.js").Capability} Capability */

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
 * The records linking to one record, in each of the shapes a section takes.
 *
 * @type {Record<string, () => HTMLElement>}
 */
const LINKING = Object.fromEntries(
  Object.entries({
    three: LINKED_RECORDS.clarke,
    seven: LINKED_RECORDS.leGuin,
    two: LINKED_RECORDS.leftHand,
  }).map(([state, { capability, linking }]) => [
    state,
    () => renderRecordForm(capability, { linking }),
  ]),
);

/**
 * One record under its bar, its back control naming the place it was opened from.
 *
 * @type {Record<string, () => HTMLElement>}
 */
const BACK = {
  record: () =>
    renderRecordView(LINKED_RECORDS.leGuin.capability, undefined, {
      to: LINKED_RECORDS.leftHand.capability.fields[0]?.value ?? "",
      linking: LINKED_RECORDS.leGuin.linking,
    }),
  list: () =>
    renderRecordView(LINKED_RECORDS.clarke.capability, undefined, {
      to: LINKED_RECORDS.clarke.capability.label,
      linking: LINKED_RECORDS.clarke.linking,
    }),
};

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
   * The address readout is this page's furniture. A desk embedded in a section
   * cannot own the real address bar, so it says what the address would read.
   */
  const address = document.querySelector("[data-desk-address]");
  const desk = new Desk(host, CAPABILITIES, {
    onAddress: (path) => {
      if (address instanceof HTMLElement) address.textContent = path;
    },
  });
  wireStates(document.querySelector("[data-build-endings]"), (state) => {
    desk.ending = /** @type {import("../narration/rehearsal.js").Ending} */ (state);
  });
}

function boot() {
  wireSectionWindows(mountWindows(document));

  bootDesk();

  for (const { selector, render } of PATTERNS) {
    const node = render();
    if (node) document.querySelector(selector)?.append(node);
  }
  swapStates(
    document.querySelector("[data-linking-states]"),
    document.querySelector("[data-pattern-linking]"),
    LINKING,
  );
  swapStates(
    document.querySelector("[data-back-states]"),
    document.querySelector("[data-pattern-back]"),
    BACK,
  );
  mountScales(document);

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
