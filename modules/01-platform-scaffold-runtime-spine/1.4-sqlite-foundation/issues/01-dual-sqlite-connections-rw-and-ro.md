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

- [ ] A read-write `bun:sqlite` connection opens against the documented db file location (from Epic 1.1)
- [ ] A separate read-only connection opens with `SQLITE_OPEN_READONLY`
- [ ] A test demonstrates that an attempted write on the read-only connection fails
- [ ] A test demonstrates that a write on the read-write connection succeeds
- [ ] Both connections are exposed as the single, shared platform db access points
- [ ] The db file is created at the documented location if it does not exist

## Blocked by

- modules/01-platform-scaffold-runtime-spine/1.1-project-and-toolchain/issues/02-platform-directory-layout-and-gitignore.md
