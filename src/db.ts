// The platform's SQLite foundation — Module 1, Epic 1.4: two connections against
// the single database file (ARCH §3, §4, §6.3, §7).
//
// The whole data model collapses to one line (ARCH §3): *mutation is constrained
// and serialized; reading is free and concurrent.* These two connections are how
// that becomes physically true at the storage layer:
//
//   - `db`         — the read-write connection, the platform's only write path.
//   - `dbReadonly` — a separate connection opened with SQLITE_OPEN_READONLY. This
//                    is the *deterministic* guarantee that a write is impossible
//                    on the read path regardless of what SQL is issued (ARCH §7):
//                    the kernel rejects it, so safety doesn't depend on the model
//                    emitting only SELECTs. Later epics (M4 `data_query`) lean on
//                    exactly this.
//
// Both open against the one documented db file (Epic 1.1: `data/omni-crud.db`).
// No domain tables here — those are created at runtime by the modules that need
// them; the platform-owned migrations runner (Epic 1.4.02) builds on `db`.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// The single documented db-file convention (Epic 1.1, ARCH §6.3). All four
// platform stores (registry, event log, data tables, metrics) live in this one
// file; both connections open against it.
export const DB_PATH = "data/omni-crud.db";

export interface PlatformDatabase {
  /** The constrained, serialized write path (ARCH §3). */
  readwrite: Database;
  /** The free, concurrent read path — SQLITE_OPEN_READONLY (ARCH §3, §7). */
  readonly: Database;
}

// Open the read-write + read-only pair against `path`. Exported as a factory so
// tests can drive it against a throwaway file; the platform's shared singletons
// below open it against DB_PATH.
export function openDatabase(path = DB_PATH): PlatformDatabase {
  // The read-write connection creates the file but not its parent directory, so
  // ensure the directory exists first — keeps a fresh checkout (or a temp path)
  // from failing on first open.
  mkdirSync(dirname(path), { recursive: true });

  // Read-write first: SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, so the file is
  // created if absent. Opening it before the read-only connection guarantees the
  // file (and its WAL sidecars) exist for that connection to attach to.
  const readwrite = new Database(path, { create: true, readwrite: true });

  // WAL is what lets the read path stay concurrent with the serialized write path
  // (ARCH §3) — readers see the last committed snapshot without blocking the
  // writer, and vice versa. busy_timeout absorbs the brief write-lock contention
  // around a checkpoint instead of surfacing a spurious SQLITE_BUSY. The `-wal`/
  // `-shm` sidecars this creates live alongside the db file (data/README.md).
  readwrite.exec("PRAGMA journal_mode = WAL;");
  readwrite.exec("PRAGMA busy_timeout = 5000;");

  // A read-only connection cannot *create* the WAL's `-shm` shared-memory index;
  // it can only attach to an existing one. On a brand-new db that has had no write
  // yet, that index doesn't exist, so the read-only open below would fail with
  // "unable to open database file". This checkpoint materializes the `-shm`
  // without touching any data, schema, or user_version — it just sets up the WAL
  // machinery so the read path can always attach, even before the first migration.
  readwrite.exec("PRAGMA wal_checkpoint(TRUNCATE);");

  // Read-only: SQLITE_OPEN_READONLY. A write through this connection is rejected
  // by SQLite itself ("attempt to write a readonly database"), which is the
  // deterministic safety boundary the read path relies on (ARCH §7).
  const readonly = new Database(path, { readonly: true });
  readonly.exec("PRAGMA busy_timeout = 5000;");

  return { readwrite, readonly };
}

// The platform's single, shared db access points (ARCH §6.3). Later epics import
// these directly: every write goes through `db`, every read through `dbReadonly`.
const platformDatabase = openDatabase();

export const db = platformDatabase.readwrite;
export const dbReadonly = platformDatabase.readonly;
