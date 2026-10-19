import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PlatformDatabase } from "../../../../platform/persistence/db.ts";
import {
  AUTHORS,
  BOOKS,
  READING_LOG,
  storeRelations,
} from "../../../../server/routes/lifecycle/link.test-support.ts";
import { setupRouterTest, teardownRouterTest } from "../router.test-support.ts";
import {
  BOOK_AUTHOR,
  BUTLER,
  describeAuthor,
  deskCode,
  gates,
  installSearchDesk,
  LE_GUIN,
  LOAN_BOOK,
  LOAN_BORROWER,
  LOANS,
  LOG_TITLE,
  readers,
  SANDERSON,
  searched,
  seed,
  watchTokens,
} from "./search-links.test-support.ts";

// Search follows links backwards too: what a record shows as
// linking to it, it can be found by.

const scratch: { dir?: string; conns?: PlatformDatabase } = {};
const conns = () => scratch.conns as PlatformDatabase;

beforeEach(() => {
  Object.assign(scratch, setupRouterTest());
  installSearchDesk(conns(), {
    books: [BOOK_AUTHOR],
    reading_log: [LOG_TITLE],
    loans: [LOAN_BOOK],
  });
  for (const [id, on, title, author, name, notes] of [
    ["b-lh", 1, "The Left Hand of Darkness", LE_GUIN, "Ursula K. Le Guin", "Hugo"],
    ["b-we", 2, "A Wizard of Earthsea", LE_GUIN, "Ursula K. Le Guin", ""],
    ["b-mb", 3, "Mistborn", SANDERSON, "Brandon Sanderson", "Hugo"],
    ["b-kin", 4, "Kindred", BUTLER, "Octavia E. Butler", ""],
  ] as const) {
    seed(conns(), BOOKS, id, on, { title, author: name, notes }, { author: [AUTHORS, author] });
  }
  describeAuthor(conns(), BUTLER, { bio: "Hugo and Nebula winner" });
  describeAuthor(conns(), LE_GUIN, { pen_name: "Kroeber" });
  for (const [id, on, book, title, notes] of [
    ["e-lh", 5, "b-lh", "The Left Hand of Darkness", ""],
    ["e-mb", 6, "b-mb", "Mistborn", "allomancy"],
  ] as const) {
    seed(conns(), READING_LOG, id, on, { title, notes }, { title: [BOOKS, book] });
  }
  for (const [id, on, book, title, borrower] of [
    ["l-kin", 7, "b-kin", "Kindred", "Ana"],
    ["l-mb", 8, "b-mb", "Mistborn", "Ana"],
    ["l-we", 9, "b-we", "A Wizard of Earthsea", "Luis"],
  ] as const) {
    seed(conns(), LOANS, id, on, { book: title, borrower }, { book: [BOOKS, book] });
  }
});

afterEach(() => {
  if (scratch.dir && scratch.conns) teardownRouterTest(scratch.dir, scratch.conns);
});

describe("search follows links backwards", () => {
  test("finds the records a matching linking record points at", async () => {
    // A book titled Mistborn points at Sanderson; Ana's loans point at Kindred and Mistborn.
    expect((await searched(conns(), "authors", "mistborn")).listed).toEqual([SANDERSON]);
    expect((await searched(conns(), "books", "ana")).listed).toEqual(["b-kin", "b-mb"]);
  });

  test("finds a name two links away, back and back, or out and back in", async () => {
    // Only a Reading Log entry, on Mistborn, says allomancy; Ana borrowed Mistborn.
    expect((await searched(conns(), "authors", "allomancy")).listed).toEqual([SANDERSON]);
    expect((await searched(conns(), "reading_log", "ana")).listed).toEqual(["e-mb"]);
  });

  test("lists the Handler's matches first, in its order, then the nearest, then the newest", async () => {
    // Butler's bio says Hugo, and so do Le Guin's and Sanderson's books, one link away.
    expect((await searched(conns(), "authors", "hugo")).listed).toEqual([
      BUTLER,
      SANDERSON,
      LE_GUIN,
    ]);
    describeAuthor(conns(), LE_GUIN, { bio: "Hugo, six times" });
    const oldestFirst = deskCode({ authors: { oldestFirst: true } });
    expect((await searched(conns(), "authors", "hugo", oldestFirst)).listed).toEqual([
      LE_GUIN,
      BUTLER,
      SANDERSON,
    ]);
  });

  test("searches each capability once, both ways round the Books and Authors loop", async () => {
    const readGates = gates(conns());
    const tokens = watchTokens(readGates);
    expect((await searched(conns(), "books", "kroeber", { readGates })).listed).toEqual([
      "b-we",
      "b-lh",
    ]);
    expect(tokens().flat().toSorted()).toEqual(["authors", "books", "loans", "reading_log"]);
    expect(readers(readGates)).toEqual([]);
  });

  test("follows every relation between the capabilities reached, but never back into one", async () => {
    // Loans point at Books and at Authors. Kroeber is Le Guin, whose Earthsea a loan points at;
    // a loan of Left Hand borrowed by Le Guin names Left Hand only as a copy of Books' title.
    storeRelations(conns(), "loans", [LOAN_BOOK, LOAN_BORROWER]);
    const picks = { book: [BOOKS, "b-lh"], borrower: [AUTHORS, LE_GUIN] } as const;
    const loan = { book: "The Left Hand of Darkness", borrower: "Ursula K. Le Guin" };
    seed(conns(), LOANS, "l-lh", 10, loan, picks);
    seed(conns(), READING_LOG, "e-we", 11, { title: "Earthsea" }, { title: [BOOKS, "b-we"] });
    expect((await searched(conns(), "loans", "kroeber")).listed).toEqual(["l-lh", "l-we"]);
    expect((await searched(conns(), "reading_log", "left hand")).listed).toEqual(["e-lh"]);
  });
});
