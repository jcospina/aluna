# Biome lint & format

Status: ready-for-agent

## Epic

Module 1 — Platform Scaffold & Runtime Spine · Epic 1.1 — Project & toolchain
(`docs/modules.md` §1.1, ARCH §4)

## What to build

Wire up Biome as the single tool for both linting and formatting, with committed configuration and `lint` / `format` scripts. Pick defaults aligned with the codebase (TypeScript, Bun) and ensure the current tree is clean under both. This becomes the quality gate every later issue runs against, so it should be cheap to run and unambiguous about what "clean" means.

Biome is preferred over a separate ESLint + Prettier pair to keep the minimal-overhead toolchain the architecture calls for (ARCH §4).

## Acceptance criteria

- [ ] Biome added as a dev dependency with a committed config (`biome.json`)
- [ ] `bun run lint` checks the project and passes on the current tree
- [ ] `bun run format` formats the project, and running it a second time is a no-op (idempotent)
- [ ] Config covers `src/` and excludes the runtime-generated artifact directories (`capabilities/`, `storage/`, db files)
- [ ] Lint is runnable non-interactively (CI-friendly exit codes)

## Blocked by

- modules/01-platform-scaffold-runtime-spine/1.1-project-and-toolchain/issues/01-bun-typescript-project-scaffold.md
