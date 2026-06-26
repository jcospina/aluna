# Dual SQLite connections (read-write + read-only)

Status: ready-for-agent

## Epic

Module 1 — Platform Scaffold & Runtime Spine · Epic 1.4 — SQLite foundation
(`docs/modules.md` §1.4, ARCH §3, §4, §7)

## What to build

Open the platform's two `bun:sqlite` connections against the single database file:

- a **read-write** connection for the constrained write path, and
- a separate **read-only** connection opened with `SQLITE_OPEN_READONLY` for the free read path.

The read-only connection is the *deterministic* guarantee that a write is physically impossible on the read path regardless of what SQL is issued (ARCH §3, §7) — prove that here. Expose both connections as the platform's single db access points for later epics to reuse. **No domain tables yet.**

## Acceptance criteria

- [x] A read-write `bun:sqlite` connection opens against the documented db file location (from Epic 1.1)
- [x] A separate read-only connection opens with `SQLITE_OPEN_READONLY`
- [x] A test demonstrates that an attempted write on the read-only connection fails
- [x] A test demonstrates that a write on the read-write connection succeeds
- [x] Both connections are exposed as the single, shared platform db access points
- [x] The db file is created at the documented location if it does not exist

## Blocked by

- modules/01-platform-scaffold-runtime-spine/1.1-project-and-toolchain/issues/02-platform-directory-layout-and-gitignore.md

## Comments

**2026-06-09 — implemented.** Both connections live in [`src/db.ts`](../../../../src/db.ts),
opening against the Epic 1.1 convention `data/omni-crud.db`. No domain tables —
this only stands up the two access points the later epics reuse.

- **Read-write** (`db`): `new Database(path, { create: true, readwrite: true })`
  — `SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE`, so it creates the file (and its
  parent dir, via `mkdirSync`) on a fresh checkout. Opened **first** so the file
  exists before the read-only connection tries to attach.
- **Read-only** (`dbReadonly`): `new Database(path, { readonly: true })` —
  Bun's mapping for `SQLITE_OPEN_READONLY`. SQLite itself rejects any write here
  ("attempt to write a readonly database"), which is the *deterministic* boundary
  the read path (M5) relies on — safety doesn't depend on the model emitting only
  `SELECT`s (ARCH §3, §7).
- Exposed as the platform's single shared access points: module-level singletons
  `db` / `dbReadonly`, plus an `openDatabase(path)` factory the tests drive against
  throwaway files.

**WAL.** The read-write connection sets `journal_mode = WAL` so the read path stays
concurrent with the serialized write path (ARCH §3: *reads free + concurrent,
writes serialized*). One wrinkle: a read-only connection can't *create* the WAL's
`-shm` index, only attach to an existing one, so on a brand-new db that's had zero
writes the read-only open fails with "unable to open database file". A
`wal_checkpoint(TRUNCATE)` right after enabling WAL materializes the `-shm`
(touching no data, schema, or `user_version`) so the read path always attaches —
even before the first migration writes. `busy_timeout = 5000` on both absorbs
momentary checkpoint contention instead of surfacing a spurious `SQLITE_BUSY`.

**Tests** ([`src/db.test.ts`](../../../../src/db.test.ts), 5 cases, all green):
file is created if absent; a write on `db` succeeds; a write on `dbReadonly` fails
(asserted for both DML **and** DDL — the boundary holds regardless of the SQL);
the read-only connection still reads rows committed by the read-write one; and the
shared singletons are wired to `data/omni-crud.db`. `bun test`, `bun run typecheck`,
and `biome check` all pass; the db file + `-wal`/`-shm` sidecars stay gitignored
(`git status` clean).
