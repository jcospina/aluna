# Provider interface & BYO-key config (single global model)

Status: ready-for-agent

## Epic

Module 1 — Platform Scaffold & Runtime Spine · Epic 1.5 — Pluggable AI provider
(`docs/modules.md` §1.5, ARCH §4 "Model strategy")

## What to build

Define the thin, pluggable AI provi1der contract the orchestrator depends on: a streaming `generate(prompt, schema)` interface that returns a structured object matching the schema (ARCH §4 "Model strategy"). The orchestrator depends on this contract, **not** on any specific SDK.

Add the configuration layer alongside it: a **BYO-key** setup (API key from the environment) and a **single, globally configured model** — no per-task routing. Comparing models means running the demo twice, not mixing them in one session.

This issue defines the contract + config only; the concrete provider call lands in issue 02 and must be swappable behind this interface.

## Acceptance criteria

- [ ] A `generate(prompt, schema)` streaming contract is defined, provider-agnostic (no SDK types leak through it)
- [ ] The contract's return is a structured object validated against the provided schema
- [ ] BYO-key config reads the API key from the environment, with a clear error when it is missing
- [ ] A single global model is configured in exactly one place (no per-call model selection)
- [ ] The interface is demonstrably implementable by more than one provider (verified with a fake/stub in a test)

## Blocked by

- modules/01-platform-scaffold-runtime-spine/1.1-project-and-toolchain/issues/01-bun-typescript-project-scaffold.md
