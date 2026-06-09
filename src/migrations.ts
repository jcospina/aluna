// The platform-owned migrations runner — Module 1, Epic 1.4 (ARCH §3, §6.3, §7,
// §9.3). It applies an ordered list of migrations idempotently through the
// read-write connection, records each applied migration in a tracking table, and
// runs on boot (src/index.ts).
//
// This is *platform* schema only. Module 1 ships no domain or capability tables —
// those are created at runtime by the modules that build them (registry: M2,
// data tables: M2, event log: M6, metrics: M2). So the only schema this runner
// owns today is its own ledger, which is exactly enough to prove the mechanism:
// a migration runs once, is recorded, and a second boot is a clean no-op.
//
// Two invariants, both straight from the unifying principle (ARCH §3):
//
//   - Every migration runs through `db`, the single constrained write path.
//   - Migrations are **additive-only** (ARCH §9.3): they add or soft-hide
//     structure and never `DROP`/destructively `RENAME`. The platform is thereby
//     structurally incapable of destroying schema — a property later modules,
//     which drive schema from AI output, lean on. This file is the place that
//     property is established; keep new migrations additive.

import type { Database } from "bun:sqlite";
import { db } from "./db.ts";

// The bookkeeping table that records which migrations have been applied. Its name
// is a fixed platform constant (never user input), so interpolating it into SQL
// below is safe.
export const MIGRATIONS_TABLE = "schema_migrations";

// One ordered, idempotently-applied unit of platform schema. `id` is a stable,
// lexically-sortable identifier (the array order is the apply order; the id is
// what the ledger records). `up` performs the additive change through the given
// read-write connection.
export interface Migration {
  readonly id: string;
  readonly up: (database: Database) => void;
}

// The ordered migration list. Append-only over the project's life — never reorder
// or rewrite an applied migration, since the ledger keys on `id`.
//
// 0001 creates the ledger itself. That makes the very first migration both the
// thing being recorded *and* the table it is recorded in: `up` creates the table
// (IF NOT EXISTS), then the runner records `0001` into it within the same
// transaction. It is the minimal honest migration that proves the runner without
// inventing any domain table (ARCH §6.3 reserves the registry/event-log/metrics
// stores for later modules).
export const MIGRATIONS: readonly Migration[] = [
  {
    id: "0001_platform_migrations_ledger",
    up: (database) => {
      database.exec(
        `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
           id         TEXT PRIMARY KEY,
           applied_at TEXT NOT NULL DEFAULT (datetime('now'))
         ) STRICT;`,
      );
    },
  },
];

// The set of migration ids already recorded in the ledger. Returns empty when the
// ledger table does not exist yet (a fresh db, before 0001 has run) — that's the
// bootstrap case, not an error.
function appliedMigrationIds(database: Database): Set<string> {
  const ledgerExists = database
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(MIGRATIONS_TABLE);
  if (!ledgerExists) return new Set<string>();

  const rows = database.query(`SELECT id FROM ${MIGRATIONS_TABLE}`).all() as { id: string }[];
  return new Set(rows.map((row) => row.id));
}

// Apply every not-yet-recorded migration in order, through the read-write
// connection, recording each in the ledger as it lands. Returns the ids applied
// on this run — empty when everything is already up to date, which is what makes
// a re-run (and every boot after the first) a no-op.
//
// Each migration's `up` and its ledger record commit together in one transaction:
// a crash mid-migration rolls back both, so the ledger never claims a migration
// that didn't fully apply, and the next boot retries it cleanly (ARCH §9.5).
export function runMigrations(database: Database = db): string[] {
  const applied = appliedMigrationIds(database);
  const newlyApplied: string[] = [];

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;

    database.transaction(() => {
      migration.up(database);
      database.run(`INSERT INTO ${MIGRATIONS_TABLE} (id) VALUES (?)`, [migration.id]);
    })();

    newlyApplied.push(migration.id);
  }

  return newlyApplied;
}
