// @ts-check

/**
 * The choice controls that need a script — the drawn picker and the segmented row. No stylesheet
 * reaches inside a `<select>`'s popup, so `design/scripts/controls/listbox.js` is the contract instead.
 * A picker drawn as a field you type into searches; one drawn as a button, as the Link control's
 * chooser is, keeps the select-only keyboard and its jump to a typed letter.
 */

import {
  keyIsNotOurs,
  narrow,
  optionLabel,
  searchIntent,
} from "../../design/scripts/controls/listbox-search.js";
import { watchArrivals } from "../core/dom-arrivals.js";
import { onCreateFinished } from "../core/shell-dom.js";
import { clamp, clipBounds, inset } from "./panel-placement.js";

export { clipBounds };

/** The field a picker is drawn on, which is what both mounting and the arrival watch look for. */
const PICKER_SELECTOR = '[data-choice-presentation="picker"]';

/** The control of a picker that searches: the field's own input, which takes the typing. */
const SEARCH_CONTROL = 'input[role="combobox"]';

/**
 * The select-only keyboard's opening keys, which the chooser keeps. Focus stays on the control
 * throughout and the active option is reported by `aria-activedescendant`, or every exit path
 * would restore focus by hand.
 */
const OPEN_KEYS = new Set(["ArrowDown", "ArrowUp", "Enter", " ", "Home", "End"]);

/** The tallest the design lets a panel grow, and the shortest that is still a list. */
export const MAX_PANEL_HEIGHT = 260;
export const MIN_SCROLL_HEIGHT = 68;
/**
 * The clearance between the control and the panel, and off the edge it is inset by so it reads as
 * inside the frame. The panel does not clip, so a long list scrolls at `.listbox__scroll`.
 */
export const PANEL_GAP = 5;

/**
 * Every option in one listbox, in document order. Group wrappers are invisible to this:
 * what the keyboard walks is the options, wherever they are nested.
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
 * The first option whose label starts with `needle`, searching forward from `start` and wrapping.
 * Null when nothing matches, so the active row stays where it was.
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
 * What a picker is drawn with. A button names its choice in `.listbox__value`; a picker that
 * searches has no button, and its input both shows the choice and takes the typing.
 *
 * @param {HTMLElement} root
 * @returns {{ control: HTMLElement, input: HTMLInputElement | null, panel: HTMLElement,
 *   valueEl: HTMLElement | null }}
 */
function pickerParts(root) {
  const button = root.querySelector(".listbox__button");
  const control = button ?? root.querySelector(SEARCH_CONTROL);
  const input = !button && control instanceof HTMLInputElement ? control : null;
  const panel = root.querySelector(".listbox__panel");
  const value = root.querySelector(".listbox__value");
  const valueEl = value instanceof HTMLElement ? value : null;
  if (!(control instanceof HTMLElement) || !(panel instanceof HTMLElement) || !(input || valueEl)) {
    throw new Error(
      "A picker needs a .listbox__button with its .listbox__value, or an input it searches" +
        " from, and a .listbox__panel",
    );
  }
  return { control, input, panel, valueEl };
}

/** One mounted picker. */
export class ChoicePicker {
  /**
   * @param {HTMLElement} root the `[data-choice-presentation="picker"]` field
   * @param {Set<ChoicePicker>} open the pickers standing open on this document
   */
  constructor(root, open) {
    const { control, input, panel, valueEl } = pickerParts(root);
    this.root = root;
    /** The open set this picker belongs to — one per document, never module-wide. */
    this.openPickers = open;
    /** The button, or the input a picker that searches takes its typing in. */
    this.control = control;
    this.input = input;
    this.panel = panel;
    this.valueEl = valueEl;
    this.open = false;

    /**
     * The option the keyboard is on, distinct from the selected one: you can walk a list and
     * leave without changing anything.
     * @type {HTMLElement | null}
     */
    this.active = null;

    /** Typeahead buffer, cleared after a pause. */
    this.typed = "";
    this.typedAt = 0;

    /** What the list is searched by: what was typed since it opened, nothing until then. */
    this.query = "";

    /**
     * Whether the list has moved since the pointer last did. A `pointerover` fires for a scroll
     * under a still hand too, and that took the selection straight back off the keyboard.
     */
    this.listMoved = false;

    const scroll = root.querySelector(".listbox__scroll");
    if (!(scroll instanceof HTMLElement)) {
      throw new Error("A picker needs a .listbox__scroll for its options");
    }
    /** @type {HTMLElement} */
    this.scroll = scroll;

    const carrier = root.querySelector("[data-choice-value]");
    if (!(carrier instanceof HTMLInputElement) && this.carries) {
      throw new Error("A picker needs a [data-choice-value] to post its choice through");
    }
    /**
     * The value carrier the renderer emitted. It already holds the record's value, so the
     * control posts correctly whether or not anyone touches it.
     * @type {HTMLInputElement | null}
     */
    this.field = carrier instanceof HTMLInputElement ? carrier : null;

    /**
     * Where the panel's coordinates start and how far they may reach, measured once each
     * time it opens. See {@link ChoicePicker#anchor}.
     * @type {{ left: number, top: number } | null}
     */
    this.origin = null;
    /** @type {{ top: number, bottom: number, left: number, right: number } | null} */
    this.bounds = null;
    /** The panel's own padding and line, so the scroller can be sized to fit a space. */
    this.chrome = 0;

    /** Every listener this picker holds, let go of at once when it is retired. */
    this.wiring = new AbortController();
    this.#wire();
  }

  /** Stop answering for good, every listener with it: the field it drew is plain text again. */
  retire() {
    this.hide(false);
    this.openPickers.delete(this);
    this.wiring.abort();
  }

  /** Whether a choice posts through a carrier. The Link control's chooser writes, and posts nothing. */
  get carries() {
    return true;
  }

  /** The box the panel hangs from and is as wide as: the drawn control, the input's shell. */
  controlBox() {
    return (this.input?.closest(".field__control") ?? this.control).getBoundingClientRect();
  }

  /** The tallest the panel may stand. A panel that heads its list measures the heading on. */
  get panelCap() {
    return MAX_PANEL_HEIGHT;
  }

  /**
   * Whether a press on `node` belongs to this control, so does not close it.
   * @param {Node} node
   */
  holds(node) {
    return this.root.contains(node);
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
   * Choose an option. A no-op selection still closes, but only a real change announces itself: a
   * `change` that fires when nothing changed is one every listener has to re-check.
   *
   * @param {HTMLElement | null} option
   */
  select(option) {
    if (!option || isDisabled(option)) return;
    const changed = option !== this.selectedOption;

    for (const other of optionsIn(this.panel)) {
      other.setAttribute("aria-selected", String(other === option));
    }
    this.paint();
    if (changed) announceChange(this.field);
  }

  /** Choose nothing, as an optional field that was emptied and left does. */
  clear() {
    const changed = this.selectedOption !== null;
    for (const option of optionsIn(this.panel)) option.setAttribute("aria-selected", "false");
    this.paint();
    if (changed) announceChange(this.field);
  }

  /**
   * The person left the field, by Tab, a press elsewhere or focus moving on. An optional field they
   * emptied stays empty, since emptying is not typing a value; anything else is put back.
   */
  leave() {
    const emptied = this.input?.value.trim() === "" && this.shownLabel() !== "";
    if (emptied && !this.field?.hasAttribute("data-choice-required")) this.clear();
    this.hide(false);
  }

  /** What the closed control shows: the chosen option's label, or nothing. */
  shownLabel() {
    const option = this.selectedOption;
    return option ? optionLabel(option) : "";
  }

  /** Put the closed control and the carrier back in step with what is selected. */
  paint() {
    const label = this.shownLabel();
    if (this.input) this.input.value = label;
    this.valueEl?.classList.toggle("is-placeholder", !label);
    if (this.valueEl) this.valueEl.textContent = label;
    if (this.field) this.field.value = this.value ?? "";
  }

  /**
   * Put the control back to what the server drew, carrier included. Not `form.reset()`'s job: a
   * hidden input's `value` is its content attribute, so a write rewrote the default a reset wants.
   */
  restore() {
    // Closed first. Put back means put back: a panel left standing over a form that has
    // finished keeps an active row and an `aria-expanded` that describe nothing.
    this.hide(false);
    const wanted = this.root.dataset.choiceInitial ?? "";
    for (const option of optionsIn(this.panel)) {
      option.setAttribute("aria-selected", String(option.dataset.value === wanted));
    }
    this.paint();
  }

  /* ── opening and closing ──────────────────────────────────────────────── */

  /** @param {HTMLElement | null} [startAt] the option to land the keyboard on */
  show(startAt) {
    if (this.open) return;
    this.open = true;
    this.openPickers.add(this);
    this.panel.hidden = false;
    this.control.setAttribute("aria-expanded", "true");
    this.root.classList.add("is-open");
    this.query = "";
    if (this.input) narrow(this.panel, "");
    this.anchor();
    // Placing it can close it again, when its control stands outside the box that paints it.
    if (!this.open) return;
    this.#setActive(startAt ?? this.selectedOption ?? this.#step(null, 1));
  }

  /** @param {boolean} [refocus] */
  hide(refocus = true) {
    // Leaving without a pick puts back what was chosen, even before a list was ever shown: typing
    // only ever searched.
    if (this.input) this.input.value = this.shownLabel();
    if (!this.open) return;
    this.open = false;
    this.origin = null;
    this.bounds = null;
    this.openPickers.delete(this);
    this.panel.hidden = true;
    this.control.setAttribute("aria-expanded", "false");
    this.root.classList.remove("is-open");
    this.#dropActive();
    // Per-opening state, cleared with the rest of it: a list disarmed by its last scroll
    // would otherwise open again with the pointer still not trusted.
    this.listMoved = false;
    if (refocus) this.control.focus();
  }

  /**
   * Learn where the panel may live, then place it. Two different boxes: where its coordinates
   * start (its containing block) and how far it may reach ({@link clipBounds}), which differ.
   */
  anchor() {
    // A fixed box is anchored to the viewport unless a transformed ancestor is its containing
    // block, and a desk window is placed by `translate`, so it is parked filling that and asked.
    const panel = this.panel;
    this.scroll.style.maxHeight = "";
    panel.style.left = "0px";
    panel.style.top = "0px";
    panel.style.bottom = "auto";
    panel.style.width = "100%";
    panel.style.height = "100%";
    const block = panel.getBoundingClientRect();
    // Measured at the width it will stand at: a heading that wraps there is taller than it is
    // at the shrink-to-fit width, and a chrome measured short lets the panel cover its field.
    panel.style.width = `${this.controlBox().width}px`;
    panel.style.height = "";

    this.origin = { left: block.left, top: block.top };
    // The window's body clips and the window, which holds the title bar, does not: measuring
    // against one and drawing inside the other left the rows past the edge unpainted.
    this.bounds = inset(clipBounds(panel), PANEL_GAP);
    this.chrome = Math.max(panel.offsetHeight - this.scroll.offsetHeight, 0);
    this.place();
  }

  /**
   * Where the panel hangs: under the button or over it, never outside the box that paints it.
   * Measured off the button, because the field also holds the label and a line of guidance.
   */
  place() {
    const { origin, bounds } = this;
    if (!origin || !bounds) return;
    const box = this.controlBox();
    // A control scrolled out of its own form takes its panel with it: a list hanging where its
    // control is not visible has nothing to point at and covers whatever the form stands over.
    if (box.bottom <= bounds.top || box.top >= bounds.bottom) {
      this.hide(false);
      return;
    }

    const below = bounds.bottom - box.bottom - PANEL_GAP;
    const above = box.top - bounds.top - PANEL_GAP;
    const wanted = Math.min(this.scroll.scrollHeight + this.chrome, this.panelCap);
    const flip = below < wanted && above > below;

    this.root.classList.toggle("is-above", flip);
    this.panel.style.width = `${box.width}px`;
    this.panel.style.left = `${clamp(box.left, bounds.left, bounds.right - box.width) - origin.left}px`;
    this.panel.style.top = `${this.#fit(box, bounds, flip) - origin.top}px`;
  }

  /**
   * Size the list to the room on the chosen side, then say where its top goes. Sized twice,
   * because a start clamped into the box can leave less room than the side it was measured from.
   *
   * @param {DOMRect} box
   * @param {{ top: number, bottom: number }} bounds
   * @param {boolean} flip
   */
  #fit(box, bounds, flip) {
    const room = flip ? box.top - bounds.top - PANEL_GAP : bounds.bottom - box.bottom - PANEL_GAP;
    this.#capScroll(room);
    const wantedTop = flip ? box.top - PANEL_GAP - this.panel.offsetHeight : box.bottom + PANEL_GAP;
    const top = clamp(wantedTop, bounds.top, bounds.bottom - this.panel.offsetHeight);
    this.#capScroll(bounds.bottom - top);
    return top;
  }

  /**
   * Hold the list to `room`, never below the height that still reads as a list.
   * @param {number} room
   */
  #capScroll(room) {
    const height = Math.min(Math.max(room, MIN_SCROLL_HEIGHT + this.chrome), this.panelCap);
    this.scroll.style.maxHeight = `${height - this.chrome}px`;
  }

  /* ── the keyboard ─────────────────────────────────────────────────────── */

  /**
   * The next selectable option in `direction`, wrapping at the ends. A null `from` starts at the
   * appropriate end, which is how opening onto the first and onto the last are one call.
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
   * Move the active row. Re-activating the row already active is not harmless: `pointerover`
   * fires again on every crossing into a child, and a hover would feed itself.
   *
   * @param {HTMLElement | null} option
   * @param {boolean} [reveal] whether to bring the row into view — what the keyboard wants
   *   and the pointer does not, since the pointer is already on it.
   */
  #setActive(option, reveal = true) {
    if (!option || option === this.active) return;
    this.active?.classList.remove("is-active");
    this.active = option;
    option.classList.add("is-active");
    this.control.setAttribute("aria-activedescendant", option.id);
    if (reveal) this.#reveal(option);
  }

  /** No row is active: the list is closed, or a search kept nothing Enter could take. */
  #dropActive() {
    this.active?.classList.remove("is-active");
    this.active = null;
    this.control.removeAttribute("aria-activedescendant");
  }

  /**
   * Bring a row into the list, scrolling nothing but the list. `scrollIntoView` scrolls every
   * scrollable ancestor, which moved the form, re-placed the panel, and fed itself a new row.
   *
   * @param {HTMLElement} option
   */
  #reveal(option) {
    const list = this.scroll;
    const box = list.getBoundingClientRect();
    const row = option.getBoundingClientRect();
    // The scrollport, not the border box: they differ by exactly the scrollbars, and a note long
    // enough to bring out a horizontal one would park the last row underneath it.
    const top = box.top + list.clientTop;
    const left = box.left + list.clientLeft;
    const was = { top: list.scrollTop, left: list.scrollLeft };

    if (row.top < top) list.scrollTop -= top - row.top;
    else if (row.bottom > top + list.clientHeight)
      list.scrollTop += row.bottom - top - list.clientHeight;
    if (row.left < left) list.scrollLeft -= left - row.left;
    else if (row.right > left + list.clientWidth)
      list.scrollLeft += row.right - left - list.clientWidth;

    // Said here rather than left to the `scroll` event, which arrives a frame later — by which
    // time the `pointerover` this is meant to disarm has already been answered.
    if (list.scrollTop !== was.top || list.scrollLeft !== was.left) this.listMoved = true;
  }

  /**
   * Jump to the next option starting with what was typed. Repeated presses of one letter cycle
   * through the options beginning with it, as every native list does.
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
   * Closed: the six keys that open, and nothing else. `End` opens onto the last option rather
   * than the first, which is why this is not simply `show()`.
   *
   * @param {KeyboardEvent} event
   */
  #keyWhileClosed(event) {
    if (!OPEN_KEYS.has(event.key)) return;
    event.preventDefault();
    this.show(event.key === "End" ? this.#step(null, -1) : undefined);
  }

  /**
   * Open: leave, commit, walk, or type. Nothing here selects by moving — only Enter changes what
   * is chosen, so arrowing past an option never commits it.
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
   * Narrow the list to what is typed, opening it on the first keystroke, and land on the first
   * option the search kept, which is where Enter picks.
   */
  #search() {
    if (!this.input) return;
    if (!this.open) this.show();
    this.query = this.input.value;
    this.relist();
  }

  /**
   * What tells one option from another once the options are drawn again: its value.
   *
   * @param {HTMLElement} option
   * @returns {string | undefined}
   */
  identity(option) {
    return option.dataset.value;
  }

  /**
   * Search the options again, as they are drawn now: after a keystroke, or when a list read while
   * it stood open is drawn again. With nothing typed the keyboard lands on the chosen option.
   *
   * @param {string} [keep] the {@link ChoicePicker#identity} of the row the keyboard was on before
   *   the options were drawn again, which it stays on while the search still keeps it
   */
  relist(keep) {
    if (!this.open || !this.input) return;
    const kept = narrow(this.panel, this.query).filter((option) => !isDisabled(option));
    const held = kept.find((option) => keep !== undefined && this.identity(option) === keep);
    const chosen = this.query.trim() === "" ? this.selectedOption : null;
    const landing = held ?? (chosen && kept.includes(chosen) ? chosen : kept[0]);
    if (landing) this.#setActive(landing);
    else this.#dropActive();
    this.place();
  }

  /**
   * A picker that searches: the arrows walk and Enter picks, Escape and Tab leave, and every other
   * key is typing, which the input takes and {@link ChoicePicker#search} hears.
   *
   * @param {KeyboardEvent} event
   */
  #keyWhileSearching(event) {
    if (keyIsNotOurs(event)) return;
    const intent = searchIntent(event.key, this.open);
    if (intent === null) return;
    if (intent === "leave") return event.key === "Tab" ? this.leave() : this.hide(false);
    event.preventDefault();
    if (intent === "open") return this.show();
    if (intent === "pick") return this.#pick(this.active);
    this.#setActive(this.#step(this.active, intent === "next" ? 1 : -1));
  }

  /** @param {HTMLElement | null} option */
  #pick(option) {
    if (!option) return;
    this.select(option);
    this.hide();
  }

  /**
   * A press on the field opens it with its text chosen, so typing replaces it, and a press on the
   * chevron opens or closes it. Focus leaving the field puts back what was chosen.
   *
   * @param {HTMLInputElement} input
   */
  #wireSearch(input) {
    const on = { signal: this.wiring.signal };
    input.addEventListener("keydown", (event) => this.#keyWhileSearching(event), on);
    input.addEventListener("input", () => this.#search(), on);
    const shell = input.closest(".field__control");
    const press = (/** @type {Event} */ event) => {
      if (event.target !== input) input.focus();
      if (this.open) return event.target === input ? undefined : this.hide();
      this.show();
      input.select();
    };
    shell?.addEventListener("click", press, on);
    // A press on the chevron or on a row would take focus off the input, closing the list first.
    for (const part of [shell, this.panel]) {
      part?.addEventListener(
        "mousedown",
        (event) => {
          if (event.target !== input) event.preventDefault();
        },
        on,
      );
    }
    const left = (/** @type {FocusEvent} */ event) => {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || !this.root.contains(next)) this.leave();
    };
    this.root.addEventListener("focusout", left, on);
  }

  #wire() {
    const on = { signal: this.wiring.signal };
    if (this.input) this.#wireSearch(this.input);
    else {
      const toggle = () => (this.open ? this.hide() : this.show());
      this.control.addEventListener("click", toggle, on);
      const key = (/** @type {KeyboardEvent} */ event) =>
        this.open ? this.#keyWhileOpen(event) : this.#keyWhileClosed(event);
      this.control.addEventListener("keydown", key, on);
    }

    this.panel.addEventListener("click", (event) => this.#pick(optionFrom(event.target)), on);

    /*
     * Pointer-over sets the active option so the keyboard and the mouse never disagree: a list
     * showing two highlights has lost track of which one Enter will take.
     */
    const hover = (/** @type {Event} */ event) => {
      if (this.listMoved) return;
      const option = optionFrom(event.target);
      /* No reveal: the pointer is on the row already, so there is nowhere to bring it. */
      if (option && !isDisabled(option)) this.#setActive(option, false);
    };
    this.panel.addEventListener("pointerover", hover, on);
    this.panel.addEventListener("pointermove", () => (this.listMoved = false), on);
    this.scroll.addEventListener("scroll", () => (this.listMoved = true), on);
  }
}

/**
 * Keep every open panel over the control it belongs to: scrolling the form moves the button.
 * Capture, because the scroll that matters is the inner scroller's and it does not bubble.
 *
 * @param {Document} root
 * @param {Set<ChoicePicker>} openPickers
 */
export function watchPlacement(root, openPickers) {
  // A panel's own list is the one scroller this owes nothing to: placement re-caps the list's
  // height, so answering its scroll resized the box the user was scrolling, mid-scroll.
  root.addEventListener(
    "scroll",
    (event) => {
      const { target } = event;
      for (const picker of [...openPickers]) {
        if (!picker.root.isConnected) picker.hide(false);
        else if (!(target instanceof Node) || !picker.panel.contains(target)) picker.place();
      }
    },
    true,
  );
  // A resize can move the containing block the panel was measured against, so the honest answer
  // is to close rather than place it somewhere guessed. A search is measured again instead: a
  // phone's keyboard rising under the field resizes the page, and closing would drop the typing.
  root.defaultView?.addEventListener("resize", () => {
    for (const picker of [...openPickers]) {
      if (picker.input) picker.anchor();
      else picker.hide(false);
    }
  });
}

/**
 * A press anywhere else closes an open panel, without taking focus back from where the press
 * landed. Detached pickers are dropped rather than asked.
 *
 * @param {Document} root
 * @param {Set<ChoicePicker>} openPickers
 */
export function closeOnPressOutside(root, openPickers) {
  root.addEventListener("pointerdown", (event) => {
    const { target } = event;
    for (const picker of [...openPickers]) {
      if (!picker.root.isConnected) {
        openPickers.delete(picker);
        continue;
      }
      if (target instanceof Node && !picker.holds(target)) picker.leave();
    }
  });
}

/** @param {EventTarget | null} target @returns {HTMLElement | null} */
function optionFrom(target) {
  if (!(target instanceof Element)) return null;
  const option = target.closest('[role="option"]');
  return option instanceof HTMLElement ? option : null;
}

/**
 * Mount every picker under `root` that is not already mounted.
 *
 * @param {Document | Element} root
 * @param {Set<ChoicePicker>} [open] the open set the mounted pickers join
 * @returns {ChoicePicker[]}
 */
export function mountChoicePickers(root, open = new Set()) {
  const found = [...root.querySelectorAll(PICKER_SELECTOR)];
  // The arrival watch hands over the node that landed, as often the field itself as a form
  // holding one — `querySelectorAll` answers about descendants and not about it.
  if (root instanceof Element && root.matches(PICKER_SELECTOR)) found.unshift(root);
  return found
    .filter((el) => el instanceof HTMLElement)
    .filter((el) => !el.dataset.choicePickerMounted)
    .map((el) => {
      // Flagged after, not before: a field that refuses would be marked mounted on its way out
      // and never offered a script again.
      const picker = new ChoicePicker(el, open);
      el.dataset.choicePickerMounted = "true";
      return picker;
    });
}

/**
 * Press one segment. The row is a plain exclusive button set: one pressed value written to the
 * carrier, and ordinary button activation does the rest, every segment being its own tab stop.
 *
 * @param {HTMLButtonElement} pressed
 */
export function pressSegment(pressed) {
  const field = pressed.closest('[data-choice-presentation="segmented"]');
  if (!(field instanceof HTMLElement)) return;
  const carrier = field.querySelector("[data-choice-value]");
  const chosen = pressed.dataset.value ?? "";

  for (const segment of field.querySelectorAll("button[data-value]")) {
    segment.setAttribute("aria-pressed", String(segment === pressed));
  }
  if (carrier instanceof HTMLInputElement && carrier.value !== chosen) {
    carrier.value = chosen;
    announceChange(carrier);
  }
}

/**
 * Say a choice moved the way a form control says it: a bubbling `change` on the input carrying
 * the value, which is the one event every form already knows and the required check hears.
 *
 * @param {HTMLInputElement | null} carrier
 */
function announceChange(carrier) {
  carrier?.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Put every drawn choice control in one form back to what the server rendered. `form.reset()`
 * covers only the radio group, so the other two are put back from `data-choice-initial`.
 *
 * @param {HTMLFormElement} form
 * @param {readonly ChoicePicker[]} pickers
 */
export function resetChoiceControls(form, pickers) {
  // Asked of the picker: `form.contains` is a field, for a capability with one called `contains`.
  for (const picker of pickers) {
    if (picker.root.closest("form") === form) picker.restore();
  }
  for (const field of form.querySelectorAll('[data-choice-presentation="segmented"]')) {
    if (field instanceof HTMLElement) restoreSegments(field);
  }
}

/** @param {HTMLElement} field */
function restoreSegments(field) {
  const wanted = field.dataset.choiceInitial ?? "";
  const carrier = field.querySelector("[data-choice-value]");
  if (carrier instanceof HTMLInputElement) carrier.value = wanted;
  for (const segment of field.querySelectorAll("button[data-value]")) {
    segment.setAttribute("aria-pressed", String(segment.getAttribute("data-value") === wanted));
  }
}

/**
 * Wire the drawn choice controls onto a document. The forms these live in arrive long after page
 * load, so mounting repeats and the segment press is delegated.
 *
 * @param {Document} root
 */
export function startChoiceControls(root) {
  /** @type {ChoicePicker[]} */
  const mounted = [];
  /**
   * The pickers standing open on this document, not module-wide: two documents sharing one set
   * would let a press on either close the other's panel.
   * @type {Set<ChoicePicker>}
   */
  const openPickers = new Set();

  /**
   * Drop the pickers whose form has been swapped away: this list outlives every form it holds.
   * A detached one standing open is closed on the way out, which lets its subtree go.
   */
  const prune = () => {
    for (let index = mounted.length - 1; index >= 0; index--) {
      const picker = mounted[index];
      if (picker?.root.isConnected) continue;
      picker?.hide(false);
      mounted.splice(index, 1);
    }
  };

  /**
   * Mount what arrived, once per batch rather than once per node: a swap lands its children one
   * at a time. A field that refuses says so after every field beside it has its script.
   *
   * @param {readonly (Document | Element)[]} nodes
   */
  const arrived = (nodes) => {
    prune();
    /** @type {unknown} */
    let refusal;
    for (const node of nodes) {
      try {
        for (const picker of mountChoicePickers(node, openPickers)) mounted.push(picker);
      } catch (error) {
        refusal ??= error;
      }
    }
    if (refusal !== undefined) throw refusal;
  };

  arrived([root]);
  watchArrivals(root, arrived);
  watchPlacement(root, openPickers);

  root.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const segment = event.target.closest(
      '[data-choice-presentation="segmented"] button[data-value]',
    );
    if (segment instanceof HTMLButtonElement && !segment.disabled) pressSegment(segment);
  });

  closeOnPressOutside(root, openPickers);
  onCreateFinished(root, (form) => resetChoiceControls(form, mounted));
}

if (typeof document !== "undefined") startChoiceControls(document);
