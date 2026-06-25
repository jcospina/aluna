// The platform-owned migrations runner — Module 1, Epic 1.4 (ARCH §3, §6.3, §7,
// §9.3). It applies an ordered list of migrations idempotently through the
// read-write connection, records each applied migration in a tracking table, and
// runs on boot (src/index.ts).
//
// This is *platform* schema only: the ledger (M1) and the capability registry
// (M2), with metrics (M2) and the event log (M6) to follow. Capability *data*
// tables (`cap_<id>`) never appear here — those are derived from specs and
// created at runtime by the builder. The mechanism's guarantee holds for every
// entry: a migration runs once, is recorded, and a second boot is a clean no-op.
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
import { GENERATION_METRICS_TABLE } from "./metrics/store.ts";
import { REGISTRY_TABLE } from "./registry/store.ts";

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
  // 0002 creates the capability registry (M2, Epic 2.1) — the source of truth
  // for everything Aluna has become (ARCH §6.3). One row per capability, kept
  // lean (spec + version + artifacts pointer) because the intent resolver scans
  // every row on every classification. `schema`, `ui_intent`, and `tools` hold
  // JSON text; the access module (src/registry/store.ts) owns the (de)serialization
  // and validates rows against the Zod spec shape in both directions.
  {
    id: "0002_capability_registry",
    up: (database) => {
      database.exec(
        `CREATE TABLE IF NOT EXISTS ${REGISTRY_TABLE} (
           id             TEXT PRIMARY KEY,
           label          TEXT NOT NULL,
           version        INTEGER NOT NULL,
           schema         TEXT NOT NULL,
           ui_intent      TEXT NOT NULL,
           behavior       TEXT NOT NULL,
           tools          TEXT NOT NULL,
           artifacts_path TEXT NOT NULL,
           prompt_context TEXT NOT NULL
         ) STRICT;`,
      );
    },
  },
  // 0003 adds the stable behavioral error contract to the registry spec row.
  // The default keeps already-created rows readable; the access layer backfills
  // the standard missing-required-fields contract from their stored schema.
  {
    id: "0003_capability_registry_behavioral_errors",
    up: (database) => {
      database.exec(
        `ALTER TABLE ${REGISTRY_TABLE}
         ADD COLUMN behavioral_errors TEXT NOT NULL DEFAULT '[]';`,
      );
    },
  },
  // 0004 creates the generation-metrics store (M2, Epic 2.7) — the experiment's
  // measurements, one row per generation, recording what the *system* did to build
  // itself (ARCH §6.3, distinct from M6's event log of what the *user* did). The
  // PLAN step-8 fields: identity + intent classification, model + token counts, the
  // timing breakdown (spec-gen, migration, code-gen, HTML-gen, test-gen, test-run,
  // total wall-clock), the per-rung gate outcomes and per-unit fix-loop attempts as
  // JSON, and the outcome — including which stage/rung a failure stopped at. Every
  // build column past identity/intent/model is nullable so a deflection (intent only)
  // or a failed build (everything up to the failing rung) writes with partial
  // knowledge; absence is stored as NULL, never a fabricated zero. The metrics
  // access module (src/metrics/store.ts) owns the (de)serialization and validates
  // rows against the Zod shape in both directions.
  {
    id: "0004_generation_metrics",
    up: (database) => {
      database.exec(
        `CREATE TABLE IF NOT EXISTS ${GENERATION_METRICS_TABLE} (
           id                       TEXT PRIMARY KEY,
           created_at               TEXT NOT NULL DEFAULT (datetime('now')),
           outcome                  TEXT NOT NULL,
           capability_id            TEXT,
           intent_type              TEXT NOT NULL,
           intent_confidence        REAL NOT NULL,
           intent_target_capability TEXT,
           model                    TEXT NOT NULL,
           input_tokens             INTEGER,
           output_tokens            INTEGER,
           total_tokens             INTEGER,
           spec_gen_ms              REAL,
           migration_ms             REAL,
           code_gen_ms              REAL,
           html_gen_ms              REAL,
           test_gen_ms              REAL,
           test_run_ms              REAL,
           total_ms                 REAL,
           gate_rungs               TEXT,
           unit_attempts            TEXT,
           failed_stage             TEXT,
           failed_rung              TEXT,
           failed_message           TEXT
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
