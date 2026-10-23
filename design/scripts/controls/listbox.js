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
 *     drawn on. A long list scrolls one level in, at `.listbox__scroll` — and that
 *     scroller is the only thing revealing the active row is allowed to move.
 *
 * Focus stays on the button throughout and the active option is reported through
 * `aria-activedescendant` — moving DOM focus into the panel would mean restoring it
 * by hand on all five exit paths.
 *
 * Search is an opt-in mode of the same listbox, never a second control. Drawn with an
 * input in place of the button, the field itself takes the typing and the list keeps the
 * options whose label holds every typed word (`listbox-search.js`). Enter picks the
 * first match, the arrows walk, and Space, Home and End are typing. Escape, Tab or a
 * press outside puts back what was chosen. A chooser drawn on a button keeps the
 * select-only keyboard, its jump to a typed letter included.
 */

import { keyIsNotOurs, narrow, optionLabel, searchIntent } from "./listbox-search.js";

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

/**
 * Give the listbox role to the panel's list, and return its id. A panel that heads its options,
 * as the Link control's chooser does, names the list inside it `[data-listbox-list]`, so the
 * heading is not a child the listbox role forbids.
 *
 * @param {HTMLElement} panel
 * @param {boolean} [searches]
 * @returns {string}
 */
function claimList(panel, searches = false) {
  // A list that searches says "No results" under its options, so the list is the scroller.
  const named = panel.querySelector(searches ? ".listbox__scroll" : "[data-listbox-list]");
  const list = named instanceof HTMLElement ? named : panel;
  list.id ||= `listbox-${++uid}`;
  list.setAttribute("role", "listbox");
  list.setAttribute("tabindex", "-1");
  return list.id;
}

/** @param {HTMLElement} option */
const isDisabled = (option) => option.getAttribute("aria-disabled") === "true";

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
 * What a listbox is drawn with. A button names its choice in `.listbox__value`; a listbox that
 * searches has no button, and its input both shows the choice and takes the typing.
 *
 * @param {HTMLElement} root
 * @returns {{ control: HTMLElement, input: HTMLInputElement | null, panel: HTMLElement,
 *   valueEl: HTMLElement | null }}
 */
function listboxParts(root) {
  const button = root.querySelector(".listbox__button");
  const control = button ?? root.querySelector('input[role="combobox"]');
  const input = !button && control instanceof HTMLInputElement ? control : null;
  const panel = root.querySelector(".listbox__panel");
  const value = root.querySelector(".listbox__value");
  const valueEl = value instanceof HTMLElement ? value : null;
  if (!(control instanceof HTMLElement) || !(panel instanceof HTMLElement) || !(input || valueEl)) {
    throw new Error(
      "A listbox needs a .listbox__button with its .listbox__value, or an input it searches" +
        " from, and a .listbox__panel",
    );
  }
  return { control, input, panel, valueEl };
}

/**
 * Give every option an id under the list's, and say it is not chosen unless the markup did.
 * @param {HTMLElement} panel
 * @param {string} id
 */
function nameOptions(panel, id) {
  for (const [index, option] of optionsIn(panel).entries()) {
    if (!option.id) option.id = `${id}-option-${index + 1}`;
    if (!option.hasAttribute("aria-selected")) option.setAttribute("aria-selected", "false");
  }
}

/**
 * The hidden input a listbox posts its value through, when the markup names one.
 * @param {HTMLElement} root
 * @returns {HTMLInputElement | null}
 */
function carrierFor(root) {
  if (!root.dataset.name) return null;
  const field = document.createElement("input");
  field.type = "hidden";
  field.name = root.dataset.name;
  root.append(field);
  return field;
}

/**
 * One mounted listbox.
 *
 * Public surface is deliberately small — `value` in and out, and a `change`
 * event on the root. A caller should not have to know that the panel exists.
 */
export class Listbox {
  /** Aborted by `destroy`, which takes the document listener with it. */
  #mounted = new AbortController();

  /**
   * @param {HTMLElement} root the `[data-listbox]` element
   */
  constructor(root) {
    const { control, input, panel, valueEl } = listboxParts(root);
    this.root = root;
    /** The button, or the input a listbox that searches takes its typing in. */
    this.button = control;
    this.input = input;
    this.panel = panel;
    this.valueEl = valueEl;
    this.open = false;
    /** What the list is searched by: what was typed since it opened. */
    this.query = "";

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

    const id = claimList(panel, input !== null);
    panel.hidden = true;
    control.setAttribute("aria-haspopup", "listbox");
    control.setAttribute("aria-controls", id);
    control.setAttribute("aria-expanded", "false");
    if (control instanceof HTMLButtonElement) control.type = "button";
    else control.setAttribute("aria-autocomplete", "list");
    nameOptions(panel, id);

    /** The value carrier, so this can sit in a real form, when the markup asked for one by name. */
    this.field = carrierFor(root);
    /** What a listbox that searches holds: the chosen label, or text no option names. */
    this.text = this.selectedOption ? optionLabel(this.selectedOption) : (input?.value ?? "");

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
    this.text = optionLabel(option);
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
    if (this.input) this.input.value = this.text;
    if (this.valueEl) this.valueEl.textContent = label || this.placeholder;
    this.valueEl?.classList.toggle("is-placeholder", !label);
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
    this.query = "";
    if (this.input) narrow(this.panel, "");
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
    // Leaving without a pick puts back what was chosen: typing only ever searched.
    if (this.input) this.input.value = this.text;
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
    /* A glyph button inside a field's shell, like the Link control's, hangs it off the shell. */
    const shell = this.button.closest(".field__control");
    const anchor = shell instanceof HTMLElement && this.root.contains(shell) ? shell : this.button;
    const box = anchor.getBoundingClientRect();
    /* The panel is showing by now, so its own height counts a chooser's heading too. */
    const wanted = this.panel.offsetHeight || 240;
    const below = window.innerHeight - box.bottom;
    /* A control below the fold, as one opened by the page itself can be, has no side to flip to. */
    const flip = box.bottom <= window.innerHeight && below < wanted + 16 && box.top > below;
    const gap = 5;

    this.root.classList.toggle("is-above", flip);
    if (flip) {
      this.panel.style.top = "auto";
      this.panel.style.bottom = `${this.root.offsetHeight - anchor.offsetTop + gap}px`;
    } else {
      this.panel.style.bottom = "auto";
      this.panel.style.top = `${anchor.offsetTop + anchor.offsetHeight + gap}px`;
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
    const all = optionsIn(this.panel).filter((option) => !option.hidden);
    if (all.length === 0) return null;
    const start = from ? all.indexOf(from) : direction === 1 ? -1 : all.length;

    for (let hop = 1; hop <= all.length; hop++) {
      const index = (start + direction * hop + all.length * hop) % all.length;
      const candidate = all[index];
      if (candidate && !isDisabled(candidate)) return candidate;
    }
    return null;
  }

  /**
   * Move the active row.
   *
   * Re-activating the row that is already active is neither free nor harmless:
   * `pointerover` fires again every time the pointer crosses into a child of the
   * row it is already on, and again after any scroll moves the list under a still
   * pointer. Doing the work only when the row actually changes is what keeps a
   * hover from feeding itself.
   *
   * @param {HTMLElement | null} option
   * @param {boolean} [reveal] whether to bring the row into view — what the
   *   keyboard wants and the pointer does not, since the pointer is already on it.
   */
  #setActive(option, reveal = true) {
    if (!option || option === this.active) return;
    this.active?.classList.remove("is-active");
    this.active = option;
    option.classList.add("is-active");
    this.button.setAttribute("aria-activedescendant", option.id);
    if (reveal) this.#reveal(option);
  }

  /**
   * Bring a row into the list, by one row's worth and scrolling nothing but the list.
   *
   * `scrollIntoView({ block: "nearest" })` says the same thing and then keeps going:
   * it scrolls *every* scrollable ancestor that would help, so revealing a row also
   * nudges whatever the control is standing in. The list is the only box that owes
   * the active row anything.
   *
   * @param {HTMLElement} option
   */
  #reveal(option) {
    const scroller = this.panel.querySelector(".listbox__scroll");
    const list = scroller instanceof HTMLElement ? scroller : this.panel;
    const box = list.getBoundingClientRect();
    const row = option.getBoundingClientRect();
    if (row.top < box.top) list.scrollTop -= box.top - row.top;
    else if (row.bottom > box.bottom) list.scrollTop += row.bottom - box.bottom;
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

  /**
   * The person left the field, by Tab, a press elsewhere or focus moving on. An optional field
   * they emptied stays empty, since emptying is not typing a value; anything else is put back.
   */
  #leave() {
    const optional = this.input?.getAttribute("aria-required") !== "true";
    if (optional && this.input?.value.trim() === "" && this.text !== "") {
      for (const option of optionsIn(this.panel)) option.setAttribute("aria-selected", "false");
      this.text = "";
      this.#paint();
      this.root.dispatchEvent(
        new CustomEvent("listbox:change", { bubbles: true, detail: { value: null, label: "" } }),
      );
    }
    this.hide(false);
  }

  /** No row is active: the list is closed, or a search kept nothing Enter could take. */
  #dropActive() {
    this.active?.classList.remove("is-active");
    this.active = null;
    this.button.removeAttribute("aria-activedescendant");
  }

  /**
   * Narrow the list to what is typed, opening it on the first keystroke, and land on the first
   * option kept, which is where Enter picks. With nothing typed it lands on the chosen one.
   */
  #search() {
    if (!this.input) return;
    if (!this.open) this.show();
    this.query = this.input.value;
    const kept = narrow(this.panel, this.query).filter((option) => !isDisabled(option));
    const chosen = this.query.trim() === "" ? this.selectedOption : null;
    const landing = chosen && kept.includes(chosen) ? chosen : kept[0];
    if (landing) this.#setActive(landing);
    else this.#dropActive();
    this.#place();
  }

  /**
   * A listbox that searches: the arrows walk and Enter picks, Escape and Tab leave, and every
   * other key is typing.
   *
   * @param {KeyboardEvent} event
   */
  #keyWhileSearching(event) {
    if (keyIsNotOurs(event)) return;
    const intent = searchIntent(event.key, this.open);
    if (intent === null) return;
    if (intent === "leave") return event.key === "Tab" ? this.#leave() : this.hide(false);
    event.preventDefault();
    if (intent === "open") return this.show();
    if (intent === "pick") {
      if (!this.active) return;
      this.select(this.active);
      return this.hide();
    }
    this.#setActive(this.#step(this.active, intent === "next" ? 1 : -1));
  }

  /**
   * A press on the field opens it with its text chosen, so typing replaces it, and a press on the
   * chevron opens or closes it. Focus leaving the field puts back what was chosen.
   *
   * @param {HTMLInputElement} input
   */
  #wireSearch(input) {
    input.addEventListener("keydown", (event) => this.#keyWhileSearching(event));
    input.addEventListener("input", () => this.#search());
    const shell = input.closest(".field__control");
    shell?.addEventListener("click", (event) => {
      if (event.target !== input) input.focus();
      if (this.open) return event.target === input ? undefined : this.hide();
      this.show();
      input.select();
    });
    /* A press on the chevron or on a row would take focus off the input, closing the list. */
    for (const part of [shell, this.panel]) {
      part?.addEventListener("mousedown", (event) => {
        if (event.target !== input) event.preventDefault();
      });
    }
    this.root.addEventListener("focusout", (event) => {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || !this.root.contains(next)) this.#leave();
    });
  }

  #wire() {
    if (this.input) this.#wireSearch(this.input);
    else {
      this.button.addEventListener("click", () => {
        if (this.open) this.hide();
        else this.show();
      });
      this.button.addEventListener("keydown", (event) => {
        if (this.open) this.#keyWhileOpen(event);
        else this.#keyWhileClosed(event);
      });
    }

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
      if (option instanceof HTMLElement && !isDisabled(option)) this.#setActive(option, false);
    });

    /* Outside means outside the control and the panel: a field's own input or a second glyph
       button can share the root, and pressing one leaves the list. A field that searches is
       its whole shell, chevron and all. */
    const control = this.input?.closest(".field__control") ?? this.button;
    document.addEventListener(
      "pointerdown",
      (event) => {
        const { target } = event;
        if (!this.open || !(target instanceof Node)) return;
        if (control.contains(target) || this.panel.contains(target)) return;
        if (this.input) this.#leave();
        else this.hide(false);
      },
      { signal: this.#mounted.signal },
    );
  }

  /** Stop listening to the document, for a listbox whose markup is about to be thrown away. */
  destroy() {
    this.hide(false);
    this.#mounted.abort();
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
