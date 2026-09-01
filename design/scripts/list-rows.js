// @ts-check

/**
 * The repeated-value list — the rows a `string[]` field is typed into, and the order they
 * are in.
 *
 * The wire has no notion of a list. Every row posts under the same field name and the order
 * they arrive in is the order they are in, so moving a row means moving the row: relabelling
 * one would leave the value the person can see and the value the server reads disagreeing
 * about their order.
 *
 * **One movement, driven two ways.** A row is dragged by its grip, and the same grip picks
 * the row up for the keyboard: space to take it, the arrow keys to move it, space to put it
 * down, escape to put it back. Both paths spend the same `placeAt` and the same announcement,
 * so the two cannot drift into behaving differently — which is the failure a second
 * implementation for the keyboard always ends in.
 *
 * A drag alone would not do. It is invisible until you try it, unavailable to a keyboard and
 * awkward on a touchscreen, and the order here is part of the value rather than a view of it.
 *
 * Structural and stateless between gestures apart from the one row being held: a field
 * carries its own identity in `data-` attributes and its rows are its children, so every rule
 * is a function of the DOM it is handed. That is what lets the host — the design page or the
 * product's shell — own the delegation around it.
 */

/** What a row and its parts are asked for by. */
const ROW = "[data-list-field-row]";
const GRIP = "[data-list-field-grip]";
const REMOVE = "[data-list-field-remove]";
const ADD = "[data-list-field-add]";
const LIVE = "[data-list-field-live]";

/** Every hook a plain press can land on, so one delegated listener covers the field. */
export const LIST_ROW_PRESS_SELECTOR = `${ADD}, ${REMOVE}`;

/**
 * The row currently held, and how. Exactly one, because a person has one pointer and one
 * focus — a second grab would be a row nobody could put down.
 *
 * @typedef {{ field: HTMLElement, values: HTMLElement, row: HTMLElement, grip: HTMLElement,
 *             from: number, byKey: boolean }} Held
 */
/** @type {Held | null} */
let held = null;

/**
 * A drag in flight, measured once when it starts.
 *
 * Nothing in the document moves while a finger is down. The row being dragged is translated
 * to follow the pointer and the rows it passes are translated out of its way, so the whole
 * gesture is displacement over a list that has not changed — the DOM is reordered exactly
 * once, when the row is let go. That is what makes the row look picked up rather than
 * teleported between slots, and it also means the ink system is never asked to redraw a
 * boundary mid-drag.
 *
 * @typedef {{ rows: HTMLElement[], from: number, pitch: number, startY: number,
 *             target: number }} Drag
 */
/** @type {Drag | null} */
let drag = null;

/**
 * True only while a move of our own is in flight.
 *
 * Moving a row takes it out of the document and puts it back, and that blurs whatever
 * inside it had focus — which, on the keyboard path, is the grip driving the move. The blur
 * is our own doing rather than the person leaving, so it must not be read as one: without
 * this the first arrow press would drop the row it had just picked up.
 */
let settling = false;

/**
 * The field a control belongs to, and the box its rows sit in.
 * @param {Element} control
 */
function fieldOf(control) {
  const field = control.closest("[data-list-field]");
  if (!(field instanceof HTMLElement)) return null;
  const values = field.querySelector("[data-list-field-values]");
  if (!(values instanceof HTMLElement)) return null;
  return { field, values };
}

/** @param {Element} row */
function inputOf(row) {
  const input = row.querySelector("input");
  return input instanceof HTMLInputElement ? input : null;
}

/** @param {Element} values */
const rowsOf = (values) => [...values.querySelectorAll(ROW)];

/**
 * Put a row at a position among its siblings. The one primitive both the drag and the
 * arrow keys spend, so there is one answer to what moving a row means.
 *
 * @param {HTMLElement} values
 * @param {HTMLElement} row
 * @param {number} index where it should land, counted among the *other* rows
 */
function placeAt(values, row, index) {
  const others = rowsOf(values).filter((one) => one !== row);
  const bounded = Math.max(0, Math.min(index, others.length));
  const before = others[bounded];
  // Moved rather than re-laid: only the one row's position changes, so the ink system is
  // not asked to unmount and remount every drawn element in the field to reorder two.
  if (before instanceof HTMLElement) before.before(row);
  else values.append(row);
}

/**
 * Where a row sits now, counted among all of them.
 * @param {Element} values
 * @param {Element} row
 */
const indexOf = (values, row) => rowsOf(values).indexOf(row);

/**
 * What the live region says about a row being moved.
 *
 * Built here rather than carried on the markup, the way the length counter's sentence is
 * (`public/long-text-field.js`): the server never paints one of these, so there is no first
 * frame for it to disagree with. Every row is named by its position, which is what
 * `nameListRow` calls it, so a person hears the row by the same name they would read.
 *
 * @param {"grabbed" | "moved" | "dropped" | "returned"} what
 * @param {string} label
 * @param {number} position
 * @param {number} total
 */
export function reorderSentence(what, label, position, total) {
  const where = `${label} ${position} of ${total}`;
  if (what === "grabbed") {
    return `${where}, grabbed. Use the arrow keys to move it, space to drop it, escape to put it back.`;
  }
  if (what === "dropped") return `${where}, dropped.`;
  if (what === "returned") return `${where}, put back.`;
  return `${where}.`;
}

/**
 * Say something about the row being moved, once.
 *
 * `aria-live` on a region that is already in the document, rather than one written on
 * arrival: a region added and filled in the same turn is a region a screen reader has not
 * started watching yet, and the announcement is lost.
 *
 * @param {HTMLElement} field
 * @param {"grabbed" | "moved" | "dropped" | "returned"} what
 */
function announce(field, what) {
  const live = field.querySelector(LIVE);
  const values = field.querySelector("[data-list-field-values]");
  if (!(live instanceof HTMLElement) || !(values instanceof HTMLElement) || !held) return;
  const rows = rowsOf(values);
  const label = field.dataset.listFieldLabel ?? "Value";
  live.textContent = reorderSentence(what, label, rows.indexOf(held.row) + 1, rows.length);
}

/**
 * Say that the field changed.
 *
 * A structural edit is an edit: removing the duplicated row a refusal named is the
 * correction that refusal asked for. But a removed node and `input.value = ""` fire nothing,
 * and `public/field-errors.js` clears a marked field on `input` — so without this a field
 * would keep a sentence it had already answered until an unrelated character was typed.
 *
 * @param {HTMLElement} field
 */
function announceListChange(field) {
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/* ── Picking a row up, moving it, putting it down ─────────────────────────── */

/**
 * Take hold of a row. Idempotent: a second grab while one is standing is the first one
 * still standing, so nothing can end up held by two gestures at once.
 *
 * @param {HTMLElement} grip
 * @param {boolean} byKey whether the arrow keys are driving, which is what gets announced
 */
function grab(grip, byKey) {
  const row = grip.closest(ROW);
  const found = fieldOf(grip);
  if (!found || !(row instanceof HTMLElement)) return null;
  // A hold whose row is no longer anywhere, or that belongs to another field, is a gesture
  // that ended without saying so — a form swapped out from under a drag is the way that
  // happens. Let go of it rather than refusing every grab from here on.
  if (held && (held.field !== found.field || !held.row.isConnected)) abandon();
  // Reaching for a second row is putting the first one down. Refusing the press instead
  // would be the one thing a person cannot see: a grip that answers nothing, because a row
  // they may have forgotten they were holding is still in hand.
  if (held && held.grip !== grip) release("dropped");
  if (held) return held;
  if (rowsOf(found.values).length < 2) return null;

  held = { ...found, row, grip, from: indexOf(found.values, row), byKey };
  row.classList.add("is-grabbed");
  grip.setAttribute("aria-pressed", "true");
  if (byKey) announce(found.field, "grabbed");
  return held;
}

/**
 * Let go of a row without saying anything: the gesture holding it is gone rather than
 * finished, so there is nobody the announcement would be for.
 */
function abandon() {
  if (!held) return;
  if (drag) {
    clearDrag(drag);
    drag = null;
  }
  held.row.classList.remove("is-grabbed");
  held.grip.removeAttribute("aria-pressed");
  held.field.classList.remove("is-dragging");
  held = null;
}

/**
 * Put the row down where it now is. The refusal to clear the field's error unless the order
 * actually changed is what keeps a grab-and-drop that moved nothing from reading as an edit.
 *
 * @param {"dropped" | "returned"} how
 */
function release(how) {
  if (!held) return;
  const { field, values, row, grip, from, byKey } = held;
  // Nothing to put down or put back: the row is not in the list any more.
  if (indexOf(values, row) === -1) {
    abandon();
    return;
  }
  if (how === "returned") {
    settling = true;
    placeAt(values, row, from);
    grip.focus();
    settling = false;
  }
  syncListRows(field);
  if (byKey || how === "returned") announce(field, how);
  row.classList.remove("is-grabbed");
  grip.removeAttribute("aria-pressed");
  const moved = indexOf(values, row) !== from;
  held = null;
  if (moved) announceListChange(field);
}

/**
 * Move the held row one place. Used by the arrow keys; the pointer path aims at a position
 * instead, because a pointer says where it is rather than which way it went.
 *
 * @param {number} step
 */
function nudge(step) {
  if (!held) return;
  const at = indexOf(held.values, held.row);
  // The row has left the list under the gesture holding it — a collapse, or a swap. Moving
  // it now would put a removed row back, so the hold ends instead.
  if (at === -1) {
    abandon();
    return;
  }
  const to = at + step;
  if (to < 0 || to >= rowsOf(held.values).length) return;
  settling = true;
  placeAt(held.values, held.row, to);
  syncListRows(held.field);
  // The grip travelled with its row and lost the focus on the way. It takes it straight
  // back, so the next arrow press reaches the same control and the row stays in hand.
  held.grip.focus();
  settling = false;
  announce(held.field, "moved");
}

/* ── The drag itself ──────────────────────────────────────────────────────── */

/**
 * Measure the list once, at the moment a finger goes down.
 *
 * Every number the drag needs comes from here and nothing re-measures while it runs: the
 * rows are not moving, so a second measurement would only read back the displacements this
 * code has already applied.
 *
 * @param {HTMLElement} values
 * @param {HTMLElement} row
 * @param {number} startY
 * @returns {Drag | null}
 */
function measureDrag(values, row, startY) {
  const rows = rowsOf(values).filter((one) => one instanceof HTMLElement);
  const from = rows.indexOf(row);
  if (from === -1 || rows.length < 2) return null;
  const boxes = rows.map((one) => one.getBoundingClientRect());
  // The pitch is one row plus the gap under it — the distance a row travels to change
  // places with its neighbour, which is the only length the shifts below are counted in.
  const pitch = (boxes[1]?.top ?? 0) - (boxes[0]?.top ?? 0);
  return { rows, from, pitch, startY, target: from };
}

/**
 * Where the dragged row would land for a pointer this far from where it started.
 *
 * Counted from the row's own centre against the resting centres of the others, so the
 * answer changes when the row has visibly travelled past a neighbour rather than when the
 * pointer has. Dragging by the bottom of a row and dragging by the top then behave the same.
 *
 * @param {Drag} state
 * @param {number} dy
 */
function targetFor(state, dy) {
  const centre = (state.from + 0.5) * state.pitch + dy;
  let landing = 0;
  state.rows.forEach((_, index) => {
    if (index === state.from) return;
    if ((index + 0.5) * state.pitch < centre) landing += 1;
  });
  return landing;
}

/**
 * Put every row where the drag says it should appear to be.
 *
 * The dragged row follows the pointer exactly. Every other row is translated by the whole
 * slots it has to give up or take on, which opens a gap under the finger and closes the one
 * the row came from.
 *
 * @param {Drag} state
 * @param {number} dy
 */
function paintDrag(state, dy) {
  let seen = 0;
  state.rows.forEach((row, index) => {
    if (index === state.from) {
      row.style.translate = `0 ${dy}px`;
      return;
    }
    // Where this row sits now, and where it would sit once the dragged row lands.
    const amongOthers = seen++;
    const settled = amongOthers < state.target ? amongOthers : amongOthers + 1;
    const slots = settled - index;
    row.style.translate = slots === 0 ? "" : `0 ${slots * state.pitch}px`;
  });
}

/**
 * Take every displacement back off, whether the drag ended or was cancelled.
 * @param {Drag} state
 */
function clearDrag(state) {
  for (const row of state.rows) row.style.translate = "";
}

/* ── Adding and removing ──────────────────────────────────────────────────── */

/**
 * Add a row after the last one, copying the first for its shape and clearing its value.
 * @param {Element} button
 */
export function addListRow(button) {
  const found = fieldOf(button);
  const firstRow = found?.values.querySelector(ROW);
  if (!found || !firstRow) return;

  const row = firstRow.cloneNode(true);
  if (!(row instanceof HTMLElement)) return;
  // A clone carries the drawn layers of the row it came from, and the ink system keys what
  // it has already mounted on the element itself — so it does not recognise the copy and
  // draws it a second pair. Two boxes, and the stale ones keep the width the row had when
  // it was copied.
  for (const layer of row.querySelectorAll(".ink__ground, .ink__layer")) layer.remove();
  // The seed goes with the layers. `mountInk` takes `data-ink-seed` if it finds one, so a
  // clone that kept it is redrawn with the hand of the row it was copied from — two rows
  // carrying the same squiggle, which is the one thing a hand per element rules out.
  for (const drawn of [row, ...row.querySelectorAll("[data-ink-seed]")]) {
    drawn.removeAttribute("data-ink-seed");
  }
  row.classList.remove("is-grabbed");
  const input = inputOf(row);
  if (input) input.value = "";
  found.values.append(row);
  syncListRows(found.field);
  announceListChange(found.field);
  input?.focus();
}

/**
 * Take a row away, or empty it when it is the only one: a field with no row cannot be typed
 * into and nothing puts one back. Focus lands on the row that took its place, or on the last
 * row when the one removed was last.
 * @param {Element} button
 */
export function removeListRow(button) {
  const found = fieldOf(button);
  const row = button.closest(ROW);
  if (!found || !(row instanceof HTMLElement)) return;
  // A row cannot be taken out from under a gesture that is holding it.
  if (held?.row === row) release("returned");

  const rows = rowsOf(found.values);
  const index = rows.indexOf(row);
  if (rows.length === 1) {
    const input = inputOf(row);
    if (input) input.value = "";
    announceListChange(found.field);
    input?.focus();
    return;
  }
  row.remove();
  syncListRows(found.field);
  announceListChange(found.field);
  const surviving = rowsOf(found.values);
  const landing = surviving[Math.min(index, surviving.length - 1)];
  if (landing) inputOf(landing)?.focus();
}

/* ── Naming the rows ──────────────────────────────────────────────────────── */

/**
 * One row's positional identity: the id its label points at, and the accessible name of the
 * input, of its grip and of its remove.
 * @param {Element} row
 * @param {{ label: string, inputId: string, position: number, total: number }} at
 */
function nameListRow(row, at) {
  const input = inputOf(row);
  if (input) {
    input.id = `${at.inputId}-${at.position}`;
    input.setAttribute("aria-label", `${at.label} ${at.position}`);
  }
  const grip = row.querySelector(GRIP);
  // The grip says what it holds and where it is, because "reorder" on its own is the same
  // words on every row of the list.
  grip?.setAttribute("aria-label", `Reorder ${at.label} ${at.position} of ${at.total}`);
  // Nothing to reorder in a list of one, and a control that cannot act says so.
  if (at.total < 2) grip?.setAttribute("disabled", "");
  else grip?.removeAttribute("disabled");
  row.querySelector(REMOVE)?.setAttribute("aria-label", `Remove ${at.label} value ${at.position}`);
}

/**
 * Row identity is positional, so it is restated after every add, move and remove.
 * @param {HTMLElement} field
 */
export function syncListRows(field) {
  const label = field.dataset.listFieldLabel ?? "Value";
  const inputId = field.dataset.listInputId ?? "list-value";
  const rows = [...field.querySelectorAll(ROW)];

  rows.forEach((row, index) => {
    nameListRow(row, { label, inputId, position: index + 1, total: rows.length });
  });
}

/* ── The gestures ─────────────────────────────────────────────────────────── */

/**
 * Answer one press. The dispatcher is the only thing standing between two controls that do
 * different things, so it asks for each by its own hook rather than by elimination.
 * @param {EventTarget | null} target
 */
export function pressListRow(target) {
  if (!(target instanceof Element)) return;
  const button = target.closest(LIST_ROW_PRESS_SELECTOR);
  if (!(button instanceof HTMLButtonElement) || button.hasAttribute("disabled")) return;
  if (button.hasAttribute("data-list-field-add")) addListRow(button);
  else removeListRow(button);
}

/**
 * A drag begins on the grip and nowhere else, so the text in a row stays selectable.
 * @param {PointerEvent} event
 */
export function startListDrag(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const grip = target.closest(GRIP);
  if (!(grip instanceof HTMLElement) || grip.hasAttribute("disabled")) return;
  const taken = grab(grip, false);
  if (!taken) return;
  const measured = measureDrag(taken.values, taken.row, event.clientY);
  if (!measured) {
    release("dropped");
    return;
  }
  drag = measured;
  // The pointer is captured so the drag survives leaving the row, and the default is
  // refused so it does not become a text selection or a native image drag instead.
  event.preventDefault();
  taken.field.classList.add("is-dragging");
  // Capture is an improvement on the drag, not a condition of it: it throws outright if the
  // pointer it names has already gone, and a drag that never started because of that would
  // leave a row held with no gesture holding it. The delegated `pointermove` on the document
  // is what the drag actually runs on either way.
  try {
    grip.setPointerCapture?.(event.pointerId);
  } catch {
    /* Uncaptured, and still dragged. */
  }
}

/** @param {PointerEvent} event */
export function dragListRow(event) {
  if (!held || held.byKey || !drag) return;
  const dy = event.clientY - drag.startY;
  drag.target = targetFor(drag, dy);
  paintDrag(drag, dy);
}

/**
 * Let the row go where it appears to be.
 *
 * The displacements come off and the one DOM move goes in, in that order — the row is already
 * drawn in its landing slot, so putting it there for real is the frame nothing moves in.
 *
 * @param {PointerEvent} [event]
 */
export function endListDrag(event) {
  if (!held || held.byKey || !drag) return;
  const { grip, field, values, row } = held;
  try {
    if (event) grip.releasePointerCapture?.(event.pointerId);
  } catch {
    /* Never captured, so there is nothing to give back. */
  }
  const landing = drag.target;
  clearDrag(drag);
  drag = null;
  field.classList.remove("is-dragging");
  placeAt(values, row, landing);
  release("dropped");
}

/**
 * The keyboard's half of the same gesture: space takes the row, the arrows move it, space
 * puts it down, escape puts it back.
 *
 * A mode, deliberately, and every way out of it is covered — dropping, cancelling, tabbing
 * away and losing focus. A row nobody can put down is the one failure this pattern has.
 *
 * @param {KeyboardEvent} event
 */
export function keyListRow(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const grip = target.closest(GRIP);
  if (!(grip instanceof HTMLElement) || grip.hasAttribute("disabled")) return;
  const holding = held?.grip === grip ? held : null;

  // Space scrolls the page and Enter submits the form; neither is what this press means.
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    if (holding) release("dropped");
    else grab(grip, true);
    return;
  }
  if (holding) whileHolding(event);
}

/**
 * What the keys do once a row is in hand. Split from the press above because the two are
 * different subjects: that one decides whether a row is held, and this one is what holding
 * it means.
 *
 * @param {KeyboardEvent} event
 */
function whileHolding(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    release("returned");
    return;
  }
  const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
  if (step === 0) return;
  // The arrows scroll a page, and while a row is held they move the row instead.
  event.preventDefault();
  nudge(step);
}

/**
 * Leaving the grip while holding a row puts it down where it is. Tab and a click elsewhere
 * both land here, which is what makes every way out of the mode a way out.
 * @param {FocusEvent} event
 */
export function blurListRow(event) {
  const target = event.target;
  if (!held?.byKey || settling || !(target instanceof Element)) return;
  if (target.closest(GRIP) !== held.grip) return;
  // Belt and braces for an engine that defers the blur past `settling`: focus already back
  // on the grip is the move's own blur arriving late, not the person going somewhere.
  if (held.grip.ownerDocument?.activeElement === held.grip) return;
  release("dropped");
}

/**
 * Every list field on a root, put into the state its row count implies. A page that ships its
 * rows in the markup has the naming right already; one whose rows arrived from a template, or
 * were authored by hand, gets it here.
 * @param {ParentNode} root
 */
export function mountListRows(root) {
  for (const field of root.querySelectorAll("[data-list-field]")) {
    if (field instanceof HTMLElement) syncListRows(field);
  }
}

/**
 * The DOM fact this needs — a root to listen on. Structural on purpose, so the gestures can
 * be exercised without a browser.
 *
 * @typedef {{ addEventListener?: (type: string, listener: (event: Event) => void) => void }} ListRowRoot
 */

/**
 * Every gesture the rows answer, wired onto one root. Delegated, because the forms these
 * live in are swapped in long after page load and a per-form script tag would have to be
 * written into every one of them.
 *
 * @param {ListRowRoot} root
 */
export function wireListRows(root) {
  // Cast at the seam rather than typing the root by event name: a root is anything with an
  // `addEventListener`, which is what lets these rules be exercised without a browser, and
  // the handlers below are the ones that know which event they were given.
  const on = (/** @type {string} */ type, /** @type {(event: never) => void} */ handler) =>
    root.addEventListener?.(type, /** @type {(event: Event) => void} */ (handler));

  on("click", (/** @type {Event} */ event) => pressListRow(event.target));
  on("pointerdown", startListDrag);
  on("pointermove", dragListRow);
  on("pointerup", endListDrag);
  on("pointercancel", endListDrag);
  on("keydown", keyListRow);
  on("focusout", blurListRow);
}
