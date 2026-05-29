# Bun + TypeScript project scaffold

Status: ready-for-agent

## Epic

Module 1 — Platform Scaffold & Runtime Spine · Epic 1.1 — Project & toolchain
(`docs/modules.md` §1.1, ARCH §4)

## What to build

Stand up the Bun project that the entire platform runs on. Initialize `package.json`, a strict TypeScript configuration, and a minimal entrypoint, plus the run scripts the team uses day to day. At the end, `bun run dev` boots the entrypoint with hot reload and stays up, and a typecheck passes clean.

This is pure toolchain — **no server, shell, SSE, database, or AI yet**. Those arrive in later epics and build on this. The deliverable is a runnable, type-checked Bun project a teammate can clone and start with two commands (`bun install`, `bun run dev`).

Bun is chosen (ARCH §4) for fastest cold start, native TypeScript, built-in SQLite, and the ability to import generated `.ts` directly — so do not add a separate bundler/transpiler unless something genuinely requires it.

## Acceptance criteria

- [x] `package.json` exists with project metadata, declaring Bun as the runtime
- [x] Strict `tsconfig.json` (TypeScript `strict: true`) targeting ESNext, configured for Bun
- [x] A minimal entrypoint (e.g. `src/index.ts`) that runs cleanly and exits/stays up without error
- [x] `bun run dev` runs the entrypoint with watch / hot reload (`bun --watch`) and stays up
- [x] `bun run build` produces a runnable artifact and `bun run start` runs it
- [x] `bun run typecheck` passes with zero errors
- [x] `bun install` completes from a clean checkout with no errors

## Blocked by

None - can start immediately

## Comments

**2026-05-29 — implemented.** Stood up the pure-toolchain scaffold (no server/shell/SSE/db/AI, per scope).

Files added:
- `package.json` — Bun runtime declared via `engines.bun >=1.3.0`, `"type": "module"`, `"module": "src/index.ts"`; scripts `dev` / `build` / `start` / `typecheck`. `@types/bun` + `typescript` as dev deps.
- `tsconfig.json` — `strict: true`, `target`/`module`/`lib` = ESNext, `moduleResolution: bundler`, `allowImportingTsExtensions`, `noEmit`, plus extra strict flags (`noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`, etc.). Scoped to `src/`.
- `src/index.ts` — minimal entrypoint that logs a boot line using `Bun.version` (also exercises the Bun global types).
- `.gitignore` — minimal, just `node_modules/` and `dist/` (the byproducts of `bun install` / `bun build`). Runtime-artifact ignores + directory layout are left to issue 02; Biome to issue 03.

Verification:
- `bun install` → clean; `bun install --frozen-lockfile` → no changes (reproducible from `bun.lock`).
- `bun run typecheck` → zero errors.
- `bun run build` → bundles to `dist/index.js`; `bun run start` → prints `omni-crud runtime spine ready — Bun 1.3.12`.
- `bun run dev` (`bun --watch`) → boots and stays up (verified process alive after start, stops cleanly on signal).
- `git status` confirms `node_modules/` and `dist/` are not tracked.
