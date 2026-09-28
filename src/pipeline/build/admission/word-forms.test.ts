import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { containsWords, sameWord, sameWords } from "./word-forms.ts";

const letters = (pattern: RegExp) => fc.stringMatching(pattern);

describe("one word, singular or plural", () => {
  test("a word and the same word with an s are one word", () => {
    fc.assert(
      fc.property(letters(/^[a-z]{3,10}$/), (word) => {
        expect(sameWord(word, `${word}s`)).toBe(true);
        expect(sameWord(`${word}s`, word)).toBe(true);
      }),
      { seed: 20260926, numRuns: 300 },
    );
  });

  test("an -ies plural is one word with its -y singular and with its -ie singular", () => {
    fc.assert(
      fc.property(letters(/^[a-z]{2,8}$/), (stem) => {
        expect(sameWord(`${stem}ies`, `${stem}y`)).toBe(true);
        expect(sameWord(`${stem}ies`, `${stem}ie`)).toBe(true);
      }),
      { seed: 20260926, numRuns: 300 },
    );
  });

  test("a stem that hisses and its -es plural are one word", () => {
    fc.assert(
      fc.property(
        letters(/^[a-z]{1,8}$/),
        fc.constantFrom("s", "x", "z", "ch", "sh"),
        (stem, hiss) => {
          expect(sameWord(`${stem}${hiss}es`, `${stem}${hiss}`)).toBe(true);
        },
      ),
      { seed: 20260926, numRuns: 300 },
    );
    expect(sameWord("boxes", "box")).toBe(true);
    expect(sameWord("toes", "t")).toBe(false);
    expect(sameWord("apes", "ap")).toBe(false);
    expect(sameWord("chester", "chest")).toBe(false);
    expect(sameWord("book", "boo")).toBe(false);
    expect(sameWord("ashes", "ash")).toBe(true);
  });

  test("an -ie singular and a -y singular are two words", () => {
    fc.assert(
      fc.property(letters(/^[a-z]{2,8}$/), (stem) => {
        expect(sameWord(`${stem}ie`, `${stem}y`)).toBe(false);
      }),
      { seed: 20260926, numRuns: 300 },
    );
  });

  test("a word of three letters or fewer is never read as a plural", () => {
    expect(sameWord("gas", "ga")).toBe(false);
    expect(sameWord("xes", "x")).toBe(false);
    expect(sameWord("pies", "pie")).toBe(true);
    expect(sameWord("pies", "py")).toBe(false);
    expect(sameWord("books", "boy")).toBe(false);
    expect(sameWord("tables", "taby")).toBe(false);
  });
});

describe("a name as a set of words", () => {
  test("names the same thing only when each holds every word of the other", () => {
    expect(sameWords(new Set(["book", "books"]), new Set(["book"]))).toBe(true);
    expect(sameWords(new Set(["work", "contacts"]), new Set(["contact"]))).toBe(false);
    expect(sameWords(new Set(), new Set())).toBe(false);
  });

  test("an empty set of words is contained by nothing", () => {
    expect(containsWords(new Set(["notes"]), new Set())).toBe(false);
    expect(containsWords(new Set(["reading", "lists"]), new Set(["list"]))).toBe(true);
  });
});
