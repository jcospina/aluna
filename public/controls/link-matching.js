// @ts-check

/**
 * What the page does while Aluna matches the names a field already holds. The press's answer
 * comes in lines: the note once the pair is admitted under the lease, so
 * nothing fades while the press only waits its turn, then the report once the relation and its
 * link rows are written. Meanwhile no save can land anywhere on the desk, so every chain fades with
 * every Save and Delete, those of a form opened meanwhile too, and one note atop the form pressed
 * says what is being connected. Cancel and the fields still work.
 */

/** The buttons a save or a link would go through, which fade while names are matched. */
const FADED_SELECTORS = [
  ".link-control__button",
  ".linked-field__unlink",
  '.capability-create-form button[type="submit"]',
  '.capability-edit-form button[type="submit"]',
  '[data-record-delete-form] button[type="submit"]',
  "[data-record-delete]",
];

/** What a button faded here carries, so only those are given back. */
const FADED_ATTRIBUTE = "data-link-faded";

export const NOTE_CLASS = "link-control__note";

/**
 * Per document, how many fields are being matched.
 * @type {WeakMap<Document, number>}
 */
const matching = new WeakMap();

/**
 * Per form, its note and how many fields pressed in it are being matched: two share one note.
 * @type {WeakMap<Element, { note: HTMLElement, count: number, writing: ReturnType<typeof setTimeout> }>}
 */
const notes = new WeakMap();

/**
 * The lines of a press's answer, each read whole as it arrives. `null` once the answer ends or
 * breaks off, which is all a broken connection can say.
 *
 * @param {Response} response
 * @returns {() => Promise<Record<string, unknown> | null>}
 */
export function answerLines(response) {
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let held = "";
  const lastLine = () => {
    const line = held + decoder.decode();
    held = "";
    return line === "" ? null : line;
  };
  /** The next whole line, the last one even with no line break after it, or null at the end. */
  const nextLine = async () => {
    let end = held.indexOf("\n");
    while (end === -1) {
      const chunk = await reader?.read().catch(() => null);
      if (!chunk || chunk.done) return lastLine();
      held += decoder.decode(chunk.value, { stream: true });
      end = held.indexOf("\n");
    }
    const line = held.slice(0, end);
    held = held.slice(end + 1);
    return line;
  };
  return async () => {
    for (let line = await nextLine(); line !== null; line = await nextLine()) {
      const read = parsed(line);
      if (read) return read;
    }
    return null;
  };
}

/** @param {string} line */
function parsed(line) {
  try {
    const value = JSON.parse(line);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Fade what would save or link at `root` and under it, if a field of its page is being matched.
 * Called for whatever lands on the page, so a form opened meanwhile fades too.
 *
 * @param {Document | Element} root
 */
export function fadeWhileMatching(root) {
  const doc = root instanceof Element ? root.ownerDocument : root;
  if ((matching.get(doc) ?? 0) === 0) return;
  const at = (/** @type {string} */ selector) =>
    root instanceof Element && root.matches(selector) ? [root] : [];
  const found = FADED_SELECTORS.flatMap((selector) => [
    ...at(selector),
    ...root.querySelectorAll(selector),
  ]);
  for (const button of found) {
    if (!(button instanceof HTMLButtonElement) || button.disabled) continue;
    button.disabled = true;
    button.setAttribute(FADED_ATTRIBUTE, "");
  }
}

/**
 * Whether a save that ends while names are matched keeps its button faded: it is then given back
 * with the others, once the last field is matched.
 *
 * @param {HTMLButtonElement} button
 */
export function heldWhileMatching(button) {
  if ((matching.get(button.ownerDocument) ?? 0) === 0) return false;
  button.setAttribute(FADED_ATTRIBUTE, "");
  return true;
}

/**
 * Hold the page while the field pressed in `form` is matched, until the returned function is
 * called. Focus standing on a button that fades goes to `field`, the dropdown being connected, and
 * once the last field on the page is matched, focus left nowhere lands there too.
 *
 * @param {Element | null} form
 * @param {string} sentence
 * @param {HTMLElement | null} field
 * @returns {() => void}
 */
export function holdWhileMatching(form, sentence, field) {
  const doc = form?.ownerDocument ?? field?.ownerDocument;
  if (!doc) return () => {};
  const active = doc.activeElement;
  matching.set(doc, (matching.get(doc) ?? 0) + 1);
  fadeWhileMatching(doc);
  if (active instanceof HTMLElement && active.hasAttribute(FADED_ATTRIBUTE)) field?.focus();
  const leaveNote = form ? noteAtop(form, sentence) : () => {};
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    leaveNote();
    const left = (matching.get(doc) ?? 1) - 1;
    matching.set(doc, left);
    if (left > 0) return;
    giveBack(doc);
    if (doc.activeElement === null || doc.activeElement === doc.body) field?.focus();
  };
}

/**
 * Every faded button back, but those of a form whose save is still out: its own end gives them
 * back (`giveBackAfterSave`).
 * @param {Document | Element} root
 */
function giveBack(root) {
  for (const button of root.querySelectorAll(`[${FADED_ATTRIBUTE}]`)) {
    if (button.closest("form")?.getAttribute("aria-busy") === "true") continue;
    button.removeAttribute(FADED_ATTRIBUTE);
    if (button instanceof HTMLButtonElement) button.disabled = false;
  }
}

/**
 * A save in `form` has ended: what faded while it was out comes back, unless names are still
 * being matched, whose end gives it back.
 *
 * @param {Element} form
 */
export function giveBackAfterSave(form) {
  if ((matching.get(form.ownerDocument) ?? 0) === 0) giveBack(form);
}

/**
 * The note atop `form`, until the returned function is called as often as this was.
 *
 * @param {Element} form
 * @param {string} sentence
 * @returns {() => void}
 */
function noteAtop(form, sentence) {
  const standing = notes.get(form);
  if (standing) {
    standing.count += 1;
    standing.note.textContent = sentence;
  } else {
    const note = form.ownerDocument.createElement("p");
    note.className = NOTE_CLASS;
    note.setAttribute("role", "status");
    form.prepend(note);
    // Written a turn after it appears: a live region filled as it arrives is not one being watched.
    const writing = setTimeout(() => {
      note.textContent = sentence;
    }, 0);
    notes.set(form, { note, count: 1, writing });
  }
  return () => {
    const held = notes.get(form);
    if (!held) return;
    held.count -= 1;
    if (held.count > 0) return;
    clearTimeout(held.writing);
    held.note.remove();
    notes.delete(form);
  };
}
