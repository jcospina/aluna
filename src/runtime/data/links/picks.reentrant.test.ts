// A save started from inside another: reading a `string[]` value a Handler handed
// over runs its code, which can call the port again before the first save writes. One submission's
// pick still links one record, and the linked-text refresh still leaves no field behind its target.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { LINK_TABLE, writeLinkRow } from "../../../platform/links/link-table.ts";
import {
  createScratchDbEnv,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../../../platform/persistence/scratch-db.test-support.ts";
import { type CapabilityRow, relationsReaching } from "../../../registry/index.ts";
import {
  AUTHORS,
  AUTHORS_INCARNATION,
  BOOKS,
  BOOKS_INCARNATION,
  type DeskCapability,
  deskRow,
} from "../../../server/routes/lifecycle/link.test-support.ts";
import { rowSpec } from "../../router/dispatch/router.test-support.ts";
import {
  applyCapabilityTableDdl,
  createCapabilityMutationPort,
  createCapabilityUpdateMutationPort,
  fileClaimScope,
  NO_LINKS,
  PickWriteError,
} from "../index.ts";
import { BOOK_AUTHOR, LE_GUIN } from "./linked-text.test-support.ts";

/** A desk capability with a list of tags, so a value it is handed can run code inside a save. */
function tagged(capability: DeskCapability, relations: CapabilityRow["relations"] = []) {
  const base = deskRow({
    ...capability,
    fields: [
      ...capability.fields,
      { name: "tags", label: "Tags", type: "string[]", required: false, lifecycle: "active" },
    ],
  });
  const form = {
    ...base.ui_intent.form,
    list_inputs: [{ field: "tags", mode: "comma_separated" as const }],
  };
  return { ...base, ui_intent: { ...base.ui_intent, form }, relations: [...relations] };
}

const AUTHORS_ROW = tagged(AUTHORS);
const BOOKS_ROW = tagged(BOOKS, [BOOK_AUTHOR]);

let env: ScratchDbEnv;
const db = () => env.conns.readwrite;

beforeEach(() => {
  env = createScratchDbEnv("omni-crud-reentrant-saves-");
  applyCapabilityTableDdl(rowSpec(AUTHORS_ROW), db());
  applyCapabilityTableDdl(rowSpec(BOOKS_ROW), db());
  db().run(`INSERT INTO "cap_authors" ("id", "name") VALUES (?, 'Ursula K. Le Guin')`, [LE_GUIN]);
});

afterEach(() => teardownScratchDbEnv(env));

/** A list whose first read runs `inside`, once. */
function listRunning(inside: () => void): string[] {
  let ran = false;
  return new Proxy(["a"], {
    get(target, property, receiver) {
      if (property === Symbol.iterator && !ran) {
        ran = true;
        inside();
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function text(table: string, field: string, id: string): unknown {
  const row = db().query(`SELECT "${field}" AS "t" FROM "${table}" WHERE "id" = ?`).get(id);
  return (row as { t: unknown }).t;
}

test("a create started inside another cannot write a second record from one pick", () => {
  const picked = { ...NO_LINKS, relations: [BOOK_AUTHOR], picks: new Map([["author", LE_GUIN]]) };
  const scope = fileClaimScope(db(), rowSpec(BOOKS_ROW), BOOKS_INCARNATION);
  const port = createCapabilityMutationPort(
    rowSpec(BOOKS_ROW),
    { scope, submitted: new Map() },
    undefined,
    picked,
  );
  const tags = listRunning(() => port.create({ title: "Inner", tags: [] }));
  expect(() => port.create({ title: "Outer", tags })).toThrow(PickWriteError);
  const rows = db().query(`SELECT source_record FROM ${LINK_TABLE}`).all();
  const books = db().query(`SELECT "title" FROM "cap_books"`).all();
  expect({ rows: rows.length, books }).toEqual({ rows: 1, books: [{ title: "Inner" }] });
});

test("an edit started inside another leaves no linked field behind its target", () => {
  db().run(`INSERT INTO "cap_books" ("id", "author") VALUES ('book-1', 'Ursula K. Le Guin')`);
  writeLinkRow(
    db(),
    { capability: "books", record: "book-1", field: "author" },
    { capability: "authors", incarnation: AUTHORS_INCARNATION, record: LE_GUIN },
  );
  const reach = {
    relations: relationsReaching(AUTHORS_ROW, [AUTHORS_ROW, BOOKS_ROW]),
    writable: () => true,
  };
  const port = createCapabilityUpdateMutationPort(
    rowSpec(AUTHORS_ROW),
    LE_GUIN,
    new Set(["name", "tags"]),
    {
      scope: fileClaimScope(db(), rowSpec(AUTHORS_ROW), AUTHORS_INCARNATION),
      submitted: new Map(),
    },
    undefined,
    { ...NO_LINKS, reach },
  );
  const tags = listRunning(() => port.update({ name: "Renamed inside", tags: [] }));
  port.update({ name: "Ursula K. Le Guin", tags });
  expect(text("cap_authors", "name", LE_GUIN)).toBe("Ursula K. Le Guin");
  expect(text("cap_books", "author", "book-1")).toBe("Ursula K. Le Guin");
});
