// The kill cases of Module 7's fault battery (issue 7.3/06): the real server, killed with SIGKILL
// at the worst moment and booted again on the same database and store.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARTIFACTS_ROOT_ENV_VAR } from "../../../builder/artifacts/artifacts-root.ts";
import { RECRAFT_BASE_URL_ENV_VAR } from "../../../lifecycle/logo/generation/provider.ts";
import { until, waitForLog } from "../../../platform/async.test-support.ts";
import { sampleFile } from "../../../platform/files/admission/sample-files.test-support.ts";
import { FILE_LEDGER_TABLE, type FileLedgerRow } from "../../../platform/files/store/ledger.ts";
import {
  OBJECT_STORE_ROOT_ENV_VAR,
  STAGING_DIRECTORY,
} from "../../../platform/files/store/object-store-root.ts";
import { expectStoreAtRest } from "../../../platform/files/store/store-at-rest.test-support.ts";
import { openDatabase, type PlatformDatabase } from "../../../platform/persistence/db.ts";
import { DB_PATH_ENV_VAR } from "../../../platform/persistence/db-path.ts";
import { runMigrations } from "../../../platform/persistence/migrations.ts";
import { withDefaultRoots } from "../../../platform/persistence/test-preload/test-roots.test-support.ts";
import { BASE_URL_ENV_VAR } from "../../../platform/provider/config.ts";
import { install, photosRow } from "../../../runtime/router/dispatch/router.test-support.ts";
import { LISTENING_LOG } from "../../serve-options.ts";
import {
  type AnsweredReference,
  heldBody,
  PHOTO_UPLOAD_PATH,
  uploadInit,
} from "../file-routes.test-support.ts";
import { pageNavigation } from "../sweep/desk-load.test-support.ts";

const REPO_ROOT = join(import.meta.dir, "../../../..");
const KILL_CASE_TIMEOUT_MS = 60_000;
/** Where the spawned server's providers point: nothing listens there, so no call leaves the box. */
const CLOSED_ADDRESS = "http://127.0.0.1:9";

let dir: string;
let root: string;
let dbPath: string;
let ledger: PlatformDatabase | undefined;
const running: Bun.Subprocess[] = [];
process.once("exit", () => {
  for (const proc of running) proc.kill("SIGKILL");
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omni-crud-killed-"));
  root = join(dir, "storage");
  dbPath = join(dir, "omni-crud.db");
  const seeded = openDatabase(dbPath);
  try {
    runMigrations(seeded.readwrite);
    install(seeded, photosRow());
  } finally {
    seeded.readwrite.close();
    seeded.readonly.close();
  }
});

afterEach(async () => {
  for (const proc of running.splice(0)) {
    proc.kill("SIGKILL");
    await proc.exited;
  }
  ledger?.readwrite.close();
  ledger?.readonly.close();
  ledger = undefined;
  rmSync(dir, { recursive: true, force: true });
});

/** The server booted on the scratch database and store, once it listens. */
async function boot() {
  const proc = Bun.spawn([process.execPath, "src/index.ts"], {
    cwd: REPO_ROOT,
    env: {
      ...withDefaultRoots(),
      PORT: "0",
      [DB_PATH_ENV_VAR]: dbPath,
      [OBJECT_STORE_ROOT_ENV_VAR]: root,
      [ARTIFACTS_ROOT_ENV_VAR]: join(dir, "capabilities"),
      [BASE_URL_ENV_VAR]: CLOSED_ADDRESS,
      [RECRAFT_BASE_URL_ENV_VAR]: CLOSED_ADDRESS,
    },
    stdout: "pipe",
    stderr: "inherit",
  });
  running.push(proc);
  const log = await waitForLog(proc.stdout, LISTENING_LOG, 20_000);
  const url = log
    .slice(log.indexOf(LISTENING_LOG) + LISTENING_LOG.length)
    .trim()
    .split(/\s/)[0];
  if (!url) throw new Error("the server never said where it listens");
  return {
    url: (path: string) => new URL(path, url),
    kill: async () => {
      proc.kill("SIGKILL");
      await proc.exited;
      const at = running.indexOf(proc);
      if (at >= 0) running.splice(at, 1);
    },
  };
}

function rows(): Pick<FileLedgerRow, "key" | "state">[] {
  ledger ??= openDatabase(dbPath);
  return ledger.readonly.query(`SELECT "key", "state" FROM ${FILE_LEDGER_TABLE}`).all() as Pick<
    FileLedgerRow,
    "key" | "state"
  >[];
}

const entries = (path: string) => (existsSync(path) ? readdirSync(path) : []);
const staged = () => entries(join(root, STAGING_DIRECTORY));
const stored = () => entries(root).filter((entry) => entry !== STAGING_DIRECTORY);

function expectAtRest(): void {
  ledger ??= openDatabase(dbPath);
  expectStoreAtRest(ledger.readonly, root);
}

async function uploadWhole(server: Awaited<ReturnType<typeof boot>>): Promise<string> {
  const response = await fetch(server.url(PHOTO_UPLOAD_PATH), uploadInit(sampleFile("jpeg", 4096)));
  expect(response.status).toBe(201);
  return ((await response.json()) as AnsweredReference).key;
}

async function loadDesk(server: Awaited<ReturnType<typeof boot>>): Promise<void> {
  expect((await fetch(server.url("/"), pageNavigation())).status).toBe(200);
}

test(
  "killed mid-stream, the next boot empties staging and no row exists",
  async () => {
    const first = await boot();
    const body = heldBody();
    const sent = fetch(first.url(PHOTO_UPLOAD_PATH), uploadInit(body.stream)).catch(() => null);
    body.push(sampleFile("jpeg", 4096));
    await until(() => staged().length === 1);

    await first.kill();
    expect(await sent).toBeNull();
    expect(staged()).toHaveLength(1);
    await boot();

    expect(staged()).toEqual([]);
    expect(rows()).toEqual([]);
    expectAtRest();
  },
  KILL_CASE_TIMEOUT_MS,
);

test(
  "killed between the row and the rename, the pending row outlives boot and a desk load takes it",
  async () => {
    const first = await boot();
    const key = await uploadWhole(first);
    await first.kill();
    // The window between the row's commit and the rename is too short to kill in, so the disk is
    // put back as such a kill leaves it: the row pending, its bytes still in staging.
    mkdirSync(join(root, STAGING_DIRECTORY), { recursive: true });
    renameSync(join(root, key), join(root, STAGING_DIRECTORY, key));

    const second = await boot();
    expect([staged(), stored(), rows()]).toEqual([[], [], [{ key, state: "pending" }]]);
    await loadDesk(second);

    await until(() => rows().length === 0);
    expect([staged(), stored()]).toEqual([[], []]);
    expectAtRest();
  },
  KILL_CASE_TIMEOUT_MS,
);

test(
  "killed with an upload held in a form, the bytes outlive boot and a desk load takes them",
  async () => {
    const first = await boot();
    const key = await uploadWhole(first);
    await first.kill();

    const second = await boot();
    expect([stored(), rows()]).toEqual([[key], [{ key, state: "pending" }]]);
    await loadDesk(second);

    await until(() => rows().length === 0 && stored().length === 0);
    expectAtRest();
  },
  KILL_CASE_TIMEOUT_MS,
);
