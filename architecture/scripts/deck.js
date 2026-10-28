// @ts-check
/**
 * The deck: one slide at a time over the desk the build happens on. A slide may hold steps that
 * arrive one press at a time. The address names the slide, so a link opens it, and whatever
 * listens is told after every move.
 */

/**
 * @typedef {object} Slide
 * @property {HTMLElement} el
 * @property {string} name what a screen reader hears the slide called
 * @property {HTMLElement[]} stepped the elements that arrive one press at a time
 * @property {number} steps how many presses the slide holds before the next one
 */

/**
 * @typedef {object} RailParts
 * @property {HTMLButtonElement} prev
 * @property {HTMLButtonElement} next
 * @property {HTMLElement} now
 * @property {HTMLElement} all
 * @property {HTMLElement} status the one line a screen reader hears when the slide or step changes
 * @property {HTMLElement[]} parts the menubar links, one per part of the deck
 */

/**
 * @param {Element | null} node
 * @returns {node is HTMLElement}
 */
const isHTML = (node) => node instanceof HTMLElement;

/** @param {HTMLElement} node */
const stepOf = (node) => Number(node.dataset.step) || 0;

/** How long a slide takes to fade as the next one arrives. */
const LEAVING_MS = 400;

/**
 * @param {HTMLElement} el
 * @returns {Slide}
 */
function readSlide(el) {
  const stepped = [...el.querySelectorAll("[data-step]")].filter(isHTML);
  return {
    el,
    name: el.dataset.name ?? el.id,
    stepped,
    steps: Math.max(0, ...stepped.map(stepOf)),
  };
}

/**
 * @template {HTMLElement} T
 * @param {Document} doc
 * @param {string} selector
 * @param {new () => T} kind
 * @returns {T}
 */
function need(doc, selector, kind) {
  const found = doc.querySelector(selector);
  if (!(found instanceof kind)) throw new Error(`The deck needs ${selector}`);
  return found;
}

/**
 * @param {Document} doc
 * @returns {RailParts}
 */
function readRail(doc) {
  return {
    prev: need(doc, '[data-go="prev"]', HTMLButtonElement),
    next: need(doc, '[data-go="next"]', HTMLButtonElement),
    now: need(doc, "[data-count-now]", HTMLElement),
    all: need(doc, "[data-count-all]", HTMLElement),
    status: need(doc, "[data-deck-status]", HTMLElement),
    parts: [...doc.querySelectorAll("[data-part-link]")].filter(isHTML),
  };
}

export class Deck {
  /**
   * @param {HTMLElement} root the desk the slides sit on
   * @param {Document} doc
   */
  constructor(root, doc) {
    this.root = root;
    this.doc = doc;
    this.slides = [...root.querySelectorAll("[data-slide]")].filter(isHTML).map(readSlide);
    this.rail = readRail(doc);
    this.index = 0;
    this.step = 0;
    /** @type {((deck: Deck) => void)[]} */
    this.listeners = [];

    const total = this.slides.length;
    this.slides.forEach((slide, i) => {
      slide.el.setAttribute("aria-roledescription", "slide");
      slide.el.setAttribute("aria-label", `${i + 1} of ${total}: ${slide.name}`);
    });
  }

  /** @returns {Slide} */
  get current() {
    const slide = this.slides[this.index];
    if (!slide) throw new Error("The deck holds no slides");
    return slide;
  }

  /** @param {string} id */
  indexOf(id) {
    return this.slides.findIndex((slide) => slide.el.id === id);
  }

  /** @param {(deck: Deck) => void} listener */
  onChange(listener) {
    this.listeners.push(listener);
  }

  /**
   * Show a slide. Going back lands on its last step, so the slide looks the way it was left.
   *
   * @param {number} index
   * @param {number} [step]
   */
  go(index, step = 0) {
    const target = Math.min(Math.max(index, 0), this.slides.length - 1);
    this.root.style.setProperty("--dir", target < this.index ? "-1" : "1");
    this.index = target;
    this.step = Math.min(step, this.current.steps);
    this.render();
  }

  next() {
    if (this.step < this.current.steps) {
      this.step += 1;
      this.render();
    } else if (this.index < this.slides.length - 1) {
      this.go(this.index + 1);
    }
  }

  prev() {
    if (this.step > 0) {
      this.step -= 1;
      this.render();
    } else if (this.index > 0) {
      this.go(this.index - 1, Number.POSITIVE_INFINITY);
    }
  }

  first() {
    this.go(0);
  }

  last() {
    this.go(this.slides.length - 1, Number.POSITIVE_INFINITY);
  }

  render() {
    const { current } = this;
    for (const slide of this.slides) {
      const leaving = slide.el.classList.contains("is-current") && slide !== current;
      slide.el.classList.toggle("is-leaving", leaving);
      slide.el.classList.toggle("is-current", slide === current);
      slide.el.inert = slide !== current;
      if (leaving) setTimeout(() => slide.el.classList.remove("is-leaving"), LEAVING_MS);
    }
    for (const node of current.stepped) {
      const n = stepOf(node);
      node.classList.toggle("is-shown", n <= this.step);
      node.classList.toggle("is-latest", n > 0 && n === this.step);
    }
    this.#renderRail();

    const hash = `#${current.el.id}`;
    if (this.doc.location.hash !== hash) history.replaceState(null, "", hash);
    for (const listener of this.listeners) listener(this);
  }

  #renderRail() {
    const { current, rail } = this;
    const lastIndex = this.slides.length - 1;
    rail.prev.disabled = this.index === 0 && this.step === 0;
    rail.next.disabled = this.index === lastIndex && this.step >= current.steps;
    rail.now.textContent = String(this.index + 1);
    rail.all.textContent = String(this.slides.length);
    const step = this.step > 0 ? `, step ${this.step} of ${current.steps}` : "";
    const status = `Slide ${this.index + 1} of ${this.slides.length}: ${current.name}${step}`;
    if (rail.status.textContent !== status) rail.status.textContent = status;
    for (const link of rail.parts) {
      if (link.dataset.partLink === current.el.dataset.part)
        link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
  }
}
