# Biome lint & format

Status: done

## Epic

Module 1 — Platform Scaffold & Runtime Spine · Epic 1.1 — Project & toolchain
(`docs/modules.md` §1.1, ARCH §4)

## What to build

Wire up Biome as the single tool for both linting and formatting, with committed configuration and `lint` / `format` scripts. Pick defaults aligned with the codebase (TypeScript, Bun) and ensure the current tree is clean under both. This becomes the quality gate every later issue runs against, so it should be cheap to run and unambiguous about what "clean" means.

Biome is preferred over a separate ESLint + Prettier pair to keep the minimal-overhead toolchain the architecture calls for (ARCH §4).

## Acceptance criteria

- [x] Biome added as a dev dependency with a committed config (`biome.json`)
- [x] `bun run lint` checks the project and passes on the current tree
- [x] `bun run format` formats the project, and running it a second time is a no-op (idempotent)
- [x] Config covers `src/` and excludes the runtime-generated artifact directories (`capabilities/`, `storage/`, db files)
- [x] Lint is runnable non-interactively (CI-friendly exit codes)

## Blocked by

- modules/01-platform-scaffold-runtime-spine/1.1-project-and-toolchain/issues/01-bun-typescript-project-scaffold.md

## Comments

**2026-05-29 — Implemented (agent).**

- Added `@biomejs/biome@2.4.16` as a dev dependency.
- Committed `biome.json` as the single config for both lint and format:
  - **Scope** (`files.includes`): whole repo via `**`, with the runtime-generated /
    build / vendor / tool dirs negated — `node_modules`, `dist`, `artifacts`,
    `capabilities`, `storage`, `data`, `.claude`, `.agents` — plus `*.db` /
    `*.sqlite[3]` and the `bun.lock` / `skills-lock.json` lockfiles. `vcs.useIgnoreFile`
    is on so `.gitignore` is honoured as a second layer. `src/` is the authored surface.
  - **Formatter**: `indentStyle: space`, `indentWidth: 2`, `lineWidth: 100` — matches the
    existing `package.json` / `tsconfig.json` (Biome's default is tabs, which would have
    churned the tree). JS: double quotes, always-semicolons. Import organising is on via
    the assist actions.
  - **Linter**: `recommended` rules.
- Scripts: `bun run lint` → `biome check .` (lint + format-check + import-organise check,
  read-only — the single quality gate, non-zero exit on any issue), `bun run format` →
  `biome format --write .`.
- Verified: `bun run lint` passes on the current tree (exit 0); `bun run format` reports
  "No fixes applied" and a second run is a no-op (idempotent); a probe `.ts` under `src/`
  is linted+formatted and yields exit 1, while a probe under `capabilities/` is correctly
  ignored.

Note: changes live in the working tree (`biome.json` new; `package.json` + `bun.lock`
modified) and are ready to commit — left uncommitted pending the usual go-ahead.

**2026-05-29 — Strict complexity gate added (agent).**

- Enabled `complexity/noExcessiveCognitiveComplexity` at `level: error` with
  `maxAllowedComplexity: 10` (opt-in rule; not in Biome's `recommended` set).
- Biome measures **cognitive** complexity (SonarSource's metric), not McCabe cyclomatic.
  It's the closest available metric and arguably better here: it ignores `switch`
  fan-out but penalizes nesting/tangled control flow, so legitimate dispatch tables and
  parsers aren't punished — only genuinely hard-to-follow functions are.
- `10` mirrors the classic McCabe/NIST cyclomatic limit; stricter than Biome's default
  (15) to curb the sprawling, deeply-nested functions AI tends to emit, while staying
  realistic for complex software.
- Verified: current tree passes; a probe function scoring 29 fails the `lint` gate (exit 1).

**2026-06-01 — Enforcement layer: Claude Code hooks + git pre-commit (agent).**

Beyond the manual `lint`/`format` scripts, the Biome gate is now enforced automatically at
two levels so violations can't silently land.

_Claude Code hooks_ (`.claude/hooks/`, wired in `.claude/settings.json`) — based on the
`katapultlabs/agentic-harness-template` hooks, trimmed to the three we want plus
`block-no-verify` from the `momo` repo:

- `biome-format.sh` (PostToolUse · Write|Edit) — auto-formats each edited file. Formatter
  **only** (`biome format --write`), not the template's `biome check --write`.
- `biome-lint.sh` (PostToolUse · Write|Edit) — lints each edited file and **blocks** Claude
  (asking it to fix) on `error`-severity violations. Warnings pass, matching `bun run lint`.
- `enforce-package-manager.sh` (PreToolUse · Bash) — denies `npm`/`npx`/`yarn`/`pnpm` and
  tells Claude the `bun`/`bunx` replacement.
- `block-no-verify.sh` (PreToolUse · Bash) — denies `git … --no-verify` / `--no-gpg-sign` /
  `-c commit.gpgsign=false`, so the pre-commit gate below can't be skipped.
- `hooks.config.json` — trimmed to just the `biomeLint` + `enforcePackageManager` sections
  the kept scripts read.
- Skipped the template's other hooks (`dangerous-commands`, `sensitive-files`,
  `conventional-commits`, `branch-naming`, `pr-test-gate`).
- Adaptation: the Biome hooks call `bunx biome` (with `~/.bun/bin` on PATH) so they pin to
  the project's Biome 2.4.16 rather than any globally-installed version (machine had a
  Homebrew Biome 2.4.11 — version drift would enforce different rules than `bun run lint`).

_Git pre-commit_ (Husky + lint-staged):

- Added `husky@9` + `lint-staged` dev deps and a `prepare: husky` script (so `bun install`
  wires `core.hooksPath` automatically — verified reproducible).
- `.husky/pre-commit` → `bunx lint-staged`. `.husky/_/` is git-ignored (regenerated on
  install).
- `lint-staged` runs `bunx biome check --write --no-errors-on-unmatched` on staged
  `*.{js,jsx,ts,tsx,mjs,cjs,mts,cts,json,jsonc,css}` — auto-fixes + organises imports, and
  **aborts the commit** on anything unfixable (e.g. complexity > 10).
- Added `!**/.husky` to `biome.json`'s ignore list (alongside `.claude` / `.agents`).

Guardrail chain: edit → format + lint-block → can't `--no-verify` → commit runs
`biome check --write` and aborts on unfixable errors. Verified end-to-end (npm→bun denial,
lint block on a complexity probe, formatter rewrite, `--no-verify` block incl. compound
commands and false-positive cases, lint-staged auto-fix exit 0 vs complexity-error exit 1).

Notes: Claude Code loads hook changes at session start and will ask to approve them — they
don't run in the session that created them. `bunx lint-staged` needs `bun` on PATH at commit
time (fine from a terminal; for GUI clients add `~/.bun/bin` via `~/.config/husky/init.sh`).
All changes uncommitted, pending go-ahead.
