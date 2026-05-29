# Platform migrations runner & migrations table

Status: ready-for-agent

## Epic

Module 1 — Platform Scaffold & Runtime Spine · Epic 1.4 — SQLite foundation
(`docs/modules.md` §1.4, ARCH §3, §6.3, §7, §9.3)

## What to build

Add a migrations runner for **platform-owned** schema (ARCH §6.3, §7). It applies ordered migrations idempotently through the read-write connection, records applied migrations in a migrations tracking table, and runs on boot.

Module 1 ships **no domain tables** — those are created at runtime by the modules that need them — so this runner exists to own platform-level schema and to prove the mechanism. Migrations are additive-only in spirit: the platform never destroys structure (ARCH §3, §9.3).

## Acceptance criteria

- [ ] A migrations runner applies ordered migrations through the read-write connection
- [ ] Applied migrations are recorded in a migrations table; re-running is a no-op (idempotent)
- [ ] The runner executes on app boot
- [ ] After boot, the SQLite file exists and contains the migrations tracking table
- [ ] No domain or capability tables are created (platform-owned schema only)

## Blocked by

- modules/01-platform-scaffold-runtime-spine/1.4-sqlite-foundation/issues/01-dual-sqlite-connections-rw-and-ro.md
