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

- [x] `capabilities/`, `storage/`, and the db-location directory exist with tracked placeholders (`.gitkeep` or a short README per directory explaining its purpose)
- [x] The database file location is a single, documented convention (one path, written down)
- [x] `.gitignore` excludes runtime-generated files: the SQLite db file(s), `storage/` blobs, and generated capability artifacts under `capabilities/<id>/v<n>/`
- [x] The tracked placeholders are *not* ignored (structure stays in git; contents do not)
- [x] A fresh `git status` after running the app shows no generated artifacts as untracked or modified

## Blocked by

- modules/01-platform-scaffold-runtime-spine/1.1-project-and-toolchain/issues/01-bun-typescript-project-scaffold.md

## Comments

**2026-05-29 — implemented.** Fixed the on-disk skeleton + runtime-artifact ignore
rules. Pure conventions — no code reads or writes these dirs yet (that lands in
later epics: data tool, object store, SQLite foundation 1.4).

Directories + tracked placeholders (a purpose-explaining README per dir doubles as
the placeholder, so no separate `.gitkeep`):
- `capabilities/README.md` — version-namespaced generated artifacts, written at
  runtime as `capabilities/<id>/v<n>/` (handler `.ts` + compiled `.html`). ARCH §5, §6.3.
- `storage/README.md` — S3-shaped object store, blobs addressed by opaque key at
  `storage/<key>`. ARCH §6.3, §7.
- `data/README.md` — documents the **single db-file convention**.

DB location convention (one path, written down): **`data/omni-crud.db`**. Both the
RW and RO connections (Epic 1.4) open against this same file; SQLite `-wal`/`-shm`/
`-journal` sidecars live alongside it. All four platform stores (registry, event
log, data tables, metrics) live in this one file.

`.gitignore` — added a "Runtime-generated artifacts" block using the keep-dir /
ignore-contents idiom so structure stays in git but generated contents never do:
```
capabilities/*
!capabilities/README.md
storage/*
!storage/README.md
data/*
!data/README.md
```
The `data/*` rule covers the `.db` file and all its sidecars.

Verification:
- `git check-ignore` confirms `capabilities/notes/v3/{create.ts,list.html}`,
  `storage/<key>`, `data/omni-crud.db`, `-wal`, `-shm` are all ignored.
- The three READMEs are *not* ignored (`git check-ignore` returns nothing for them).
- After seeding dummy artifacts in every dir, `git status --untracked-files=all`
  showed only the 3 READMEs + `.gitignore` — zero generated artifacts.
- `bun run typecheck` clean; `bun src/index.ts` boots (`omni-crud runtime spine
  ready — Bun 1.3.12`) with no resulting untracked/modified files.
