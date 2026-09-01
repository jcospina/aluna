// @ts-check
/**
 * High Meadow, rendered from the tokens themselves.
 *
 * Every chip below reads its colour from a CSS custom property rather than
 * from a literal here, so a swatch cannot drift from the token it names. The
 * measured ratio under each one is computed the same way, from the two tokens
 * it names and nothing else — this page states the numbers the contrast audit
 * asserts (`src/presentation/contrast-audit.ts`), and neither can go stale
 * without the other going with it.
 */

/* A structural fill carries one label and only one, so only that one is measured. */
const STRUCTURE = [
  { token: "ground", role: "the desk", labels: ["ink"] },
  { token: "ground-deep", role: "bands, wells", labels: ["ink"] },
  { token: "surface", role: "windows, cards", labels: ["ink"] },
  { token: "surface-2", role: "inputs, items", labels: ["ink"] },
  { token: "ink", role: "lines and type only", labels: ["surface"] },
];

/** The two reading strengths. What they may sit on is closed, and the audit closes it. */
const STRENGTHS = [
  {
    token: "ink-2",
    role: "secondary text, field labels",
    against: ["surface", "surface-2", "pane-2"],
  },
  {
    token: "ink-3",
    role: "placeholders, guidance, faint detail",
    against: ["surface", "surface-2"],
  },
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

/** @param {string} hex @returns {number} */
function luminance(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (/** @type {number} */ raw) => {
    const c = raw / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((value >> 16) & 0xff) +
    0.7152 * channel((value >> 8) & 0xff) +
    0.0722 * channel(value & 0xff)
  );
}

/** @param {string} a @param {string} b @returns {number} */
function ratio(a, b) {
  const light = Math.max(luminance(a), luminance(b));
  const dark = Math.min(luminance(a), luminance(b));
  return (light + 0.05) / (dark + 0.05);
}

/** @param {string} token @returns {string} */
function value(token) {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${token}`).trim();
}

/**
 * One measured pairing, as a line of the chip's caption.
 * @param {string} foreground @param {string} background
 * @returns {HTMLElement}
 */
function reading(foreground, background) {
  const measured = ratio(value(foreground), value(background));
  const line = document.createElement("small");
  line.className = "swatch__ratio";
  line.textContent = `${foreground} on ${background} · ${measured.toFixed(2)} : 1`;
  // AA for text is 4.5; anything under it is a pairing this palette does not make.
  if (measured < 4.5) line.dataset.under = "";
  return line;
}

/**
 * `role` is optional: the anchors are named colours and speak for themselves,
 * while the structural and reserved tokens have to say what they are for.
 *
 * A swatch is measured one of two ways. `labels` names what is read *on* this
 * fill — one for a structural fill, which carries ink and nothing else, and both
 * for an anchor, where which label a fill can carry is the whole question.
 * `against` reverses it: the reading strengths are foregrounds, and what they name
 * is the closed set of fills they are allowed to sit on.
 * @typedef {{ token: string, role?: string, labels?: string[], against?: string[] }} Swatch
 */

/**
 * @param {Swatch} swatch
 * @returns {HTMLElement}
 */
function swatch({ token, role, labels, against }) {
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
  code.textContent = value(token).toUpperCase();
  meta.append(name, code);

  if (role) {
    const small = document.createElement("small");
    small.textContent = role;
    meta.append(small);
  }

  const readings = against
    ? against.map((fill) => /** @type {[string, string]} */ ([token, fill]))
    : (labels ?? ["ink", "surface"]).map(
        (label) => /** @type {[string, string]} */ ([label, token]),
      );
  meta.append(...readings.map(([foreground, background]) => reading(foreground, background)));

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
  paint("[data-palette-strengths]", STRENGTHS);
  paint("[data-palette-anchors]", ANCHORS);
  paint("[data-palette-reserved]", RESERVED);
}
