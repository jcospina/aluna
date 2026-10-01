// The worker as the app wires it: a desk load presses another try for a key whose retries ran out,
// the render does not wait for it, and a worker wired to anything else is refused. Boot's drain is
// in `src/index.boot.test.ts`.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileLedgerRow } from "../../../platform/files/store/ledger.ts";
import { createLocalObjectStore } from "../../../platform/files/store/object-store.ts";
import { openDatabase, type PlatformDatabase } from "../../../platform/persistence/db.ts";
import { runMigrations } from "../../../platform/persistence/migrations.ts";
import { createMutationCoordinator } from "../../../runtime/concurrency/mutation-coordinator.ts";
import { createTestApp } from "../../isolated-app.test-support.ts";
import { EXHAUSTED_ATTEMPTS, seedEnqueuedFile } from "./file-cleanup.test-support.ts";
import { createFileCleanupWorker } from "./file-cleanup.ts";

let dir: string;
let databases: PlatformDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omni-crud-file-cleanup-wiring-"));
  databases = openDatabase(join(dir, "app.db"));
  runMigrations(databases.readwrite);
});

afterEach(() => {
  databases.readwrite.close();
  databases.readonly.close();
  rmSync(dir, { recursive: true, force: true });
});

test("a desk load gives a key whose retries ran out another try", async () => {
  const key = seedEnqueuedFile(databases.readwrite, EXHAUSTED_ATTEMPTS);
  const root = join(dir, "storage");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, key), "bytes");
  const mutationCoordinator = createMutationCoordinator();
  const objectStore = createLocalObjectStore(root);
  const fileCleanup = createFileCleanupWorker({ databases, objectStore, mutationCoordinator });
  const app = createTestApp({
    capabilityRouter: { databases },
    mutationCoordinator,
    objectStore,
    fileCleanup,
  });

  fileCleanup.wake();
  await fileCleanup.idle();
  expect(existsSync(join(root, key))).toBe(true);

  expect((await app.request("/")).status).toBe(200);
  await fileCleanup.idle();
  expect(existsSync(join(root, key))).toBe(false);
  expect(readFileLedgerRow(databases.readwrite, key)).toBeNull();
});

test("a desk load answers while a cleanup it pressed is still deleting", async () => {
  seedEnqueuedFile(databases.readwrite, EXHAUSTED_ATTEMPTS);
  const mutationCoordinator = createMutationCoordinator();
  let release = () => {};
  const deleting = new Promise<void>((resolve) => (release = resolve));
  const objectStore = { ...createLocalObjectStore(join(dir, "storage")), delete: () => deleting };
  const fileCleanup = createFileCleanupWorker({ databases, objectStore, mutationCoordinator });
  const app = createTestApp({
    capabilityRouter: { databases },
    mutationCoordinator,
    objectStore,
    fileCleanup,
  });

  expect((await app.request("/")).status).toBe(200);
  release();
  await fileCleanup.idle();
});

test("the app refuses a worker that drives another coordinator, ledger or store", () => {
  const mutationCoordinator = createMutationCoordinator();
  const objectStore = createLocalObjectStore(join(dir, "storage"));
  const elsewhere = [
    { databases, objectStore, mutationCoordinator: createMutationCoordinator() },
    { databases, objectStore: createLocalObjectStore(join(dir, "other")), mutationCoordinator },
  ];
  for (const wiring of elsewhere) {
    expect(() =>
      createTestApp({
        capabilityRouter: { databases },
        mutationCoordinator,
        objectStore,
        fileCleanup: createFileCleanupWorker(wiring),
      }),
    ).toThrow();
  }
});
