import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { LINK_TABLE, writeLinkRow } from "../../../platform/links/link-table.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import { FIFTH_INCARNATION_ID } from "../../../registry/incarnations.test-support.ts";
import type { Relation } from "../../../registry/index.ts";
import {
  setupRouterTest,
  teardownRouterTest,
} from "../../../runtime/router/dispatch/router.test-support.ts";
import {
  AUTHORS_INCARNATION,
  installDesk,
  storeRelations,
} from "../../../server/routes/lifecycle/link.test-support.ts";
import { matchLinkedFieldsAtStartup } from "./match-at-startup.ts";

// Books' author linked to Authors · Name before the matching scan existed, its names never matched:
// the seeded authors are Ursula K. Le Guin (author-0), Octavia E. Butler (author-1) and Brandon
// Sanderson (author-2).

let dir: string;
let conns: PlatformDatabase;

const AUTHOR_TO_NAME: Relation = {
  field: "author",
  to: { capability: "authors", incarnation: AUTHORS_INCARNATION, field: "name" },
};

beforeEach(() => {
  ({ dir, conns } = setupRouterTest());
  installDesk(conns);
  storeRelations(conns, "books", [AUTHOR_TO_NAME]);
  const books = [
    ["elantris", "Brandon Sanderson"],
    ["warbreaker", "brandon sanderson "],
    ["kindred", "Octavia E. Butler"],
    ["picked", "Octavia E. Butler"],
    ["broken", "Ursula K. Le Guin"],
    ["unknown", "Brandin Sanderlanche"],
    ["empty", ""],
  ];
  for (const [id, author] of books) {
    conns.readwrite.run('INSERT INTO "cap_books" ("id", "title", "author") VALUES (?, ?, ?)', [
      id ?? "",
      `Book ${id}`,
      author ?? "",
    ]);
  }
  const from = (record: string) => ({ capability: "books", record, field: "author" });
  // A pick made by hand, which its text does not name: it stands.
  writeLinkRow(conns.readwrite, from("picked"), {
    capability: "authors",
    incarnation: AUTHORS_INCARNATION,
    record: "author-0",
  });
  // A link into a lifetime of Authors since gone: it leads nowhere, so the name decides.
  writeLinkRow(conns.readwrite, from("broken"), {
    capability: "authors",
    incarnation: FIFTH_INCARNATION_ID,
    record: "author-0",
  });
});

afterEach(() => teardownRouterTest(dir, conns));

/** Which author each book's author field leads to, by book. */
function links(): Record<string, string> {
  const rows = conns.readonly
    .query(`SELECT source_record, target_incarnation, target_record FROM ${LINK_TABLE}`)
    .all() as { source_record: string; target_incarnation: string; target_record: string }[];
  return Object.fromEntries(
    rows
      .filter((row) => row.target_incarnation === AUTHORS_INCARNATION)
      .map((row) => [row.source_record, row.target_record]),
  );
}

const storedBooks = () => conns.readonly.query('SELECT * FROM "cap_books" ORDER BY "id"').all();

describe("at startup, a field linked before matching existed", () => {
  test("links each name one author holds, and keeps every link that leads to an author", () => {
    const before = storedBooks();
    expect(matchLinkedFieldsAtStartup(conns.readwrite)).toEqual([
      { capability: "books", field: "author", linked: 4 },
    ]);
    expect(links()).toEqual({
      elantris: "author-2",
      warbreaker: "author-2",
      kindred: "author-1",
      picked: "author-0",
      broken: "author-0",
    });
    expect(storedBooks()).toEqual(before);
  });

  test("leaves a name no author holds, or two do, unlinked", () => {
    conns.readwrite.run('INSERT INTO "cap_authors" ("id", "name") VALUES (?, ?)', [
      "author-3",
      "Octavia E. Butler",
    ]);
    matchLinkedFieldsAtStartup(conns.readwrite);
    expect(Object.keys(links())).not.toContain("unknown");
    expect(Object.keys(links())).not.toContain("kindred");
    expect(Object.keys(links())).not.toContain("empty");
  });

  test("finds nothing left to link the next time", () => {
    matchLinkedFieldsAtStartup(conns.readwrite);
    const linked = links();
    expect(matchLinkedFieldsAtStartup(conns.readwrite)).toEqual([]);
    expect(links()).toEqual(linked);
  });
});

describe("a field that cannot be matched", () => {
  test("is reported, and the others are matched all the same", () => {
    storeRelations(conns, "memos", [
      {
        field: "subject",
        to: { capability: "authors", incarnation: AUTHORS_INCARNATION, field: "pen_name" },
      },
    ]);
    conns.readwrite.run('ALTER TABLE "cap_memos" RENAME TO "memos_away"');
    const matched = matchLinkedFieldsAtStartup(conns.readwrite);
    expect(matched).toContainEqual({ capability: "books", field: "author", linked: 4 });
    expect(matched.find((match) => match.capability === "memos")).toMatchObject({
      field: "subject",
      error: expect.any(Error),
    });
  });
});
