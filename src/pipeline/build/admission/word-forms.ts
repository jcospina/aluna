// Singular and plural spellings of one word, shared by the two checks that ask whether a name is
// one the desk already has. An -ies plural may come from a -y singular (Stories) or an -ie one
// (Movies), and a hissing stem takes -es (Boxes), so a word carries every reading rather than
// being rewritten to one: rewriting -ie to -y made Julie and July one name.

/** A stem ending in a hiss takes -es: boxes, classes, dishes, churches, buzzes. */
const SIBILANT_PLURAL = /(?:s|x|z|ch|sh)es$/;

/** Every spelling `word` may be read as: itself, and its singulars when it looks plural. */
export function wordForms(word: string): readonly string[] {
  const forms = [word];
  if (word.length > 3 && word.endsWith("s")) forms.push(word.slice(0, -1));
  if (word.length > 4 && word.endsWith("ies")) forms.push(`${word.slice(0, -3)}y`);
  if (word.length > 3 && SIBILANT_PLURAL.test(word)) forms.push(word.slice(0, -2));
  return forms;
}

/** Whether two lowercase words can be read as the same word. */
export function sameWord(left: string, right: string): boolean {
  const rightForms = wordForms(right);
  return wordForms(left).some((form) => rightForms.includes(form));
}

/** Whether every word of `words` is one of `container`'s. */
export function containsWords(container: ReadonlySet<string>, words: ReadonlySet<string>): boolean {
  return (
    words.size > 0 &&
    [...words].every((word) => [...container].some((held) => sameWord(word, held)))
  );
}

/** Whether two sets of words name the same thing: each holds every word of the other. */
export function sameWords(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return containsWords(left, right) && containsWords(right, left);
}
