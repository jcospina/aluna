// @ts-check

/**
 * The choice controls that need a script — the drawn picker and the segmented row. No stylesheet
 * reaches inside a `<select>`'s popup, so `design/scripts/listbox.js` is the contract instead.
 */

import { watchArrivals } from "./dom-arrivals.js";

/** The field a picker is drawn on, which is what both mounting and the arrival watch look for. */
const PICKER_SELECTOR = '[data-choice-presentation="picker"]';

/**
 * The pattern's roving-focus keys. Focus stays on the button throughout and the active option is
 * reported by `aria-activedescendant`, or all five exit paths would restore focus by hand.
 */
const OPEN_KEYS = new Set(["ArrowDown", "ArrowUp", "Enter", " ", "Home", "End"]);

/** The tallest the design lets a panel grow, and the shortest that is still a list. */
const MAX_PANEL_HEIGHT = 260;
const MIN_SCROLL_HEIGHT = 68;
/**
 * The clearance between the control and the panel, and off the edge it is inset by so it reads as
 * inside the frame. The panel does not clip, so a long list scrolls at `.listbox__scroll`.
 */
const PANEL_GAP = 5;

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
 * What an option is called, as against everything written on its row. A trailing note belongs to
 * the row, not the value: in typeahead it would make `c` match a status called Paid.
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

/** One mounted picker. */
export class ChoicePicker {
  /**
   * @param {HTMLElement} root the `[data-choice-presentation="picker"]` field
   * @param {Set<ChoicePicker>} open the pickers standing open on this document
   */
  constructor(root, open) {
    const button = root.querySelector(".listbox__button");
    const panel = root.querySelector(".listbox__panel");
    const value = root.querySelector(".listbox__value");
    if (
      !(button instanceof HTMLButtonElement) ||
      !(panel instanceof HTMLElement) ||
      !(value instanceof HTMLElement)
    ) {
      throw new Error("A picker needs a .listbox__button, a .listbox__panel and a .listbox__value");
    }

    this.root = root;
    /** The open set this picker belongs to — one per document, never module-wide. */
    this.openPickers = open;
    this.button = button;
    this.panel = panel;
    this.valueEl = value;
    this.open = false;

    /**
     * What the closed control shows when nothing is chosen. Read off the field rather than
     * off the rendered value, which is the *chosen* label whenever there is one.
     */
    this.placeholder = root.dataset.choicePlaceholder ?? "Choose…";

    /**
     * The option the keyboard is on, distinct from the selected one: you can walk a list and
     * leave without changing anything.
     * @type {HTMLElement | null}
     */
    this.active = null;

    /** Typeahead buffer, cleared after a pause. */
    this.typed = "";
    this.typedAt = 0;

    /**
     * Whether the list has moved since the pointer last did. A `pointerover` fires for a scroll
     * under a still hand too, and that took the selection straight back off the keyboard.
     */
    this.listMoved = false;

    /**
     * The value carrier the renderer emitted. It already holds the record's value, so the
     * control posts correctly whether or not anyone touches it.
     * @type {HTMLInputElement | null}
     */
    const scroll = root.querySelector(".listbox__scroll");
    if (!(scroll instanceof HTMLElement)) {
      throw new Error("A picker needs a .listbox__scroll for its options");
    }
    this.scroll = scroll;

    const carrier = root.querySelector("[data-choice-value]");
    if (!(carrier instanceof HTMLInputElement)) {
      throw new Error("A picker needs a [data-choice-value] to post its choice through");
    }
    this.field = carrier;

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

    this.#wire();
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

  /** Put the closed control and the carrier back in step with what is selected. */
  paint() {
    const option = this.selectedOption;
    const label = option ? optionLabel(option) : "";
    this.valueEl.textContent = label || this.placeholder;
    this.valueEl.classList.toggle("is-placeholder", !label);
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
    this.button.setAttribute("aria-expanded", "true");
    this.root.classList.add("is-open");
    this.anchor();
    this.#setActive(startAt ?? this.selectedOption ?? this.#step(null, 1));
  }

  /** @param {boolean} [refocus] */
  hide(refocus = true) {
    if (!this.open) return;
    this.open = false;
    this.origin = null;
    this.bounds = null;
    this.openPickers.delete(this);
    this.panel.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
    this.button.removeAttribute("aria-activedescendant");
    this.root.classList.remove("is-open");
    this.active?.classList.remove("is-active");
    this.active = null;
    // Per-opening state, cleared with the rest of it: a list disarmed by its last scroll
    // would otherwise open again with the pointer still not trusted.
    this.listMoved = false;
    if (refocus) this.button.focus();
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
    panel.style.width = "";
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
    const box = this.button.getBoundingClientRect();
    // A control scrolled out of its own form takes its panel with it: a list hanging where its
    // control is not visible has nothing to point at and covers whatever the form stands over.
    if (box.bottom <= bounds.top || box.top >= bounds.bottom) {
      this.hide(false);
      return;
    }

    const below = bounds.bottom - box.bottom - PANEL_GAP;
    const above = box.top - bounds.top - PANEL_GAP;
    const wanted = Math.min(this.scroll.scrollHeight + this.chrome, MAX_PANEL_HEIGHT);
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
    const height = Math.min(Math.max(room, MIN_SCROLL_HEIGHT + this.chrome), MAX_PANEL_HEIGHT);
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
    this.button.setAttribute("aria-activedescendant", option.id);
    if (reveal) this.#reveal(option);
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
      const option = optionFrom(event.target);
      if (!option) return;
      this.select(option);
      this.hide();
    });

    /*
     * Pointer-over sets the active option so the keyboard and the mouse never disagree: a list
     * showing two highlights has lost track of which one Enter will take.
     */
    this.panel.addEventListener("pointerover", (event) => {
      if (this.listMoved) return;
      const option = optionFrom(event.target);
      /* No reveal: the pointer is on the row already, so there is nowhere to bring it. */
      if (option && !isDisabled(option)) this.#setActive(option, false);
    });

    this.panel.addEventListener("pointermove", () => {
      this.listMoved = false;
    });

    this.scroll.addEventListener("scroll", () => {
      this.listMoved = true;
    });
  }
}

/**
 * Keep every open panel over the control it belongs to: scrolling the form moves the button.
 * Capture, because the scroll that matters is the inner scroller's and it does not bubble.
 *
 * @param {Document} root
 * @param {Set<ChoicePicker>} openPickers
 */
function watchPlacement(root, openPickers) {
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
  // is to close rather than place it somewhere guessed.
  root.defaultView?.addEventListener("resize", () => {
    for (const picker of [...openPickers]) picker.hide(false);
  });
}

/**
 * @param {{ top: number, left: number, right: number, bottom: number }} box
 * @param {number} by
 */
function inset(box, by) {
  return {
    top: box.top + by,
    left: box.left + by,
    right: box.right - by,
    bottom: box.bottom - by,
  };
}

/** @param {number} value @param {number} low @param {number} high */
function clamp(value, low, high) {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

/**
 * The box a fixed panel is actually painted inside — not its containing block, but any ancestor
 * up to it that both hides overflow and is positioned. A static scroller does not clip.
 *
 * @param {HTMLElement} panel
 */
export function clipBounds(panel) {
  const view = panel.ownerDocument.defaultView;
  let bounds = { top: 0, left: 0, right: view?.innerWidth ?? 0, bottom: view?.innerHeight ?? 0 };
  for (const node of clippingAncestors(panel)) {
    bounds = intersect(bounds, node.getBoundingClientRect());
  }
  return bounds;
}

/**
 * The ancestors that clip a fixed panel: those hiding their overflow, up to and including
 * the one that is its containing block.
 *
 * @param {HTMLElement} panel
 * @returns {HTMLElement[]}
 */
function clippingAncestors(panel) {
  const view = panel.ownerDocument.defaultView;
  /** @type {HTMLElement[]} */
  const clippers = [];
  for (let node = panel.parentElement; node; node = node.parentElement) {
    const style = view?.getComputedStyle(node);
    if (!style) break;
    // `translate`/`scale`/`rotate` make a containing block exactly as `transform` does, and a
    // dragged row carries a `translate` (design/styles/tokens.css).
    const containing =
      style.transform !== "none" ||
      style.filter !== "none" ||
      style.translate !== "none" ||
      style.scale !== "none" ||
      style.rotate !== "none";
    if (clips(style, containing)) clippers.push(node);
    if (containing) break;
  }
  return clippers;
}

/** @param {CSSStyleDeclaration} style @param {boolean} containing */
function clips(style, containing) {
  if (!containing && style.position === "static") return false;
  return style.overflowX !== "visible" || style.overflowY !== "visible";
}

/**
 * @param {{ top: number, left: number, right: number, bottom: number }} box
 * @param {DOMRect} other
 */
function intersect(box, other) {
  return {
    top: Math.max(box.top, other.top),
    left: Math.max(box.left, other.left),
    right: Math.min(box.right, other.right),
    bottom: Math.min(box.bottom, other.bottom),
  };
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
  for (const picker of pickers) {
    if (form.contains(picker.root)) picker.restore();
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

  /* A press anywhere else closes an open panel, without taking focus back from where the press
   * landed. Detached pickers are dropped rather than asked. */
  root.addEventListener("pointerdown", (event) => {
    const { target } = event;
    for (const picker of [...openPickers]) {
      if (!picker.root.isConnected) {
        openPickers.delete(picker);
        continue;
      }
      if (target instanceof Node && !picker.root.contains(target)) picker.hide(false);
    }
  });

  for (const finished of ["aluna:record-created", "aluna:create-cancelled"]) {
    root.addEventListener(finished, (event) => {
      const trigger = event.target;
      const form =
        trigger instanceof HTMLFormElement
          ? trigger
          : trigger instanceof Element
            ? Element.prototype.closest.call(trigger, "form")
            : null;
      if (form instanceof HTMLFormElement) resetChoiceControls(form, mounted);
    });
  }
}

if (typeof document !== "undefined") startChoiceControls(document);
