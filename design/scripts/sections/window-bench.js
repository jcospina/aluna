// @ts-check
/**
 * The window bench.
 *
 * A real window on a stage, with the four things that are worth being able to
 * move: the seed, the divider reach, focus, and the ground it sits on.
 *
 * The point of the bench is that no two frames on a desk are identical. Press
 * re-ink a few times — the spread you see is the spread that ships.
 */

import { CAPABILITIES } from "../data/capabilities.js";
import { renderCollection } from "../patterns.js";
import { SPEC } from "../spec.js";
import { wallpaperUrl } from "../wallpaper.js";
import { AlunaWindow } from "../window.js";

/**
 * @param {HTMLElement} root
 * @returns {AlunaWindow | null}
 */
export function mountWindowBench(root) {
  const stage = root.querySelector("[data-bench-stage]");
  const reseed = root.querySelector("[data-bench-reseed]");
  const focusToggle = root.querySelector("[data-bench-focus]");
  const groundToggle = root.querySelector("[data-bench-ground]");
  const reach = root.querySelector("[data-bench-reach]");
  const reachValue = root.querySelector("[data-bench-reach-value]");
  if (!(stage instanceof HTMLElement)) return null;

  /* The bench stands on the first fixture; with none there is nothing to show. */
  const capability = CAPABILITIES[0];
  if (!capability) return null;

  const el = document.createElement("section");
  el.className = "window window--specimen";
  const content = document.createElement("div");
  content.append(renderCollection(capability));
  el.append(content);
  stage.append(el);

  const win = new AlunaWindow(el, {
    title: capability.label,
    seed: 31,
    shadowAlpha: 0.24,
  });

  reseed?.addEventListener("click", () => {
    win.setSeed(Math.floor(Math.random() * 9000) + 10);
  });

  focusToggle?.addEventListener("click", () => {
    const next = !win.focused;
    win.setFocused(next);
    focusToggle.setAttribute("aria-pressed", String(!next));
    focusToggle.textContent = next ? "Unfocus" : "Focus";
  });

  wireGround(win, stage, groundToggle);
  wireReach(win, reach, reachValue);

  return win;
}

/**
 * Flat ground or wallpaper. The only thing that changes with it is the shadow:
 * 24% on flat colour, 40% over a wallpaper, because a hard shadow needs more
 * weight to read against a busy ground.
 *
 * @param {AlunaWindow} win
 * @param {HTMLElement} stage
 * @param {Element | null} button
 */
function wireGround(win, stage, button) {
  if (!button) return;
  const tag = stage.querySelector("[data-bench-tag]");

  const GROUNDS = {
    flat: { image: () => "", shadow: 0.24, next: "Over wallpaper", tag: "Shadow 24%" },
    wallpaper: { image: wallpaperUrl, shadow: 0.4, next: "Flat ground", tag: "Shadow 40%" },
  };

  button.addEventListener("click", () => {
    const onWallpaper = stage.classList.toggle("is-wallpaper");
    const ground = onWallpaper ? GROUNDS.wallpaper : GROUNDS.flat;

    stage.style.backgroundImage = ground.image();
    win.setShadowAlpha(ground.shadow);
    button.setAttribute("aria-pressed", String(onWallpaper));
    button.textContent = ground.next;
    if (tag) tag.textContent = ground.tag;
  });
}

/**
 * The divider reach — the one number the plate books left open.
 *
 * @param {AlunaWindow} win
 * @param {Element | null} input the range control; anything else is no control
 * @param {Element | null} readout
 */
function wireReach(win, input, readout) {
  if (!(input instanceof HTMLInputElement)) return;
  /** @param {number} px */
  const show = (px) => {
    if (readout) readout.textContent = `${px}px`;
  };

  input.value = String(SPEC.dividerReach);
  show(SPEC.dividerReach);

  input.addEventListener("input", () => {
    const px = Number(input.value);
    win.setDividerReach(px);
    show(px);
  });
}
