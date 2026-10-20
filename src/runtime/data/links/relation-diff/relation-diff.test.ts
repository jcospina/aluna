// The relation diff: Link, the link step, Unlink, a deletion and an activation each map to
// platform work on the registry row, the matching scan and the link rows. None of it is a version.
// An activation re-decides no relation: the only work it ever has is waking one whose rules hold again.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { LINK_TABLE, writeLinkRow } from "../../../../platform/links/link-table.ts";
import {
  type CapabilityRow,
  getCapability,
  insertCapability,
  listCapabilities,
} from "../../../../registry/index.ts";
import { BOOKS_INCARNATION } from "../../../../server/routes/lifecycle/link.test-support.ts";
import {
  BOOK_AUTHOR,
  closeDesk,
  db,
  desk,
  hidden,
  LE_GUIN,
  longText,
  MEMO_SUBJECT,
  openDesk,
  reshaped,
  toAuthor,
} from "../linked-text.test-support.ts";
import { applyRelationWork, type RelationWork, relationDiff } from "./relation-diff.ts";

const row = (catalog: readonly CapabilityRow[], id: string) => {
  const found = catalog.find((each) => each.id === id);
  if (!found) throw new Error(`${id} is not on the desk`);
  return found;
};

const kinds = (work: readonly RelationWork[]) => work.map((each) => each.kind);

describe("each relation change maps to platform work", () => {
  const catalog = desk({});
  const books = row(catalog, "books");

  test("Link writes the relation on the row as read, then matches the names the field holds", () => {
    const target = row(catalog, "authors");
    const work = relationDiff({ kind: "link", source: books, target, relation: BOOK_AUTHOR });
    expect(work).toEqual([
      {
        kind: "write_relations",
        expectation: {
          capabilityId: "books",
          incarnationId: BOOKS_INCARNATION,
          version: books.version,
          relations: [],
        },
        relations: [BOOK_AUTHOR],
      },
      { kind: "match_typed_names", source: books, target, relation: BOOK_AUTHOR },
    ]);
  });

  test("Unlink writes the row without the field's relation, then forgets the field's picks", () => {
    const title = { ...BOOK_AUTHOR, field: "title" };
    const linkedBooks = { ...books, relations: [BOOK_AUTHOR, title] };
    const work = relationDiff({ kind: "unlink", source: linkedBooks, field: "author" });
    expect(work).toEqual([
      {
        kind: "write_relations",
        expectation: {
          capabilityId: "books",
          incarnationId: BOOKS_INCARNATION,
          version: books.version,
          relations: [BOOK_AUTHOR, title],
        },
        relations: [title],
      },
      { kind: "delete_field_link_rows", capability: "books", field: "author" },
    ]);
  });

  test("fields no record has a value in are linked beside the row's relations, with no matching scan", () => {
    const title = { ...BOOK_AUTHOR, field: "title" };
    const linkedBooks = { ...books, relations: [BOOK_AUTHOR] };
    const work = relationDiff({ kind: "link_new_fields", source: linkedBooks, relations: [title] });
    expect(work).toStrictEqual([
      {
        kind: "write_relations",
        expectation: {
          capabilityId: "books",
          incarnationId: BOOKS_INCARNATION,
          version: books.version,
          relations: [BOOK_AUTHOR],
        },
        relations: [BOOK_AUTHOR, title],
      },
    ]);
  });

  test("a deletion takes the relations pinned to its lifetime, then every pick it is an end of", () => {
    const deleted = { capabilityId: "authors", incarnationId: BOOK_AUTHOR.to.incarnation };
    expect(relationDiff({ kind: "deletion", deleted })).toEqual([
      { kind: "remove_relations_to", deleted },
      { kind: "delete_capability_link_rows", capability: "authors" },
    ]);
  });
});

describe("an activation carries every relation forward and re-decides none", () => {
  test("relations that held and still hold, or slept and still sleep, need no work", () => {
    expect(relationDiff({ kind: "activation", before: desk(), after: desk() })).toEqual([]);
    const asleep = hidden(desk(), "authors", "name");
    expect(relationDiff({ kind: "activation", before: asleep, after: asleep })).toEqual([]);
  });

  test("a relation put to sleep keeps its link rows: hiding either end, or breaking a rule", () => {
    for (const after of [
      hidden(desk(), "books", "author"),
      hidden(desk(), "authors", "name"),
      reshaped(desk(), "authors", "name", { max_length: 400 }),
      reshaped(desk(), "books", "author", { max_length: 20 }),
      longText(desk(), "books", "author"),
      longText(desk(), "authors", "name"),
    ]) {
      expect(relationDiff({ kind: "activation", before: desk(), after })).toEqual([]);
    }
  });

  test("a relation that wakes is refreshed from its link rows, then its typed names are matched", () => {
    const after = desk();
    const work = relationDiff({
      kind: "activation",
      before: hidden(desk(), "authors", "name"),
      after,
    });
    const books = row(after, "books");
    expect(work).toEqual([
      {
        kind: "refresh_from_link_rows",
        revived: {
          source: { capability: "books", incarnation: BOOKS_INCARNATION },
          relation: BOOK_AUTHOR,
        },
        reach: expect.arrayContaining([expect.objectContaining({ relation: MEMO_SUBJECT })]),
      },
      {
        kind: "match_unlinked_names",
        source: books,
        target: row(after, "authors"),
        relation: BOOK_AUTHOR,
      },
    ]);
  });

  test("a rule that holds again wakes its relation, whichever end the activation changed", () => {
    const authorOnly = () => desk({ books: [BOOK_AUTHOR] });
    for (const before of [
      reshaped(authorOnly(), "authors", "name", { max_length: 400 }),
      reshaped(authorOnly(), "authors", "name", { max_length: undefined }),
      reshaped(authorOnly(), "books", "author", { max_length: 20 }),
      longText(authorOnly(), "books", "author"),
      longText(authorOnly(), "authors", "name"),
    ]) {
      const work = relationDiff({ kind: "activation", before, after: authorOnly() });
      expect(kinds(work)).toEqual(["refresh_from_link_rows", "match_unlinked_names"]);
    }
  });

  test("a hidden field in a chain wakes both its relations, every refresh before any scan", () => {
    const work = relationDiff({
      kind: "activation",
      before: hidden(desk(), "books", "author"),
      after: desk(),
    });
    expect(kinds(work)).toEqual([
      "refresh_from_link_rows",
      "refresh_from_link_rows",
      "match_unlinked_names",
      "match_unlinked_names",
    ]);
  });

  test("a capability new to the desk wakes nothing", () => {
    const withoutMemos = desk().filter((each) => each.id !== "memos");
    expect(relationDiff({ kind: "activation", before: withoutMemos, after: desk() })).toEqual([]);
  });
});

describe("the work, done on the registry and the tables", () => {
  beforeEach(() => openDesk());
  afterEach(() => closeDesk());

  test("a relation write that finds its row moved undoes every piece of work", () => {
    const catalog = desk({});
    for (const each of catalog) insertCapability(each, db());
    writeLinkRow(
      db(),
      { capability: "books", record: "book-1", field: "author" },
      toAuthor(LE_GUIN),
    );
    const moved = { ...row(catalog, "books"), relations: [MEMO_SUBJECT] };
    const [write, forget] = relationDiff({ kind: "unlink", source: moved, field: "author" });
    if (!write || !forget) throw new Error("Unlink maps to two pieces of work");

    expect(applyRelationWork(db(), [forget, write])).toBeNull();
    const rows = db().query(`SELECT count(*) AS n FROM ${LINK_TABLE}`).get() as { n: number };
    expect(rows.n).toBe(1);
    expect(getCapability("books", db())?.relations).toEqual([]);
  });

  test("no change's work moves a row's version or its artifacts", () => {
    for (const each of desk({})) insertCapability(each, db());
    const versions = () =>
      listCapabilities(db()).map(({ id, version, artifacts_path }) => [
        id,
        version,
        artifacts_path,
      ]);
    const before = versions();
    const live = (id: string) => row(listCapabilities(db()), id);
    const link = { kind: "link", relation: BOOK_AUTHOR } as const;
    const apply = (work: RelationWork[]) => expect(applyRelationWork(db(), work)).not.toBeNull();

    apply(relationDiff({ ...link, source: live("books"), target: live("authors") }));
    expect(live("books").relations).toEqual([BOOK_AUTHOR]);
    apply(relationDiff({ kind: "unlink", source: live("books"), field: "author" }));
    apply(relationDiff({ ...link, source: live("books"), target: live("authors") }));
    const asleep = hidden(listCapabilities(db()), "authors", "name");
    apply(relationDiff({ kind: "activation", before: asleep, after: listCapabilities(db()) }));
    const deleted = { capabilityId: "authors", incarnationId: BOOK_AUTHOR.to.incarnation };
    apply(relationDiff({ kind: "deletion", deleted }));

    expect(live("books").relations).toEqual([]);
    expect(versions()).toEqual(before);
  });
});
