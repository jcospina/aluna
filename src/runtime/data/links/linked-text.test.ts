// The text a linked field shows is its target's, at the ports: a pick stores the target's
// text whatever the save was handed, an edit carries a target's new text down every chain in its own
// savepoint, and a target left holding no name lets its links go.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { LINK_TABLE, writeLinkRow } from "../../../platform/links/link-table.ts";
import { FIFTH_INCARNATION_ID } from "../../../registry/incarnations.test-support.ts";
import type { CapabilityRow, Relation } from "../../../registry/index.ts";
import {
  BOOKS,
  BOOKS_INCARNATION,
  type DeskCapability,
  deskRow,
  MEMOS,
  textField,
} from "../../../server/routes/lifecycle/link.test-support.ts";
import {
  applyCapabilityTableDdl,
  createCapabilityMutationPort,
  fieldsDrawnUnlinked,
  fileClaimScope,
  type LinkBinding,
  MaxLengthExceededError,
  materializeCapabilityActionRecord,
} from "../index.ts";
import {
  BOOK_AUTHOR,
  BOOK_TITLE,
  BUTLER,
  closeDesk,
  db,
  desk,
  editAuthor,
  hidden,
  LE_GUIN,
  linked,
  MEMO_SUBJECT,
  openDesk,
  picking,
  reachOn,
  spec,
  texts,
  toAuthor,
  toBook,
  updatePort,
} from "./linked-text.test-support.ts";

beforeEach(() => openDesk());

afterEach(() => closeDesk());

const linkCount = () =>
  (db().query(`SELECT count(*) AS n FROM ${LINK_TABLE}`).get() as { n: number }).n;

const bookFiles = () => ({
  scope: fileClaimScope(db(), spec(BOOKS), BOOKS_INCARNATION),
  submitted: new Map(),
});

const createBook = (links: LinkBinding, values: Record<string, unknown>) =>
  materializeCapabilityActionRecord(
    createCapabilityMutationPort(spec(BOOKS), bookFiles(), undefined, links).create(values),
  );

/** One more character than Books' author field takes. */
const tooLong = () =>
  "U".repeat((BOOKS.fields.find(({ name }) => name === "author")?.max_length ?? 0) + 1);

describe("the id wins", () => {
  test("a create stores the target's text, whatever its Handler handed over", () => {
    const book = createBook(picking(LE_GUIN), { title: "The Dispossessed", author: "URSULA" });
    expect(book.author).toBe("Ursula K. Le Guin");
    expect(texts("cap_books", "author")).toEqual({ [String(book.id)]: "Ursula K. Le Guin" });
  });

  test("a save whose Handler leaves the linked field out still stores the target's text", () => {
    expect(createBook(picking(LE_GUIN), { title: "The Lathe of Heaven" }).author).toBe(
      "Ursula K. Le Guin",
    );
    linked(BOOKS, "author", "book-1", "Ursula K. Le Guin", toAuthor(LE_GUIN));
    updatePort(BOOKS, "book-1", ["title", "author"], picking(BUTLER)).update({ title: "Kindred" });
    expect(texts("cap_books", "author")["book-1"]).toBe("Octavia E. Butler");
  });

  test("a save without a pick keeps the text its Handler handed over", () => {
    const unpicked: LinkBinding = { ...picking(LE_GUIN), picks: new Map() };
    expect(createBook(unpicked, { author: "Someone typed this" }).author).toBe(
      "Someone typed this",
    );
  });

  test("an edit posting old text stores the target's text as it is now", () => {
    linked(BOOKS, "author", "book-1", "Ursula K. Le Guin", toAuthor(LE_GUIN));
    db().run(`UPDATE "cap_authors" SET "name" = 'Ursula Le Guin' WHERE "id" = ?`, [LE_GUIN]);
    updatePort(BOOKS, "book-1", ["author"], picking(LE_GUIN)).update({
      author: "Ursula K. Le Guin",
    });
    expect(texts("cap_books", "author")).toEqual({ "book-1": "Ursula Le Guin" });
  });

  test("an edit that does not submit the linked field leaves it as it was", () => {
    linked(BOOKS, "author", "book-1", "Ursula K. Le Guin, as typed", toAuthor(LE_GUIN));
    updatePort(BOOKS, "book-1", ["title"], picking(LE_GUIN)).update({
      title: "Always Coming Home",
    });
    expect(texts("cap_books", "author")).toEqual({ "book-1": "Ursula K. Le Guin, as typed" });
  });

  test("the target's text is held to the linked field's length limit", () => {
    db().run(`UPDATE "cap_authors" SET "name" = ? WHERE "id" = ?`, [tooLong(), LE_GUIN]);
    expect(() => createBook(picking(LE_GUIN), { author: "Ursula" })).toThrow(
      MaxLengthExceededError,
    );
    linked(BOOKS, "author", "book-1", "Octavia E. Butler", toAuthor(BUTLER));
    const edit = updatePort(BOOKS, "book-1", ["author"], picking(LE_GUIN));
    expect(() => edit.update({ author: "Ursula" })).toThrow(MaxLengthExceededError);
    expect(texts("cap_books", "author")).toEqual({ "book-1": "Octavia E. Butler" });
  });
});

describe("an edit of a target", () => {
  beforeEach(() => {
    linked(BOOKS, "author", "book-1", "Ursula K. Le Guin", toAuthor(LE_GUIN));
    linked(BOOKS, "author", "book-2", "Ursula K. Le Guin", toAuthor(LE_GUIN));
    linked(BOOKS, "author", "book-3", "Octavia E. Butler", toAuthor(BUTLER));
    linked(BOOKS, "author", "book-typed", "Ursula K. Le Guin");
    linked(MEMOS, "subject", "memo-1", "Ursula K. Le Guin", toBook("book-1"));
    linked(MEMOS, "subject", "memo-3", "Octavia E. Butler", toBook("book-3"));
  });

  test("carries its new text to every field linked to it, down the chain", () => {
    editAuthor(LE_GUIN, { name: "Ursula Le Guin" }, reachOn(desk()));
    expect(texts("cap_books", "author")).toEqual({
      "book-1": "Ursula Le Guin",
      "book-2": "Ursula Le Guin",
      "book-3": "Octavia E. Butler",
      "book-typed": "Ursula K. Le Guin",
    });
    expect(texts("cap_memos", "subject")).toEqual({
      "memo-1": "Ursula Le Guin",
      "memo-3": "Octavia E. Butler",
    });
  });

  test("of a linked field, by a new pick, carries the new text on down its chain", () => {
    const reach = reachOn(desk(), [], "books");
    updatePort(BOOKS, "book-1", ["author"], { ...picking(BUTLER), reach }).update({ author: "" });
    expect(texts("cap_books", "author")["book-1"]).toBe("Octavia E. Butler");
    expect(texts("cap_memos", "subject")["memo-1"]).toBe("Octavia E. Butler");
  });

  test("that leaves the text as it was writes no linked field", () => {
    db().run(`UPDATE "cap_books" SET "author" = 'stale' WHERE "id" = 'book-1'`);
    editAuthor(LE_GUIN, { pen_name: "Le Guin, Ursula" }, reachOn(desk()));
    expect(texts("cap_books", "author")["book-1"]).toBe("stale");
  });

  test("writes no field whose relation does not hold, nor the chain below it", () => {
    editAuthor(LE_GUIN, { name: "Ursula Le Guin" }, reachOn(hidden(desk(), "books", "author")));
    expect(texts("cap_books", "author")["book-1"]).toBe("Ursula K. Le Guin");
    expect(texts("cap_memos", "subject")["memo-1"]).toBe("Ursula K. Le Guin");
  });

  test("skips a capability it may not write, and the chain below it", () => {
    editAuthor(LE_GUIN, { name: "Ursula Le Guin" }, reachOn(desk(), ["books"]));
    expect(texts("cap_books", "author")["book-1"]).toBe("Ursula K. Le Guin");
    expect(texts("cap_memos", "subject")["memo-1"]).toBe("Ursula K. Le Guin");

    editAuthor(LE_GUIN, { name: "U. K. Le Guin" }, reachOn(desk(), ["memos"]));
    expect(texts("cap_books", "author")["book-1"]).toBe("U. K. Le Guin");
    expect(texts("cap_memos", "subject")["memo-1"]).toBe("Ursula K. Le Guin");
  });

  test("carries the text down every chain, whatever order the relations are listed in", () => {
    const editors: DeskCapability = {
      id: "editors",
      label: "Editors",
      noun: "editor",
      plural: "editors",
      incarnation: FIFTH_INCARNATION_ID,
      fields: [textField("name", "Name", { max_length: 120 })],
    };
    const toEditor = { capability: "editors", incarnation: FIFTH_INCARNATION_ID };
    applyCapabilityTableDdl(spec(editors), db());
    linked(editors, "name", "editor-1", "Ursula K. Le Guin", toBook("book-1"));
    linked(MEMOS, "subject", "memo-editor", "Ursula K. Le Guin", {
      ...toEditor,
      record: "editor-1",
    });
    const catalog: CapabilityRow[] = [
      ...desk({
        books: [BOOK_AUTHOR],
        memos: [{ field: "subject", to: { ...toEditor, field: "name" } }],
      }),
      { ...deskRow(editors), relations: [{ field: "name", to: { ...MEMO_SUBJECT.to } }] },
    ];
    const reach = reachOn(catalog);
    editAuthor(
      LE_GUIN,
      { name: "Ursula Le Guin" },
      { ...reach, relations: reach.relations.toReversed() },
    );
    expect(texts("cap_editors", "name")).toEqual({ "editor-1": "Ursula Le Guin" });
    expect(texts("cap_memos", "subject")["memo-editor"]).toBe("Ursula Le Guin");
  });

  test("writes each field it reaches once, so a loop handed to it ends", () => {
    const loop: Relation = { field: "name", to: { ...MEMO_SUBJECT.to } };
    const catalog = desk({ books: [BOOK_AUTHOR], memos: [MEMO_SUBJECT], authors: [loop] });
    writeLinkRow(db(), { capability: "authors", record: BUTLER, field: "name" }, toBook("book-1"));
    const saved = editAuthor(LE_GUIN, { name: "Ursula Le Guin" }, reachOn(catalog));
    expect(saved.name).toBe("Ursula Le Guin");
    expect(texts("cap_books", "author")["book-1"]).toBe("Ursula Le Guin");
    expect(texts("cap_memos", "subject")["memo-1"]).toBe("Ursula Le Guin");
    expect(texts("cap_authors", "name")[BUTLER]).toBe("Ursula Le Guin");
  });

  test("hands back the record as the refresh left it when a field of its own is linked to it", () => {
    const own: Relation = { field: "name", to: { ...BOOK_TITLE.to } };
    writeLinkRow(db(), { capability: "authors", record: BUTLER, field: "name" }, toAuthor(BUTLER));
    const saved = editAuthor(
      BUTLER,
      { pen_name: "O. E. Butler" },
      reachOn(desk({ authors: [own] })),
    );
    expect(saved.name).toBe("O. E. Butler");
    expect(texts("cap_authors", "name")[BUTLER]).toBe("O. E. Butler");
  });

  test("writes nothing when a linked field's write fails: the edit's savepoint holds it all", () => {
    db().exec(
      `CREATE TRIGGER refuse BEFORE UPDATE ON "cap_memos" BEGIN SELECT RAISE(ABORT, 'no'); END`,
    );
    expect(() => editAuthor(LE_GUIN, { name: "Ursula Le Guin" }, reachOn(desk()))).toThrow();
    expect(texts("cap_authors", "name")[LE_GUIN]).toBe("Ursula K. Le Guin");
    expect(texts("cap_books", "author")["book-1"]).toBe("Ursula K. Le Guin");
  });
});

describe("a target left holding no name", () => {
  const catalog = () => desk({ books: [BOOK_AUTHOR, BOOK_TITLE], memos: [MEMO_SUBJECT] });

  beforeEach(() => {
    linked(BOOKS, "author", "book-1", "Ursula K. Le Guin", toAuthor(LE_GUIN));
    writeLinkRow(
      db(),
      { capability: "books", record: "book-1", field: "title" },
      toAuthor(LE_GUIN),
    );
    linked(BOOKS, "author", "book-3", "Octavia E. Butler", toAuthor(BUTLER));
  });

  const rows = () =>
    db()
      .query(`SELECT source_record, source_field, target_record FROM ${LINK_TABLE} ORDER BY 1, 2`)
      .all();

  const rest = [
    { source_record: "book-1", source_field: "title", target_record: LE_GUIN },
    { source_record: "book-3", source_field: "author", target_record: BUTLER },
  ];

  test("lets the links through that field go, and moves no text", () => {
    editAuthor(LE_GUIN, { name: null }, reachOn(catalog()));
    expect(rows()).toEqual(rest);
    expect(texts("cap_books", "author")["book-1"]).toBe("Ursula K. Le Guin");
  });

  test("counts text holding only spaces and invisible marks as no name", () => {
    editAuthor(LE_GUIN, { name: String.fromCodePoint(0x200b, 0x20) }, reachOn(catalog()));
    expect(texts("cap_books", "author")["book-1"]).toBe("Ursula K. Le Guin");
    expect(linkCount()).toBe(2);
  });

  test("lets a dormant relation's links through that field go too", () => {
    const reach = reachOn(hidden(catalog(), "books", "author"));
    expect(reach.relations.find(({ relation }) => relation === BOOK_AUTHOR)?.holds).toBe(false);
    editAuthor(LE_GUIN, { name: null }, reach);
    expect(rows()).toEqual(rest);
  });
});

describe("what the refresh reaches", () => {
  const reached = (catalog: readonly CapabilityRow[]) =>
    reachOn(catalog).relations.map(({ source, relation, holds }) => [
      source.capability,
      relation.field,
      holds,
    ]);

  test("is each relation that holds, down every chain", () => {
    expect(reached(desk())).toEqual([
      ["books", "author", true],
      ["memos", "subject", true],
    ]);
  });

  test("takes in each dormant relation pointing at a capability it reaches, and goes no further", () => {
    expect(reached(hidden(desk(), "memos", "subject"))).toEqual([
      ["books", "author", true],
      ["memos", "subject", false],
    ]);
    expect(reached(hidden(desk(), "books", "author"))).toEqual([["books", "author", false]]);
  });
});

describe("an Edit form drawn before its field was linked", () => {
  const stale = (author: string, drawnLinked?: ReadonlySet<string>) =>
    fieldsDrawnUnlinked(db(), { capabilityId: "books", recordId: "book-1" }, [BOOK_AUTHOR], {
      values: { author },
      submittedFields: new Set(["author"]),
      ...(drawnLinked === undefined ? {} : { drawnLinked }),
    });

  test("is stale once it holds other text than the record's, a change of case or emptied", () => {
    linked(BOOKS, "author", "book-1", "Ursula Le Guin", toAuthor(LE_GUIN));
    for (const other of ["Ursula K. Le Guin", "ursula le guin", " Ursula Le Guin", ""]) {
      expect(stale(other)).toEqual(["author"]);
    }
    expect(stale("Ursula Le Guin")).toEqual([]);
  });

  test("is not, for a field it drew linked or one whose record picks nothing", () => {
    linked(BOOKS, "author", "book-1", "Ursula Le Guin", toAuthor(LE_GUIN));
    expect(stale("Someone else", new Set(["author"]))).toEqual([]);
    db().run(`DELETE FROM ${LINK_TABLE}`);
    expect(stale("Someone else")).toEqual([]);
  });
});
