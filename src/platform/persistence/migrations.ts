// The platform-owned migrations runner (ARCH §3, §6.3, §7, §9.3). It applies an ordered list of
// migrations idempotently through the read-write connection, records each in a tracking table,
// and runs on boot.
//
// Platform schema only. Capability data tables (`cap_<id>`) never appear here — the builder
// derives those from specs at runtime.
//
// Two invariants. Every migration runs through `db`, the single constrained write path. And
// migrations are additive-only: they add or soft-hide structure and never `DROP` or
// destructively `RENAME`, so the platform cannot destroy schema — a property later modules,
// which drive schema from AI output, lean on. Keep new migrations additive.

import type { Database } from "bun:sqlite";
import { LOGO_BIRTH_STATUS, LOGO_STATUSES } from "../../registry/logo.ts";
import { REGISTRY_TABLE } from "../../registry/store/store.ts";
import { INTENT_RESOLUTION_METRICS_TABLE } from "../metrics/intent-resolution-store.ts";
import {
  GENERATION_LIFECYCLE_TABLE,
  reconcileRunningGenerationLifecycles,
} from "../metrics/lifecycle-store.ts";
import { GENERATION_METRICS_TABLE } from "../metrics/store.ts";
import { db } from "./db.ts";

/**
 * The bookkeeping table recording which migrations have been applied. A fixed platform constant,
 * never user input, so interpolating it into the SQL below is safe.
 */
export const MIGRATIONS_TABLE = "schema_migrations";

/**
 * One ordered, idempotently-applied unit of platform schema. The array order is the apply order;
 * `id` is what the ledger records, and `up` performs the additive change.
 */
export interface Migration {
  readonly id: string;
  readonly up: (database: Database) => void;
}

/**
 * The ordered migration list. Append-only over the project's life — never reorder or rewrite an
 * applied migration, since the ledger keys on `id`.
 */
export const MIGRATIONS: readonly Migration[] = [
  // 0001 creates the ledger it is itself recorded in: `up` creates the table, then the runner
  // records `0001` into it within the same transaction.
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
  // 0002 creates the capability registry, one lean row per capability because the intent resolver
  // scans every row on every classification. `src/registry/store/store.ts` owns the JSON columns.
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
  // 0003 adds the behavioral error contract. The default keeps already-created rows readable;
  // the access layer backfills the missing-required-fields contract from their stored schema.
  {
    id: "0003_capability_registry_behavioral_errors",
    up: (database) => {
      database.exec(
        `ALTER TABLE ${REGISTRY_TABLE}
         ADD COLUMN behavioral_errors TEXT NOT NULL DEFAULT '[]';`,
      );
    },
  },
  // 0004 records what the system did to build itself (ARCH §6.3, distinct from M8's event log of
  // what the user did). Past model, every column is nullable: absence is NULL, never a fake zero.
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
  // 0005 names Module 3's presentation stage honestly. `html_gen_ms` stays M2 historical data,
  // so item-renderer timings write to `presentation_gen_ms` rather than overload an M2 name.
  {
    id: "0005_generation_metrics_presentation_gen",
    up: (database) => {
      database.exec(
        `ALTER TABLE ${GENERATION_METRICS_TABLE}
         ADD COLUMN presentation_gen_ms REAL;`,
      );
    },
  },
  // 0006's empty registry default only makes SQLite's additive ALTER legal — row validation
  // rejects it. Metrics keep `incarnation_id` nullable for failures predating an identity.
  {
    id: "0006_incarnation_keyed_capabilities",
    up: (database) => {
      database.exec(
        `ALTER TABLE ${REGISTRY_TABLE}
         ADD COLUMN incarnation_id TEXT NOT NULL DEFAULT '';`,
      );
      database.exec(
        `ALTER TABLE ${GENERATION_METRICS_TABLE}
         ADD COLUMN incarnation_id TEXT;`,
      );
    },
  },
  // 0007's default carries the complete fixed five-Action inventory with every list empty; the
  // registry validator rejects any row whose keys are not exactly that shape.
  {
    id: "0007_capability_registry_read_dependencies",
    up: (database) => {
      database.exec(
        `ALTER TABLE ${REGISTRY_TABLE}
         ADD COLUMN read_dependencies TEXT NOT NULL DEFAULT '{"create":[],"read":[],"update":[],"delete":[],"search":[]}';`,
      );
    },
  },
  // 0008 adds the admitted-build lifecycle beside the M2 terminal metrics table. `outcome` is
  // nullable while a build runs, and the JSON measurement groups stay additive.
  {
    id: "0008_generation_metrics_lifecycle",
    up: (database) => {
      database.exec(
        `CREATE TABLE IF NOT EXISTS ${GENERATION_LIFECYCLE_TABLE} (
           build_id             TEXT NOT NULL,
           incarnation_id       TEXT NOT NULL,
           capability_id        TEXT,
           lifecycle_status     TEXT NOT NULL
             CHECK (lifecycle_status IN ('running', 'success', 'failed', 'interrupted')),
           outcome              TEXT
             CHECK (outcome IS NULL OR outcome IN (
               'activated', 'no_change', 'stale', 'spec_generation_failed',
               'migration_failed', 'unit_generation_failed', 'gate_failed',
               'publication_failed', 'activation_failed', 'cancelled', 'interrupted'
             )),
           resolver_measurement TEXT CHECK (
             resolver_measurement IS NULL OR json_valid(resolver_measurement)
           ),
           build_measurement    TEXT CHECK (
             build_measurement IS NULL OR json_valid(build_measurement)
           ),
           stage_measurements   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(stage_measurements)),
           created_at           TEXT NOT NULL DEFAULT (datetime('now')),
           updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
           PRIMARY KEY (build_id, incarnation_id),
           CHECK (
             (lifecycle_status = 'running' AND outcome IS NULL) OR
             (lifecycle_status = 'success' AND outcome IN ('activated', 'no_change')) OR
             (lifecycle_status = 'failed' AND outcome IN (
               'stale', 'spec_generation_failed', 'migration_failed',
               'unit_generation_failed', 'gate_failed', 'publication_failed',
               'activation_failed', 'cancelled'
             )) OR
             (lifecycle_status = 'interrupted' AND outcome = 'interrupted')
           )
         ) STRICT;`,
      );
    },
  },
  // 0009 holds non-admitted resolution measurements. Rows are content-free and best-effort: the
  // prompt stream never waits for this table, and admitted builds embed the same one in 0008.
  {
    id: "0009_intent_resolution_metrics",
    up: (database) => {
      database.exec(
        `CREATE TABLE IF NOT EXISTS ${INTENT_RESOLUTION_METRICS_TABLE} (
           prompt_job_id       TEXT PRIMARY KEY,
           outcome             TEXT NOT NULL
             CHECK (outcome IN ('completed', 'cancelled', 'expired')),
           resolver_measurement TEXT NOT NULL CHECK (json_valid(resolver_measurement)),
           created_at          TEXT NOT NULL DEFAULT (datetime('now'))
         ) STRICT;`,
      );
    },
  },
  // One registry identity has exactly one lifecycle: active and routable, or a
  // non-routable deletion tombstone that durably owns its cleanup manifest.
  {
    id: "0010_capability_deletion_tombstones",
    up: (database) => {
      database.exec(
        `ALTER TABLE ${REGISTRY_TABLE}
         ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'active'
           CHECK (lifecycle_state IN ('active', 'deletion_tombstone'));`,
      );
      database.exec(
        `ALTER TABLE ${REGISTRY_TABLE}
         ADD COLUMN deletion_manifest TEXT CHECK (
           deletion_manifest IS NULL OR json_valid(deletion_manifest)
         );`,
      );
      database.exec(
        `ALTER TABLE ${REGISTRY_TABLE}
         ADD COLUMN deletion_created_at TEXT;`,
      );
    },
  },
  // Cleanup progress lives on the tombstone so a wedged deletion is visible to an
  // operator instead of being a console line in a process that has since restarted.
  {
    id: "0011_deletion_cleanup_progress",
    up: (database) => {
      database.exec(
        `ALTER TABLE ${REGISTRY_TABLE}
         ADD COLUMN deletion_cleanup_attempts INTEGER NOT NULL DEFAULT 0;`,
      );
      database.exec(
        `ALTER TABLE ${REGISTRY_TABLE}
         ADD COLUMN deletion_cleanup_error TEXT;`,
      );
    },
  },
  // The logo's inputs and its durable state (ADR-0007; PLAN decision 42). A row predating the
  // cut reads these back as NULL and fails the row schema loudly at the read site.
  {
    id: "0012_capability_logo_inputs",
    up: (database) => {
      // No default and nothing backfills them: a birth fact invented after birth would describe
      // artwork that does not exist, so `bun run reset` removes the pre-logo corpus instead.
      for (const column of ["subject", "ground", "noun"]) {
        database.exec(`ALTER TABLE ${REGISTRY_TABLE} ADD COLUMN ${column} TEXT;`);
      }
      database.exec(`ALTER TABLE ${REGISTRY_TABLE} ADD COLUMN seed INTEGER;`);
      // The lifecycle pair is the honest exception: `absent`/0 is what every capability is born
      // with, so both are NOT NULL and the claim can compare without a null case.
      database.exec(
        `ALTER TABLE ${REGISTRY_TABLE}
         ADD COLUMN logo_status TEXT NOT NULL DEFAULT '${LOGO_BIRTH_STATUS}'
           CHECK (logo_status IN (${LOGO_STATUSES.map((status) => `'${status}'`).join(", ")}));`,
      );
      database.exec(
        `ALTER TABLE ${REGISTRY_TABLE}
         ADD COLUMN logo_attempts INTEGER NOT NULL DEFAULT 0 CHECK (logo_attempts >= 0);`,
      );
    },
  },
  // The logo's second colour becomes a fourth authored key (ADR-0007, amended). Deriving it from
  // the ground by a closed four-pair lookup capped a desk at four colours. No default, as 0012.
  {
    id: "0013_capability_logo_companion",
    up: (database) => {
      database.exec(`ALTER TABLE ${REGISTRY_TABLE} ADD COLUMN companion TEXT;`);
    },
  },
  // 0014 is the one name the platform owns. NULL means "still called what it was authored as", so
  // a rename never touches `label` and `spec.json` stays truthful (`canonicalCapabilityLabel`).
  {
    id: "0014_capability_display_label_override",
    up: (database) => {
      database.exec(`ALTER TABLE ${REGISTRY_TABLE} ADD COLUMN display_label_override TEXT;`);
    },
  },
  // What one question cost the person who asked it (PLAN decision 33, ADR-0008). Columns rather
  // than two more keys in the measurement JSON: `INTEGER` on a `STRICT` table cannot hold a
  // sentence at all, so the row stays content-free by the database's own rule. NULL is a row no
  // loop ran for — a refusal spends no step, and counting it zero would read as a spent one.
  {
    id: "0015_intent_resolution_question_cost",
    up: (database) => {
      database.exec(
        `ALTER TABLE ${INTENT_RESOLUTION_METRICS_TABLE}
         ADD COLUMN steps_taken INTEGER CHECK (steps_taken IS NULL OR steps_taken >= 0);`,
      );
      database.exec(
        `ALTER TABLE ${INTENT_RESOLUTION_METRICS_TABLE}
         ADD COLUMN elapsed_ms INTEGER CHECK (elapsed_ms IS NULL OR elapsed_ms >= 0);`,
      );
    },
  },
];

// The set of migration ids already recorded in the ledger. Empty when the ledger table does not
// exist yet — a fresh db before 0001 has run is the bootstrap case, not an error.
function appliedMigrationIds(database: Database): Set<string> {
  const ledgerExists = database
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(MIGRATIONS_TABLE);
  if (!ledgerExists) return new Set<string>();

  const rows = database.query(`SELECT id FROM ${MIGRATIONS_TABLE}`).all() as { id: string }[];
  return new Set(rows.map((row) => row.id));
}

/**
 * Apply every not-yet-recorded migration in order, recording each in the ledger as it lands. A
 * migration's `up` and its ledger record commit together, so a crash mid-migration rolls back both.
 */
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

  // Every boot closes admitted work abandoned by the previous process. This is
  // idempotent and runs after schema setup on both fresh and existing databases.
  reconcileRunningGenerationLifecycles(database);

  return newlyApplied;
}
