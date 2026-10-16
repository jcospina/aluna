import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { sameText } from "#shell/core/same-text.js";
import { LINK_TABLE, writeLinkRow } from "../../../platform/links/link-table.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import { getCapability, type Relation } from "../../../registry/index.ts";
import {
  setupRouterTest,
  teardownRouterTest,
} from "../../../runtime/router/dispatch/router.test-support.ts";
import {
  AUTHORS_INCARNATION,
  installDesk,
} from "../../../server/routes/lifecycle/link.test-support.ts";
import { matchTypedNames } from "./matching-scan.ts";

// The desk's Books author, matched against Authors · Name: the three seeded authors, and whatever
// a test adds beside them.

let dir: string;
let conns: PlatformDatabase;

beforeEach(() => {
  ({ dir, conns } = setupRouterTest());
  installDesk(conns);
});

afterEach(() => {
  teardownRouterTest(dir, conns);
});

const AUTHOR_TO_NAME: Relation = {
  field: "author",
  to: { capability: "authors", incarnation: AUTHORS_INCARNATION, field: "name" },
};

function book(id: string, author: string | null): void {
  conns.readwrite.run('INSERT INTO "cap_books" ("id", "title", "author") VALUES (?, ?, ?)', [
    id,
    `Book ${id}`,
    author,
  ]);
}

function author(id: string, name: string): void {
  conns.readwrite.run('INSERT INTO "cap_authors" ("id", "name") VALUES (?, ?)', [id, name]);
}

function scan() {
  const books = getCapability("books", conns.readwrite);
  const authors = getCapability("authors", conns.readwrite);
  if (!books || !authors) throw new Error("the desk is not installed");
  return matchTypedNames(conns.readwrite, books, authors, AUTHOR_TO_NAME);
}

/** Which author each book's author field picked, by book. */
function picked(): Record<string, string> {
  const rows = conns.readonly
    .query(`SELECT source_record, target_record FROM ${LINK_TABLE} WHERE source_field = 'author'`)
    .all() as { source_record: string; target_record: string }[];
  return Object.fromEntries(rows.map((row) => [row.source_record, row.target_record]));
}

const storedBooks = () => conns.readonly.query('SELECT * FROM "cap_books" ORDER BY "id"').all();

describe("a name typed before the link", () => {
  test("matches with spaces at either end and case aside", () => {
    book("plain", "Ursula K. Le Guin");
    book("spaced", "  octavia e. butler\t");
    book("loud", "BRANDON SANDERSON");
    expect(scan()).toEqual({ linked: 3, unmatched: 0 });
    expect(picked()).toEqual({ plain: "author-0", spaced: "author-1", loud: "author-2" });
  });

  test("is case-folded beyond ASCII, which SQLite's lower() is not", () => {
    author("alvaro", "Álvaro Mutis");
    book("folded", "ÁLVARO MUTIS");
    const sqlite = conns.readonly.query("SELECT lower('ÁLVARO') = lower('álvaro') AS same").get();
    expect(sqlite).toEqual({ same: 0 });
    expect(scan()).toEqual({ linked: 1, unmatched: 0 });
    expect(picked()).toEqual({ folded: "alvaro" });
  });

  test("matches however its accents were composed, since they read the same", () => {
    author("pena", "Peña");
    book("decomposed", "Pen\u0303a");
    expect(scan()).toEqual({ linked: 1, unmatched: 0 });
    expect(picked()).toEqual({ decomposed: "pena" });
  });

  test("keeps its accents and its inner spaces: those make another name", () => {
    author("pena", "Peña");
    book("unaccented", "Pena");
    book("double-spaced", "Ursula K.  Le Guin");
    expect(scan()).toEqual({ linked: 0, unmatched: 2 });
    expect(picked()).toEqual({});
  });

  test("that two target records share, whatever their case, is ambiguous and gets no row", () => {
    author("kindred-1", "Kindred");
    author("kindred-2", " kindred ");
    book("ambiguous", "KINDRED");
    book("matched", "Octavia E. Butler");
    expect(scan()).toEqual({ linked: 1, unmatched: 1 });
    expect(picked()).toEqual({ matched: "author-1" });
  });

  test("that no target record holds gets no row", () => {
    book("unknown", "Terry Pratchett");
    expect(scan()).toEqual({ linked: 0, unmatched: 1 });
    expect(picked()).toEqual({});
  });

  test("never matches a blank target name, and an empty field is not counted", () => {
    author("blank", "   ");
    book("empty", "");
    book("blank", " \u00a0 ");
    book("null", null);
    expect(scan()).toEqual({ linked: 0, unmatched: 0 });
    expect(picked()).toEqual({});
  });

  test("keeps its text: the scan writes link rows and nothing else", () => {
    book("spaced", "  octavia e. butler ");
    book("unknown", "Terry Pratchett");
    const before = storedBooks();
    scan();
    expect(storedBooks()).toEqual(before);
  });
});

describe("rows the field held before", () => {
  test("go, since the relation that wrote them is gone; other fields and capabilities keep theirs", () => {
    book("left-over", "Terry Pratchett");
    book("relinked", "Octavia E. Butler");
    const elsewhere = { capability: "elsewhere", incarnation: "gone", record: "x" };
    writeLinkRow(
      conns.readwrite,
      { capability: "books", record: "left-over", field: "author" },
      elsewhere,
    );
    writeLinkRow(
      conns.readwrite,
      { capability: "books", record: "relinked", field: "author" },
      elsewhere,
    );
    writeLinkRow(
      conns.readwrite,
      { capability: "books", record: "left-over", field: "title" },
      elsewhere,
    );
    writeLinkRow(conns.readwrite, { capability: "memos", record: "m", field: "author" }, elsewhere);

    expect(scan()).toEqual({ linked: 1, unmatched: 1 });
    const rows = conns.readonly
      .query(
        `SELECT source_capability, source_record, source_field, target_record FROM ${LINK_TABLE}`,
      )
      .all();
    expect(rows).toHaveLength(3);
    expect(rows).toContainEqual({
      source_capability: "books",
      source_record: "relinked",
      source_field: "author",
      target_record: "author-1",
    });
    expect(rows).toContainEqual({
      source_capability: "books",
      source_record: "left-over",
      source_field: "title",
      target_record: "x",
    });
    expect(rows).toContainEqual({
      source_capability: "memos",
      source_record: "m",
      source_field: "author",
      target_record: "x",
    });
  });
});

describe("a match", () => {
  test("is what the dropdown's sameText says, pair for pair, so the two never disagree", () => {
    const pairs = [
      ["  Mary Shelley ", "mary shelley"],
      ["STRASSE", "Straße"],
      ["STRAẞENBAHN", "straßenbahn"],
      ["ΟΔΟΣ", "οδοσ"],
      ["Pen\u0303alosa", "Peñalosa"],
      ["Pena", "Peña"],
      ["Mary  Godwin", "Mary Godwin "],
    ] as const;
    pairs.forEach(([typed, name], index) => {
      author(`name-${index}`, name);
      book(`typed-${index}`, typed);
    });
    scan();
    const links = picked();
    const agreed = pairs.map(([typed, name], index) => ({
      linked: links[`typed-${index}`] === `name-${index}`,
      same: sameText(typed, name),
    }));
    expect(agreed.every(({ linked, same }) => linked === same)).toBe(true);
    expect(new Set(agreed.map(({ same }) => same))).toEqual(new Set([true, false]));
  });

  test("trims what is invisible at either end and keeps it inside, in time a long name allows", () => {
    expect(sameText("\u200b Kindred\u0085", "kindred")).toBe(true);
    expect(sameText("Kin\u200bdred", "Kindred")).toBe(false);
    const started = performance.now();
    expect(sameText(`a${"\u200b".repeat(100_000)}b`, "ab")).toBe(false);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
