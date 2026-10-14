import { describe, expect, test } from "bun:test";

import {
  FIFTH_INCARNATION_ID,
  SEVENTH_INCARNATION_ID,
  SIXTH_INCARNATION_ID,
  UNKNOWN_INCARNATION_ID,
} from "../../registry/incarnations.test-support.ts";
import type { CapabilityRow, Relation } from "../../registry/index.ts";
import {
  AUTHORS,
  BOOKS,
  deskRow,
  MEMOS,
  READING_LOG,
  textField,
} from "../../server/routes/lifecycle/link.test-support.ts";
import { type LinkEnd, linkRefusal, linkTargets, sourceRefusal } from "./rules.ts";

const end = (row: CapabilityRow, field: string): LinkEnd => ({ row, field });

function withRelations(row: CapabilityRow, relations: readonly Relation[]): CapabilityRow {
  return { ...row, relations: [...relations] };
}

function hidden(row: CapabilityRow, field: string): CapabilityRow {
  const fields = row.schema.fields.map((candidate) =>
    candidate.name === field ? { ...candidate, lifecycle: "inactive" as const } : candidate,
  );
  return { ...row, schema: { fields } };
}

const relation = (field: string, row: CapabilityRow, to: string): Relation => ({
  field,
  to: { capability: row.id, incarnation: row.incarnation_id, field: to },
});

/** Two capabilities with no length limits, so only the loop rule can refuse between them. */
const PLAIN_P = deskRow({
  id: "p",
  label: "P",
  noun: "p",
  plural: "ps",
  incarnation: FIFTH_INCARNATION_ID,
  fields: [textField("a", "A"), textField("b", "B")],
});
const PLAIN_R = deskRow({
  id: "r",
  label: "R",
  noun: "r",
  plural: "rs",
  incarnation: SEVENTH_INCARNATION_ID,
  fields: [textField("a", "A")],
});
const PLAIN_Q = deskRow({
  id: "q",
  label: "Q",
  noun: "q",
  plural: "qs",
  incarnation: SIXTH_INCARNATION_ID,
  fields: [textField("a", "A"), textField("b", "B")],
});

describe("the four rules", () => {
  const books = deskRow(BOOKS);
  const authors = deskRow(AUTHORS);
  const log = deskRow(READING_LOG);
  const memos = deskRow(MEMOS);
  const catalog = [authors, books, log, memos];

  test("the source is an active single-line text field holding no relation", () => {
    expect(sourceRefusal(end(books, "author"))).toBeNull();
    for (const field of ["notes", "pages", "isbn", "nope"]) {
      expect(sourceRefusal(end(books, field))).toBe("source_not_linkable");
    }
    const linked = withRelations(books, [relation("author", authors, "name")]);
    expect(sourceRefusal(end(linked, "author"))).toBe("source_already_linked");
  });

  test("the target is an active single-line text field of another capability", () => {
    expect(linkRefusal(end(books, "author"), end(authors, "name"), catalog)).toBeNull();
    expect(linkRefusal(end(books, "author"), end(books, "title"), catalog)).toBe(
      "target_is_source",
    );
    for (const field of ["bio", "born", "nope"]) {
      expect(linkRefusal(end(books, "author"), end(authors, field), catalog)).toBe(
        "target_not_linkable",
      );
    }
    const hiddenName = hidden(authors, "name");
    expect(linkRefusal(end(books, "author"), end(hiddenName, "name"), catalog)).toBe(
      "target_not_linkable",
    );
  });

  test("the source's limit is absent or at least the target's", () => {
    expect(linkRefusal(end(books, "author"), end(authors, "pen_name"), catalog)).toBeNull();
    expect(linkRefusal(end(books, "author"), end(log, "title"), catalog)).toBe("target_too_long");
    expect(linkRefusal(end(books, "author"), end(memos, "subject"), catalog)).toBe(
      "target_too_long",
    );
    expect(linkRefusal(end(memos, "subject"), end(log, "title"), catalog)).toBeNull();
  });
});

describe("a target that is itself a linked source", () => {
  test("is allowed, however long the chain", () => {
    const q = withRelations(PLAIN_Q, [relation("a", PLAIN_P, "b")]);
    expect(linkRefusal(end(PLAIN_P, "a"), end(q, "a"), [PLAIN_P, q])).toBeNull();
  });

  test("is refused when the chain comes back to the source", () => {
    const q = withRelations(PLAIN_Q, [relation("a", PLAIN_P, "a")]);
    expect(linkRefusal(end(PLAIN_P, "a"), end(q, "a"), [PLAIN_P, q])).toBe("link_would_loop");
  });

  test("counts a dormant relation, so reviving a field can never close a loop", () => {
    // R.a follows P.b, and P.b follows Q.a. P.b is hidden, so both relations are dormant; Q.a
    // following R.a would close Q.a → R.a → P.b → Q.a the day P.b comes back.
    const r = withRelations(PLAIN_R, [relation("a", PLAIN_P, "b")]);
    const p = hidden(withRelations(PLAIN_P, [relation("b", PLAIN_Q, "a")]), "b");
    expect(linkRefusal(end(PLAIN_Q, "a"), end(r, "a"), [p, PLAIN_Q, r])).toBe("link_would_loop");
  });

  test("a relation whose target lifetime is over leads nowhere", () => {
    const gone = { capability: PLAIN_P.id, incarnation: UNKNOWN_INCARNATION_ID, field: "a" };
    const q = withRelations(PLAIN_Q, [{ field: "a", to: gone }]);
    expect(linkRefusal(end(PLAIN_P, "a"), end(q, "a"), [PLAIN_P, q])).toBeNull();
  });
});

describe("the targets a source is offered", () => {
  test("are every pair the rules admit, in catalog then schema order", () => {
    const catalog = [deskRow(AUTHORS), deskRow(BOOKS), deskRow(READING_LOG), deskRow(MEMOS)];
    const books = catalog[1] as CapabilityRow;
    const offered = (row: CapabilityRow, field: string) =>
      linkTargets(end(row, field), catalog).map((target) => `${target.row.id}.${target.field}`);
    expect(offered(books, "author")).toEqual(["authors.name", "authors.pen_name"]);
    expect(offered(catalog[3] as CapabilityRow, "subject")).toEqual([
      "authors.name",
      "authors.pen_name",
      "books.title",
      "books.author",
      "reading_log.title",
    ]);
  });
});
