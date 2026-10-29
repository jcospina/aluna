// Whether a run of words is one this person wrote.
//
// Two callers, two jobs. The gap asks whether the subject the model named is a run of the
// person's own words, which decides whether it gives way to a window standing open.
// `question-no-home.ts` then uses the same notion of a word to ask whether a subject names
// something the desk already holds.
//
// A word is matched on a key: composed, folded, and without the quote that closed it, so *café*
// is one word in either normal form, a paste from macOS matches a model's composed answer, and a
// word inside quotation marks matches the word itself.
//
// A leaf: it imports nothing.

/** A word as a person writes one, with the marks and the apostrophes inside it kept whole. */
const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’]*/gu;

/** A quote that closed a word rather than sat inside it, which is punctuation and not the word. */
const CLOSING_QUOTE = /['’]+$/;

/**
 * How many of their words a subject may be. Past a handful the model has handed back the question
 * rather than the thing it is about. It bounds a subject only: a collection's own label is as
 * long as this person made it.
 */
export const MOST_SUBJECT_WORDS = 6;

/** The key each of `text`'s words is matched on. */
function wordsOf(text: string): readonly string[] {
  return [...text.matchAll(WORD)].map((match) =>
    match[0].replace(CLOSING_QUOTE, "").normalize("NFC").toLowerCase(),
  );
}

/** Where one run of words sits inside another, counted in words rather than in characters. */
export interface WordRun {
  /** How many of `text`'s words stand before the run. */
  readonly from: number;
  /** How many words the run is. */
  readonly words: number;
  /** How many words `text` holds in all. */
  readonly of: number;
}

/**
 * The first place `run`'s words sit unbroken inside `text`'s, or `null`. One unbroken run, so a
 * phrase assembled out of words they used apart is not one of theirs.
 */
export function wordRunIn(text: string, run: string): WordRun | null {
  const words = wordsOf(text);
  const named = wordsOf(run);
  if (named.length === 0) return null;
  for (let from = 0; from + named.length <= words.length; from += 1) {
    if (named.every((word, index) => words[from + index] === word)) {
      return { from, words: named.length, of: words.length };
    }
  }
  return null;
}

/**
 * Whether the subject is a run of words this person wrote — and not one long enough to be the
 * question rather than the thing it asks about.
 */
export function questionSubjectIsTheirs(question: string, subject: string): boolean {
  const run = wordRunIn(question, subject);
  return run !== null && run.words <= MOST_SUBJECT_WORDS;
}

/** Whether `run`'s words sit anywhere inside `text`'s. */
export function wordsSitInside(text: string, run: string): boolean {
  return wordRunIn(text, run) !== null;
}

/**
 * Whether `run` sits at one end of `text`'s words. English hangs its subject on the first word or
 * the last — *notes from my doctor* is notes, *grocery item list* is a list — so a name found in
 * the middle is a coincidence, and a coincidence here suppresses a gap this desk really has.
 */
export function wordsSitAtAnEdge(text: string, run: string): boolean {
  const found = wordRunIn(text, run);
  return found !== null && (found.from === 0 || found.from + found.words === found.of);
}
