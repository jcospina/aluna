// @ts-check
/**
 * The window bench: a real window standing on the wallpaper, the divider reach to move, and a
 * picker that shows it focused, unfocused, or with its anatomy marked up over it.
 */

import { CAPABILITIES } from "../data/capabilities.js";
import { renderCollection } from "../desk/patterns.js";
import { wallpaperUrl } from "../desk/wallpaper.js";
import { SPEC } from "../ink/spec.js";
import { AlunaWindow } from "../window/window.js";
import { wireStates } from "./state-picker.js";
import { wireAnatomy } from "./window-anatomy.js";

/** Over a wallpaper a hard shadow needs more weight to read than on flat colour. */
const SHADOW_OVER_WALLPAPER = 0.4;

/**
 * @param {HTMLElement} root
 * @returns {AlunaWindow | null}
 */
export function mountWindowBench(root) {
  const stage = root.querySelector("[data-bench-stage]");
  if (!(stage instanceof HTMLElement)) return null;

  /* The bench stands on the first fixture; with none there is nothing to show. */
  const capability = CAPABILITIES[0];
  if (!capability) return null;

  const el = document.createElement("section");
  el.className = "window window--specimen";
  const content = document.createElement("div");
  content.append(renderCollection(capability));
  el.append(content);
  stage.prepend(el);
  stage.style.backgroundImage = wallpaperUrl();

  const win = new AlunaWindow(el, {
    title: capability.label,
    seed: 31,
    shadowAlpha: SHADOW_OVER_WALLPAPER,
  });

  /* The specimen's lamps are part of the picture: pressed, they would fold or widen the section
   * holding it. */
  win.lampsEl.inert = true;

  const anatomy = wireAnatomy(stage, win);
  wireReach(
    win,
    root.querySelector("[data-bench-reach]"),
    root.querySelector("[data-bench-reach-value]"),
    anatomy.redraw,
  );
  wireStates(root.querySelector("[data-bench-views]"), (view) => {
    win.setFocused(view !== "unfocused");
    anatomy.show(view === "anatomy");
  });
  return win;
}

/**
 * @param {AlunaWindow} win
 * @param {Element | null} input the range control; anything else is no control
 * @param {Element | null} readout
 * @param {() => void} moved
 */
function wireReach(win, input, readout, moved) {
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
    moved();
  });
}
