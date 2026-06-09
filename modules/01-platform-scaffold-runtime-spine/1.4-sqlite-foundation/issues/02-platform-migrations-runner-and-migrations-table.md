# Platform migrations runner & migrations table

Status: ready-for-agent

## Epic

Module 1 — Platform Scaffold & Runtime Spine · Epic 1.4 — SQLite foundation
(`docs/modules.md` §1.4, ARCH §3, §6.3, §7, §9.3)

## What to build

Add a migrations runner for **platform-owned** schema (ARCH §6.3, §7). It applies ordered migrations idempotently through the read-write connection, records applied migrations in a migrations tracking table, and runs on boot.

Module 1 ships **no domain tables** — those are created at runtime by the modules that need them — so this runner exists to own platform-level schema and to prove the mechanism. Migrations are additive-only in spirit: the platform never destroys structure (ARCH §3, §9.3).

## Acceptance criteria

- [x] A migrations runner applies ordered migrations through the read-write connection
- [x] Applied migrations are recorded in a migrations table; re-running is a no-op (idempotent)
- [x] The runner executes on app boot
- [x] After boot, the SQLite file exists and contains the migrations tracking table
- [x] No domain or capability tables are created (platform-owned schema only)

## Blocked by

- modules/01-platform-scaffold-runtime-spine/1.4-sqlite-foundation/issues/01-dual-sqlite-connections-rw-and-ro.md

## Comments

**2026-06-09 — implemented.** The runner lives in [`src/migrations.ts`](../../../../src/migrations.ts)
and runs on boot from [`src/index.ts`](../../../../src/index.ts), before `Bun.serve`,
through the read-write connection (`db`) from Epic 1.4.01.

- **Ordered migrations.** `MIGRATIONS` is an append-only array of `{ id, up }`;
  array order is apply order, and the ledger keys on `id`. `runMigrations(db)`
  reads the already-applied ids, then applies each missing migration **in its own
  transaction** — `up()` and the ledger `INSERT` commit together, so a crash
  mid-migration rolls back both and the next boot retries cleanly (ARCH §9.5).
- **The ledger is migration `0001`.** Module 1 ships no domain tables and the
  registry/event-log/metrics stores belong to later modules (ARCH §6.3; `docs/modules.md`
  §2.1, §2.7, §6.3), so the only platform schema today is the bookkeeping table
  itself. Making its creation the first ordered migration is the minimal honest way
  to prove the mechanism without inventing a table: `0001_platform_migrations_ledger`
  creates `schema_migrations` (`id` PK + `applied_at`) and records itself. The
  applied-set check tolerates the ledger not existing yet (the bootstrap case).
- **Idempotent on boot.** Clean-room verified: first boot logs `applied 1
  migration(s): 0001_platform_migrations_ledger`; a second boot logs nothing extra
  and leaves a single ledger row — a true no-op (ARCH §3 *mutation constrained and
  serialized*; §9.3 *structure never destroyed* — migrations are additive-only,
  documented as the invariant on the `Migration` type).
- **No domain/capability tables.** After boot, `data/omni-crud.db` contains exactly
  `schema_migrations` and nothing else.

**Tests** ([`src/migrations.test.ts`](../../../../src/migrations.test.ts), 5 cases,
all green): applies + records the ordered migrations through the rw connection;
re-running is a byte-identical no-op (no duplicate rows, no re-stamped `applied_at`);
only `schema_migrations` exists (no domain/capability tables); the row is durable
on the **read-only** connection (proving the write reached the shared file); and a
boot case that **spawns the real entrypoint** in a temp cwd (so its relative db
path is isolated) and asserts the db file is created with the ledger and baseline
row. `bun test` (12 pass), `bun run typecheck`, and `biome check` all pass; the db
file + `-wal`/`-shm` sidecars stay gitignored (`git status` clean).
