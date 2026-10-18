// What the records linking to a deleted record keep, at the delete port: an optional
// linked field is cleared and a required one keeps its text, each losing its link row in the
// deletion's own savepoint, and a cleared field lets the links through it go.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { LINK_TABLE, writeLinkRow } from "../../../platform/links/link-table.ts";
import type { CapabilityRow, Relation } from "../../../registry/index.ts";
import {
  AUTHORS,
  AUTHORS_INCARNATION,
  BOOKS,
  MEMOS,
} from "../../../server/routes/lifecycle/link.test-support.ts";
import {
  createCapabilityDeleteMutationPort,
  fileClaimScope,
  NO_REACH,
  type RefreshReach,
} from "../index.ts";
import {
  BOOK_AUTHOR,
  BOOK_TITLE,
  BUTLER,
  closeDesk,
  db,
  desk,
  hidden,
  LE_GUIN,
  linked,
  MEMO_SUBJECT,
  openDesk,
  reachOn,
  reshaped,
  spec,
  texts,
  toAuthor,
  toBook,
} from "./linked-text.test-support.ts";
import { reviveLinkedText } from "./linked-text.ts";

beforeEach(() => {
  openDesk();
  linked(BOOKS, "author", "book-1", "Ursula K. Le Guin", toAuthor(LE_GUIN));
  linked(BOOKS, "author", "book-3", "Octavia E. Butler", toAuthor(BUTLER));
  linked(MEMOS, "subject", "memo-1", "Ursula K. Le Guin", toBook("book-1"));
});

afterEach(() => closeDesk());

/** Delete one author through the port, with what the router hands it. */
function deleteAuthor(id: string, reach: RefreshReach): void {
  const scope = fileClaimScope(db(), spec(AUTHORS), AUTHORS_INCARNATION);
  createCapabilityDeleteMutationPort(spec(AUTHORS), id, scope, undefined, reach).delete();
}

/** Every link row, as which record and field named which record. */
function rows(): string[] {
  const all = db()
    .query(`SELECT source_record, source_field, target_record FROM ${LINK_TABLE} ORDER BY 1, 2`)
    .all() as { source_record: string; source_field: string; target_record: string }[];
  return all.map((row) => `${row.source_record}.${row.source_field} → ${row.target_record}`);
}

const BUTLERS_ROW = `book-3.author → ${BUTLER}`;
const MEMOS_ROW = "memo-1.subject → book-1";

/** The desk with Books' author made required. */
const requiredAuthor = (catalog: readonly CapabilityRow[] = desk()) =>
  reshaped(catalog, "books", "author", { required: true });

describe("a deleted target record", () => {
  test("clears an optional field linked to it and lets its row go, and no other record", () => {
    deleteAuthor(LE_GUIN, reachOn(desk()));
    expect(texts("cap_books", "author")).toEqual({
      "book-1": null,
      "book-3": "Octavia E. Butler",
    });
    expect(rows()).toEqual([BUTLERS_ROW]);
  });

  test("keeps a required field's text, the last name it showed, and lets its row go", () => {
    deleteAuthor(LE_GUIN, reachOn(requiredAuthor()));
    expect(texts("cap_books", "author")).toEqual({
      "book-1": "Ursula K. Le Guin",
      "book-3": "Octavia E. Butler",
    });
    expect(rows()).toEqual([BUTLERS_ROW, MEMOS_ROW]);
  });

  test("lets the links through a field it cleared go, and moves no text down the chain", () => {
    deleteAuthor(LE_GUIN, reachOn(desk()));
    expect(texts("cap_memos", "subject")).toEqual({ "memo-1": "Ursula K. Le Guin" });
    expect(rows()).not.toContain(MEMOS_ROW);
  });

  test("lets a dormant relation's links through a field it cleared go, so a wake writes nothing", () => {
    deleteAuthor(LE_GUIN, reachOn(hidden(desk(), "memos", "subject")));
    expect(rows()).toEqual([BUTLERS_ROW]);
    db().run(`UPDATE "cap_books" SET "author" = 'Octavia E. Butler' WHERE "id" = 'book-1'`);
    writeLinkRow(
      db(),
      { capability: "books", record: "book-1", field: "author" },
      toAuthor(BUTLER),
    );
    const memos = { capability: MEMOS.id, incarnation: MEMOS.incarnation };
    reviveLinkedText(db(), { source: memos, relation: MEMO_SUBJECT }, NO_REACH);
    expect(texts("cap_memos", "subject")).toEqual({ "memo-1": "Ursula K. Le Guin" });
  });

  test("leaves a field whose relation points elsewhere, though a stray row names the record", () => {
    const toBookAuthor: Relation = { field: "name", to: { ...MEMO_SUBJECT.to } };
    writeLinkRow(db(), { capability: "authors", record: BUTLER, field: "name" }, toAuthor(LE_GUIN));
    deleteAuthor(LE_GUIN, reachOn(desk({ authors: [toBookAuthor], books: [BOOK_AUTHOR] })));
    expect(texts("cap_authors", "name")).toEqual({ [BUTLER]: "Octavia E. Butler" });
    expect(rows()).toEqual([BUTLERS_ROW, MEMOS_ROW]);
  });

  test("clears each of a record's optional fields linked to it, and keeps each required one", () => {
    writeLinkRow(
      db(),
      { capability: "books", record: "book-1", field: "title" },
      toAuthor(LE_GUIN),
    );
    db().run(`UPDATE "cap_books" SET "title" = 'Le Guin' WHERE "id" = 'book-1'`);
    const catalog = desk({ books: [BOOK_AUTHOR, BOOK_TITLE], memos: [MEMO_SUBJECT] });
    deleteAuthor(LE_GUIN, reachOn(requiredAuthor(catalog)));
    expect(texts("cap_books", "author")["book-1"]).toBe("Ursula K. Le Guin");
    expect(texts("cap_books", "title")["book-1"]).toBeNull();
    expect(rows()).toEqual([BUTLERS_ROW, MEMOS_ROW]);
  });

  test("clears a field of its own capability linked to it, and the links through it go", () => {
    const toPenName: Relation = { field: "name", to: { ...BOOK_TITLE.to } };
    writeLinkRow(db(), { capability: "authors", record: BUTLER, field: "name" }, toAuthor(LE_GUIN));
    const catalog = desk({ authors: [toPenName], books: [BOOK_AUTHOR], memos: [MEMO_SUBJECT] });
    deleteAuthor(LE_GUIN, reachOn(catalog));
    expect(texts("cap_authors", "name")).toEqual({ [BUTLER]: null });
    expect(texts("cap_books", "author")).toEqual({ "book-1": null, "book-3": "Octavia E. Butler" });
    expect(rows()).toEqual([]);
  });

  test.each([
    ["its source field hidden", () => hidden(desk(), "books", "author")],
    ["its target field hidden", () => hidden(desk(), "authors", "name")],
    ["required, its source field hidden", () => hidden(requiredAuthor(), "books", "author")],
  ])("keeps the text behind a dormant relation, %s, and lets its rows go", (_, catalog) => {
    const reach = reachOn(catalog());
    expect(reach.relations.find(({ relation }) => relation === BOOK_AUTHOR)?.holds).toBe(false);
    deleteAuthor(LE_GUIN, reach);
    expect(texts("cap_books", "author")["book-1"]).toBe("Ursula K. Le Guin");
    expect(rows()).toEqual([BUTLERS_ROW, MEMOS_ROW]);
  });

  test("keeps the text in a capability it may not write, and lets its rows go", () => {
    deleteAuthor(LE_GUIN, reachOn(desk(), ["books"]));
    expect(texts("cap_books", "author")["book-1"]).toBe("Ursula K. Le Guin");
    expect(rows()).toEqual([BUTLERS_ROW, MEMOS_ROW]);
  });

  test("handed no reach, as the Gate's is, clears nothing and lets the rows naming it go", () => {
    deleteAuthor(LE_GUIN, NO_REACH);
    expect(texts("cap_books", "author")["book-1"]).toBe("Ursula K. Le Guin");
    expect(rows()).toEqual([BUTLERS_ROW, MEMOS_ROW]);
  });

  test("lets go of the picks it made itself", () => {
    writeLinkRow(db(), { capability: "authors", record: LE_GUIN, field: "name" }, toAuthor(BUTLER));
    deleteAuthor(LE_GUIN, reachOn(desk()));
    expect(rows()).toEqual([BUTLERS_ROW]);
  });

  test("writes nothing when a linked field's write fails: the deletion's savepoint holds it all", () => {
    db().exec(
      `CREATE TRIGGER refuse BEFORE UPDATE ON "cap_books" BEGIN SELECT RAISE(ABORT, 'no'); END`,
    );
    const before = rows();
    expect(() => deleteAuthor(LE_GUIN, reachOn(desk()))).toThrow();
    expect(texts("cap_authors", "name")[LE_GUIN]).toBe("Ursula K. Le Guin");
    expect(texts("cap_books", "author")["book-1"]).toBe("Ursula K. Le Guin");
    expect(rows()).toEqual(before);
  });
});
