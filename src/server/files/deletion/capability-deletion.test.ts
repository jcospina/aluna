// Deleting a capability through M4's confirm route takes every file its incarnation held, and an
// upload that meets the deletion loses cleanly (Module 7 PLAN decisions 15, 23 and 33).

import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  createDeletionCleanupSupervisor,
  createProductionCapabilityDeletionAdapters,
} from "../../../lifecycle/deletion/index.ts";
import { until } from "../../../platform/async.test-support.ts";
import { sampleFile } from "../../../platform/files/admission/sample-files.test-support.ts";
import { fileUrl } from "../../../platform/files/file-url.ts";
import { seedFileLedgerRow } from "../../../platform/files/store/ledger.test-support.ts";
import {
  createLocalObjectStore,
  type ObjectStore,
} from "../../../platform/files/store/object-store.ts";
import { REGISTRY_TABLE } from "../../../platform/persistence/table-names.ts";
import {
  createMutationCoordinator,
  type MutationCoordinator,
} from "../../../runtime/concurrency/mutation-coordinator.ts";
import type { AppDeps } from "../../app.ts";
import { confirmationRequest } from "../../routes/lifecycle/deletion.test-support.ts";
import {
  answeredReference,
  heldBody,
  PHOTO_UPLOAD_PATH,
  PHOTOS,
  uploadInit,
  useFileRoutes,
} from "../file-routes.test-support.ts";

const files = useFileRoutes();
const CONFIRM_PATH = `/capability-deletion/${PHOTOS.capabilityId}/confirm`;

/**
 * The app over a scratch artifacts root holding the photos incarnation's tree, which the
 * version-artifacts adapter may remove; the fixture's own tree sits in the repository.
 */
const scratchArtifacts = () => join(dirname(files.root()), "artifacts");

function deletableApp(deps: AppDeps = {}) {
  const artifactsRoot = scratchArtifacts();
  const version = join(artifactsRoot, PHOTOS.capabilityId, PHOTOS.incarnationId, "v1");
  mkdirSync(version, { recursive: true });
  files
    .conns()
    .readwrite.run(`UPDATE ${REGISTRY_TABLE} SET artifacts_path = ? WHERE id = ?`, [
      version,
      PHOTOS.capabilityId,
    ]);
  return files.app({ artifactsRoot, ...deps });
}

/** A retry supervisor over the app's ledger and `objectStore` that never schedules a retry itself. */
function supervisorOver(objectStore: ObjectStore, mutationCoordinator: MutationCoordinator) {
  return createDeletionCleanupSupervisor({
    database: files.conns().readwrite,
    adapters: createProductionCapabilityDeletionAdapters(
      { objectStore, ledger: files.conns().readonly },
      scratchArtifacts(),
    ),
    mutationCoordinator,
    schedule: () => {},
  });
}

const deleteCapability = (app: ReturnType<typeof deletableApp>) =>
  app.request(CONFIRM_PATH, confirmationRequest(PHOTOS.incarnationId));

/** A ledger row for the photos field in `state`, with its bytes written through the store. */
async function held(state: "owned" | "cleanup_enqueued"): Promise<string> {
  const key = seedFileLedgerRow(files.conns().readwrite, {
    capabilityId: PHOTOS.capabilityId,
    incarnationId: PHOTOS.incarnationId,
    field: "photo",
    state,
    ...(state === "owned" ? { recordId: "record-1" } : {}),
  });
  const staged = await files.store().put(
    key,
    (async function* () {
      yield new Uint8Array([1, 2, 3]);
    })(),
  );
  await staged.place();
  return key;
}

async function expectNotServed(app: ReturnType<typeof deletableApp>, key: string) {
  const served = await app.request(fileUrl(key));
  expect(served.status).toBe(404);
  expect(served.headers.get("cache-control")).toBe("no-store");
}

describe("deleting a capability", () => {
  test("takes every file it held, whatever its state, and their addresses stop serving", async () => {
    const app = deletableApp();
    const uploaded = [];
    for (const name of ["dawn.jpg", "dusk.jpg"]) {
      const response = await app.request(
        PHOTO_UPLOAD_PATH,
        uploadInit(sampleFile("jpeg"), { name }),
      );
      uploaded.push((await answeredReference(response)).key);
    }
    const keys = [...uploaded, await held("owned"), await held("cleanup_enqueued")];
    expect(files.stored()).toEqual([...keys].sort());

    expect((await deleteCapability(app)).status).toBe(200);
    await files.cleaned();

    expect(files.ledgerRows()).toEqual([]);
    expect(files.stored()).toEqual([]);
    expect(files.staged()).toEqual([]);
    for (const key of keys) await expectNotServed(app, key);
  });

  test("stops serving its files while their cleanup is owed, and a retry takes the bytes", async () => {
    let busy = true;
    const inner = files.store();
    const store: ObjectStore = {
      ...inner,
      delete: async (key) => {
        if (busy) throw new Error("the disk is busy");
        await inner.delete(key);
      },
    };
    const mutationCoordinator = createMutationCoordinator();
    const deletionCleanup = supervisorOver(store, mutationCoordinator);
    const app = deletableApp({ objectStore: store, mutationCoordinator, deletionCleanup });
    const key = await held("owned");

    expect((await deleteCapability(app)).status).toBe(200);

    expect(deletionCleanup.pending()).toHaveLength(1);
    expect(files.stored()).toEqual([key]);
    expect(files.ledgerRows()).toEqual([]);
    await expectNotServed(app, key);

    busy = false;
    await deletionCleanup.runOnce();
    expect(deletionCleanup.pending()).toEqual([]);
    expect(files.stored()).toEqual([]);
  });

  test("is refused a retry supervisor that deletes through another store", () => {
    const elsewhere = createLocalObjectStore(join(dirname(files.root()), "elsewhere"));
    const mutationCoordinator = createMutationCoordinator();
    expect(() =>
      deletableApp({
        mutationCoordinator,
        deletionCleanup: supervisorOver(elsewhere, mutationCoordinator),
      }),
    ).toThrow();
  });
});

describe("an upload that meets a deletion", () => {
  test("still streaming is cancelled by the drain and leaves nothing", async () => {
    const app = deletableApp();
    const body = heldBody();
    body.push(sampleFile("jpeg").subarray(0, 1024));
    const upload = app.request(PHOTO_UPLOAD_PATH, uploadInit(body.stream));
    await until(() => files.staged().length === 1);

    expect((await deleteCapability(app)).status).toBe(200);
    expect((await upload).status).toBe(404);
    await files.cleaned();

    expect(body.cancelled()).toBe(true);
    expect(files.staged()).toEqual([]);
    expect(files.stored()).toEqual([]);
    expect(files.ledgerRows()).toEqual([]);
  });

  test("done streaming before its row went in is refused by its write and leaves nothing", async () => {
    const inner = files.store();
    let deleted: Response | Promise<Response> | undefined;
    const store: ObjectStore = {
      ...inner,
      async put(key, chunks) {
        const staged = await inner.put(key, chunks);
        deleted = deleteCapability(app);
        await deleted;
        return staged;
      },
    };
    const app = deletableApp({ objectStore: store });

    const response = await app.request(PHOTO_UPLOAD_PATH, uploadInit(sampleFile("jpeg")));
    await files.cleaned();

    expect((await deleted)?.status).toBe(200);
    expect(response.status).toBe(404);
    expect(files.staged()).toEqual([]);
    expect(files.stored()).toEqual([]);
    expect(files.ledgerRows()).toEqual([]);
  });

  test("whose row went in just before is collected, and its rename finds nothing to place", async () => {
    const inner = files.store();
    let deleted: Response | Promise<Response> | undefined;
    const store: ObjectStore = {
      ...inner,
      async put(key, chunks) {
        const staged = await inner.put(key, chunks);
        return {
          ...staged,
          async place() {
            deleted = deleteCapability(app);
            await deleted;
            return staged.place();
          },
        };
      },
    };
    const app = deletableApp({ objectStore: store });

    const response = await app.request(PHOTO_UPLOAD_PATH, uploadInit(sampleFile("jpeg")));
    await files.cleaned();

    expect((await deleted)?.status).toBe(200);
    expect(response.status).toBe(404);
    expect(files.staged()).toEqual([]);
    expect(files.stored()).toEqual([]);
    expect(files.ledgerRows()).toEqual([]);
  });
});
