// The link table: built by the migrations and on every Gate scratch database, indexed from
// both ends, written and read by the platform alone, and out of a Handler's query scope.

import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openScratchDatabasePair } from "../../builder/gate/gate-internal.ts";
import { notesSpec } from "../../registry/spec/spec.test-support.ts";
import {
  applyCapabilityTableDdl,
  CapabilityDataValidationError,
  createCapabilityQueryPort,
  deriveCapabilityTableDdl,
} from "../../runtime/data/index.ts";
import {
  createScratchDbEnv,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../persistence/scratch-db.test-support.ts";
import {
  deleteCapabilityLinkRows,
  deleteFieldLinkRowsTo,
  deleteLinkRow,
  deleteSourceLinkRows,
  deleteTargetLinkRows,
  LINK_TABLE,
  type LinkEdge,
  type LinkTarget,
  readLinksFrom,
  readLinksTo,
  readSourceLinkRows,
  writeLinkRow,
} from "./link-table.ts";

const SANDERSON: LinkTarget = {
  capability: "authors",
  incarnation: "authors-1",
  record: "author-2",
};
const LE_GUIN: LinkTarget = { ...SANDERSON, record: "author-0" };
const MISTBORN_AUTHOR = { capability: "books", record: "book-1", field: "author" };

let env: ScratchDbEnv;

beforeEach(() => {
  env = createScratchDbEnv("omni-crud-link-table-");
});

afterEach(() => teardownScratchDbEnv(env));

/** The index SQLite plans `sql` through, as `EXPLAIN QUERY PLAN` names it. */
function planOf(database: Database, sql: string, ...parameters: string[]): string {
  const rows = database.query(`EXPLAIN QUERY PLAN ${sql}`).all(...parameters) as {
    detail: string;
  }[];
  return rows.map((row) => row.detail).join("; ");
}

/** Whether `database` holds the link table, and the index each end's lookup is planned through. */
function shapeOf(database: Database) {
  const table = database
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(LINK_TABLE);
  return {
    table: table !== null,
    fromSource: planOf(
      database,
      `SELECT * FROM ${LINK_TABLE} WHERE source_capability = ? AND source_record = ?`,
      "books",
      "book-1",
    ),
    fromTarget: planOf(
      database,
      `SELECT * FROM ${LINK_TABLE}
       WHERE target_capability = ? AND target_incarnation = ? AND target_record = ?`,
      "authors",
      "authors-1",
      "author-2",
    ),
  };
}

describe("where the table is", () => {
  test("the migrations build it, searchable from the source end and from the target end", () => {
    const shape = shapeOf(env.conns.readwrite);
    expect(shape.table).toBe(true);
    expect(shape.fromSource).toContain(`USING INDEX sqlite_autoindex_${LINK_TABLE}_1`);
    expect(shape.fromTarget).toContain(`USING INDEX ${LINK_TABLE}_target`);
  });

  test("every Gate scratch database builds it the same way", () => {
    const scratch = openScratchDatabasePair();
    try {
      expect(shapeOf(scratch.readwrite)).toEqual(shapeOf(env.conns.readwrite));
    } finally {
      scratch.readonly.close();
      scratch.readwrite.close();
    }
  });
});

describe("a row", () => {
  test("names what one record's field picked, and a second pick replaces the first", () => {
    const database = env.conns.readwrite;
    writeLinkRow(database, MISTBORN_AUTHOR, SANDERSON);
    expect(readSourceLinkRows(database, "books", "book-1")).toEqual(
      new Map([["author", SANDERSON]]),
    );
    writeLinkRow(database, MISTBORN_AUTHOR, LE_GUIN);
    expect(readSourceLinkRows(database, "books", "book-1")).toEqual(new Map([["author", LE_GUIN]]));
  });

  test("goes alone, or with every row its record holds, and never another record's", () => {
    const database = env.conns.readwrite;
    const editor = { ...MISTBORN_AUTHOR, field: "editor" };
    writeLinkRow(database, MISTBORN_AUTHOR, SANDERSON);
    writeLinkRow(database, editor, LE_GUIN);
    writeLinkRow(database, { ...MISTBORN_AUTHOR, record: "book-2" }, SANDERSON);
    deleteLinkRow(database, editor);
    expect([...readSourceLinkRows(database, "books", "book-1").keys()]).toEqual(["author"]);
    deleteSourceLinkRows(database, "books", "book-1");
    expect(readSourceLinkRows(database, "books", "book-1")).toEqual(new Map());
    expect(readSourceLinkRows(database, "books", "book-2")).toEqual(
      new Map([["author", SANDERSON]]),
    );
  });

  test("naming one record goes with it, or only one field's, and no other (8.1/06)", () => {
    const database = env.conns.readwrite;
    const editor = { ...MISTBORN_AUTHOR, field: "editor" };
    const quote = { capability: "quotes", record: "quote-1", field: "by" };
    const elsewhere = { ...SANDERSON, incarnation: "authors-0" };
    writeLinkRow(database, MISTBORN_AUTHOR, SANDERSON);
    writeLinkRow(database, editor, SANDERSON);
    writeLinkRow(database, quote, SANDERSON);
    writeLinkRow(database, { ...MISTBORN_AUTHOR, record: "book-2" }, LE_GUIN);
    writeLinkRow(database, { ...MISTBORN_AUTHOR, record: "book-3" }, elsewhere);
    const picked = (record: string) => readSourceLinkRows(database, "books", record);
    deleteFieldLinkRowsTo(database, { capability: "books", field: "author" }, SANDERSON);
    expect(picked("book-1")).toEqual(new Map([["editor", SANDERSON]]));
    expect(readSourceLinkRows(database, "quotes", "quote-1")).toEqual(new Map([["by", SANDERSON]]));
    deleteTargetLinkRows(database, SANDERSON);
    expect(picked("book-1")).toEqual(new Map());
    expect(readSourceLinkRows(database, "quotes", "quote-1")).toEqual(new Map());
    expect(picked("book-2")).toEqual(new Map([["author", LE_GUIN]]));
    expect(picked("book-3")).toEqual(new Map([["author", elsewhere]]));
  });

  test("goes with its capability at either end, in every lifetime, and no other's (8.1/07)", () => {
    const database = env.conns.readwrite;
    const byAuthor = { capability: "authors", record: "author-0", field: "mentor" };
    const people = { capability: "people", incarnation: "people-1", record: "person-1" };
    const quote = { capability: "quotes", record: "quote-1", field: "by" };
    writeLinkRow(database, MISTBORN_AUTHOR, SANDERSON);
    writeLinkRow(database, byAuthor, people);
    writeLinkRow(database, quote, { ...SANDERSON, incarnation: "authors-0" });
    writeLinkRow(database, { ...quote, record: "quote-2" }, people);
    deleteCapabilityLinkRows(database, "authors");
    expect(readSourceLinkRows(database, "books", "book-1")).toEqual(new Map());
    expect(readSourceLinkRows(database, "authors", "author-0")).toEqual(new Map());
    expect(readSourceLinkRows(database, "quotes", "quote-1")).toEqual(new Map());
    expect(readSourceLinkRows(database, "quotes", "quote-2")).toEqual(new Map([["by", people]]));
  });
});

describe("a search's hop along one relation (8.5)", () => {
  const BOOK_AUTHOR: LinkEdge = {
    source: { capability: "books", field: "author" },
    target: { capability: "authors", incarnation: "authors-1" },
  };

  beforeEach(() => {
    const database = env.conns.readwrite;
    writeLinkRow(database, MISTBORN_AUTHOR, SANDERSON);
    writeLinkRow(database, { ...MISTBORN_AUTHOR, record: "book-2" }, SANDERSON);
    writeLinkRow(database, { ...MISTBORN_AUTHOR, record: "book-3" }, LE_GUIN);
    writeLinkRow(database, { ...MISTBORN_AUTHOR, field: "editor" }, LE_GUIN);
    writeLinkRow(
      database,
      { ...MISTBORN_AUTHOR, record: "book-4" },
      { ...LE_GUIN, incarnation: "authors-0" },
    );
    writeLinkRow(database, { capability: "quotes", record: "quote-1", field: "author" }, LE_GUIN);
  });

  test("back from the records picked: the rows of the records whose field picked one, in that lifetime", () => {
    const database = env.conns.readonly;
    const picking = (targets: string[]) =>
      readLinksTo(database, BOOK_AUTHOR, targets)
        .map((link) => link.source)
        .toSorted();
    expect(picking(["author-2"])).toEqual(["book-1", "book-2"]);
    expect(picking(["author-0", "author-2"])).toEqual(["book-1", "book-2", "book-3"]);
    expect(picking(["author-9"])).toEqual([]);
  });

  test("on from the records picking: the records their field picked, in that lifetime", () => {
    const database = env.conns.readonly;
    const picked = (sources: string[]) =>
      [
        ...new Set(readLinksFrom(database, BOOK_AUTHOR, sources).map((link) => link.target)),
      ].toSorted();
    expect(picked(["book-1", "book-2"])).toEqual(["author-2"]);
    expect(picked(["book-1", "book-3", "book-4"])).toEqual(["author-0", "author-2"]);
    expect(picked(["quote-1"])).toEqual([]);
  });
});

describe("a Handler's query", () => {
  test("cannot read the table, alone or joined to its own records", () => {
    const spec = notesSpec();
    applyCapabilityTableDdl(spec, env.conns.readwrite);
    writeLinkRow(env.conns.readwrite, { ...MISTBORN_AUTHOR, capability: "notes" }, SANDERSON);
    const port = createCapabilityQueryPort(env.conns.readonly, { target: spec });
    const own = deriveCapabilityTableDdl(spec).tableName;
    for (const sql of [
      `SELECT * FROM ${LINK_TABLE}`,
      `SELECT n."id" FROM "${own}" AS n JOIN ${LINK_TABLE} AS l ON l.source_record = n."id"`,
    ]) {
      expect(() => port.all({ sql, result: [] })).toThrow(CapabilityDataValidationError);
      expect(() => port.all({ sql, result: [] })).toThrow(LINK_TABLE);
    }
  });
});
