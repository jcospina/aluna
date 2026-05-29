# Platform directory layout & gitignore

Status: ready-for-agent

## Epic

Module 1 — Platform Scaffold & Runtime Spine · Epic 1.1 — Project & toolchain
(`docs/modules.md` §1.1, ARCH §4, §5, §6.3)

## What to build

Establish the platform's on-disk skeleton and keep runtime-generated artifacts out of version control. Create the conventional directories the architecture references so they exist in a fresh checkout, and add a `.gitignore` that excludes everything generated at runtime while keeping the directory structure itself tracked.

The directories (ARCH §5, §6.3):

- `capabilities/` — version-namespaced generated handler `.ts` + compiled HTML, written at runtime as `capabilities/<id>/v<n>/`.
- `storage/` — object-store blobs addressed by opaque key (`storage/<key>`).
- The **database file location** — a single documented convention for where the `bun:sqlite` file lives.

No code reads or writes these yet — this issue only fixes the conventions and the ignore rules so later epics (data tool, object store, SQLite foundation) drop into known places and the repo never accidentally commits a generated `.ts`, an uploaded blob, or a `.db` file.

## Acceptance criteria

- [ ] `capabilities/`, `storage/`, and the db-location directory exist with tracked placeholders (`.gitkeep` or a short README per directory explaining its purpose)
- [ ] The database file location is a single, documented convention (one path, written down)
- [ ] `.gitignore` excludes runtime-generated files: the SQLite db file(s), `storage/` blobs, and generated capability artifacts under `capabilities/<id>/v<n>/`
- [ ] The tracked placeholders are *not* ignored (structure stays in git; contents do not)
- [ ] A fresh `git status` after running the app shows no generated artifacts as untracked or modified

## Blocked by

- modules/01-platform-scaffold-runtime-spine/1.1-project-and-toolchain/issues/01-bun-typescript-project-scaffold.md
