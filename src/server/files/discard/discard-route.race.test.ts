// A discard racing a save of the same key (Module 7 PLAN decision 32): the coordinator lets one of
// them take the key, and a saved record keeps its file whichever it is.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { FILE_DISCARD_PATH } from "#shell/core/shell-dom.js";
import { sampleFile } from "../../../platform/files/admission/sample-files.test-support.ts";
import { enqueuePendingFiles, readFileLedgerRow } from "../../../platform/files/store/ledger.ts";
import {
  between,
  createBody,
} from "../../../runtime/router/dispatch/files/router.file.test-support.ts";
import { answeredReference, useFileRoutes } from "../file-routes.test-support.ts";

const files = useFileRoutes();

const discardInit = (key: string): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
  body: JSON.stringify({ keys: [key] }),
});

async function uploaded(): Promise<string> {
  const response = await files.upload(sampleFile("jpeg", 2_000));
  expect(response.status).toBe(201);
  return (await answeredReference(response)).key;
}

const records = () =>
  files.conns().readonly.query(`SELECT "id", "photo" FROM "cap_photos"`).all() as {
    id: string;
    photo: string | null;
  }[];

const holding = (key: string) =>
  records().filter((record) => (record.photo ?? "").includes(key)).length;

/** Whichever request won `key`, no record holds it without its bytes and its owned row. */
function expectNoRecordWithoutItsFile(key: string, saved: boolean): void {
  const row = readFileLedgerRow(files.conns().readonly, key);
  if (saved) {
    expect(holding(key)).toBe(1);
    expect(row?.state).toBe("owned");
    expect(existsSync(join(files.root(), key))).toBe(true);
  } else {
    expect(holding(key)).toBe(0);
    expect(row).toBeNull();
    expect(existsSync(join(files.root(), key))).toBe(false);
  }
}

describe("a discard racing a save of the same key", () => {
  test("sent while the save is in flight, it finds the key owned and the record keeps its file", async () => {
    const key = await uploaded();
    let discard: Response | Promise<Response> | undefined;
    const mutationCoordinator = between(() => {
      discard ??= app.request(FILE_DISCARD_PATH, discardInit(key));
    });
    const app = files.app({ mutationCoordinator });

    const save = await app.request("/capability/photos/create", createBody("Dawn", key));
    expect(save.status).toBe(200);
    expect((await discard)?.status).toBe(204);
    await files.cleaned();
    expectNoRecordWithoutItsFile(key, true);
  });

  test("committed between the save's check and its write, it leaves the save nothing to store", async () => {
    // No await parts the save's check from its lease, so only a synchronous write can land there:
    // the route's own write stands in for the route.
    const key = await uploaded();
    let moved = 0;
    const mutationCoordinator = between(() => {
      moved ||= enqueuePendingFiles(files.conns().readwrite, [key]);
    });

    const save = await files
      .app({ mutationCoordinator })
      .request("/capability/photos/create", createBody("Dawn", key));
    expect(moved).toBe(1);
    expect(save.status).not.toBe(200);
    expect(holding(key)).toBe(0);
    expect(readFileLedgerRow(files.conns().readonly, key)?.state).toBe("cleanup_enqueued");
  });

  test("sent first, it takes the key and the save after it is refused", async () => {
    const key = await uploaded();
    const app = files.app();
    expect((await app.request(FILE_DISCARD_PATH, discardInit(key))).status).toBe(204);
    const save = await app.request("/capability/photos/create", createBody("Dawn", key));
    await files.cleaned();
    expect(save.status).not.toBe(200);
    expectNoRecordWithoutItsFile(key, false);
  });

  test("sent together in either order, whichever wins, a saved record never loses its file", async () => {
    for (const discardFirst of [true, false]) {
      const key = await uploaded();
      const app = files.app();
      const save = () => app.request("/capability/photos/create", createBody("Dawn", key));
      const discard = () => app.request(FILE_DISCARD_PATH, discardInit(key));
      const saved = discardFirst
        ? (await Promise.all([discard(), save()]))[1]
        : (await Promise.all([save(), discard()]))[0];
      await files.cleaned();
      expectNoRecordWithoutItsFile(key, saved.status === 200);
    }
  });
});
