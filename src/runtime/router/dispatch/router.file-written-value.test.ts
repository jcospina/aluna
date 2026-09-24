// What an edit writes to a photo is what the router checked, whatever generated code hands back,
// and the check holds inside the save's transaction too. Through the router and the photos fixture,
// with ledger rows minted directly, as the upload route would mint them.

import { describe, expect, test } from "bun:test";

import { requireFileLedgerRow } from "../../../platform/files/ledger.test-support.ts";
import { FILE_LEDGER_TABLE, mintFileKey } from "../../../platform/files/ledger.ts";
import {
  INVALID_FILE_REFERENCE_ERROR_CODE,
  RECORD_CHANGED_ERROR_CODE,
} from "../../../registry/index.ts";
import { createApp } from "../../../server/app.ts";
import { createMutationCoordinator } from "../../concurrency/mutation-coordinator.ts";
import { createReadGateCoordinator } from "../../concurrency/read-gates.ts";
import {
  CapabilityDataValidationError,
  type CapabilityFileProjection,
  FILE_CLEAR_VALUE,
  FILE_URL_PREFIX,
  RECORD_NOT_FOUND_ERROR_CODE,
} from "../../data/index.ts";
import { FileFieldWriteError } from "../../data/internal.ts";
import { storedFileReference } from "../../data/schema/file-values.ts";
import type { CapabilityUpdateContext } from "../contract.ts";
import { READ_UNAVAILABLE_ERROR_CODE } from "../wire/failure-responses.ts";
import {
  editBody,
  PHOTO,
  projectionOf,
  updateHandler,
  usePhotosRouter,
} from "./router.file.test-support.ts";
import { makeSpyLoader, NOTES_INCARNATION_ID } from "./router.test-support.ts";
import type { HandlerLoader } from "./router.ts";

describe("the edit's check runs again inside the save's transaction", () => {
  const photos = usePhotosRouter();

  /** Run `flip` after the route's first check and before its transaction opens. */
  function between(flip: () => void) {
    const mutationCoordinator = createMutationCoordinator();
    const acquire = mutationCoordinator.tryAcquireRecordWrite.bind(mutationCoordinator);
    mutationCoordinator.tryAcquireRecordWrite = () => {
      flip();
      return acquire();
    };
    return mutationCoordinator;
  }

  test("and refuses a kept key another save replaced in between", async () => {
    const kept = photos.mint();
    const id = await photos.save(kept);
    const other = photos.mint({ state: "owned", recordId: id });
    const { readwrite } = photos.conns();
    const spy = makeSpyLoader();

    const response = await photos.request(
      "/capability/photos/update",
      editBody(id, { [PHOTO]: kept }),
      {
        loadHandler: spy.loadHandler,
        mutationCoordinator: between(() => {
          readwrite.run(`UPDATE "cap_photos" SET "photo" = ? WHERE "id" = ?`, [
            storedFileReference(requireFileLedgerRow(readwrite, other)),
            id,
          ]);
          readwrite.run(
            `UPDATE ${FILE_LEDGER_TABLE} SET "state" = 'cleanup_enqueued' WHERE "key" = ?`,
            [kept],
          );
        }),
      },
    );

    expect(response.status).toBe(422);
    expect(await response.text()).toContain(`data-error-code="${RECORD_CHANGED_ERROR_CODE}"`);
    expect(spy.calls).toEqual([]);
  });

  test("and refuses a replacement another save claimed in between", async () => {
    const id = await photos.save(photos.mint());
    const next = photos.mint();
    const { readwrite } = photos.conns();
    const spy = makeSpyLoader();

    const response = await photos.request(
      "/capability/photos/update",
      editBody(id, { [PHOTO]: next }),
      {
        loadHandler: spy.loadHandler,
        mutationCoordinator: between(() =>
          readwrite.run(
            `UPDATE ${FILE_LEDGER_TABLE} SET "state" = 'owned', "record_id" = 'someone-else' WHERE "key" = ?`,
            [next],
          ),
        ),
      },
    );

    expect(response.status).toBe(422);
    expect(await response.text()).toContain(
      `data-error-code="${INVALID_FILE_REFERENCE_ERROR_CODE}"`,
    );
    expect(spy.calls).toEqual([]);
  });

  test("and answers as not found for a record deleted in between", async () => {
    const kept = photos.mint();
    const id = await photos.save(kept);
    const { readwrite } = photos.conns();
    const spy = makeSpyLoader();

    const response = await photos.request(
      "/capability/photos/update",
      editBody(id, { [PHOTO]: kept }),
      {
        loadHandler: spy.loadHandler,
        mutationCoordinator: between(() =>
          readwrite.run(`DELETE FROM "cap_photos" WHERE "id" = ?`, [id]),
        ),
      },
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toContain(`data-error-code="${RECORD_NOT_FOUND_ERROR_CODE}"`);
    expect(spy.calls).toEqual([]);
  });
});

/** An update Handler whose one write is expected to be refused: it keeps the refusal, then fails. */
function refusedWrite(write: (context: CapabilityUpdateContext) => unknown) {
  const refusals: unknown[] = [];
  const loadHandler: HandlerLoader = async () => async (context: CapabilityUpdateContext) => {
    try {
      write(context);
    } catch (error) {
      refusals.push(error);
      throw error;
    }
    return "<p>written</p>";
  };
  return { refusals, loadHandler };
}

describe("a null the control never asked for is refused before anything is written", () => {
  const photos = usePhotosRouter();
  const submissions: readonly [
    string,
    (kept: string) => Record<string, string>,
    abstract new (...args: never) => CapabilityDataValidationError,
  ][] = [
    [
      "an edit that keeps the photo",
      (kept) => ({ caption: "Dusk", [PHOTO]: kept }),
      FileFieldWriteError,
    ],
    [
      "an edit that replaces it",
      () => ({ caption: "Dusk", [PHOTO]: photos.mint() }),
      FileFieldWriteError,
    ],
    // Refused as any field the edit did not submit is, before the file rule is reached.
    ["an edit that leaves it out", () => ({ caption: "Dusk" }), CapabilityDataValidationError],
  ];

  for (const [name, submission, refusal] of submissions) {
    test(`from ${name}`, async () => {
      const kept = photos.mint();
      const id = await photos.save(kept);
      const body = submission(kept);
      const before = { stored: photos.stored(), ledger: photos.ledgerRows() };
      const { refusals, loadHandler } = refusedWrite(({ input, mutation }) =>
        mutation.update({ caption: input.values.caption, photo: null }),
      );

      const response = await photos.request("/capability/photos/update", editBody(id, body), {
        loadHandler,
      });

      expect(response.status).toBe(500);
      expect(refusals).toHaveLength(1);
      expect(refusals[0]).toBeInstanceOf(refusal);
      expect({ stored: photos.stored(), ledger: photos.ledgerRows() }).toEqual(before);
    });
  }
});

describe("mutation.update and the written-value rule", () => {
  const photos = usePhotosRouter();

  test("returns the projection of a photo the edit never named", async () => {
    const kept = photos.mint();
    const id = await photos.save(kept);
    let returned: unknown;
    const loadHandler = updateHandler(({ mutation }) => {
      const record = mutation.update({ caption: "Dusk" });
      returned = record.fields.photo;
      return record;
    });

    await photos.request("/capability/photos/update", editBody(id, { caption: "Dusk" }), {
      loadHandler,
    });

    expect(returned).toEqual(projectionOf(photos.ledger(kept)));
    expect(Object.isFrozen(returned)).toBe(true);
  });

  test("an edited projection still writes the ledger's name and type", async () => {
    const id = await photos.save(photos.mint());
    const next = photos.mint({ name: "tide.jpg", mime: "image/jpeg" });
    const loadHandler = updateHandler(({ input, mutation }) =>
      mutation.update({
        photo: { ...(input.values.photo as object), name: "renamed.gif", mime: "image/gif" },
      }),
    );

    const response = await photos.request(
      "/capability/photos/update",
      editBody(id, { [PHOTO]: next }),
      { loadHandler },
    );

    expect(response.status).toBe(200);
    expect(photos.photoOf(id)).toMatchObject({
      key: next,
      name: "tide.jpg",
      mime: "image/jpeg",
    });
  });

  test("a submitted photo left out of the patch writes the submission", async () => {
    const old = photos.mint();
    const id = await photos.save(old);
    const next = photos.mint();
    const loadHandler = updateHandler(({ mutation }) => mutation.update({}));

    const response = await photos.request(
      "/capability/photos/update",
      editBody(id, { [PHOTO]: next }),
      { loadHandler },
    );

    expect(response.status).toBe(200);
    expect(photos.photoOf(id)).toMatchObject({ key: next });
    expect(photos.ledger(old).state).toBe("cleanup_enqueued");
  });

  test("a second update in one Handler keeps what the first wrote", async () => {
    const old = photos.mint();
    const id = await photos.save(old);
    const next = photos.mint();
    const loadHandler = updateHandler(({ input, mutation }) => {
      mutation.update({ caption: "Dawn", photo: input.values.photo });
      return mutation.update({ caption: "Dusk", photo: input.values.photo });
    });

    const response = await photos.request(
      "/capability/photos/update",
      editBody(id, { caption: "Dusk", [PHOTO]: next }),
      { loadHandler },
    );

    expect(response.status).toBe(200);
    expect(photos.photoOf(id)).toMatchObject({ key: next });
    expect(photos.ledger(next)).toMatchObject({ state: "owned", record_id: id });
    expect(photos.ledger(old).state).toBe("cleanup_enqueued");
  });
});

describe("any other photo generated code hands back is refused before anything is written", () => {
  const photos = usePhotosRouter();
  const keyOf = (photo: CapabilityFileProjection) => photo.url.slice(FILE_URL_PREFIX.length);
  const values: readonly [string, (photo: CapabilityFileProjection, old: string) => unknown][] = [
    [
      "the projection of the photo being replaced",
      (photo, old) => ({ ...photo, url: FILE_URL_PREFIX + old }),
    ],
    [
      "another pending key's address",
      (photo) => ({ ...photo, url: FILE_URL_PREFIX + mintFileKey() }),
    ],
    ["the bare key", (photo) => keyOf(photo)],
    [
      "the stored shape",
      ({ url, ...rest }) => ({ key: url.slice(FILE_URL_PREFIX.length), ...rest }),
    ],
    ["the clear itself", () => FILE_CLEAR_VALUE],
  ];

  for (const [name, value] of values) {
    test(name, async () => {
      const old = photos.mint();
      const id = await photos.save(old);
      const next = photos.mint();
      const before = { stored: photos.stored(), ledger: photos.ledgerRows() };
      const { refusals, loadHandler } = refusedWrite(({ input, mutation }) =>
        mutation.update({ photo: value(input.values.photo as CapabilityFileProjection, old) }),
      );

      const response = await photos.request(
        "/capability/photos/update",
        editBody(id, { [PHOTO]: next }),
        { loadHandler },
      );

      expect(response.status).toBe(500);
      expect(refusals[0]).toBeInstanceOf(FileFieldWriteError);
      expect({ stored: photos.stored(), ledger: photos.ledgerRows() }).toEqual(before);
    });
  }

  test("a projection for a photo the edit left out", async () => {
    const kept = photos.mint();
    const id = await photos.save(kept);
    const before = { stored: photos.stored(), ledger: photos.ledgerRows() };
    const { refusals, loadHandler } = refusedWrite(({ mutation }) =>
      mutation.update({ caption: "Dusk", photo: projectionOf(photos.ledger(kept)) }),
    );

    const response = await photos.request(
      "/capability/photos/update",
      editBody(id, { caption: "Dusk" }),
      { loadHandler },
    );

    expect(response.status).toBe(500);
    expect(refusals[0]).toBeInstanceOf(CapabilityDataValidationError);
    expect({ stored: photos.stored(), ledger: photos.ledgerRows() }).toEqual(before);
  });
});

describe("an edit racing its capability's deletion", () => {
  const photos = usePhotosRouter();

  test("is asked to wait, not failed, once the deletion closed the gate and dropped the table", async () => {
    const kept = photos.mint();
    const id = await photos.save(kept);
    const readGates = createReadGateCoordinator();
    const incarnation = { capabilityId: "photos", incarnationId: NOTES_INCARNATION_ID };
    readGates.synchronizeCatalog([incarnation]);
    await readGates.closeAndDrain(incarnation);
    photos.conns().readwrite.exec(`DROP TABLE "cap_photos"`);
    const app = createApp({ readGates, capabilityRouter: { databases: photos.conns() } });

    const response = await app.request(
      "/capability/photos/update",
      editBody(id, { [PHOTO]: kept }),
    );

    expect(response.status).toBe(422);
    expect(await response.text()).toContain(`data-error-code="${READ_UNAVAILABLE_ERROR_CODE}"`);
  });
});
