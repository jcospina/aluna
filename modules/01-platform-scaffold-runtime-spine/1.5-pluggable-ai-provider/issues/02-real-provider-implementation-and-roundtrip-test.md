# Real provider implementation & structured round-trip test

Status: ready-for-agent

## Epic

Module 1 — Platform Scaffold & Runtime Spine · Epic 1.5 — Pluggable AI provider
(`docs/modules.md` §1.5, ARCH §4 "Model strategy")

## What to build

Implement the `generate(prompt, schema)` contract from issue 01 with one real provider behind it — a SOTA LLM with a fast mode (default: Claude Opus fast mode, per ARCH §4), streaming, returning a structured object that conforms to the requested schema.

Prove it with a test round-trip: a real invocation returns a validated structured response. This is the final wire of Module 1's runtime spine — after it, the shell renders, SSE streams, both DB connections are open, and the AI provider answers.

## Acceptance criteria

- [ ] One real provider implements the issue-01 contract behind the pluggable interface
- [ ] The call streams and returns a structured object that conforms to the requested schema
- [ ] A test round-trip invokes the provider and asserts a valid structured object comes back
- [ ] It uses the globally configured model and the BYO key from issue 01
- [ ] Failure modes (missing key, malformed/non-conforming response) surface clearly rather than silently

## Blocked by

- modules/01-platform-scaffold-runtime-spine/1.5-pluggable-ai-provider/issues/01-provider-interface-and-byo-key-config.md
