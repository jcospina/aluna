// @ts-check
/** Small pieces the lab's options share: a line that rises and lifts, runs drawn as links. */

import { OPENING, STEP_DONE, STEP_SENTENCE } from "./scenarios.js";

/** @typedef {import("./scenarios.js").Scenario} Scenario */
/** @typedef {import("./scenarios.js").Run} Run */

/**
 * @param {string} tag @param {string} className @param {(Node | string)[]} [children]
 * @returns {HTMLElement}
 */
export function el(tag, className, children = []) {
  const node = document.createElement(tag);
  node.className = className;
  node.append(...children);
  return node;
}

/** @param {HTMLElement} root @param {string} selector @returns {HTMLElement} */
export function find(root, selector) {
  const node = root.querySelector(selector);
  if (!(node instanceof HTMLElement)) throw new Error(`answer lab: missing ${selector}`);
  return node;
}

/** @param {readonly Run[]} runs @returns {(Node | string)[]} */
export function drawRuns(runs) {
  return runs.map((run) => {
    if ("text" in run) return run.text;
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = run.name;
    return link;
  });
}

/** @param {readonly Run[]} runs */
export function plainText(runs) {
  return runs.map((run) => ("text" in run ? run.text : run.name)).join("");
}

/** How much room the answer asks for, so the big voice can step down for a long one. @param {Scenario} s */
export function answerScale(s) {
  const text = plainText(s.ending.runs);
  if (text.includes("\n")) return "is-long";
  return text.length > 120 ? "is-mid" : "is-short";
}

/** @param {Scenario} s @param {number} i */
export function stepSentence(s, i) {
  const step = s.steps[i];
  return step ? STEP_SENTENCE[step.label] : "";
}

/** @param {Scenario} s @param {number} i */
export function stepDone(s, i) {
  const step = s.steps[i];
  return step ? STEP_DONE[step.label] : "";
}

/** A list as a sentence says one: A, B and C. @param {readonly string[]} words */
export function wordList(words) {
  if (words.length < 2) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export { OPENING };

/**
 * Say something on a line: the old saying lifts away while the new one rises into the same place.
 *
 * @param {HTMLElement} line @param {(Node | string)[]} content @param {string} [extra]
 * @returns {HTMLElement}
 */
export function say(line, content, extra = "") {
  for (const old of line.children) {
    if (old.classList.contains("is-leaving")) continue;
    old.classList.add("is-leaving");
    setTimeout(() => old.remove(), 400);
  }
  const said = el("span", `lab-said ${extra}`.trim(), content);
  line.append(said);
  return said;
}

/** Creep a rule toward an end it never reaches until told it has. @param {HTMLElement} rule */
export function creep(rule) {
  const now = Number(rule.dataset.fill ?? "0");
  const next = now + (92 - now) * 0.42;
  rule.dataset.fill = String(next);
  rule.style.setProperty("--lab-eta", "5200ms");
  rule.style.setProperty("--lab-fill", `${next}%`);
}

/** @param {HTMLElement} rule */
export function completeRule(rule) {
  rule.dataset.fill = "100";
  rule.style.setProperty("--lab-eta", "320ms");
  rule.style.setProperty("--lab-fill", "100%");
}
