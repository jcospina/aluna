// @ts-check
/**
 * Bootstrap for the logo page: the section windows, the drawn line, and the three benches that
 * take a logo apart — the tile at any size, the hue families and their shades, and the label
 * written over each of the wallpaper's grounds.
 */

import { LOGO_FAMILIES } from "../data/logo-shades.js";
import { dressGrounds } from "../desk/wallpaper.js";
import { startInk } from "../ink/ink.js";
import { wireSectionWindows } from "../sections/section-window.js";
import { wireStates } from "../sections/state-picker.js";
import { mountWindows } from "../window/window.js";

/** Where each ground sits in the wallpaper, as a crop of it. */
const GROUNDS = {
  sky: "18% 6%",
  meadow: "42% 96%",
  foliage: "97% 52%",
};

/**
 * @param {string} name
 * @param {string} hex
 */
function swatch(name, hex) {
  const figure = document.createElement("figure");
  figure.className = "swatch";
  figure.style.margin = "0";
  const chip = document.createElement("div");
  chip.className = "swatch__chip";
  chip.style.background = hex;
  const meta = document.createElement("figcaption");
  meta.className = "swatch__meta";
  const label = document.createElement("b");
  label.textContent = name;
  const code = document.createElement("code");
  code.textContent = hex;
  meta.append(label, code);
  figure.append(chip, meta);
  return figure;
}

/** @param {Element | null} host */
function mountFamilies(host) {
  if (!host) return;
  host.replaceChildren(
    ...LOGO_FAMILIES.map(([family, shades]) => {
      const block = document.createElement("div");
      const heading = document.createElement("h3");
      heading.className = "kicker caps";
      heading.textContent = family;
      const row = document.createElement("div");
      row.className = "swatches";
      row.append(...Object.entries(shades).map(([name, hex]) => swatch(name, hex)));
      block.append(heading, row);
      return block;
    }),
  );
}

function mountTileBench() {
  const tiles = [...document.querySelectorAll("[data-tile-specimen]")];
  const size = document.querySelector("[data-tile-size]");
  const readout = document.querySelector("[data-tile-size-value]");
  if (!(size instanceof HTMLInputElement)) return;
  const resize = () => {
    for (const tile of tiles) {
      if (!(tile instanceof HTMLElement)) continue;
      tile.style.width = `${size.value}px`;
      tile.style.height = `${size.value}px`;
    }
    if (readout) readout.textContent = `${size.value}px`;
  };
  size.addEventListener("input", resize);
  resize();
}

function mountLabelBench() {
  const labels = [...document.querySelectorAll("[data-label-specimen]")];
  const name = document.querySelector("[data-label-name]");
  for (const ground of document.querySelectorAll("[data-label-ground]")) {
    if (!(ground instanceof HTMLElement)) continue;
    const at = GROUNDS[/** @type {keyof typeof GROUNDS} */ (ground.dataset.labelGround)];
    if (!at) continue;
    ground.style.backgroundSize = "520% auto";
    ground.style.backgroundPosition = at;
    ground.style.minHeight = "11rem";
  }
  if (name instanceof HTMLInputElement) {
    name.addEventListener("input", () => {
      for (const label of labels) label.textContent = name.value;
    });
  }
  wireStates(document.querySelector("[data-halo-states]"), (halo) => {
    for (const label of labels) {
      if (label instanceof HTMLElement) label.style.filter = halo === "off" ? "none" : "";
    }
  });
}

function boot() {
  wireSectionWindows(mountWindows(document));
  dressGrounds();
  mountTileBench();
  mountFamilies(document.querySelector("[data-logo-families]"));
  mountLabelBench();

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
