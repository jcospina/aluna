// An upload a desk load overtook: its row went in and the sweep took it before the rename. Whether
// the cleanup unlinks the staged bytes before the rename or the placed ones after it, the upload
// asks for the file again and nothing is left behind.

import { expect, spyOn, test } from "bun:test";
import { until } from "../../../platform/async.test-support.ts";
import { ADD_FILE_AGAIN_SENTENCE } from "../../../platform/files/admission/refusal-copy.ts";
import { sampleFile } from "../../../platform/files/admission/sample-files.test-support.ts";
import { readFileLedgerRow } from "../../../platform/files/store/ledger.ts";
import type { ObjectStore } from "../../../platform/files/store/object-store.ts";
import * as registryStore from "../../../registry/store/store.ts";
import { createMutationCoordinator } from "../../../runtime/concurrency/mutation-coordinator.ts";
import type { AppDeps } from "../../app.ts";
import { createFileCleanupWorker } from "../cleanup/file-cleanup.ts";
import { PHOTO_UPLOAD_PATH, uploadInit, useFileRoutes } from "../file-routes.test-support.ts";
import { pageNavigation } from "./desk-load.test-support.ts";

const files = useFileRoutes();

/**
 * The app over a store whose `place` first loads the desk and waits for the sweep to take the row.
 * `order` says whether the cleanup unlinks before the rename or is held until after it, and
 * `swept` runs once the row is taken.
 */
function overtaken(order: "cleanup-first" | "rename-first", swept: () => void = () => {}) {
  const inner = files.store();
  const mutationCoordinator = createMutationCoordinator();
  let unlinked: () => void = () => {};
  const unlinking = new Promise<void>((resolve) => (unlinked = resolve));
  const store: ObjectStore = {
    ...inner,
    async delete(key) {
      if (order === "rename-first") await unlinking;
      return inner.delete(key);
    },
    async put(key, chunks) {
      const staged = await inner.put(key, chunks);
      return {
        ...staged,
        async place() {
          await app.request("/", pageNavigation());
          await until(() => readFileLedgerRow(files.conns().readonly, key)?.state !== "pending");
          swept();
          if (order === "cleanup-first") await fileCleanup.idle();
          try {
            return await staged.place();
          } finally {
            unlinked();
          }
        },
      };
    },
  };
  const fileCleanup = createFileCleanupWorker({
    databases: files.conns(),
    objectStore: store,
    mutationCoordinator,
    schedule: () => {},
  });
  const deps: AppDeps = { mutationCoordinator, objectStore: store, fileCleanup };
  const app = files.app(deps);
  return { app, fileCleanup };
}

for (const order of ["cleanup-first", "rename-first"] as const) {
  test(`an upload swept before its rename asks for the file again and leaves nothing (${order})`, async () => {
    const { app, fileCleanup } = overtaken(order);

    const response = await app.request(PHOTO_UPLOAD_PATH, uploadInit(sampleFile("jpeg")));
    await fileCleanup.idle();
    await files.cleaned();

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ refusal: "gone", message: ADD_FILE_AGAIN_SENTENCE });
    expect(files.ledgerRows()).toEqual([]);
    expect(files.staged()).toEqual([]);
    expect(files.stored()).toEqual([]);
  });
}

for (const order of ["cleanup-first", "rename-first"] as const) {
  test(`an upload swept before its rename, from a field that stopped taking files, is not found (${order})`, async () => {
    const real = registryStore.getCapability;
    let hidden: ReturnType<typeof spyOn> | undefined;
    const { app, fileCleanup } = overtaken(order, () => {
      hidden = spyOn(registryStore, "getCapability").mockImplementation((id, database) =>
        database === files.conns().readonly ? null : real(id, database),
      );
    });
    try {
      const response = await app.request(PHOTO_UPLOAD_PATH, uploadInit(sampleFile("jpeg")));
      expect(response.status).toBe(404);
    } finally {
      hidden?.mockRestore();
    }
    await fileCleanup.idle();
    await files.cleaned();
    expect(files.ledgerRows()).toEqual([]);
    expect(files.staged()).toEqual([]);
    expect(files.stored()).toEqual([]);
  });
}
