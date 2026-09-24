// Deleting a record gives up every file it holds, hidden fields' included, in the delete's own
// transaction. Through the router and the photos fixture, with ledger rows minted directly.

import { describe, expect, test } from "bun:test";

import {
  requireFileLedgerRow,
  seedFileLedgerRow,
} from "../../../platform/files/ledger.test-support.ts";
import { FILE_LEDGER_TABLE } from "../../../platform/files/ledger.ts";
import { PHOTO_FIELD } from "../../../registry/fields/file.test-support.ts";
import type { CapabilityRow } from "../../../registry/index.ts";
import { storedFileReference } from "../../data/schema/file-values.ts";
import type { CapabilityDeleteContext } from "../contract.ts";
import { editBody, usePhotosRouter } from "./router.file.test-support.ts";
import { NOTES_INCARNATION_ID, photosRow } from "./router.test-support.ts";
import type { HandlerLoader } from "./router.ts";

const COVER = "cover";

/** The photos fixture with a second file field that evolution has hidden. */
function withHiddenCover(): CapabilityRow {
  const row = photosRow();
  return {
    ...row,
    schema: {
      fields: [
        ...row.schema.fields,
        { ...PHOTO_FIELD, name: COVER, label: "Cover", lifecycle: "inactive" },
      ],
    },
  };
}

describe("deleting a record gives up every key it holds", () => {
  const photos = usePhotosRouter(withHiddenCover);

  /** A record holding a photo and, in the hidden field, a cover, both owned in the ledger. */
  async function recordWithCover(): Promise<{ id: string; photo: string; cover: string }> {
    const photo = photos.mint();
    const id = await photos.save(photo);
    const { readwrite } = photos.conns();
    const cover = seedFileLedgerRow(readwrite, {
      capabilityId: "photos",
      incarnationId: NOTES_INCARNATION_ID,
      field: COVER,
      state: "owned",
      recordId: id,
    });
    readwrite.run(`UPDATE "cap_photos" SET "cover" = ? WHERE "id" = ?`, [
      storedFileReference(requireFileLedgerRow(readwrite, cover)),
      id,
    ]);
    return { id, photo, cover };
  }

  test("hidden fields included, and nothing another record or a form holds", async () => {
    const { id, photo, cover } = await recordWithCover();
    const theirs = photos.mint();
    const other = await photos.save(theirs);
    const displaced = photos.mint({ state: "cleanup_enqueued", recordId: id });
    const uploading = photos.mint();

    const response = await photos.request("/capability/photos/delete", editBody(id, {}));

    expect(response.status).toBe(200);
    expect(photos.stored().map((record) => record.id)).toEqual([other]);
    for (const key of [photo, cover, displaced]) {
      expect(photos.ledger(key)).toMatchObject({ state: "cleanup_enqueued", record_id: id });
    }
    expect(photos.ledger(theirs)).toMatchObject({ state: "owned", record_id: other });
    expect(photos.ledger(uploading)).toMatchObject({ state: "pending", record_id: null });
  });

  test("in the delete's transaction, so a Handler that deletes and then fails gives nothing up", async () => {
    const { id, photo, cover } = await recordWithCover();
    const loadHandler: HandlerLoader = async () => async (context: CapabilityDeleteContext) => {
      context.mutation.delete();
      throw new Error("the Handler broke after deleting");
    };

    const response = await photos.request("/capability/photos/delete", editBody(id, {}), {
      loadHandler,
    });

    expect(response.status).toBe(500);
    expect(photos.stored().map((record) => record.id)).toEqual([id]);
    for (const key of [photo, cover]) expect(photos.ledger(key).state).toBe("owned");
  });

  test("a delete that fails gives nothing up, even to a Handler that answers anyway", async () => {
    const { id, photo } = await recordWithCover();
    photos.conns().readwrite.exec(
      `CREATE TRIGGER "refuse_ledger" BEFORE UPDATE ON ${FILE_LEDGER_TABLE}
       BEGIN SELECT RAISE(ABORT, 'the ledger refused'); END;`,
    );
    const loadHandler: HandlerLoader = async () => async (context: CapabilityDeleteContext) => {
      try {
        context.mutation.delete();
      } catch {
        // Swallowed, so the route answers 200 and commits whatever the transaction holds.
      }
      return "";
    };

    const response = await photos.request("/capability/photos/delete", editBody(id, {}), {
      loadHandler,
    });

    expect(response.status).toBe(200);
    expect(photos.stored().map((record) => record.id)).toEqual([id]);
    expect(photos.ledger(photo).state).toBe("owned");
  });
});
