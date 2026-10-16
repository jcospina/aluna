// @ts-check

/**
 * When two texts name the same record, written once for the matching scan that links the names a
 * field already holds and the dropdown that marks the record its text names. Spaces at either end
 * and case aside, and nothing else: accents count, since "Pena" and "Peña" are two names, and
 * inner spaces count. A leaf, so the server can import it without the page around it.
 */

/** A space, or a mark that prints nothing, as a pasted name brings at either end. */
const INVISIBLE = /^[\s\u0085\p{Default_Ignorable_Code_Point}]$/u;

/**
 * The text as a match compares it: composed one way, trimmed at both ends, and case-folded in code,
 * since SQLite's `lower()` folds ASCII only. Lower-, upper- then lower-casing folds what one
 * lower-casing keeps apart, as Unicode's full folding does: "STRASSE", "straße" and "STRAẞE",
 * "ΟΔΟΣ" and "οδοσ".
 *
 * @param {string} text
 */
export function matchKey(text) {
  return trimmed(text.normalize("NFC")).toLowerCase().toUpperCase().toLowerCase().normalize("NFC");
}

/**
 * `text` without what is invisible at either end, one character at a time: a pattern anchored at
 * the end backtracks over every invisible run inside a name, for minutes on a long one.
 *
 * @param {string} text
 */
function trimmed(text) {
  const characters = [...text];
  let start = 0;
  let end = characters.length;
  while (start < end && INVISIBLE.test(characters[start] ?? "")) start += 1;
  while (end > start && INVISIBLE.test(characters[end - 1] ?? "")) end -= 1;
  return characters.slice(start, end).join("");
}

/**
 * Whether two texts name the same record.
 *
 * @param {string} a
 * @param {string} b
 */
export function sameText(a, b) {
  return matchKey(a) === matchKey(b);
}
