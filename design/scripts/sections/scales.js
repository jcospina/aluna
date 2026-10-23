// @ts-check
/**
 * The type scale and the spacing rung, read off the tokens rather than restated: each row shows
 * the value the stylesheet holds and the size it comes to on this page, measured off the sample.
 */

/** @param {string} token */
const isTitle = (token) => token.startsWith("type-title") || token === "type-display";

/**
 * @param {CSSRuleList} rules
 * @returns {CSSRule[]}
 */
const flatten = (rules) =>
  [...rules].flatMap((rule) =>
    rule instanceof CSSImportRule && rule.styleSheet ? flatten(rule.styleSheet.cssRules) : [rule],
  );

/**
 * The tokens `:root` declares under one prefix, in the order tokens.css declares them.
 * @param {string} prefix
 */
function declared(prefix) {
  const properties = [...document.styleSheets]
    .flatMap((sheet) => flatten(sheet.cssRules))
    .flatMap((rule) =>
      rule instanceof CSSStyleRule && rule.selectorText === ":root" ? [...rule.style] : [],
    );
  const names = properties.filter((name) => name.startsWith(`--${prefix}`));
  return [...new Set(names.map((name) => name.slice(2)))];
}

/** @param {string} token */
const value = (token) =>
  getComputedStyle(document.documentElement).getPropertyValue(`--${token}`).trim();

/**
 * @param {string} token
 * @param {HTMLElement} sample
 * @param {(sample: HTMLElement) => number} measure the sample's size in px, once it is drawn
 */
function row(token, sample, measure) {
  const tr = document.createElement("tr");
  const name = document.createElement("td");
  const code = document.createElement("code");
  code.textContent = `--${token}`;
  name.append(code);
  const size = document.createElement("td");
  const shown = document.createElement("td");
  shown.append(sample);
  tr.append(name, size, shown);
  queueMicrotask(() => {
    size.textContent = `${value(token)} · ${Math.round(measure(sample) * 10) / 10}px`;
  });
  return tr;
}

/** @param {string} token */
function typeRow(token) {
  const sample = document.createElement("span");
  sample.textContent = "Aluna grew you a thing";
  sample.style.fontSize = `var(--${token})`;
  if (isTitle(token)) {
    sample.style.fontFamily = "var(--font-display)";
    sample.style.fontWeight = "700";
    sample.style.lineHeight = "1.1";
  }
  return row(token, sample, (drawn) => Number.parseFloat(getComputedStyle(drawn).fontSize));
}

/** @param {string} token */
function spaceRow(token) {
  const bar = document.createElement("span");
  bar.style.display = "block";
  bar.style.width = `var(--${token})`;
  bar.style.height = "var(--space-3)";
  bar.style.background = "var(--sky)";
  return row(token, bar, (drawn) => drawn.getBoundingClientRect().width);
}

/** @param {ParentNode} root */
export function mountScales(root) {
  root.querySelector("[data-type-scale]")?.replaceChildren(...declared("type-").map(typeRow));
  root.querySelector("[data-space-scale]")?.replaceChildren(...declared("space-").map(spaceRow));
}
