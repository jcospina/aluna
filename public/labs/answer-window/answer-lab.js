// @ts-check
/**
 * A disposable lab: ten ways the answer window could show Aluna looking and then answering, each
 * played inside the real window frame over the real wallpaper. Opened at
 * /static/labs/answer-window/index.html on the dev server; nothing in the product loads it.
 */

import { startInk } from "../../../design/scripts/ink/ink.js";
import { AlunaWindow } from "../../../design/scripts/window/window.js";
import { OPTIONS } from "./options.js";
import { SCENARIOS } from "./scenarios.js";

/** @typedef {import("./scenarios.js").Scenario} Scenario */
/** @typedef {import("./options.js").Option} Option */

const OPENING_MS = 700;
const SIZES = {
  default: { w: 634, h: 330 },
  narrow: { w: 380, h: 330 },
  roomy: { w: 760, h: 470 },
};

const state = {
  option: 0,
  scenario: 0,
  speed: 1,
  /** @type {keyof typeof SIZES} */
  size: "default",
  /** @type {number[]} */
  timers: [],
  started: 0,
  playing: false,
  held: false,
};

/** @param {string} selector @returns {HTMLElement} */
function $(selector) {
  const el = document.querySelector(selector);
  if (!(el instanceof HTMLElement)) throw new Error(`answer lab: missing ${selector}`);
  return el;
}

const stage = $("[data-stage]");
const winEl = document.createElement("section");
winEl.className = "window window--desk window--answer lab-window";
const content = document.createElement("div");
content.className = "desk-window__content";
const body = document.createElement("div");
body.className = "desk-window__answer lab-answer";
body.setAttribute("aria-live", "polite");
content.append(body);
winEl.append(content);
stage.append(winEl);
const win = new AlunaWindow(winEl, { title: "", seed: 4242, shadowAlpha: 0.4 });

body.addEventListener("click", (event) => {
  if (event.target instanceof Element && event.target.closest("a")) event.preventDefault();
});

function placeWindow() {
  const { w, h } = SIZES[state.size];
  const bounds = stage.getBoundingClientRect();
  const width = Math.min(w, bounds.width - 24);
  const height = Math.min(h, bounds.height - 24);
  winEl.style.setProperty("--win-w", `${width}px`);
  winEl.style.setProperty("--win-h", `${height}px`);
  winEl.style.setProperty("--win-x", `${Math.round((bounds.width - width) / 2)}px`);
  winEl.style.setProperty("--win-y", `${Math.round((bounds.height - height) / 2.4)}px`);
}

function clearTimers() {
  for (const id of state.timers) clearTimeout(id);
  state.timers = [];
}

/** @param {Option} option @param {Scenario} s @param {number} moment */
function apply(option, s, moment) {
  if (moment === 0) {
    body.replaceChildren();
    body.className = `desk-window__answer lab-answer lab-o-${option.id}`;
    win.setTitle(s.question);
    option.open(body, s);
  } else if (moment <= s.steps.length) {
    option.step(body, s, moment - 1);
  } else {
    option.end(body, s);
  }
  markMoment(moment);
}

function play() {
  clearTimers();
  const option = OPTIONS[state.option];
  const s = SCENARIOS[state.scenario];
  if (option === undefined || s === undefined) return;
  winEl.classList.remove("is-instant");
  state.held = false;
  state.started = performance.now();
  state.playing = true;
  apply(option, s, 0);
  let at = OPENING_MS;
  s.steps.forEach((step, i) => {
    state.timers.push(window.setTimeout(() => apply(option, s, i + 1), at / state.speed));
    at += step.ms;
  });
  state.timers.push(
    window.setTimeout(() => {
      apply(option, s, s.steps.length + 1);
      state.playing = false;
    }, at / state.speed),
  );
}

/** Hold at a moment, every moment up to it applied without motion until the next play. @param {number} to */
function hold(to) {
  clearTimers();
  state.playing = false;
  const option = OPTIONS[state.option];
  const s = SCENARIOS[state.scenario];
  if (option === undefined || s === undefined) return;
  winEl.classList.add("is-instant");
  state.held = true;
  for (let m = 0; m <= to; m += 1) apply(option, s, m);
}

/* ── controls ─────────────────────────────────────────────────────────────── */

const optionList = $("[data-options]");
const notes = $("[data-notes]");
const scenarioGroup = $("[data-scenarios]");
const momentGroup = $("[data-moments]");
const clock = $("[data-clock]");

function drawOptions() {
  optionList.replaceChildren(
    ...OPTIONS.map((option, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lab-option";
      button.setAttribute("aria-pressed", String(i === state.option));
      const num = document.createElement("span");
      num.className = "lab-option__num";
      num.textContent = String(i + 1);
      const name = document.createElement("span");
      name.className = "lab-option__name";
      name.textContent = option.name;
      const gist = document.createElement("span");
      gist.className = "lab-option__gist";
      gist.textContent = option.gist;
      button.append(num, name, gist);
      button.addEventListener("click", () => chooseOption(i));
      return button;
    }),
  );
}

function drawNotes() {
  const option = OPTIONS[state.option];
  if (option === undefined) return;
  /** @type {[string, string | undefined][]} */
  const rows = [
    ["What it does", option.does],
    ["Borrowed from", option.borrows],
    ["Watch for", option.watch],
    ["Would need", option.needs],
  ];
  const heading = document.createElement("h2");
  heading.className = "lab-notes__title";
  heading.textContent = `${OPTIONS.indexOf(option) + 1}. ${option.name}`;
  const list = document.createElement("dl");
  for (const [term, text] of rows) {
    if (!text) continue;
    const dt = document.createElement("dt");
    dt.className = "caps";
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = text;
    list.append(dt, dd);
  }
  notes.replaceChildren(heading, list);
}

/**
 * A segmented group built whole, so the ink system draws it as it lands: it puts its own drawing
 * inside every segmented control, and a group rebuilt in place would lose it.
 *
 * @param {HTMLElement} holder @param {string} label @param {string[]} names
 * @param {number} pressed @param {(index: number) => void} onPick
 */
function segmented(holder, label, names, pressed, onPick) {
  const group = document.createElement("div");
  group.className = "segmented lab-wrap";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", label);
  names.forEach((name, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = name;
    button.setAttribute("aria-pressed", String(i === pressed));
    button.addEventListener("click", () => onPick(i));
    group.append(button);
  });
  holder.replaceChildren(group);
}

function drawScenarios() {
  const names = SCENARIOS.map((s) => s.label);
  segmented(scenarioGroup, "Question", names, state.scenario, (i) => {
    state.scenario = i;
    drawScenarios();
    drawMoments();
    play();
  });
}

function drawMoments() {
  const s = SCENARIOS[state.scenario];
  if (s === undefined) return;
  const names = ["Asked", ...s.steps.map((_, i) => `Step ${i + 1}`), "Answered"];
  segmented(momentGroup, "Hold at", names, -1, hold);
}

/** @param {number} moment */
function markMoment(moment) {
  const group = momentGroup.querySelector(".segmented");
  if (group instanceof HTMLElement) press(group, moment);
}

/** @param {HTMLElement} group */
function buttonsOf(group) {
  return [...group.querySelectorAll(":scope > button")];
}

/** @param {HTMLElement} group @param {number} index */
function press(group, index) {
  buttonsOf(group).forEach((button, i) => {
    button.setAttribute("aria-pressed", String(i === index));
  });
}

/** @param {number} i */
function chooseOption(i) {
  state.option = (i + OPTIONS.length) % OPTIONS.length;
  press(optionList, state.option);
  drawNotes();
  play();
}

/** @param {string} selector @param {(value: string) => void} onPick */
function wireGroup(selector, onPick) {
  const group = $(selector);
  group.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!(button instanceof HTMLButtonElement)) return;
    press(group, buttonsOf(group).indexOf(button));
    onPick(button.value);
  });
}

wireGroup("[data-speeds]", (value) => {
  state.speed = Number(value);
  play();
});
wireGroup("[data-sizes]", (value) => {
  state.size = /** @type {keyof typeof SIZES} */ (value);
  placeWindow();
});
$("[data-replay]").addEventListener("click", play);

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") chooseOption(state.option + 1);
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") chooseOption(state.option - 1);
  else if (event.key === "r") play();
  else return;
  event.preventDefault();
});

function tick() {
  const s = SCENARIOS[state.scenario];
  const total = s ? s.steps.reduce((sum, step) => sum + step.ms, OPENING_MS) / state.speed : 0;
  const elapsed = Math.min(performance.now() - state.started, total);
  clock.textContent = state.held
    ? "Held. Replay plays it through."
    : `${(elapsed / 1000).toFixed(1)}s of ${(total / 1000).toFixed(1)}s`;
  clock.classList.toggle("is-playing", state.playing);
  requestAnimationFrame(tick);
}

/** The banner says plainly when the design system's sheet did not arrive. */
function checkStyles() {
  const ink = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim();
  $("[data-banner]").hidden = ink !== "";
}

new ResizeObserver(placeWindow).observe(stage);
drawOptions();
drawNotes();
drawScenarios();
drawMoments();
placeWindow();
checkStyles();
startInk(document.body);
play();
tick();
