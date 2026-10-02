// The desk-load sweep as the app wires it: a browser loading the desk, or a capability's page,
// into a tab takes every `pending` key without holding up the render, and its place in the
// coordinator's queue is the cutoff. Any other request to those addresses sweeps nothing.

import { describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { until } from "../../../platform/async.test-support.ts";
import { sampleFile } from "../../../platform/files/admission/sample-files.test-support.ts";
import { seedFileLedgerRow } from "../../../platform/files/store/ledger.test-support.ts";
import * as ledger from "../../../platform/files/store/ledger.ts";
import { STAGING_DIRECTORY } from "../../../platform/files/store/object-store-root.ts";
import {
  createMutationCoordinator,
  type MutationCoordinator,
} from "../../../runtime/concurrency/mutation-coordinator.ts";
import {
  answeredReference,
  PHOTO_UPLOAD_PATH,
  PHOTOS,
  uploadInit,
  useFileRoutes,
} from "../file-routes.test-support.ts";
import { pageNavigation } from "./desk-load.test-support.ts";

const files = useFileRoutes();

/** Admit a photo for `state`, with its bytes where the upload would have left them. */
function seeded(state: ledger.FileLedgerState = "pending", staged = false): string {
  const key = seedFileLedgerRow(files.conns().readwrite, {
    capabilityId: PHOTOS.capabilityId,
    incarnationId: PHOTOS.incarnationId,
    field: "photo",
    state,
  });
  const at = staged ? join(files.root(), STAGING_DIRECTORY) : files.root();
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, key), "bytes");
  return key;
}

const stateOf = (key: string) => ledger.readFileLedgerRow(files.conns().readonly, key)?.state;
const pendingKeys = () =>
  files
    .ledgerRows()
    .filter((row) => row.state === "pending")
    .map((row) => row.key);

/** A coordinator a build is holding, and the way to let it go. */
async function runningBuild() {
  const mutationCoordinator = createMutationCoordinator();
  const lease = await mutationCoordinator.acquireBuild(mutationCoordinator.reserveBuild());
  return { mutationCoordinator, finish: () => mutationCoordinator.release(lease) };
}

const queuedPlatformWrites = (coordinator: MutationCoordinator) =>
  coordinator.snapshot().queuedTickets.filter((ticket) => ticket.kind === "platform").length;

describe("a desk load", () => {
  test("takes every pending key, staged or placed, and their bytes go; nothing else moves", async () => {
    const pending = [seeded(), seeded("pending", true)];
    const owned = seeded("owned");
    const app = files.app();

    expect((await app.request("/", pageNavigation())).status).toBe(200);
    await until(() => pendingKeys().length === 0);
    await files.cleaned();

    expect(files.ledgerRows().map((row) => [row.key, row.state])).toEqual([[owned, "owned"]]);
    expect(files.stored()).toEqual([owned]);
    expect(files.staged()).toEqual([]);
    expect(pending.map(stateOf)).toEqual([undefined, undefined]);
  });

  test("queues its sweep as the request arrives, before anything is drawn", async () => {
    const { mutationCoordinator, finish } = await runningBuild();
    seeded();
    const app = files.app({ mutationCoordinator });

    const answer = app.request("/", pageNavigation());
    expect(queuedPlatformWrites(mutationCoordinator)).toBe(1);

    expect((await answer).status).toBe(200);
    finish();
    await until(() => pendingKeys().length === 0);
    await files.cleaned();
  });

  test("answers while its sweep waits behind a build, which sweeps once the build lets go", async () => {
    const { mutationCoordinator, finish } = await runningBuild();
    const key = seeded();
    const app = files.app({ mutationCoordinator });

    expect((await app.request("/", pageNavigation())).status).toBe(200);
    expect(queuedPlatformWrites(mutationCoordinator)).toBe(1);
    expect(stateOf(key)).toBe("pending");

    finish();
    await until(() => stateOf(key) !== "pending");
    await files.cleaned();
    expect(stateOf(key)).toBeUndefined();
    expect(files.stored()).toEqual([]);
  });

  test("queued behind a build never takes an upload whose row is written after the load", async () => {
    const { mutationCoordinator, finish } = await runningBuild();
    const before = seeded();
    const app = files.app({ mutationCoordinator });

    expect((await app.request("/", pageNavigation())).status).toBe(200);
    const answer = app.request(PHOTO_UPLOAD_PATH, uploadInit(sampleFile("jpeg")));
    await until(() => queuedPlatformWrites(mutationCoordinator) === 2);

    finish();
    const response = await answer;
    expect(response.status).toBe(201);
    const { key } = await answeredReference(response);
    await files.cleaned();
    expect(stateOf(before)).toBeUndefined();
    expect(stateOf(key)).toBe("pending");
    expect(files.stored()).toEqual([key]);
  });

  test("that finds no key pending queues nothing behind a build", async () => {
    const { mutationCoordinator, finish } = await runningBuild();
    const owned = seeded("owned");
    const app = files.app({ mutationCoordinator });

    expect((await app.request("/", pageNavigation())).status).toBe(200);
    expect(queuedPlatformWrites(mutationCoordinator)).toBe(0);

    finish();
    await files.cleaned();
    expect(stateOf(owned)).toBe("owned");
  });

  for (const path of [
    `/capability/${PHOTOS.capabilityId}`,
    `/capability/${PHOTOS.capabilityId}/`,
  ]) {
    test(`of a capability's page at ${path} sweeps as the desk's does`, async () => {
      const key = seeded();
      const app = files.app();

      expect((await app.request(path, pageNavigation())).status).toBe(200);
      await until(() => stateOf(key) !== "pending");
      await files.cleaned();
      expect(stateOf(key)).toBeUndefined();
    });
  }

  test("whose sweep fails says so in the log and still draws the desk", async () => {
    const key = seeded();
    const cause = new Error("disk I/O error");
    const failure = spyOn(ledger, "enqueueAllPendingFiles").mockImplementation(() => {
      throw cause;
    });
    const logged = spyOn(console, "error").mockImplementation(() => {});
    const namesCause = () =>
      logged.mock.calls.some((args) => args.some((arg) => String(arg).includes(cause.message)));
    try {
      expect((await files.app().request("/", pageNavigation())).status).toBe(200);
      await until(namesCause);
      expect(stateOf(key)).toBe("pending");
    } finally {
      failure.mockRestore();
      logged.mockRestore();
    }
  });
});

describe("a desk load made again while its sweep waits", () => {
  test("while that sweep is still last in the queue queues one sweep for both", async () => {
    const { mutationCoordinator, finish } = await runningBuild();
    const first = seeded();
    const app = files.app({ mutationCoordinator });

    await app.request("/", pageNavigation());
    const second = seeded();
    await app.request("/", pageNavigation());
    await app.request(`/capability/${PHOTOS.capabilityId}`, pageNavigation());
    expect(queuedPlatformWrites(mutationCoordinator)).toBe(1);

    finish();
    await until(() => pendingKeys().length === 0);
    await files.cleaned();
    expect([first, second].map(stateOf)).toEqual([undefined, undefined]);
  });

  test("after a build queued behind that sweep keeps it ahead of the build", async () => {
    const { mutationCoordinator, finish } = await runningBuild();
    const key = seeded();
    const app = files.app({ mutationCoordinator });

    await app.request("/", pageNavigation());
    const next = mutationCoordinator.acquireBuild(mutationCoordinator.reserveBuild());
    await app.request("/", pageNavigation());
    expect(mutationCoordinator.snapshot().queuedTickets.map((ticket) => ticket.kind)).toEqual([
      "platform",
      "build",
      "platform",
    ]);

    finish();
    const lease = await next;
    expect(stateOf(key)).not.toBe("pending");
    mutationCoordinator.release(lease);
    await until(() => queuedPlatformWrites(mutationCoordinator) === 0);
    await files.cleaned();
    expect(stateOf(key)).toBeUndefined();
  });
});

describe("a request that does not load a page into a tab", () => {
  const requests: readonly [string, RequestInit][] = [
    [
      "an htmx swap",
      { headers: { "HX-Request": "true", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" } },
    ],
    ["an image", { headers: { "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image" } }],
    ["an iframe", pageNavigation({ "sec-fetch-dest": "iframe" })],
    ["an object", pageNavigation({ "sec-fetch-dest": "object" })],
    ["a fetch", { headers: { "sec-fetch-mode": "cors", "sec-fetch-dest": "document" } }],
    ["a prefetch", pageNavigation({ "sec-purpose": "prefetch" })],
    ["a prerender", pageNavigation({ "sec-purpose": "prefetch;prerender" })],
    ["a HEAD", { ...pageNavigation(), method: "HEAD" }],
    ["a request from outside a browser", {}],
  ];
  const paths = ["/", `/capability/${PHOTOS.capabilityId}`, "/capability/cover.jpg"];

  for (const [name, init] of requests) {
    test(`sweeps nothing when it is ${name}`, async () => {
      const { mutationCoordinator, finish } = await runningBuild();
      const key = seeded();
      const app = files.app({ mutationCoordinator });

      for (const path of paths) await app.request(path, init);
      expect(queuedPlatformWrites(mutationCoordinator)).toBe(0);

      finish();
      await files.cleaned();
      expect(stateOf(key)).toBe("pending");
    });
  }
});

describe("a browser fetching a desk address ahead of a navigation", () => {
  for (const purpose of ["prefetch", "prefetch;prerender"]) {
    test(`is declined, uncached, so the load itself reaches the desk (${purpose})`, async () => {
      const key = seeded();
      const app = files.app();

      for (const path of [
        "/",
        `/capability/${PHOTOS.capabilityId}`,
        `/capability/${PHOTOS.capabilityId}/`,
      ]) {
        const declined = await app.request(path, pageNavigation({ "sec-purpose": purpose }));
        expect(declined.status).toBe(503);
        expect(declined.headers.get("cache-control")).toBe("no-store");
        expect(await declined.text()).toBe("");
      }
      expect(stateOf(key)).toBe("pending");

      expect((await app.request("/", pageNavigation())).status).toBe(200);
      await until(() => stateOf(key) !== "pending");
      await files.cleaned();
    });
  }
});

test("a HEAD carrying a speculation's header is answered as a HEAD at every desk address", async () => {
  const key = seeded();
  const app = files.app();
  const head = { ...pageNavigation({ "sec-purpose": "prefetch" }), method: "HEAD" };

  for (const path of ["/", `/capability/${PHOTOS.capabilityId}`]) {
    expect((await app.request(path, head)).status).toBe(200);
  }
  await files.cleaned();
  expect(stateOf(key)).toBe("pending");
});
