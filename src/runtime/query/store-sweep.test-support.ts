// The store sweep both query-side suites prove their no-state claim with.
//
// A read through the worker and a whole-catalog scope around it are the module's single
// exception to *everything is cached*, and it is an exception in the direction of less
// state (PLAN decision 2). The deterministic form of that claim is this: everything a run
// could have added — the database's own objects, their row counts and their contents, the
// database file's directory, and the platform's artifact roots — captured before and after,
// and compared.
//
// The contents digest is not redundant beside the row count. `read_dependencies` is a
// column on `capability_registry`, not a table of its own, so a persisted read dependency
// would land as an edit inside an existing row and leave every count untouched.
//
// The roots are absolute so the sweep cannot silently degrade to nothing when the process
// runs from another directory, and the walk is recursive so a file written one level in is
// still seen. Table names come from `sqlite_master` on a database the caller created, never
// from user input, so quoting them here rather than reaching into `runtime/data`'s
// internals costs nothing. This module is not run as a test by bun.

import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
/** Where capability artifacts, generated code and stored logos land, if they ever do. */
const PLATFORM_ARTIFACT_ROOTS = ["artifacts", "capabilities", "storage"].map((root) =>
  join(REPO_ROOT, root),
);

export interface PlatformStoreEntry {
  readonly type: string;
  readonly name: string;
  readonly sql: string | null;
  readonly rows: number | null;
  readonly digest: string | null;
}

export interface PlatformStoreSweep {
  readonly stores: readonly PlatformStoreEntry[];
  readonly paths: readonly string[];
}

export function sweepPlatformStores(database: Database, directory: string): PlatformStoreSweep {
  const objects = database
    .query("SELECT type, name, sql FROM sqlite_master ORDER BY type, name")
    .all() as { type: string; name: string; sql: string | null }[];
  return {
    stores: objects.map((object) => ({
      ...object,
      rows: object.type === "table" ? countRows(database, object.name) : null,
      digest: object.type === "table" ? digestRows(database, object.name) : null,
    })),
    paths: [directory, ...sweepPlatformArtifacts()].sort(),
  };
}

/** Everything under the platform's artifact roots right now, absolute and recursive. */
export function sweepPlatformArtifacts(): readonly string[] {
  return PLATFORM_ARTIFACT_ROOTS.flatMap(entries);
}

/**
 * Additions only: the claim is that a read *creates* nothing, and a dev server building a
 * capability beside this run may legitimately remove something.
 */
export function addedPaths(
  before: PlatformStoreSweep,
  after: PlatformStoreSweep,
): readonly string[] {
  return after.paths.filter((entry) => !before.paths.includes(entry));
}

function entries(directory: string): readonly string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true }).map((entry) => join(directory, String(entry)));
}

function countRows(database: Database, table: string): number {
  const row = database.query(`SELECT count(*) AS total FROM "${table}"`).get() as { total: number };
  return row.total;
}

function digestRows(database: Database, table: string): string {
  const rows = database.query(`SELECT * FROM "${table}"`).all();
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
