// The platform's SQLite foundation: two connections against the single database file.
//
// Mutation is constrained and serialized; reading is free and concurrent. `db` is the read-write
// connection and the platform's only write path. `dbReadonly` opens with `SQLITE_OPEN_READONLY`,
// so a write on the read path is impossible whatever SQL is issued — SQLite rejects it, and
// safety does not depend on the model emitting only SELECTs.
//
// Both open against the one documented db file, `data/omni-crud.db`, whose WAL sidecars sit
// beside it (data/README.md). No domain tables here — those are created at runtime by the
// modules that need them, and the platform-owned migrations runner builds on `db`.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { configureSqliteRuntime } from "./sqlite-functions.ts";

configureSqliteRuntime();

/**
 * The single documented db-file convention (Epic 1.1, ARCH §6.3). All four platform stores —
 * registry, event log, data tables, metrics — live in this one file.
 */
export const DB_PATH = "data/omni-crud.db";

export interface PlatformDatabase {
  /** The constrained, serialized write path. */
  readwrite: Database;
  /** The free, concurrent read path — SQLITE_OPEN_READONLY. */
  readonly: Database;
}

/**
 * Bun's `Database.transaction` helper commits before an awaited continuation settles. Builder
 * work needs one rollback scope spanning later async stages, so this keeps the transaction open.
 */
export async function withWriteTransaction<T>(
  database: Database,
  body: () => T | Promise<T>,
  beforeCommit?: () => void,
): Promise<T> {
  database.exec("BEGIN IMMEDIATE TRANSACTION;");

  try {
    const result = await body();
    // Activation's last cancellation check runs here, immediately before SQLite's point of no
    // return; inside an async body it would leave one microtask-sized gap.
    beforeCommit?.();
    database.exec("COMMIT;");
    return result;
  } catch (err) {
    try {
      database.exec("ROLLBACK;");
    } catch (rollbackErr) {
      throw new AggregateError([err, rollbackErr], "Transaction failed and rollback failed");
    }
    throw err;
  }
}

/**
 * Open the read-write + read-only pair against `path`. A factory so tests can drive it against a
 * throwaway file; the shared singletons below open it against DB_PATH.
 */
export function openDatabase(path = DB_PATH): PlatformDatabase {
  // The read-write connection creates the file but not its parent directory, so a fresh
  // checkout or a temp path would fail on first open.
  mkdirSync(dirname(path), { recursive: true });

  // SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE. Opening this first guarantees the file and its
  // WAL sidecars exist for the read-only connection to attach to.
  const readwrite = new Database(path, { create: true, readwrite: true });

  // WAL lets readers see the last committed snapshot without blocking the writer, and vice versa.
  // busy_timeout absorbs write-lock contention at a checkpoint instead of a spurious SQLITE_BUSY.
  readwrite.exec("PRAGMA journal_mode = WAL;");
  readwrite.exec("PRAGMA busy_timeout = 5000;");

  // A read-only connection attaches to the WAL's `-shm` index but can never create it, so on a
  // brand-new db the read-only open below fails with "unable to open database file".
  readwrite.exec("PRAGMA wal_checkpoint(TRUNCATE);");

  // SQLITE_OPEN_READONLY: a write here is rejected by SQLite itself ("attempt to write a
  // readonly database"), which is the deterministic boundary the read path relies on.
  const readonly = new Database(path, { readonly: true });
  readonly.exec("PRAGMA busy_timeout = 5000;");

  return { readwrite, readonly };
}

// The platform's single, shared db access points. Later epics import
// these directly: every write goes through `db`, every read through `dbReadonly`.
const platformDatabase = openDatabase();

export const db = platformDatabase.readwrite;
export const dbReadonly = platformDatabase.readonly;
