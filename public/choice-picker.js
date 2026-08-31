// @ts-check

/**
 * The choice controls that need a script — the drawn picker and the segmented row.
 *
 * `<select>` is a replaced element: the browser draws its popup itself and no stylesheet
 * reaches inside it, so on a surface whose every boundary is drawn the popup has to be
 * ours. The closed control stays a `<button>` (a real focus stop with a real accessible
 * name) and the panel is an ordinary drawn element. Ported from `design/scripts/listbox.js`,
 * which is the contract for every behavior here.
 *
 * Two consequences worth knowing before editing:
 *
 *   - **The panel does not cast a shadow.** What says it is in front is the frame hand
 *     plus the ordered fills — `surface` in front of the `surface-2` field it covers.
 *   - **The panel does not clip**, because the ink paints just outside the box it is drawn
 *     on. A long list scrolls one level in, at `.listbox__scroll`.
 *
 * Focus stays on the button throughout and the active option is reported through
 * `aria-activedescendant` — moving DOM focus into the panel would mean restoring it by
 * hand on all five exit paths.
 *
 * What the product adds to the design's version: the panel arrives server-rendered
 * complete, so the chosen label reads correctly before this runs; the value rides a
 * hidden input the renderer emitted rather than one this creates; and the radio group
 * needs nothing here at all, because native radio inputs already are the control.
 *
 * And where it now knowingly departs from it. The design's page is one static document
 * with one scroller; a desk is neither, and two of its behaviors do not survive the move:
 * the active row is revealed by scrolling the list alone rather than by `scrollIntoView`
 * (see `#reveal` below), and a row already active is not re-activated. Ported
 * unchanged, they fed each other through the placement watch below.
 */

/** The field a picker is drawn on, which is what both mounting and the arrival watch look for. */
const PICKER_SELECTOR = '[data-choice-presentation="picker"]';

/** The pattern's roving-focus keys, and what each one means for the panel. */
const OPEN_KEYS = new Set(["ArrowDown", "ArrowUp", "Enter", " ", "Home", "End"]);

/** The tallest the design lets a panel grow, and the shortest that is still a list. */
const MAX_PANEL_HEIGHT = 260;
const MIN_SCROLL_HEIGHT = 68;
/** The clearance between the control and the panel, and off the edge it is bounded by. */
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
 * What an option is *called*, as against everything written on its row. A row may carry a
 * trailing note, which belongs to the row and not to the value: it must not follow the
 * choice back onto the closed control, nor into typeahead, where it would make `c` match
 * a status called Paid.
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
 * The first option whose label starts with `needle`, searching forward from `start` and
 * wrapping. Null when nothing matches, which leaves the active row where it was rather
 * than moving it somewhere arbitrary.
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
     * The option the keyboard is on. Distinct from the selected one: you can walk a list
     * and leave without changing anything, which is the whole reason
     * `aria-activedescendant` exists as a separate idea from selection.
     * @type {HTMLElement | null}
     */
    this.active = null;

    /** Typeahead buffer, cleared after a pause. */
    this.typed = "";
    this.typedAt = 0;

    /**
     * Whether the list has moved since the pointer last did. A `pointerover` means "the
     * pointer is over something new", which is true of a scroll under a still hand as much
     * as of a hand that moved — and only one of those is somebody choosing. Without this,
     * arrowing down a list scrolls a row under a resting cursor and the cursor takes the
     * selection straight back off the keyboard.
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
   * Choose an option. A no-op selection still closes, but only a real change announces
   * itself — a `change` that fires when nothing changed is a `change` every listener has
   * to re-check.
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
   * Put the control back to what the server drew, carrier included — how a finished create
   * form gets its picker back. Not `form.reset()`'s job: the carrier is a hidden input,
   * whose `value` reflects its content attribute, so writing a choice through it rewrote
   * the very default a reset would restore. `data-choice-initial` is the truth instead.
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
   * Learn where the panel may live, then place it.
   *
   * Two different boxes, and conflating them is what put the panel over the window's title
   * bar with its first rows cut off.
   *
   * The first is where its coordinates start. A fixed box is normally anchored to the
   * viewport, but any transformed ancestor becomes its containing block instead — and a
   * desk window is dragged by `transform`, so in the product there always is one. So the
   * panel is parked filling its own containing block and asked where that landed.
   *
   * The second is how far it may reach, which is not the containing block: it is whatever
   * actually clips it ({@link clipBounds}). The window's *body* clips; the window, which
   * also holds the title bar, does not. Hanging a panel into the box it is measured
   * against but not the box it is drawn inside means the rows past the edge simply are not
   * painted.
   *
   * Neither can move while the panel is open — dragging a window starts with a press
   * outside it, which closes it — so a scroll only has to re-place, never re-anchor.
   */
  anchor() {
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
    // Inset by the same clearance the panel keeps from its control, so it reads as sitting
    // inside the frame rather than kissing it.
    this.bounds = inset(clipBounds(panel), PANEL_GAP);
    this.chrome = Math.max(panel.offsetHeight - this.scroll.offsetHeight, 0);
    this.place();
  }

  /**
   * Where the panel hangs: under the button, or over it when there is more room that way,
   * never outside the box that paints it, and never wider than the control it belongs to.
   * Measured off the *button* rather than the field, because the field also holds the
   * label and — from 5.10/03 — a line of guidance.
   *
   * A control scrolled out of its own form takes its panel with it. A list hanging where
   * the thing it belongs to is no longer visible has nothing to point at, and it would be
   * drawn over whatever the form is standing in front of.
   */
  place() {
    const { origin, bounds } = this;
    if (!origin || !bounds) return;
    const box = this.button.getBoundingClientRect();
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
   * Size the list to the room on the chosen side, then say where its top goes.
   *
   * Sized twice, because the two answers depend on each other: how tall the panel may be
   * decides where it starts, and a start clamped into the box can leave less room than the
   * side it was measured from. The second pass is what stops a list from running past the
   * edge when its control sits near one.
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
   * The next selectable option in `direction`, wrapping at the ends. Passing a null `from`
   * starts at the appropriate end, which is how "open onto the first item" and "open onto
   * the last item" are the same call.
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
   * Move the active row.
   *
   * Re-activating the row that is already active is not free and not harmless: `pointerover`
   * fires again every time the pointer crosses into a child of the row it is already on, and
   * again after any scroll moves the list under a still pointer. Doing the work only when the
   * row actually changes is what keeps a hover from feeding itself — and it is what stops a
   * key that moves nowhere from dragging a hand-scrolled list back, which is the same
   * control fighting the same user by another route.
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
   * Bring a row into the list, by one row's worth and scrolling nothing but the list.
   *
   * `scrollIntoView({ block: "nearest" })` says the same thing and then keeps going: it
   * scrolls *every* scrollable ancestor that would help, so revealing a row also nudged the
   * form the control stands in. That moved the button, which re-placed the panel, which put
   * a different row under a pointer that had not moved — and that row asked to be revealed.
   * The list is the only box that owes the active row anything.
   *
   * @param {HTMLElement} option
   */
  #reveal(option) {
    const list = this.scroll;
    const box = list.getBoundingClientRect();
    const row = option.getBoundingClientRect();
    // The scrollport, not the border box: they differ by exactly the scrollbars, and a note
    // long enough to bring out a horizontal one would otherwise leave the last row parked
    // underneath it. Both axes, because a row can be off the side for the same reason.
    const top = box.top + list.clientTop;
    const left = box.left + list.clientLeft;
    const was = { top: list.scrollTop, left: list.scrollLeft };

    if (row.top < top) list.scrollTop -= top - row.top;
    else if (row.bottom > top + list.clientHeight)
      list.scrollTop += row.bottom - top - list.clientHeight;
    if (row.left < left) list.scrollLeft -= left - row.left;
    else if (row.right > left + list.clientWidth)
      list.scrollLeft += row.right - left - list.clientWidth;

    // Said here rather than left to the `scroll` event, which arrives on a later frame —
    // by which time the `pointerover` this is meant to disarm has already been answered.
    if (list.scrollTop !== was.top || list.scrollLeft !== was.left) this.listMoved = true;
  }

  /**
   * Jump to the next option starting with what was typed. Repeated presses of the same
   * letter cycle through the options beginning with it, which is what every native list
   * does and the only reason single-letter typeahead is usable at all.
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
   * Closed: the six keys that open, and nothing else. `End` opens onto the last option
   * rather than the first, which is the one asymmetry in the pattern and the reason this
   * is not simply `show()`.
   *
   * @param {KeyboardEvent} event
   */
  #keyWhileClosed(event) {
    if (!OPEN_KEYS.has(event.key)) return;
    event.preventDefault();
    this.show(event.key === "End" ? this.#step(null, -1) : undefined);
  }

  /**
   * Open: leave, commit, walk, or type. Nothing here selects by moving — walking the list
   * changes what is *active*, and only Enter changes what is chosen, so arrowing past an
   * option never commits it by accident.
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
     * Pointer-over sets the active option so the keyboard and the mouse never disagree
     * about where you are — a list showing two highlights is a list that has lost track of
     * which one Enter will take.
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
 * Keep every open panel over the control it belongs to. A viewport-positioned panel is
 * the price of not being clipped by the form's scroller, and this is the rest of that
 * bargain: scrolling the form moves the button, so the panel has to follow it. Capture,
 * because the scroll that matters is the inner scroller's and it does not bubble.
 *
 * A panel's *own* list is the one scroller this owes nothing to. Placement re-measures the
 * button and then re-caps the list's height, so answering the list's own scroll meant
 * resizing the box the user was scrolling, mid-scroll, on every frame of it.
 *
 * @param {Document} root
 * @param {Set<ChoicePicker>} openPickers
 */
function watchPlacement(root, openPickers) {
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
  // A resize can move the containing block the panel was measured against, so the honest
  // answer is to close rather than to place it somewhere guessed.
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
 * The box a fixed panel is actually painted inside.
 *
 * Exported so it can be pinned directly: what it answers is a walk over computed styles,
 * and the placement it feeds is arithmetic over measurements a document double cannot
 * honestly supply. Proving the walk where the walk lives is the only way it is proved.
 *
 * Not its containing block: a transformed ancestor decides where its coordinates start,
 * while what clips it is any ancestor up to and including that one which both hides its
 * overflow *and* is positioned. On the desk that is the window's body — which begins below
 * the title bar, where the containing block does not. The form's own scroller is static, so
 * it does not clip the panel, which is the whole reason the panel is fixed.
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
    const containing = style.transform !== "none" || style.filter !== "none";
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
  // The arrival watch hands this the node that landed, which is as often the field itself
  // as a form holding one — `querySelectorAll` answers about descendants and not about it.
  if (root instanceof Element && root.matches(PICKER_SELECTOR)) found.unshift(root);
  return found
    .filter((el) => el instanceof HTMLElement)
    .filter((el) => !el.dataset.choicePickerMounted)
    .map((el) => {
      // Flagged after, not before: a field that refuses would otherwise be marked as
      // mounted on its way out and never be offered a script again.
      const picker = new ChoicePicker(el, open);
      el.dataset.choicePickerMounted = "true";
      return picker;
    });
}

/**
 * Mount every picker that arrives, however it arrives.
 *
 * htmx's landing events were the whole of this, and they are not the fact underneath —
 * they are one way of causing it. A record view is cloned out of a `<template>` and put in
 * place by `record-view.js` itself, so no landing is announced and the edit form's picker
 * used to stand there dead: it opened on a fresh record and refused every one after.
 * What every picker actually waits for is its field entering the document, and that is what
 * an observer reports, whoever put it there.
 *
 * @param {Document} root
 * @param {(nodes: readonly Element[]) => void} arrived
 */
function watchArrivals(root, arrived) {
  const Observer = root.defaultView?.MutationObserver;
  if (!Observer) return;
  new Observer((records) => {
    const added = addedElements(records);
    if (added.length > 0) arrived(added);
  }).observe(root, { childList: true, subtree: true });
}

/**
 * Every element one batch of mutations put in the tree. Text and comment nodes are not
 * asked about: a picker is a field, and a field is an element.
 *
 * @param {readonly MutationRecord[]} records
 * @returns {Element[]}
 */
function addedElements(records) {
  /** @type {Element[]} */
  const added = [];
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node instanceof Element) added.push(node);
    }
  }
  return added;
}

/**
 * Press one segment. The row is a plain exclusive button set, so this is the whole of its
 * behavior: one pressed value, written through to the carrier the form posts. Ordinary
 * button keyboard activation does the rest — Enter and Space press a `<button>` already,
 * and every segment is its own tab stop.
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
 * Say a choice moved, the way a form control says it: a bubbling `change` on the input
 * that carries the value. A custom event on the field would be a seam only code written
 * for this control could use; `change` on the carrier is the one every form already knows,
 * and it is what 5.10/04's required check will hear.
 *
 * @param {HTMLInputElement | null} carrier
 */
function announceChange(carrier) {
  carrier?.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Put every drawn choice control in one form back to what the server rendered.
 *
 * `form.reset()` covers the radio group, whose real inputs restore from their `checked`
 * attributes. It reaches neither of the other two: not the button text a picker shows nor
 * the pressed segment, because neither is an input — and not even their carriers, because
 * a hidden input's value *is* its content attribute, so a reset restores whatever was last
 * written through it. Both are put back from `data-choice-initial` instead.
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
 * Wire the drawn choice controls onto a document.
 *
 * Mounting is repeated after every htmx landing because the forms these live in arrive
 * long after page load, and a per-form script tag would have to be written into every one
 * of them. The segment press is delegated for the same reason.
 *
 * @param {Document} root
 */
export function startChoiceControls(root) {
  /** @type {ChoicePicker[]} */
  const mounted = [];
  /**
   * The pickers standing open on *this* document. Held here rather than module-wide: two
   * documents sharing one set would let a press on either close the other's panel, and a
   * picker whose form was swapped away would sit in it until something unrelated pruned it.
   * @type {Set<ChoicePicker>}
   */
  const openPickers = new Set();

  /**
   * Drop the pickers whose form has been swapped away, rather than accumulating them: this
   * list outlives every form it holds, and a desk is open for a long time. A detached one
   * that was standing open is closed on the way out, which is what takes it off
   * `openPickers` and lets the subtree it was holding go.
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
   * Mount what arrived. Once per batch rather than once per node, because a single swap
   * lands its children one at a time and every one of them would otherwise pay for a walk
   * of the whole list.
   *
   * A field that refuses to mount is a real failure and still says so — but it says so
   * after every field that arrived beside it has been given its script, rather than taking
   * them all down with it.
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

  /* A press anywhere else closes an open panel, without taking focus back from wherever
   * the press landed. Detached pickers are dropped rather than asked. */
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
