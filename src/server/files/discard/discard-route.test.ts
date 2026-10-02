// The pending-only route as the app wires it: what it moves, what it leaves alone, and the
// refusals every writing route owes. The races against a save are in `discard-route.race.test.ts`.

import { describe, expect, test } from "bun:test";
import { FILE_DISCARD_PATH } from "#shell/core/shell-dom.js";
import { until } from "../../../platform/async.test-support.ts";
import { sampleFile } from "../../../platform/files/admission/sample-files.test-support.ts";
import { seedFileLedgerRow } from "../../../platform/files/store/ledger.test-support.ts";
import { mintFileKey, readFileLedgerRow } from "../../../platform/files/store/ledger.ts";
import { createMutationCoordinator } from "../../../runtime/concurrency/mutation-coordinator.ts";
import { TEXT_BODY_LIMIT_BYTES } from "../../http/index.ts";
import { seedEnqueuedFile } from "../cleanup/file-cleanup.test-support.ts";
import { createFileCleanupWorker } from "../cleanup/file-cleanup.ts";
import { answeredReference, PHOTOS, useFileRoutes } from "../file-routes.test-support.ts";

const files = useFileRoutes();

function discardInit(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

async function uploaded(): Promise<string> {
  const response = await files.upload(sampleFile("jpeg", 2_000));
  expect(response.status).toBe(201);
  return (await answeredReference(response)).key;
}

/** An app whose cleanup worker counts its wakes, and the count. */
function countingApp(mutationCoordinator = createMutationCoordinator()) {
  const fileCleanup = createFileCleanupWorker({
    databases: files.conns(),
    objectStore: files.store(),
    mutationCoordinator,
    schedule: () => {},
  });
  let wakes = 0;
  const wake = fileCleanup.wake.bind(fileCleanup);
  fileCleanup.wake = () => {
    wakes += 1;
    wake();
  };
  const app = files.app({ mutationCoordinator, fileCleanup });
  return { app, wakes: () => wakes };
}

const platformWritesQueued = (coordinator: ReturnType<typeof createMutationCoordinator>) =>
  coordinator.snapshot().queuedTickets.filter((ticket) => ticket.kind === "platform").length;

describe("the pending-only route", () => {
  test("moves every pending key it is given in one write, and the worker removes their bytes", async () => {
    const keys = [await uploaded(), await uploaded()];
    expect(files.stored()).toEqual([...keys].sort());
    const mutationCoordinator = createMutationCoordinator();
    const lease = await mutationCoordinator.acquireBuild(mutationCoordinator.reserveBuild());
    const { app, wakes } = countingApp(mutationCoordinator);

    const answer = app.request(FILE_DISCARD_PATH, discardInit({ keys: [...keys, keys[0]] }));
    await until(() => platformWritesQueued(mutationCoordinator) === 1);
    expect(files.ledgerRows().map((row) => row.state)).toEqual(["pending", "pending"]);
    expect(files.stored()).toEqual([...keys].sort());
    expect(wakes()).toBe(0);

    mutationCoordinator.release(lease);
    expect((await answer).status).toBe(204);
    expect(platformWritesQueued(mutationCoordinator)).toBe(0);
    await files.cleaned();
    expect(wakes()).toBe(1);
    expect(files.ledgerRows()).toEqual([]);
    expect(files.stored()).toEqual([]);
  });

  test("leaves a key already owned, enqueued or gone as it is, and answers success", async () => {
    const owned = seedFileLedgerRow(files.conns().readwrite, {
      capabilityId: PHOTOS.capabilityId,
      incarnationId: PHOTOS.incarnationId,
      field: "photo",
      state: "owned",
    });
    const enqueued = seedEnqueuedFile(files.conns().readwrite, 1);
    const before = [owned, enqueued].map((key) => readFileLedgerRow(files.conns().readonly, key));
    const { app, wakes } = countingApp();

    const response = await app.request(
      FILE_DISCARD_PATH,
      discardInit({ keys: [owned, enqueued, mintFileKey()] }),
    );
    await files.cleaned();
    expect(response.status).toBe(204);
    expect([owned, enqueued].map((key) => readFileLedgerRow(files.conns().readonly, key))).toEqual(
      before,
    );
    expect(wakes()).toBe(0);
  });

  test("takes an empty list as nothing to do", async () => {
    const key = await uploaded();
    const { app, wakes } = countingApp();
    expect((await app.request(FILE_DISCARD_PATH, discardInit({ keys: [] }))).status).toBe(204);
    expect(readFileLedgerRow(files.conns().readonly, key)?.state).toBe("pending");
    expect(wakes()).toBe(0);
  });

  test("refuses a body that is not a list of keys, and moves nothing", async () => {
    const key = await uploaded();
    for (const body of [
      "{",
      "null",
      [key],
      { keys: key },
      { keys: [key, "not-a-key"] },
      { keys: [key, 7] },
      { keys: [key.toUpperCase()] },
    ]) {
      const response = await files.app().request(FILE_DISCARD_PATH, discardInit(body));
      expect(response.status).toBe(400);
    }
    expect(readFileLedgerRow(files.conns().readonly, key)?.state).toBe("pending");
  });

  test("refuses a cross-site request and a body past its limit before moving anything", async () => {
    const key = await uploaded();
    const crossSite = discardInit({ keys: [key] }, { "sec-fetch-site": "cross-site" });
    expect((await files.app().request(FILE_DISCARD_PATH, crossSite)).status).toBe(403);

    const padding = " ".repeat(TEXT_BODY_LIMIT_BYTES);
    const tooLarge = discardInit(`{"keys":["${key}"]}${padding}`);
    expect((await files.app().request(FILE_DISCARD_PATH, tooLarge)).status).toBe(413);

    expect(readFileLedgerRow(files.conns().readonly, key)?.state).toBe("pending");
    expect(files.stored()).toEqual([key]);
  });
});
