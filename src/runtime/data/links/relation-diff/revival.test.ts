// A relation an activation wakes, at the tables: each field it reaches shows its target's
// text as it is now, the text goes on down every chain, a row naming no record that holds a name
// lets go, and the names typed while it slept are matched as every boot matches them.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { holdsName } from "#shell/core/same-text.js";
import { LINK_TABLE } from "../../../../platform/links/link-table.ts";
import { FIFTH_INCARNATION_ID } from "../../../../registry/incarnations.test-support.ts";
import type { CapabilityRow } from "../../../../registry/index.ts";
import { BOOKS, MEMOS } from "../../../../server/routes/lifecycle/link.test-support.ts";
import {
  BUTLER,
  closeDesk,
  db,
  desk,
  hidden,
  LE_GUIN,
  linked,
  openDesk,
  reshaped,
  texts,
  toAuthor,
  toBook,
} from "../linked-text.test-support.ts";
import { applyRelationWork, relationDiff } from "./relation-diff.ts";

beforeEach(() => openDesk());
afterEach(() => closeDesk());

/** Books' author read Authors' name while the rule that names were at most 120 long was broken. */
const tooLong = () => reshaped(desk(), "authors", "name", { max_length: 400 });

function wake(before: readonly CapabilityRow[]): void {
  const done = applyRelationWork(db(), relationDiff({ kind: "activation", before, after: desk() }));
  expect(done).not.toBeNull();
}

function rename(author: string, name: string): void {
  db().run('UPDATE "cap_authors" SET "name" = ? WHERE "id" = ?', [name, author]);
}

function rowsOf(record: string): unknown[] {
  return db().query(`SELECT * FROM ${LINK_TABLE} WHERE source_record = ?`).all(record);
}

describe("a woken relation shows its target's text as it is now", () => {
  test("a field hidden while its target was renamed shows the new name, down the chain", () => {
    linked(BOOKS, "author", "book-1", "Ursula K. Le Guin", toAuthor(LE_GUIN));
    linked(MEMOS, "subject", "memo-1", "Ursula K. Le Guin", toBook("book-1"));
    rename(LE_GUIN, "Ursula Le Guin");

    wake(hidden(desk(), "books", "author"));

    expect(texts("cap_books", "author")["book-1"]).toBe("Ursula Le Guin");
    expect(texts("cap_memos", "subject")["memo-1"]).toBe("Ursula Le Guin");
    expect(rowsOf("book-1")).toHaveLength(1);
  });

  test("a relation that held all along below the woken field follows it too", () => {
    linked(BOOKS, "author", "book-1", "Ursula K. Le Guin", toAuthor(LE_GUIN));
    linked(MEMOS, "subject", "memo-1", "Ursula K. Le Guin", toBook("book-1"));
    rename(LE_GUIN, "Ursula Le Guin");

    wake(tooLong());

    expect(texts("cap_books", "author")["book-1"]).toBe("Ursula Le Guin");
    expect(texts("cap_memos", "subject")["memo-1"]).toBe("Ursula Le Guin");
  });

  test("only the records whose rows name a target record are rewritten", () => {
    linked(BOOKS, "author", "book-1", "Ursula K. Le Guin", toAuthor(LE_GUIN));
    linked(BOOKS, "author", "book-typed", "Typed while it slept");
    rename(LE_GUIN, "Ursula Le Guin");

    wake(tooLong());

    expect(texts("cap_books", "author")).toEqual({
      "book-1": "Ursula Le Guin",
      "book-typed": "Typed while it slept",
    });
    expect(rowsOf("book-typed")).toEqual([]);
  });
});

describe("a woken relation's rows that lead nowhere let go", () => {
  test("a row naming a record that holds no name goes, and the field keeps its text", () => {
    linked(BOOKS, "author", "book-2", "Octavia E. Butler", toAuthor(BUTLER));
    rename(BUTLER, "  ");
    expect(holdsName("  ")).toBe(false);

    wake(tooLong());

    expect(rowsOf("book-2")).toEqual([]);
    expect(texts("cap_books", "author")["book-2"]).toBe("Octavia E. Butler");
  });

  test("a row naming a record since deleted goes, and the field keeps its text", () => {
    linked(BOOKS, "author", "book-3", "Gone", toAuthor("author-gone"));

    wake(tooLong());

    expect(rowsOf("book-3")).toEqual([]);
    expect(texts("cap_books", "author")["book-3"]).toBe("Gone");
  });

  test("a row naming another lifetime of the target is left as it is", () => {
    const earlier = { ...toAuthor(LE_GUIN), incarnation: FIFTH_INCARNATION_ID };
    linked(BOOKS, "author", "book-4", "Kept", earlier);

    wake(tooLong());

    expect(rowsOf("book-4")).toEqual([
      expect.objectContaining({ target_incarnation: FIFTH_INCARNATION_ID }),
    ]);
    expect(texts("cap_books", "author")["book-4"]).toBe("Kept");
  });
});

describe("names typed while a relation slept", () => {
  test("one naming exactly one target record is linked, its text untouched", () => {
    linked(BOOKS, "author", "book-5", " octavia e. butler ");
    linked(BOOKS, "author", "book-6", "Nobody at all");

    wake(tooLong());

    expect(rowsOf("book-5")).toEqual([expect.objectContaining({ target_record: BUTLER })]);
    expect(texts("cap_books", "author")["book-5"]).toBe(" octavia e. butler ");
    expect(rowsOf("book-6")).toEqual([]);
  });

  test("a relation still asleep after the activation is left alone", () => {
    linked(BOOKS, "author", "book-1", "Ursula K. Le Guin", toAuthor(LE_GUIN));
    linked(BOOKS, "author", "book-5", "Octavia E. Butler");
    rename(LE_GUIN, "Ursula Le Guin");

    const asleep = tooLong();
    applyRelationWork(db(), relationDiff({ kind: "activation", before: desk(), after: asleep }));

    expect(texts("cap_books", "author")["book-1"]).toBe("Ursula K. Le Guin");
    expect(rowsOf("book-1")).toHaveLength(1);
    expect(rowsOf("book-5")).toEqual([]);
  });
});
