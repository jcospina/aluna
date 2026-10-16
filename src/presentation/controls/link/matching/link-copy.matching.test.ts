// What the prompt bar says once a field's names are matched, and what the broken-link mark is read
// as, held to the grammar every count asks for and never to their wording.

import { describe, expect, test } from "bun:test";

import { collectionCountSentence } from "../../../records/region/collection-count.ts";
import { matchingReport, pickTargetMark } from "../link-copy.ts";

const BOOKS = { noun: "book", plural: "books" };
const COUNTS = [0, 1, 2, 45, 1234];

/** Every report the counts above make, with the counts that made it. */
const reports = COUNTS.flatMap((linked) =>
  COUNTS.map((unmatched) => ({
    linked,
    unmatched,
    sentence: matchingReport(BOOKS, "author", { linked, unmatched }),
  })),
);

describe("the matching report", () => {
  test("says nothing only when no record held a name", () => {
    for (const { linked, unmatched, sentence } of reports) {
      expect(sentence === "").toBe(linked + unmatched === 0);
    }
  });

  test("counts the records it matched as their collection counts them, noun and all", () => {
    for (const { linked, sentence } of reports.filter((each) => each.linked > 0)) {
      const counted = collectionCountSentence(linked, BOOKS);
      expect(sentence).toMatch(new RegExp(`(?<![\\d,])${counted}(?![\\p{L}])`, "u"));
    }
  });

  test("says how many still need a pick, its verb agreeing with that count", () => {
    for (const linked of COUNTS) {
      const one = matchingReport(BOOKS, "author", { linked, unmatched: 1 });
      const seven = matchingReport(BOOKS, "author", { linked, unmatched: 7 });
      expect(seven).toMatch(/\b7\b/);
      expect(seven.replace(/\b7\b/, "1")).not.toBe(one);
    }
  });

  test("names the target by its record noun, which is never pluralised", () => {
    for (const { sentence } of reports.filter((each) => each.sentence !== "")) {
      expect(sentence).toMatch(/\bauthor\b/);
      expect(sentence).not.toMatch(/\bauthors\b/);
    }
  });
});

describe("the broken-link mark's name", () => {
  test("names each target once, however many fields ask for it", () => {
    expect(pickTargetMark(["author", "author"])).toBe(pickTargetMark(["author"]));
    const three = pickTargetMark(["author", "publisher", "series"]);
    for (const noun of ["author", "publisher", "series"]) expect(three).toContain(`the ${noun}`);
  });
});
