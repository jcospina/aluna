// @ts-check
/**
 * High Meadow, rendered from the tokens themselves.
 *
 * Every chip below reads its colour from a CSS custom property rather than
 * from a literal here, so a swatch cannot drift from the token it names.
 */

const STRUCTURE = [
  { token: "ground", role: "the desk" },
  { token: "ground-deep", role: "bands, wells" },
  { token: "surface", role: "windows, cards" },
  { token: "surface-2", role: "inputs, items" },
  { token: "ink", role: "lines and type only" },
];

const ANCHORS = [
  { token: "leaf" },
  { token: "shade" },
  { token: "teal" },
  { token: "sky" },
  { token: "sun" },
  { token: "ochre" },
  { token: "clay" },
  { token: "violet" },
];

const RESERVED = [
  {
    token: "signal",
    role: "Alerts and destructive confirmation only. Never a capability colour, so a red on screen always means one thing.",
  },
];

/**
 * One chip. `role` is optional: the anchors are named colours and speak for
 * themselves, while the structural and reserved tokens have to say what they
 * are for.
 * @typedef {{ token: string, role?: string }} Swatch
 */

/**
 * @param {Swatch} swatch
 * @returns {HTMLElement}
 */
function swatch({ token, role }) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--${token}`).trim();

  const figure = document.createElement("figure");
  figure.className = "swatch";
  figure.style.margin = "0";

  const chip = document.createElement("div");
  chip.className = "swatch__chip";
  chip.style.background = `var(--${token})`;

  const meta = document.createElement("figcaption");
  meta.className = "swatch__meta";

  const name = document.createElement("b");
  name.textContent = token;
  const code = document.createElement("code");
  code.textContent = value.toUpperCase();
  meta.append(name, code);

  if (role) {
    const small = document.createElement("small");
    small.textContent = role;
    meta.append(small);
  }

  figure.append(chip, meta);
  return figure;
}

/** @param {HTMLElement} root */
export function mountPalette(root) {
  /**
   * @param {string} selector
   * @param {Swatch[]} set
   */
  const paint = (selector, set) => {
    const host = root.querySelector(selector);
    if (host) host.replaceChildren(...set.map(swatch));
  };

  paint("[data-palette-structure]", STRUCTURE);
  paint("[data-palette-anchors]", ANCHORS);
  paint("[data-palette-reserved]", RESERVED);
}
