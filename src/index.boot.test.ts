import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitForLog } from "./platform/async.test-support.ts";
import { readFileLedgerRow } from "./platform/files/store/ledger.ts";
import {
  OBJECT_STORE_ROOT_ENV_VAR,
  STAGING_DIRECTORY,
} from "./platform/files/store/object-store-root.ts";
import { openDatabase } from "./platform/persistence/db.ts";
import { DB_PATH_ENV_VAR } from "./platform/persistence/db-path.ts";
import { runMigrations } from "./platform/persistence/migrations.ts";
import { withDefaultRoots } from "./platform/persistence/test-preload/test-roots.test-support.ts";
import {
  EXHAUSTED_ATTEMPTS,
  seedEnqueuedFile,
} from "./server/files/cleanup/file-cleanup.test-support.ts";
import { LISTENING_LOG } from "./server/serve-options.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omni-crud-boot-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("boot empties the upload staging directory before the server listens", async () => {
  const root = join(dir, "objects");
  const staging = join(root, STAGING_DIRECTORY);
  mkdirSync(staging, { recursive: true });
  writeFileSync(join(staging, "unfinished-upload"), "bytes a previous process never finished");

  const proc = Bun.spawn(["bun", join(import.meta.dir, "index.ts")], {
    cwd: dir,
    env: { ...withDefaultRoots(), PORT: "0", [OBJECT_STORE_ROOT_ENV_VAR]: root },
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    await waitForLog(proc.stdout, LISTENING_LOG, 15_000);
    expect(readdirSync(staging)).toEqual([]);
  } finally {
    proc.kill();
    await proc.exited;
  }
}, 20_000);

test("boot deletes every enqueued key's bytes and row before the server listens", async () => {
  const root = join(dir, "objects");
  const dbPath = join(dir, "boot.db");
  const seeded = openDatabase(dbPath);
  let keys: string[];
  try {
    runMigrations(seeded.readwrite);
    keys = [
      seedEnqueuedFile(seeded.readwrite),
      seedEnqueuedFile(seeded.readwrite, EXHAUSTED_ATTEMPTS),
    ];
  } finally {
    seeded.readwrite.close();
    seeded.readonly.close();
  }
  mkdirSync(root, { recursive: true });
  for (const key of keys) writeFileSync(join(root, key), "bytes a previous process enqueued");

  const proc = Bun.spawn(["bun", join(import.meta.dir, "index.ts")], {
    cwd: dir,
    env: {
      ...withDefaultRoots(),
      PORT: "0",
      [OBJECT_STORE_ROOT_ENV_VAR]: root,
      [DB_PATH_ENV_VAR]: dbPath,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    await waitForLog(proc.stdout, LISTENING_LOG, 15_000);
    expect(keys.map((key) => existsSync(join(root, key)))).toEqual([false, false]);
    const after = openDatabase(dbPath);
    try {
      expect(keys.map((key) => readFileLedgerRow(after.readonly, key))).toEqual([null, null]);
    } finally {
      after.readwrite.close();
      after.readonly.close();
    }
  } finally {
    proc.kill();
    await proc.exited;
  }
}, 20_000);
