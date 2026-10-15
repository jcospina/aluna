// The pick route a linked field's dropdown reads: the target's records,
// each by the field the relation names, read through the real app under both capabilities' read
// tokens, and the refusals for a field that is no dropdown and a capability being deleted.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { capabilityPickUrl } from "#shell/core/routes.js";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import { REGISTRY_TABLE } from "../../../platform/persistence/table-names.ts";
import {
  chooseTargetRecord,
  disconnectFieldName,
  unmatchedTargetLine,
} from "../../../presentation/controls/link/link-copy.ts";
import { renderCreateForm } from "../../../presentation/fields/field-renderer.ts";
import { renderableFromRow } from "../../../presentation/fields/renderable-capability.ts";
import { UNKNOWN_INCARNATION_ID } from "../../../registry/incarnations.test-support.ts";
import { type CapabilityRow, listCapabilities, type Relation } from "../../../registry/index.ts";
import { createReadGateCoordinator } from "../../../runtime/concurrency/read-gates.ts";
import {
  setupRouterTest,
  teardownRouterTest,
} from "../../../runtime/router/dispatch/router.test-support.ts";
import { createTestApp } from "../../isolated-app.test-support.ts";
import {
  AUTHORS,
  AUTHORS_INCARNATION,
  BOOKS,
  BOOKS_INCARNATION,
  installDesk,
  noticeCode,
  SEEDED_AUTHORS,
  storeRelations,
} from "./link.test-support.ts";

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
});

afterEach(() => {
  teardownRouterTest(dir, conns);
});

function pick(capability: string, field: string, deps: Parameters<typeof createTestApp>[0] = {}) {
  return createTestApp({ capabilityRouter: { databases: conns }, ...deps }).request(
    capabilityPickUrl(capability, field),
  );
}

async function picked(capability = "books", field = "author") {
  const response = await pick(capability, field);
  expect(response.status).toBe(200);
  return (await response.json()) as {
    placeholder: string;
    unmatched: string;
    disconnect: string;
    records: { id: string; text: string }[];
  };
}

function addAuthor(id: string, name: string | null, penName: string | null = null): void {
  conns.readwrite.run('INSERT INTO "cap_authors" ("id", "name", "pen_name") VALUES (?, ?, ?)', [
    id,
    name,
    penName,
  ]);
}

const field = (row: typeof BOOKS, name: string) =>
  row.fields.find((one) => one.name === name) as (typeof BOOKS.fields)[number];

describe("the records a dropdown holds", () => {
  test("each record's id and the target field's text, in the order a name is looked up in", async () => {
    const list = await picked();
    const byName = [...SEEDED_AUTHORS].sort((a, b) => a.localeCompare(b));
    expect(list.records.map((record) => record.text)).toEqual(byName);
    expect(list.records.map((record) => record.id)).toEqual(
      byName.map((name) => `author-${SEEDED_AUTHORS.indexOf(name)}`),
    );
  });

  test("with the words the dropdown says, around the target's record noun and the source's field", async () => {
    const list = await picked();
    expect(list.placeholder).toBe(chooseTargetRecord(AUTHORS.noun));
    expect(list.unmatched).toBe(unmatchedTargetLine(AUTHORS.noun));
    expect(list.disconnect).toBe(disconnectFieldName(BOOKS.noun, field(BOOKS, "author")));
    expect(list.placeholder).toContain(AUTHORS.noun);
  });

  test("a record holding no text in the field is no option", async () => {
    addAuthor("author-blank", "   ");
    addAuthor("author-none", null);
    // Blank as a save judges it: a tab, a no-break space and an ideographic space hold no text.
    addAuthor("author-wide", "\t\u00a0\u3000");
    const ids = (await picked()).records.map((record) => record.id);
    expect(ids).not.toContain("author-blank");
    expect(ids).not.toContain("author-none");
    expect(ids).not.toContain("author-wide");
    expect(ids).toHaveLength(SEEDED_AUTHORS.length);
  });

  test("case and accents do not move a name, and two records with one name are both held", async () => {
    addAuthor("author-a", "álvaro");
    addAuthor("author-b", "alice");
    addAuthor("author-c", "Alice");
    const texts = (await picked()).records.map((record) => record.text);
    expect(texts.slice(0, 4)).toEqual(["Alice", "alice", "álvaro", "Brandon Sanderson"]);
  });

  test("every read is the desk as it is now", async () => {
    expect((await picked()).records).toHaveLength(SEEDED_AUTHORS.length);
    addAuthor("author-new", "Ann Leckie");
    expect((await picked()).records.map((record) => record.text)).toContain("Ann Leckie");
  });

  test("the field the relation names is the one shown", async () => {
    addAuthor("author-pen", "Alice Sheldon", "James Tiptree Jr.");
    storeRelations(conns, "books", [
      { ...AUTHOR_TO_NAME, to: { ...AUTHOR_TO_NAME.to, field: "pen_name" } },
    ]);
    expect((await picked()).records).toEqual([{ id: "author-pen", text: "James Tiptree Jr." }]);
  });

  test("both read tokens are let go once the records are read", async () => {
    const readGates = createReadGateCoordinator();
    expect((await pick("books", "author", { readGates })).status).toBe(200);
    for (const capabilityId of ["books", "authors"]) {
      const gate = readGates.snapshot().find((one) => one.capabilityId === capabilityId);
      expect(gate?.readerCount).toBe(0);
    }
  });
});

describe("what the route refuses", () => {
  test("a field holding no relation is no dropdown", async () => {
    for (const name of ["title", "nothing_here"]) {
      const response = await pick("books", name);
      expect(response.status).toBe(422);
      expect(noticeCode(await response.text())).toBe("field_not_linked");
    }
  });

  test("a relation whose rules no longer hold is no dropdown either", async () => {
    for (const relations of [
      [{ ...AUTHOR_TO_NAME, field: "notes" }],
      [{ ...AUTHOR_TO_NAME, field: "isbn" }],
      [{ ...AUTHOR_TO_NAME, to: { ...AUTHOR_TO_NAME.to, field: "bio" } }],
      [{ ...AUTHOR_TO_NAME, to: { ...AUTHOR_TO_NAME.to, capability: "ghosts" } }],
      // A lifetime of Authors that is over: only a rebuild after deletion mints a new one.
      [{ ...AUTHOR_TO_NAME, to: { ...AUTHOR_TO_NAME.to, incarnation: UNKNOWN_INCARNATION_ID } }],
      // Books' title takes 300 characters, longer than an author's 120.
      [
        {
          field: "author",
          to: { capability: "books", incarnation: BOOKS_INCARNATION, field: "title" },
        },
      ],
    ]) {
      storeRelations(conns, "books", relations);
      const fieldName = relations[0]?.field ?? "";
      const response = await pick("books", fieldName);
      expect(response.status).toBe(422);
      expect(noticeCode(await response.text())).toBe("field_not_linked");
    }
  });

  test("a capability that is gone answers stale", async () => {
    const response = await pick("ghosts", "name");
    expect(response.status).toBe(409);
    expect(noticeCode(await response.text())).toBe("link_stale");
  });

  test("a closed read gate, on the target or on the field's own capability, reads nothing", async () => {
    for (const closing of [
      { capabilityId: "authors", incarnationId: AUTHORS_INCARNATION },
      { capabilityId: "books", incarnationId: BOOKS_INCARNATION },
    ]) {
      const readGates = createReadGateCoordinator();
      readGates.synchronizeCatalog([closing]);
      await readGates.closeAndDrain(closing);
      const response = await pick("books", "author", { readGates });
      expect(response.status).toBe(409);
      expect(noticeCode(await response.text())).toBe("read_unavailable");
      expect(readGates.snapshot().every((gate) => gate.readerCount === 0)).toBe(true);
    }
  });
});

describe("the form and the route agree on which fields are dropdowns", () => {
  test("a dropdown is drawn exactly where the route reads records, and nowhere it refuses", async () => {
    const drawn = (catalog: CapabilityRow[]) => {
      const books = catalog.find((row) => row.id === "books") as CapabilityRow;
      return renderCreateForm(renderableFromRow(books, catalog)).includes("data-linked-field");
    };
    const catalog = listCapabilities(conns.readonly);
    expect(drawn(catalog)).toBe(true);
    expect((await pick("books", "author")).status).toBe(200);

    // Authors' name drawn as long text: the relation is dormant, so the field is plain on both sides.
    conns.readwrite
      .query(
        `UPDATE ${REGISTRY_TABLE} SET ui_intent = json_set(ui_intent, '$.form.long_text', ` +
          `json('["name","bio"]')) WHERE id = 'authors'`,
      )
      .run();
    expect(drawn(listCapabilities(conns.readonly))).toBe(false);
    expect((await pick("books", "author")).status).toBe(422);
  });
});
