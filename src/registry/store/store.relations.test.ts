// A capability's relations on its registry row: row-only, parsed for shape alone, written in
// place by one conditional update, kept by every activation.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { PlatformDatabase } from "../../platform/persistence/db.ts";
import {
  createScratchDbEnv,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../../platform/persistence/scratch-db.test-support.ts";
import {
  FIRST_INCARNATION_ID,
  SECOND_INCARNATION_ID,
  UNKNOWN_INCARNATION_ID,
} from "../incarnations.test-support.ts";
import { type Relation, relationsSchema } from "../relations.ts";
import { validSpec } from "../spec/spec.test-support.ts";
import { capabilitySpecFromRow } from "../spec/spec.ts";
import { fingerprintActiveRegistryCatalog } from "./active-catalog.ts";
import {
  addCapabilityRelation,
  compareAndSwapCapability,
  getCapability,
  insertCapability,
  listCapabilities,
  REGISTRY_TABLE,
  removeRelationsTo,
} from "./store.ts";

const BOOKS_INCARNATION = FIRST_INCARNATION_ID;

const AUTHOR_TO_NAME: Relation = {
  field: "author",
  to: { capability: "authors", incarnation: SECOND_INCARNATION_ID, field: "name" },
};

function booksWrite(overrides: Record<string, unknown> = {}) {
  return {
    ...validSpec({
      id: "books",
      label: "Books",
      noun: "book",
      plural_noun: "books",
      schema: {
        fields: [
          { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
          { name: "author", label: "Author", type: "string", required: false, lifecycle: "active" },
        ],
      },
    }),
    incarnation_id: BOOKS_INCARNATION,
    version: 1,
    artifacts_path: `capabilities/books/${BOOKS_INCARNATION}/v1/`,
    seed: 184206,
    ...overrides,
  };
}

const expectation = (overrides: Partial<Parameters<typeof addCapabilityRelation>[0]> = {}) => ({
  capabilityId: "books",
  incarnationId: BOOKS_INCARNATION,
  version: 1,
  relations: [],
  ...overrides,
});

let env: ScratchDbEnv;
let conns: PlatformDatabase;

beforeEach(() => {
  env = createScratchDbEnv("omni-crud-registry-relations-");
  conns = env.conns;
});

afterEach(() => {
  teardownScratchDbEnv(env);
});

const books = () => getCapability("books", conns.readonly);
const storeRaw = (value: string) =>
  conns.readwrite.query(`UPDATE ${REGISTRY_TABLE} SET relations = ? WHERE id = 'books'`).run(value);

describe("a capability's relations are written in place", () => {
  test("a row is born holding none, whatever the write carried", () => {
    insertCapability(booksWrite({ relations: [AUTHOR_TO_NAME] }), conns.readwrite);
    expect(books()?.relations).toEqual([]);
  });

  test("one is added in place: no version, nothing else on the row moves", () => {
    const before = insertCapability(booksWrite(), conns.readwrite);
    const after = addCapabilityRelation(expectation(), AUTHOR_TO_NAME, conns.readwrite);

    expect(after?.relations).toEqual([AUTHOR_TO_NAME]);
    expect(after && { ...after, relations: before.relations }).toEqual(before);
    expect(books()).toEqual(after);
  });

  test("the update is conditional on the row as it was read", () => {
    insertCapability(booksWrite(), conns.readwrite);
    const second = { ...AUTHOR_TO_NAME, field: "title" };
    for (const moved of [
      { version: 2 },
      { incarnationId: UNKNOWN_INCARNATION_ID },
      { relations: [second] },
      { capabilityId: "authors" },
    ]) {
      expect(addCapabilityRelation(expectation(moved), AUTHOR_TO_NAME, conns.readwrite)).toBeNull();
    }
    expect(books()?.relations).toEqual([]);

    addCapabilityRelation(expectation(), second, conns.readwrite);
    expect(addCapabilityRelation(expectation(), AUTHOR_TO_NAME, conns.readwrite)).toBeNull();
    const read = expectation({ relations: [second] });
    expect(addCapabilityRelation(read, AUTHOR_TO_NAME, conns.readwrite)?.relations).toEqual([
      second,
      AUTHOR_TO_NAME,
    ]);
  });

  test("relations stored with their keys in another order are the same relations", () => {
    insertCapability(booksWrite(), conns.readwrite);
    const { field, to } = AUTHOR_TO_NAME;
    const reordered = {
      to: { field: to.field, incarnation: to.incarnation, capability: to.capability },
      field,
    };
    storeRaw(JSON.stringify([{ ...reordered, field: "title" }]));
    const read = expectation({ relations: [{ field: "title", to }] });
    expect(addCapabilityRelation(read, AUTHOR_TO_NAME, conns.readwrite)?.relations).toEqual([
      { field: "title", to },
      AUTHOR_TO_NAME,
    ]);
  });

  test("a field holds at most one: a second relation on it is refused before the write", () => {
    insertCapability(booksWrite(), conns.readwrite);
    const read = expectation({ relations: [AUTHOR_TO_NAME] });
    storeRaw(JSON.stringify([AUTHOR_TO_NAME]));
    expect(() => addCapabilityRelation(read, AUTHOR_TO_NAME, conns.readwrite)).toThrow();
    expect(books()?.relations).toEqual([AUTHOR_TO_NAME]);
  });
});

describe("a capability's relations are kept, read and cleared", () => {
  test("an activation's compare-and-swap carries them forward, and a write cannot set them", () => {
    insertCapability(booksWrite(), conns.readwrite);
    addCapabilityRelation(expectation(), AUTHOR_TO_NAME, conns.readwrite);
    const evolved = compareAndSwapCapability(
      booksWrite({ version: 2, relations: [] }),
      { state: "active", capabilityId: "books", incarnationId: BOOKS_INCARNATION, version: 1 },
      conns.readwrite,
    );
    expect(evolved.version).toBe(2);
    expect(evolved.relations).toEqual([AUTHOR_TO_NAME]);
  });

  test("a row whose relation names a hidden field or a deleted capability still loads", () => {
    insertCapability(booksWrite(), conns.readwrite);
    const hiddenField = { field: "title", to: { ...AUTHOR_TO_NAME.to, field: "retired" } };
    const deleted = {
      field: "author",
      to: { capability: "gone", incarnation: UNKNOWN_INCARNATION_ID, field: "name" },
    };
    storeRaw(JSON.stringify([hiddenField, deleted, { ...AUTHOR_TO_NAME, field: "nope" }]));

    expect(books()?.relations).toHaveLength(3);
    expect(listCapabilities(conns.readonly).map((row) => row.id)).toEqual(["books"]);
  });

  test("parsing checks the shape, and a row holding the wrong shape fails loudly", () => {
    expect(relationsSchema.safeParse([AUTHOR_TO_NAME]).success).toBe(true);
    for (const malformed of [
      [{ ...AUTHOR_TO_NAME, label: "Author" }],
      [{ field: "author", to: { ...AUTHOR_TO_NAME.to, incarnation: "inc_7f3" } }],
      [{ field: "Author!", to: AUTHOR_TO_NAME.to }],
      [{ field: "author", to: { capability: "authors", incarnation: SECOND_INCARNATION_ID } }],
      [AUTHOR_TO_NAME, AUTHOR_TO_NAME],
      {},
    ]) {
      expect(relationsSchema.safeParse(malformed).success).toBe(false);
    }
    insertCapability(booksWrite(), conns.readwrite);
    storeRaw('[{"field":"author"}]');
    expect(() => books()).toThrow();
  });

  test("a deletion takes the relations pinned to its lifetime off the others, passing over a broken row", () => {
    insertCapability(booksWrite(), conns.readwrite);
    insertCapability(
      booksWrite({ id: "loans", incarnation_id: UNKNOWN_INCARNATION_ID }),
      conns.readwrite,
    );
    const kept = {
      ...AUTHOR_TO_NAME,
      field: "title",
      to: { ...AUTHOR_TO_NAME.to, capability: "x" },
    };
    storeRaw(JSON.stringify([AUTHOR_TO_NAME, kept]));
    conns.readwrite
      .query(`UPDATE ${REGISTRY_TABLE} SET relations = 'not json' WHERE id = 'loans'`)
      .run();

    removeRelationsTo(
      { capabilityId: "authors", incarnationId: SECOND_INCARNATION_ID },
      conns.readwrite,
    );
    expect(books()?.relations).toEqual([kept]);
  });

  test("no model-facing view and no resolver fingerprint carries them", () => {
    insertCapability(booksWrite(), conns.readwrite);
    const before = books();
    const linked = addCapabilityRelation(expectation(), AUTHOR_TO_NAME, conns.readwrite);
    if (!before || !linked) throw new Error("books was not written");

    expect(capabilitySpecFromRow(linked)).toEqual(capabilitySpecFromRow(before));
    expect(Object.keys(capabilitySpecFromRow(linked))).not.toContain("relations");
    expect(fingerprintActiveRegistryCatalog([linked])).toBe(
      fingerprintActiveRegistryCatalog([before]),
    );
  });
});
