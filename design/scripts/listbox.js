// @ts-check
/**
 * The listbox — choosing one value from a closed set.
 *
 * `<select>` is a replaced element: the browser draws its popup itself and no
 * stylesheet reaches inside it, so on a surface whose every boundary is drawn the
 * popup has to be ours. The closed control stays a `<button>` (a real focus stop
 * with a real accessible name) and the panel is an ordinary drawn element.
 *
 * Two consequences worth knowing before editing:
 *
 *   - **The panel does not cast a shadow.** What says it is in front is the frame
 *     hand plus the ordered fills — `surface` in front of the `surface-2` field it
 *     covers. Depth here is bands and hands, never a blur.
 *   - **The panel does not clip**, because the ink paints just outside the box it is
 *     drawn on. A long list scrolls one level in, at `.listbox__scroll`.
 *
 * Focus stays on the button throughout and the active option is reported through
 * `aria-activedescendant` — moving DOM focus into the panel would mean restoring it
 * by hand on all five exit paths.
 */

/** The pattern's roving-focus keys, and what each one means for the panel. */
const OPEN_KEYS = new Set(["ArrowDown", "ArrowUp", "Enter", " ", "Home", "End"]);

let uid = 0;

/**
 * Every option in one listbox, in document order. Group wrappers are invisible
 * to this: what the keyboard walks is the options, wherever they are nested.
 *
 * @param {HTMLElement} panel
 * @returns {HTMLElement[]}
 */
function optionsIn(panel) {
  return [...panel.querySelectorAll('[role="option"]')].filter((el) => el instanceof HTMLElement);
}

/** @param {HTMLElement} option */
const isDisabled = (option) => option.getAttribute("aria-disabled") === "true";

/**
 * What an option is *called*, as against everything written on its row. A row may
 * carry a trailing note, which belongs to the row and not to the value: it must not
 * follow the choice back onto the closed control, nor into typeahead, where it would
 * make `c` match a status called Paid.
 *
 * @param {HTMLElement} option
 * @returns {string}
 */
function optionLabel(option) {
  const note = option.querySelector(".listbox__note");
  if (!note) return option.textContent?.trim() ?? "";
  return [...option.childNodes]
    .filter((node) => node !== note)
    .map((node) => node.textContent ?? "")
    .join("")
    .trim();
}

/**
 * The first option whose label starts with `needle`, searching forward from
 * `start` and wrapping. Null when nothing matches, which leaves the active row
 * where it was rather than moving it somewhere arbitrary.
 *
 * @param {readonly HTMLElement[]} options
 * @param {string} needle lowercased
 * @param {number} start
 * @returns {HTMLElement | null}
 */
function matchFrom(options, needle, start) {
  for (let hop = 0; hop < options.length; hop++) {
    const candidate = options[(start + hop + options.length) % options.length];
    if (candidate && optionLabel(candidate).toLowerCase().startsWith(needle)) return candidate;
  }
  return null;
}

/**
 * One mounted listbox.
 *
 * Public surface is deliberately small — `value` in and out, and a `change`
 * event on the root. A caller should not have to know that the panel exists.
 */
export class Listbox {
  /**
   * @param {HTMLElement} root the `[data-listbox]` element
   */
  constructor(root) {
    const button = root.querySelector(".listbox__button");
    const panel = root.querySelector(".listbox__panel");
    const value = root.querySelector(".listbox__value");
    if (
      !(button instanceof HTMLButtonElement) ||
      !(panel instanceof HTMLElement) ||
      !(value instanceof HTMLElement)
    ) {
      throw new Error(
        "A listbox needs a .listbox__button, a .listbox__panel and a .listbox__value",
      );
    }

    this.root = root;
    this.button = button;
    this.panel = panel;
    this.valueEl = value;
    this.open = false;

    /** What the closed control shows when nothing is chosen yet. */
    this.placeholder = root.dataset.placeholder ?? "Choose…";

    /**
     * The option the keyboard is on. Distinct from the selected one: you can
     * walk a list and leave without changing anything, which is the whole
     * reason `aria-activedescendant` exists as a separate idea from selection.
     * @type {HTMLElement | null}
     */
    this.active = null;

    /** Typeahead buffer, cleared after a pause. */
    this.typed = "";
    this.typedAt = 0;

    /**
     * The value carrier, so this can sit in a real form. Only present when the
     * markup asked for one by name.
     * @type {HTMLInputElement | null}
     */
    this.field = null;

    const id = panel.id || `listbox-${++uid}`;
    panel.id = id;
    panel.setAttribute("role", "listbox");
    panel.setAttribute("tabindex", "-1");
    panel.hidden = true;
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-controls", id);
    button.setAttribute("aria-expanded", "false");
    button.type = "button";

    for (const [index, option] of optionsIn(panel).entries()) {
      if (!option.id) option.id = `${id}-option-${index + 1}`;
      if (!option.hasAttribute("aria-selected")) option.setAttribute("aria-selected", "false");
    }

    if (root.dataset.name) {
      const field = document.createElement("input");
      field.type = "hidden";
      field.name = root.dataset.name;
      root.append(field);
      this.field = field;
    }

    this.#wire();
    this.#paint();
  }

  /* ── the value ────────────────────────────────────────────────────────── */

  /** @returns {HTMLElement | null} */
  get selectedOption() {
    return optionsIn(this.panel).find((o) => o.getAttribute("aria-selected") === "true") ?? null;
  }

  /** @returns {string | null} */
  get value() {
    return this.selectedOption?.dataset.value ?? null;
  }

  /**
   * Choose an option. A no-op selection still closes, but only a real change
   * announces itself — a `change` that fires when nothing changed is a `change`
   * every listener has to re-check.
   *
   * @param {HTMLElement | null} option
   */
  select(option) {
    if (!option || isDisabled(option)) return;
    const changed = option !== this.selectedOption;

    for (const other of optionsIn(this.panel)) {
      other.setAttribute("aria-selected", String(other === option));
    }
    this.#paint();

    if (!changed) return;
    this.root.dispatchEvent(
      new CustomEvent("listbox:change", {
        bubbles: true,
        detail: { value: this.value, label: optionLabel(option) },
      }),
    );
  }

  #paint() {
    const option = this.selectedOption;
    const label = option ? optionLabel(option) : "";
    this.valueEl.textContent = label || this.placeholder;
    this.valueEl.classList.toggle("is-placeholder", !label);
    if (this.field) this.field.value = this.value ?? "";
  }

  /* ── opening and closing ──────────────────────────────────────────────── */

  /** @param {HTMLElement | null} [startAt] the option to land the keyboard on */
  show(startAt) {
    if (this.open) return;
    this.open = true;
    this.panel.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    this.root.classList.add("is-open");
    this.#place();
    this.#setActive(startAt ?? this.selectedOption ?? this.#step(null, 1));
  }

  /** @param {boolean} [refocus] */
  hide(refocus = true) {
    if (!this.open) return;
    this.open = false;
    this.panel.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
    this.button.removeAttribute("aria-activedescendant");
    this.root.classList.remove("is-open");
    this.active?.classList.remove("is-active");
    this.active = null;
    if (refocus) this.button.focus();
  }

  /**
   * Where the panel hangs, decided at open time.
   *
   * Off the *button*, not off the field. The positioning context is the whole
   * `.listbox` — label, control and guidance — so a stylesheet's `top: 100%`
   * drops the panel below the guidance line and leaves a gap the width of a
   * sentence. Only the button's own offset knows where the control ends.
   *
   * Above or below is the other half, and it is the one thing here that cannot
   * be settled in the stylesheet at all: it depends on where the control
   * happens to be standing when it is opened.
   */
  #place() {
    const box = this.button.getBoundingClientRect();
    const wanted = Math.min(this.panel.scrollHeight || 240, 260);
    const below = window.innerHeight - box.bottom;
    const flip = below < wanted + 16 && box.top > below;
    const gap = 5;

    this.root.classList.toggle("is-above", flip);
    if (flip) {
      this.panel.style.top = "auto";
      this.panel.style.bottom = `${this.root.offsetHeight - this.button.offsetTop + gap}px`;
    } else {
      this.panel.style.bottom = "auto";
      this.panel.style.top = `${this.button.offsetTop + this.button.offsetHeight + gap}px`;
    }
  }

  /* ── the keyboard ─────────────────────────────────────────────────────── */

  /**
   * The next selectable option in `direction`, wrapping at the ends. Passing a
   * null `from` starts at the appropriate end, which is how "open onto the
   * first item" and "open onto the last item" are the same call.
   *
   * @param {HTMLElement | null} from
   * @param {1 | -1} direction
   * @returns {HTMLElement | null}
   */
  #step(from, direction) {
    const all = optionsIn(this.panel);
    if (all.length === 0) return null;
    const start = from ? all.indexOf(from) : direction === 1 ? -1 : all.length;

    for (let hop = 1; hop <= all.length; hop++) {
      const index = (start + direction * hop + all.length * hop) % all.length;
      const candidate = all[index];
      if (candidate && !isDisabled(candidate)) return candidate;
    }
    return null;
  }

  /** @param {HTMLElement | null} option */
  #setActive(option) {
    if (!option) return;
    this.active?.classList.remove("is-active");
    this.active = option;
    option.classList.add("is-active");
    this.button.setAttribute("aria-activedescendant", option.id);
    /* `nearest` so walking a long list scrolls by one row rather than jumping. */
    option.scrollIntoView({ block: "nearest" });
  }

  /**
   * Jump to the next option starting with what was typed. Repeated presses of
   * the same letter cycle through the options beginning with it, which is what
   * every native list does and the only reason single-letter typeahead is
   * usable at all.
   *
   * @param {string} char
   */
  #typeahead(char) {
    const now = Date.now();
    this.typed = now - this.typedAt > 700 ? char : this.typed + char;
    this.typedAt = now;

    const all = optionsIn(this.panel).filter((option) => !isDisabled(option));
    if (all.length === 0) return;

    /* One letter repeated means "the next one", not "match a longer string". */
    const repeated = this.typed.length > 1 && [...this.typed].every((c) => c === this.typed[0]);
    const cycling = repeated || this.typed.length === 1;
    const needle = (repeated ? char : this.typed).toLowerCase();
    /* Cycling resumes after the active row; a growing string re-searches from 0. */
    const start = cycling && this.active ? all.indexOf(this.active) + 1 : 0;

    this.#setActive(matchFrom(all, needle, start));
  }

  /**
   * Closed: the six keys that open, and nothing else. `End` opens onto the last
   * option rather than the first, which is the one asymmetry in the pattern and
   * the reason this is not simply `show()`.
   *
   * @param {KeyboardEvent} event
   */
  #keyWhileClosed(event) {
    if (!OPEN_KEYS.has(event.key)) return;
    event.preventDefault();
    this.show(event.key === "End" ? this.#step(null, -1) : undefined);
  }

  /**
   * Open: leave, commit, walk, or type. Nothing here selects by moving —
   * walking the list changes what is *active*, and only Enter changes what is
   * chosen, so arrowing past an option never commits it by accident.
   *
   * @param {KeyboardEvent} event
   */
  #keyWhileOpen(event) {
    const { key } = event;

    /* Tab still moves on; it just does not leave the panel hanging open. */
    if (key === "Escape" || key === "Tab") return this.hide(key === "Escape");

    if (key === "Enter" || key === " ") {
      event.preventDefault();
      this.select(this.active);
      return this.hide();
    }

    /** @type {Record<string, () => HTMLElement | null>} */
    const walk = {
      ArrowDown: () => this.#step(this.active, 1),
      ArrowUp: () => this.#step(this.active, -1),
      Home: () => this.#step(null, 1),
      End: () => this.#step(null, -1),
    };
    const move = walk[key];
    if (move) {
      event.preventDefault();
      return this.#setActive(move());
    }

    if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      this.#typeahead(key);
    }
  }

  #wire() {
    this.button.addEventListener("click", () => {
      if (this.open) this.hide();
      else this.show();
    });

    this.button.addEventListener("keydown", (event) => {
      if (this.open) this.#keyWhileOpen(event);
      else this.#keyWhileClosed(event);
    });

    this.panel.addEventListener("click", (event) => {
      const { target } = event;
      if (!(target instanceof Element)) return;
      const option = target.closest('[role="option"]');
      if (!(option instanceof HTMLElement)) return;
      this.select(option);
      this.hide();
    });

    /*
     * Pointer-over sets the active option so the keyboard and the mouse never
     * disagree about where you are — a list showing two highlights is a list
     * that has lost track of which one Enter will take.
     */
    this.panel.addEventListener("pointerover", (event) => {
      const { target } = event;
      if (!(target instanceof Element)) return;
      const option = target.closest('[role="option"]');
      if (option instanceof HTMLElement && !isDisabled(option)) this.#setActive(option);
    });

    document.addEventListener("pointerdown", (event) => {
      const { target } = event;
      if (this.open && target instanceof Node && !this.root.contains(target)) this.hide(false);
    });
  }
}

/**
 * Mount every `[data-listbox]` under `root` that is not already mounted.
 *
 * @param {Document | Element} [root]
 * @returns {Listbox[]}
 */
export function mountListboxes(root = document) {
  return [...root.querySelectorAll("[data-listbox]")]
    .filter((el) => el instanceof HTMLElement)
    .filter((el) => !el.dataset.listboxMounted)
    .map((el) => {
      el.dataset.listboxMounted = "true";
      return new Listbox(el);
    });
}
