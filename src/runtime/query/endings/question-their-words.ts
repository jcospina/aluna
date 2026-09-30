// A run of words as this person wrote it (PLAN decision 20).
//
// Two callers, two jobs. The gap sentence narrows a subject the model named down to words the
// person actually typed, so the one sentence with a word of the model's inside it carries theirs
// instead. `question-no-home.ts` then uses the same notion of a word to ask whether a subject
// names something the desk already holds.
//
// Their words cross and their punctuation does not: what stands between two of their words is
// whatever they typed there, and a sentence the platform vouches for carries their word
// characters and our single space between them, never a run of theirs. So the marks on a word
// stay on it — *café* is one word in either normal form — while a quote around it does not.
//
// A leaf: it imports nothing.

/** A word as a person writes one, with the marks and the apostrophes inside it kept whole. */
const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’]*/gu;

/** A quote that closed a word rather than sat inside it, which is theirs to type and not to name. */
const CLOSING_QUOTE = /['’]+$/;

/**
 * How many of their words a subject may be. Decision 20's own runs to two, and past a handful the
 * model has handed back the question rather than the thing it is about. It bounds a subject only:
 * a collection's own label is as long as this person made it.
 */
export const MOST_SUBJECT_WORDS = 6;

interface WordWritten {
  readonly written: string;
  readonly word: string;
}

/**
 * The words of `text`, each paired with the key it is matched on: composed, folded, and without
 * the quote that closed it, so a paste from macOS and a word inside quotation marks both match.
 * Only the key is composed. What is written comes back in the code points they typed, because a
 * sentence that normalized their word would be handing them a word they did not write.
 */
function wordsOf(text: string): readonly WordWritten[] {
  return [...text.matchAll(WORD)].map((match) => {
    // A quote that closed the word is punctuation, and punctuation does not cross: a sentence
    // reading *anywhere for hiking trips' yet* would be carrying a mark of theirs, not a word.
    const written = match[0].replace(CLOSING_QUOTE, "");
    return { written, word: written.normalize("NFC").toLowerCase() };
  });
}

/** Where one run of words sits inside another, counted in words rather than in characters. */
export interface WordRun {
  /** How many of `text`'s words stand before the run. */
  readonly from: number;
  /** How many words the run is. */
  readonly words: number;
  /** How many words `text` holds in all. */
  readonly of: number;
  /** The run as `text` wrote it, their word characters and our space between them. */
  readonly written: string;
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
    const found = words.slice(from, from + named.length);
    if (named.every((word, index) => found[index]?.word === word.word)) {
      return {
        from,
        words: named.length,
        of: words.length,
        written: found.map((written) => written.written).join(" "),
      };
    }
  }
  return null;
}

/**
 * The subject as this person wrote it, or `null` when they did not write it — a run long enough
 * to be the question rather than the thing it asks about included.
 */
export function questionSubjectInTheirWords(question: string, subject: string): string | null {
  const run = wordRunIn(question, subject);
  if (run === null || run.words > MOST_SUBJECT_WORDS) return null;
  return run.written;
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
