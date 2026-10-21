// What the prompt bar says once a field's names are matched, and what the broken-link mark is read
// as, held to the grammar every count asks for and never to their wording.

import { describe, expect, test } from "bun:test";

import { collectionCountSentence } from "../../../records/region/collection-count.ts";
import {
  alreadyConnected,
  buildConnecting,
  connectingNote,
  everyRecordsField,
  matchingReport,
  NOTHING_ELSE_TO_CONNECT,
  NOTHING_TO_CONNECT,
  pickTargetMark,
  requestConnected,
} from "../link-copy.ts";

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

describe("what a linking-only request says it connected", () => {
  const field = (label: string) => ({ label });
  const unnamed = { linked: 0, unmatched: 0 };
  const author = { field: field("Author"), targetNoun: "author", targetPlural: "authors" };
  const series = { field: field("Series"), targetNoun: "series", targetPlural: "series" };
  const genre = { field: field("Genre"), targetNoun: "genre", targetPlural: "genres" };
  const clause = (each: typeof author) =>
    `${everyRecordsField(BOOKS.noun, each.field)} to your ${each.targetPlural}`;

  test("says each field's matching report, then one sentence for the fields no record named", () => {
    const named = { ...author, matched: { linked: 45, unmatched: 5 } };
    const report = matchingReport(BOOKS, "author", named.matched);
    expect(requestConnected(BOOKS, [named])).toBe(report);

    const said = requestConnected(BOOKS, [named, { ...series, matched: unnamed }]);
    expect(said.startsWith(`${report} `)).toBe(true);
    expect(said).toContain(clause(series));
    expect(said).not.toContain(clause(author));
  });

  test("names every field no record named in one sentence, in the order given", () => {
    const said = requestConnected(BOOKS, [
      { ...author, matched: unnamed },
      { ...series, matched: unnamed },
      { ...genre, matched: unnamed },
    ]);
    expect(said).toBe(said.trim());
    expect(said).toContain(`${clause(author)}, ${clause(series)} and ${clause(genre)}.`);
    expect(said.match(/\./g)?.length).toBe(1);
  });

  test("the build says the same fields while it connects them, and nothing when it connects none", () => {
    expect(buildConnecting(BOOKS.noun, [])).toBe("");
    expect(buildConnecting(BOOKS.noun, [author])).toContain(`${clause(author)}.`);
    expect(buildConnecting(BOOKS.noun, [author, series])).toContain(
      `${clause(author)} and ${clause(series)}.`,
    );
  });

  test("finding nothing to connect is said, in the product's word for linking", () => {
    for (const sentence of [NOTHING_TO_CONNECT, NOTHING_ELSE_TO_CONNECT]) {
      expect(sentence).not.toBe("");
      expect(sentence.toLowerCase()).not.toContain("link");
    }
  });

  test("two fields picking from one kind of record are each reported by their own label", () => {
    const writer = { ...author, field: field("Writer"), matched: { linked: 3, unmatched: 0 } };
    const artist = {
      ...author,
      field: field("Cover artist"),
      matched: { linked: 2, unmatched: 1 },
    };
    const said = requestConnected(BOOKS, [writer, artist]);

    expect(said).toBe(
      `${matchingReport(BOOKS, "writer", writer.matched)} ${matchingReport(BOOKS, "cover artist", artist.matched)}`,
    );
    expect(requestConnected(BOOKS, [writer])).toBe(matchingReport(BOOKS, "author", writer.matched));

    const shelf = { field: field("Shelf"), targetNoun: "entry", targetPlural: "entries" };
    const apart = [
      { ...writer, matched: { linked: 3, unmatched: 0 } },
      { ...shelf, matched: { linked: 1, unmatched: 2 } },
    ];
    expect(requestConnected(BOOKS, apart)).toBe(
      `${matchingReport(BOOKS, "author", apart[0]?.matched ?? unnamed)} ${matchingReport(BOOKS, "entry", apart[1]?.matched ?? unnamed)}`,
    );
  });

  test("fields already connected are said in the build's clauses, and none says nothing", () => {
    expect(alreadyConnected(BOOKS.noun, [])).toBe("");
    const said = alreadyConnected(BOOKS.noun, [author, series]);
    expect(said).toContain(`${clause(author)} and ${clause(series)}.`);
    expect(said).not.toBe(buildConnecting(BOOKS.noun, [author, series]));
  });

  test("the note names every capability it connects to, once each", () => {
    const note = connectingNote("books", "authors", "series", "authors", "genres");
    expect(note).toContain("authors, series and genres");
    expect(note.split("authors").length).toBe(2);
    expect(connectingNote("books", "authors")).toContain("authors…");
    expect(connectingNote("books", "authors")).not.toContain(" and ");
  });
});
