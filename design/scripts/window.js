// @ts-check
/**
 * The window, as a mounted component.
 *
 * Every window on this surface — the document sections you are reading and the
 * live windows on the desk — is the same object built by the same code. There
 * is no second, simpler window for documentation.
 *
 * The chrome is injected rather than authored, so no window can drift from the
 * specification by being written out by hand.
 */

import { seedFrom } from "./lib/random.js";
import { SPEC } from "./spec.js";
import { buildFrame } from "./window-frame.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/*
 * Two lamps, and no minimise. With no taskbar (D4) there is nowhere for a
 * minimised window to be seen waiting, so it would be indistinguishable from a
 * closed one — and reopening either is the same click on the same logo. Both
 * lamps perform reversible actions and neither is signal red.
 */
const LAMPS = [
  { action: "maximise", label: "Maximise", className: "lamp--leaf" },
  { action: "putaway", label: "Put away", className: "lamp--clay" },
];

/**
 * A mounted window element. It carries its component back, which is how a
 * hit-test on the DOM gets from an element to the window that owns it.
 * @typedef {HTMLElement & { alunaWindow?: AlunaWindow }} WindowElement
 */

export class AlunaWindow {
  /**
   * @param {HTMLElement} el the window element; its existing children become
   *   the body, and the chrome is injected around them
   * @param {object} [opts]
   * @param {string} [opts.title] falls back to `data-title`
   * @param {number} [opts.seed] falls back to `data-seed`, then to the title
   * @param {boolean} [opts.focused]
   * @param {number} [opts.shadowAlpha]
   * @param {number} [opts.dividerReach]
   */
  constructor(el, opts = {}) {
    this.el = el;
    this.title = opts.title ?? el.dataset.title ?? "";
    this.seed = Number(opts.seed ?? el.dataset.seed ?? seedFrom(this.title));
    this.focused = opts.focused ?? true;
    this.shadowAlpha = opts.shadowAlpha ?? 0.24;
    this.dividerReach = opts.dividerReach ?? SPEC.dividerReach;
    this.rolled = false;

    /* The last size we drew for. Only a change here invalidates the path. */
    this.lastKey = "";

    const chrome = this.#buildChrome();
    this.ground = chrome.ground;
    this.ink = chrome.ink;
    this.bar = chrome.bar;
    this.body = chrome.body;
    this.titleEl = chrome.title;

    this.observer = this.#observe();
    this.refresh();
  }

  /* ── chrome ───────────────────────────────────────────────────────────── */

  /**
   * Build and insert the chrome, and hand back the parts the component keeps.
   *
   * They are returned rather than assigned onto `this` from in here so the
   * constructor is the only place a field is established — which is also what
   * lets each one be a element rather than a maybe-element.
   *
   * @returns {{ ground: SVGSVGElement, ink: SVGSVGElement, bar: HTMLElement,
   *            body: HTMLElement, title: HTMLElement }}
   */
  #buildChrome() {
    const { el } = this;
    el.classList.add("window");
    el.dataset.seed = String(this.seed);

    /* Whatever was authored inside becomes the body. */
    const body = document.createElement("div");
    body.className = "window__body";
    while (el.firstChild) body.appendChild(el.firstChild);

    const ground = document.createElementNS(SVG_NS, "svg");
    ground.setAttribute("class", "window__ground");
    ground.setAttribute("aria-hidden", "true");

    const ink = document.createElementNS(SVG_NS, "svg");
    ink.setAttribute("class", "window__ink");
    ink.setAttribute("aria-hidden", "true");

    const bar = document.createElement("header");
    bar.className = "window__bar";

    const title = document.createElement("h2");
    title.className = "window__title";
    title.textContent = this.title;

    const lamps = document.createElement("div");
    lamps.className = "window__lamps";
    for (const lamp of LAMPS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `lamp ${lamp.className}`;
      button.dataset.action = lamp.action;
      button.title = lamp.label;
      button.setAttribute("aria-label", `${lamp.label} — ${this.title}`);
      lamps.appendChild(button);
    }
    lamps.addEventListener("click", (event) => {
      const { target } = event;
      if (!(target instanceof Element)) return;
      const button = target.closest("button[data-action]");
      if (!(button instanceof HTMLElement)) return;
      event.stopPropagation();
      el.dispatchEvent(
        new CustomEvent("window:lamp", {
          bubbles: true,
          detail: { action: button.dataset.action, window: this },
        }),
      );
    });

    bar.append(title, lamps);
    el.append(ground, bar, body, ink);
    return { ground, ink, bar, body, title };
  }

  /* ── the resize rule ──────────────────────────────────────────────────── */

  /** @returns {ResizeObserver} */
  #observe() {
    /*
     * Regenerate on resize only. Dragging a window is a CSS transform and does
     * not touch this — rebuild the geometry on every drag frame and the frame
     * becomes the slowest thing on the desk.
     */
    const observer = new ResizeObserver(() => this.refresh());
    observer.observe(this.el);
    return observer;
  }

  /**
   * Redraw if — and only if — the measured box actually changed.
   *
   * @param {boolean} [force]
   */
  refresh(force = false) {
    const w = Math.round(this.el.clientWidth);
    const h = Math.round(this.el.clientHeight);
    const barH = Math.round(this.bar.offsetHeight);
    if (w < 2 || h < 2) return;

    const key = [
      w,
      h,
      barH,
      this.seed,
      this.focused,
      this.shadowAlpha,
      this.dividerReach,
      this.rolled,
    ].join(":");
    if (!force && key === this.lastKey) return;
    this.lastKey = key;

    const frame = buildFrame({
      w,
      h,
      barH,
      seed: this.seed,
      dividerReach: this.dividerReach,
      unfocused: !this.focused,
      shadowAlpha: this.shadowAlpha,
      /* Rolled up, the window is all title bar and has nothing to divide. */
      divider: !this.rolled,
    });

    /** @type {[SVGSVGElement, string][]} */
    const layers = [
      [this.ground, frame.ground],
      [this.ink, frame.ink],
    ];
    for (const [svg, markup] of layers) {
      svg.setAttribute("viewBox", frame.viewBox);
      svg.setAttribute("width", String(frame.width));
      svg.setAttribute("height", String(frame.height));
      svg.style.left = "0";
      svg.style.top = "0";
      svg.innerHTML = markup;
    }
  }

  /* ── state ────────────────────────────────────────────────────────────── */

  /** @param {boolean} focused */
  setFocused(focused) {
    if (this.focused === focused) return;
    this.focused = focused;
    this.el.classList.toggle("is-unfocused", !focused);
    this.refresh();
  }

  /**
   * Roll the window up to its title bar. Reversible, and nothing in storage
   * changes — the same contract every lamp keeps.
   *
   * @param {boolean} rolled
   */
  setRolled(rolled) {
    if (this.rolled === rolled) return;
    this.rolled = rolled;
    this.el.classList.toggle("is-rolled", rolled);
    this.refresh();
  }

  /** @param {number} seed */
  setSeed(seed) {
    this.seed = seed;
    this.el.dataset.seed = String(seed);
    this.refresh(true);
  }

  /** @param {number} px */
  setDividerReach(px) {
    this.dividerReach = px;
    this.refresh();
  }

  /** @param {number} alpha */
  setShadowAlpha(alpha) {
    this.shadowAlpha = alpha;
    this.refresh();
  }

  /** @param {string} title */
  setTitle(title) {
    this.title = title;
    this.titleEl.textContent = title;
  }

  destroy() {
    this.observer.disconnect();
  }
}

/**
 * Mount every `[data-window]` under `root` that is not already mounted.
 *
 * @param {Document | Element} [root]
 * @returns {AlunaWindow[]}
 */
export function mountWindows(root = document) {
  return [...root.querySelectorAll("[data-window]")]
    .filter((el) => el instanceof HTMLElement)
    .filter((el) => !el.dataset.windowMounted)
    .map((el) => {
      el.dataset.windowMounted = "true";
      const win = new AlunaWindow(el, {
        shadowAlpha: Number(el.dataset.shadow ?? 0.24),
      });
      /** @type {WindowElement} */ (el).alunaWindow = win;
      return win;
    });
}
