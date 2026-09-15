// The plural of a capability's own noun, for the sentences a collection says about itself.
//
// The generation contract asks for a singular common noun, and a model reaches for something else
// often enough that "7 datas" and "7 quizes" both reached a real label. English morphology is not
// what a count sentence is about, so it lives here rather than beside the sentences.
//
// The platform declines rather than guesses wherever two answers exist. A declined noun costs the
// label its noun and nothing else — "7" instead of "7 Aufgaben" — which is the same shape the
// empty state already speaks in.

/**
 * Nouns English does not count, so the label says the figure alone. `fish`, `sheep` and `series`
 * are here as uncountables rather than as irregulars: their plural is the word itself, and a
 * label reading "7 fish" is what the singular already gives.
 */
const UNCOUNTABLE = new Set([
  "advice",
  "baggage",
  "data",
  "equipment",
  "evidence",
  "feedback",
  "fish",
  "furniture",
  "homework",
  "information",
  "luggage",
  "news",
  "research",
  "series",
  "sheep",
  "software",
  "species",
  "staff",
]);

/** English plurals with one answer. Anything with two is declined below. */
const IRREGULAR_PLURALS = new Map([
  ["child", "children"],
  ["criterion", "criteria"],
  ["foot", "feet"],
  ["goose", "geese"],
  ["man", "men"],
  ["mouse", "mice"],
  ["person", "people"],
  ["tooth", "teeth"],
  ["woman", "women"],
]);

/** A noun already written in the plural, which the label leaves exactly as the model wrote it. */
const ALREADY_PLURAL = new Set([
  "children",
  "criteria",
  "feet",
  "geese",
  "men",
  "mice",
  "people",
  "teeth",
  "women",
]);

/**
 * The plural of a capability's noun, or `undefined` when the platform will not guess: a noun in
 * `f`/`fe`/`o`/`s`, or anything outside plain Latin letters, rather than an `s` glued onto 메모.
 */
export function pluralNoun(noun: string): string | undefined {
  // Latin letters are not necessarily English letters: a German "Aufgabe" is pluralized as
  // English, which is the one wrong answer left and the one "add your first Aufgabe" already is.
  if (!/^[A-Za-z]+(?: [A-Za-z]+)*$/.test(noun)) return undefined;
  const words = noun.split(" ");
  const last = words.at(-1) ?? "";
  const plural = pluralWord(last);
  if (plural === undefined) return undefined;
  return [...words.slice(0, -1), plural].join(" ");
}

/**
 * The rule is chosen off the lowercased word and applied to the word as the model wrote it, so
 * `iPhone` pluralizes to `iPhones` rather than to `iphones` — a label that changed its own shape
 * between one record and seven.
 */
function pluralWord(word: string): string | undefined {
  const lower = word.toLowerCase();
  const irregular = IRREGULAR_PLURALS.get(lower);
  if (irregular !== undefined) return matchCase(word, irregular);
  if (UNCOUNTABLE.has(lower) || ALREADY_PLURAL.has(lower)) return undefined;
  const plural = regularPlural(word, lower);
  if (plural === undefined) return undefined;
  // A noun the model shouted keeps its voice: TRIP counts as TRIPS, never TRIPs.
  return word === word.toUpperCase() ? plural.toUpperCase() : plural;
}

/** The suffix rules, chosen off the lowercased word and hung on the word as it was written. */
function regularPlural(word: string, lower: string): string | undefined {
  // `z` doubles before the `es` — quiz, quizzes — and a `ch` said as a `k` takes a plain `s`.
  if (lower.endsWith("z")) return `${word}zes`;
  if (/(?:ss|sh|x)$/.test(lower) || /[^aeiou]ch$|[aeiou]{2}ch$/.test(lower)) return `${word}es`;
  if (/(?:s|f|o)$/.test(lower) || lower.endsWith("fe")) return undefined;
  if (/[^aeiou]y$/.test(lower)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/**
 * An irregular plural written the way the model wrote the singular: all capitals stay capital,
 * an initial capital stays capital, and anything else is left as the dictionary has it.
 */
function matchCase(original: string, plural: string): string {
  if (original === original.toUpperCase()) return plural.toUpperCase();
  const first = original.at(0);
  if (first === undefined || first !== first.toUpperCase()) return plural;
  return plural.charAt(0).toUpperCase() + plural.slice(1);
}
