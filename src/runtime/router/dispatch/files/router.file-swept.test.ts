// A save naming a key the desk-load sweep took (Module 7 PLAN decision 32): a second tab's form
// lost its upload to a load elsewhere. The real sweep runs here, through a desk load or as the app
// builds it; `router.file-claim.test.ts` flips the row by hand between the save's two checks.

import { describe, expect, test } from "bun:test";
import { until } from "../../../../platform/async.test-support.ts";
import { ADD_FILE_AGAIN_SENTENCE } from "../../../../platform/files/admission/refusal-copy.ts";
import { INVALID_FILE_REFERENCE_ERROR_CODE } from "../../../../registry/index.ts";
import { pageNavigation } from "../../../../server/files/sweep/desk-load.test-support.ts";
import { createDeskLoadSweep } from "../../../../server/files/sweep/desk-load-sweep.ts";
import {
  createMutationCoordinator,
  type MutationCoordinator,
} from "../../../concurrency/mutation-coordinator.ts";
import { MUTATION_BUSY_ERROR_CODE } from "../../wire/failure-responses.ts";
import { makeSpyLoader } from "../router.test-support.ts";
import {
  between,
  createBody,
  createHandler,
  editBody,
  PHOTO,
  sentenceOf,
  usePhotosRouter,
} from "./router.file.test-support.ts";

const photos = usePhotosRouter();

const sweepOn = (mutationCoordinator: MutationCoordinator) =>
  createDeskLoadSweep({
    databases: photos.conns(),
    mutationCoordinator,
    wakeFileCleanup: () => {},
  });

const queuedPlatformWrites = (coordinator: MutationCoordinator) =>
  coordinator.snapshot().queuedTickets.filter((ticket) => ticket.kind === "platform").length;

async function expectAskedForAgain(response: Response): Promise<void> {
  expect(response.status).toBe(422);
  const body = await response.text();
  expect(body).toContain(`data-error-code="${INVALID_FILE_REFERENCE_ERROR_CODE}"`);
  expect(body).toContain(`data-error-fields="${PHOTO}"`);
  expect(sentenceOf(body)).toBe(ADD_FILE_AGAIN_SENTENCE);
}

/** A key held by an open form, swept by a desk load in another tab, its bytes gone with its row. */
async function sweptByAnotherTab(): Promise<string> {
  const key = photos.mint();
  photos.place(key);
  expect((await photos.request("/", pageNavigation())).status).toBe(200);
  await until(() => photos.gone(key) && !photos.onDisk(key));
  return key;
}

describe("a key a desk load swept", () => {
  test("refuses the create that names it before its Handler runs, asking for the file again", async () => {
    const key = await sweptByAnotherTab();
    const spy = makeSpyLoader();

    const response = await photos.request("/capability/photos/create", createBody("Dawn", key), {
      loadHandler: spy.loadHandler,
    });

    await expectAskedForAgain(response);
    expect(spy.calls).toEqual([]);
    expect(photos.stored()).toEqual([]);
  });

  test("refuses the edit that replaces a photo with it, and the record keeps its photo", async () => {
    const held = photos.mint();
    const id = await photos.save(held);
    const key = await sweptByAnotherTab();
    const spy = makeSpyLoader();

    const response = await photos.request(
      "/capability/photos/update",
      editBody(id, { caption: "Dusk", [PHOTO]: key }),
      { loadHandler: spy.loadHandler },
    );

    await expectAskedForAgain(response);
    expect(spy.calls).toEqual([]);
    expect(photos.photoOf(id)).toMatchObject({ key: held });
    expect(photos.ledger(held)).toMatchObject({ state: "owned", record_id: id });
  });
});

describe("a sweep and a save racing on one key", () => {
  test("a save holding its write wins the key, and the sweep queued behind it moves nothing", async () => {
    const key = photos.mint();
    const mutationCoordinator = createMutationCoordinator();
    const sweep = sweepOn(mutationCoordinator);
    let swept: Promise<void> | undefined;
    let queuedDuringSave = 0;
    const loadHandler = createHandler(({ input, mutation }) => {
      swept = sweep();
      queuedDuringSave = queuedPlatformWrites(mutationCoordinator);
      return mutation.create({ caption: input.values.caption, photo: input.values.photo });
    });

    const response = await photos.request("/capability/photos/create", createBody("Dawn", key), {
      loadHandler,
      mutationCoordinator,
    });
    await swept;

    expect(response.status).toBe(200);
    expect(queuedDuringSave).toBe(1);
    const [record] = photos.stored();
    expect(photos.ledger(key)).toMatchObject({ state: "owned", record_id: record?.id });
  });

  test("a save arriving while the sweep holds the write is refused as busy, then asks for the file", async () => {
    const key = photos.mint();
    let swept: Promise<void> | undefined;
    const mutationCoordinator = between(() => {
      swept ??= sweep();
    });
    const sweep = sweepOn(mutationCoordinator);
    const spy = makeSpyLoader();
    const save = () =>
      photos.request("/capability/photos/create", createBody("Dawn", key), {
        loadHandler: spy.loadHandler,
        mutationCoordinator,
      });

    const busy = await save();
    await swept;

    expect(busy.status).toBe(422);
    expect(await busy.text()).toContain(`data-error-code="${MUTATION_BUSY_ERROR_CODE}"`);
    expect(photos.ledger(key).state).toBe("cleanup_enqueued");
    await expectAskedForAgain(await save());
    expect(spy.calls).toEqual([]);
    expect(photos.stored()).toEqual([]);
  });
});
