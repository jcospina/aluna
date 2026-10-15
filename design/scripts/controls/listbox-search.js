// @ts-check
/**
 * The listbox's search, typed into the field itself. A list that searches keeps the options whose
 * label contains every typed word, folded the way a capability's own search folds its text, and
 * says "No results" when it keeps none. An option's note is never read. The design's listbox and
 * the desk's picker both search through this module, and each one keeps its own keyboard.
 */

/** What the list says in place of the options a search kept none of. */
export const NO_RESULTS = "No results";

const MARK = /^\p{M}$/u;
const DIACRITIC = /^\p{Diacritic}$/u;
const LATIN = /^\p{Script=Latin}$/u;

/**
 * Text as a search compares it, folded exactly as the server's `normalizeSearchText` folds it:
 * decomposed and lower-cased, with the accents on Latin letters dropped. Every other mark stays,
 * because in another script a mark can be the difference between two words.
 *
 * @param {string} value
 * @returns {string}
 */
export function foldForSearch(value) {
  const decomposed = value.normalize("NFKD").toLocaleLowerCase("und");
  let folded = "";
  let followsLatin = false;
  for (const character of decomposed) {
    if (MARK.test(character)) {
      if (!(followsLatin && DIACRITIC.test(character))) folded += character;
      continue;
    }
    folded += character;
    followsLatin = LATIN.test(character);
  }
  return folded.normalize("NFKC");
}

/**
 * The words a query is split into, each folded. An empty query has none, and keeps every option.
 * @param {string} query
 * @returns {string[]}
 */
export function searchWords(query) {
  return query
    .trim()
    .split(/\s+/u)
    .map(foldForSearch)
    .filter((word) => word !== "");
}

/**
 * @param {string} label
 * @param {readonly string[]} words already folded
 */
export function containsEveryWord(label, words) {
  const folded = foldForSearch(label);
  return words.every((word) => folded.includes(word));
}

/**
 * Each option's label as last folded, so a keystroke folds only the words typed: a list of a few
 * thousand names is searched again on every key.
 * @type {WeakMap<Element, { label: string, folded: string }>}
 */
const foldedLabels = new WeakMap();

/** @param {Element} option */
function foldedLabelOf(option) {
  const label = optionLabel(option);
  const known = foldedLabels.get(option);
  if (known?.label === label) return known.folded;
  const folded = foldForSearch(label);
  foldedLabels.set(option, { label, folded });
  return folded;
}

/**
 * What an option is called, as against everything written on its row. A trailing note belongs to
 * the row and not the value: it never reaches the closed control, the typeahead or the search.
 *
 * @param {Element} option
 * @returns {string}
 */
export function optionLabel(option) {
  const note = option.querySelector(".listbox__note");
  if (!note) return option.textContent?.trim() ?? "";
  return [...option.childNodes]
    .filter((node) => node !== note)
    .map((node) => node.textContent ?? "")
    .join("")
    .trim();
}

/**
 * Show the options `query` keeps and hide the rest, with every group left holding none, then say
 * "No results" when nothing is kept.
 *
 * @param {HTMLElement} panel
 * @param {string} query
 * @returns {HTMLElement[]} the options kept, in document order
 */
export function narrow(panel, query) {
  const words = searchWords(query);
  /** @type {HTMLElement[]} */
  const kept = [];
  for (const option of panel.querySelectorAll('[role="option"]')) {
    if (!(option instanceof HTMLElement)) continue;
    const folded = foldedLabelOf(option);
    option.hidden = !words.every((word) => folded.includes(word));
    if (!option.hidden) kept.push(option);
  }
  for (const group of panel.querySelectorAll('[role="group"]')) {
    if (!(group instanceof HTMLElement)) continue;
    group.hidden = !kept.some((option) => group.contains(option));
  }
  emptySentence(panel).textContent = kept.length === 0 ? NO_RESULTS : "";
  return kept;
}

/**
 * The live sentence under the list, made once, empty, when the list first searches: a status
 * region a reader announces must already stand in the page when its words change.
 *
 * @param {HTMLElement} panel
 * @returns {HTMLElement}
 */
export function emptySentence(panel) {
  const standing = panel.querySelector(".listbox__empty");
  if (standing instanceof HTMLElement) return standing;
  const sentence = panel.ownerDocument.createElement("p");
  sentence.className = "listbox__empty";
  sentence.setAttribute("role", "status");
  panel.append(sentence);
  return sentence;
}

/**
 * Whether a key is someone else's to answer: held with Cmd or Ctrl it is a shortcut the field or
 * the page keeps, and one that ends or steers an input method's composition is the input method's.
 *
 * @param {KeyboardEvent} event
 */
export function keyIsNotOurs(event) {
  return event.metaKey || event.ctrlKey || event.isComposing || event.keyCode === 229;
}

/**
 * What one key means to a field that searches: a step through the list, a pick, a way out, or
 * opening it. Anything else is typing, which the field takes, so Space, Home and End are typing.
 *
 * @param {string} key
 * @param {boolean} open
 * @returns {"open" | "next" | "previous" | "pick" | "leave" | null}
 */
export function searchIntent(key, open) {
  if (!open) return key === "ArrowDown" || key === "ArrowUp" || key === "Enter" ? "open" : null;
  if (key === "ArrowDown") return "next";
  if (key === "ArrowUp") return "previous";
  if (key === "Enter") return "pick";
  return key === "Escape" || key === "Tab" ? "leave" : null;
}
