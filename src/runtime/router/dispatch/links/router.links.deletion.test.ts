// Deleting a capability a link has at either end: deleting the target works like Unlink on every
// relation pointing at it, and deleting the source takes its own relations and link rows with it,
// all in the tombstone transaction. A relation never blocks the deletion. Through the real deletion
// route, on the notes fixture whose text and Books' author are both linked to Authors · Name.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  capabilityActionUrl,
  capabilityDeletionUrl,
  capabilityLinkUrl,
} from "#shell/core/routes.js";
import type { CapabilityDestructionFaults } from "../../../../lifecycle/deletion/destruction/two-phase-destruction.ts";
import type { PlatformDatabase } from "../../../../platform/persistence/db.ts";
import { REGISTRY_TABLE } from "../../../../platform/persistence/table-names.ts";
import { getCapability } from "../../../../registry/index.ts";
import { createTestApp } from "../../../../server/isolated-app.test-support.ts";
import { confirmationRequest } from "../../../../server/routes/lifecycle/deletion.test-support.ts";
import { AUTHORS_INCARNATION } from "../../../../server/routes/lifecycle/link.test-support.ts";
import { NOTES_INCARNATION_ID, teardownRouterTest } from "../router.test-support.ts";
import {
  BOOK_AUTHOR,
  BOOK_LINK,
  BUTLER,
  linkedNotesDesk,
  linkRows,
  notes,
  recordAddressView,
  seedLinkedBook,
  seedNote,
  TEXT_TO_NAME,
} from "./router.links.test-support.ts";

const LINKED = "0c0c0c0c-0000-4000-8000-000000000001";
const UNKNOWN = "0c0c0c0c-0000-4000-8000-000000000002";

let dir: string;
let conns: PlatformDatabase;

beforeEach(() => {
  ({ dir, conns } = linkedNotesDesk());
  seedNote(conns, LINKED, "Octavia E. Butler", BUTLER);
  seedNote(conns, UNKNOWN, "Terry Pratchett");
  seedLinkedBook(conns);
  deletable("authors");
});

/** Its artifacts under the root a deletion cleans; the notes fixture reads its Handlers elsewhere. */
function deletable(id: string): void {
  conns.readwrite.run(
    `UPDATE ${REGISTRY_TABLE} SET artifacts_path = ? || '/' || id || '/' || incarnation_id || '/v1'
     WHERE id = ?`,
    [join(dir, "artifacts"), id],
  );
}

afterEach(() => teardownRouterTest(dir, conns));

function app(faults: CapabilityDestructionFaults = {}) {
  return createTestApp({
    artifactsRoot: join(dir, "artifacts"),
    capabilityRouter: { databases: conns },
    capabilityDestructionFaults: faults,
  });
}

async function deleted(
  id: string,
  incarnation: string,
  faults: CapabilityDestructionFaults = {},
): Promise<string> {
  const answer = await app(faults).request(
    `${capabilityDeletionUrl(id)}/confirm`,
    confirmationRequest(incarnation),
  );
  return answer.text();
}

function books(): unknown[] {
  return conns.readonly.query('SELECT "id", "author" FROM "cap_books" ORDER BY "id"').all();
}

describe("deleting the capability a link points at", () => {
  test("is not blocked by the relations pointing at it", async () => {
    const preflight = await (await app().request(capabilityDeletionUrl("authors"))).text();
    expect(preflight).not.toContain("data-deletion-dependency-notice");
    expect(await deleted("authors", AUTHORS_INCARNATION)).toContain(
      "data-capability-deletion-logo-removal",
    );
    expect(getCapability("authors", conns.readonly)).toBeNull();
  });

  test("takes every relation and link row pointing at it, and every linking record keeps its text", async () => {
    const before = { notes: notes(conns), books: books() };
    await deleted("authors", AUTHORS_INCARNATION);
    expect(getCapability("notes", conns.readonly)?.relations).toEqual([]);
    expect(getCapability("books", conns.readonly)?.relations).toEqual([]);
    expect(linkRows(conns)).toEqual([]);
    expect(notes(conns)).toEqual(before.notes);
    expect(books()).toEqual(before.books);
  });

  test("leaves each linking field plain text with its chain, and no card marked", async () => {
    // The cards carry the marks; the record's address draws its form, which carries the field.
    const linked = await (await app().request(capabilityActionUrl("notes", "read"))).text();
    expect(linked).toContain("link-mark");
    expect(await recordAddressView(app(), "notes", LINKED)).toContain("data-linked-field");
    await deleted("authors", AUTHORS_INCARNATION);
    const read = await (await app().request(capabilityActionUrl("notes", "read"))).text();
    expect(read).not.toContain("link-mark");
    const form = await recordAddressView(app(), "notes", LINKED);
    expect(form).not.toContain("data-linked-field");
    expect(form).toContain(`data-link-url="${capabilityLinkUrl("notes", "text")}"`);
  });

  test("keeps every relation and link row when the commit fails, as it keeps the rest", async () => {
    const failing = {
      afterLinkRowsPurged: () => {
        throw new Error("before commit");
      },
    };
    const rows = linkRows(conns);
    await deleted("authors", AUTHORS_INCARNATION, failing).catch(() => "");
    expect(getCapability("authors", conns.readonly)).not.toBeNull();
    expect(getCapability("notes", conns.readonly)?.relations).toEqual([TEXT_TO_NAME]);
    expect(linkRows(conns)).toEqual(rows);
  });
});

describe("deleting a capability whose own field is linked", () => {
  beforeEach(() => deletable("notes"));

  test("takes its relations and its link rows with it, and leaves every other link as it was", async () => {
    await deleted("notes", NOTES_INCARNATION_ID);
    expect(getCapability("notes", conns.readonly)).toBeNull();
    expect(linkRows(conns)).toEqual([BOOK_LINK]);
    expect(getCapability("books", conns.readonly)?.relations).toEqual([BOOK_AUTHOR]);
    expect(getCapability("authors", conns.readonly)).not.toBeNull();
  });

  test("its tombstone holds no relation while the cleanup it owes is still to run", async () => {
    const stopped = {
      afterCommit: () => {
        throw new Error("process stopped before cleanup");
      },
    };
    await deleted("notes", NOTES_INCARNATION_ID, stopped);
    const tombstone = conns.readonly
      .query(`SELECT lifecycle_state, relations FROM ${REGISTRY_TABLE} WHERE id = 'notes'`)
      .get();
    expect(tombstone).toEqual({ lifecycle_state: "deletion_tombstone", relations: "[]" });
    expect(linkRows(conns)).toEqual([BOOK_LINK]);
  });
});
