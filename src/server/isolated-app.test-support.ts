// The one way a test builds the app. `createApp` defaults every store to the configured one, which
// the test preload points at a scratch copy every file in the process shares, and a page load
// reconciles logos and retries deletion cleanup against whatever it was handed, so a test that
// forgets one dependency reads and edits the leftovers of the files before it. Not a test file
// itself (no `*.test.ts`), so bun never runs it.

import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalObjectStore } from "../platform/files/object-store.ts";
import { openDatabase, type PlatformDatabase } from "../platform/persistence/db.ts";
import { runMigrations } from "../platform/persistence/migrations.ts";
import { type AppDeps, createApp } from "./app.ts";

function scratchDatabases(dir: string): PlatformDatabase {
  const conns = openDatabase(join(dir, "test.db"));
  runMigrations(conns.readwrite);
  afterAll(() => {
    conns.readwrite.close();
    conns.readonly.close();
  });
  return conns;
}

/**
 * `createApp` with every store it would default to the real one pointed at scratch instead: an
 * empty migrated database, an artifacts root and an object store, unless the caller names its own.
 * The scratch directory goes when the calling file's tests are done.
 */
export function createTestApp(deps: AppDeps = {}): ReturnType<typeof createApp> {
  const dir = mkdtempSync(join(tmpdir(), "omni-crud-app-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const databases =
    deps.capabilityRouter?.databases ?? deps.buildDatabases ?? scratchDatabases(dir);
  return createApp({
    ...deps,
    capabilityRouter: { ...deps.capabilityRouter, databases },
    buildDatabases: deps.buildDatabases ?? databases,
    artifactsRoot: deps.artifactsRoot ?? join(dir, "artifacts"),
    objectStore: deps.objectStore ?? createLocalObjectStore(join(dir, "storage")),
  });
}
