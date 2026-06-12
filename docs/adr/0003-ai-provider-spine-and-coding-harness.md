# 0003 — AI provider spine & the code-writing harness (seeds epic 1.5)

Status: accepted

## Decision

The AI provider contract (ARCH §4 "Model strategy", modules.md epic 1.5) is built
on the **Vercel AI SDK** as a **thin, in-process provider spine** — not a
hand-rolled streaming client, and not an autonomous coding-agent harness. The
SDK supplies the three primitives the `generate(prompt, schema)` contract needs:
**structured generation** (`generateObject`/`streamObject` with Zod, type-validated),
**streamed text** (`streamText` → Hono SSE, for build narration), and a
**bounded tool-loop** (`ToolLoopAgent` + `stopWhen`) for the code-writing step.
We do **not** build our own streaming SDK, retry/routing, structured-output
validation, or multi-provider abstraction — those are solved problems the SDK
owns. We **do** keep building the harness *discipline* — the pipeline, Diff
Engine, layered gate, migration runner — because that discipline *is* the thesis,
and no SDK ships it.

**Settled now:**

- **The spine is the AI SDK, used in-process** (fetch-based, runs on Bun, MIT,
  BYO-key). It sits behind the `generate(prompt, schema)` contract — the
  orchestrator depends on the contract, never on the SDK directly, so the spine
  stays swappable (ARCH §4).
- **Provider-agnosticism via wire shape, not an adapter layer we write.** A
  provider registry keyed by `baseURL` (`createAnthropic`/`createOpenAICompatible`)
  targets the **Anthropic Messages** and **OpenAI-compatible** endpoints that have
  become the de-facto standard. One config change swaps the single global model
  (ARCH §4 "Model strategy") across **Claude, GPT, Gemini, and the open Chinese
  coding models** — Qwen3-Coder, GLM (Zhipu/Z.ai), Kimi (Moonshot), MiniMax,
  DeepSeek — all of which expose an Anthropic-compatible endpoint. "Compare models
  = run the demo twice" stays a one-line swap.
- **The harness is agentic *within a unit*, deterministic *across units*.** The
  code-writing muscle is a **bounded** loop scoped to a single build unit (write
  `create.ts` → type-check → feed the error back → fix → stop on gate-pass or a
  step cap). It never roams the filesystem or decides its own scope. This is the
  "coding-run-fix loop" the models are trained for, dropped *inside* a Capability
  Builder step (ARCH §6.2) without surrendering the cross-unit guarantees:
  spec → derived caches, regenerate only affected units, fail-closed gate, atomic
  pointer flip (ARCH §9.1, §9.5).

**Rejected, with reasons (kept so the road not taken stays legible):**

- **A fully autonomous coding agent** (Claude Code / Codex / opencode as the
  builder). Most "out of the box," but it owns the loop and the filesystem, is
  nondeterministic about *which* files it touches, and runs as a heavyweight
  separate process with its own context/session. That fights the Diff Engine's
  "regenerate only affected units" (ARCH §6.2) and the version-keyed-cache
  discipline (ARCH §9.1) head-on. `opencode` (provider-agnostic, MIT, drivable
  over an HTTP server) is the one kept **in the back pocket** *if* the project
  ever pivots to the autonomous shape — not adopted now.
- **A hosted agent API** (provider runs the loop server-side). Data leaves the
  box — fights BYO-key, local-first, and the open-sourced free demo (ARCH §4) —
  and forfeits control of the very latency the PoC exists to measure (ARCH §6.3,
  §9.6).
- **An execution sandbox** (E2B / Daytona) for the gate. Deferred, not adopted. A
  single-user, local, BYO-key PoC has no multi-tenant threat model, and the real
  write-danger surface is already closed *deterministically* by the read-only
  SQLite connection + additive-only DDL + constrained data tool (ARCH §3, §7) —
  stronger than process isolation. Revisit only if the harness is later allowed
  to execute arbitrary untrusted code during its fix-loop.

**Deliberately open — owned by the module that first needs it, not locked here:**

- **Which model is the configured default.** The spine makes any of them a
  one-line swap; *which* one ships as the global default is an empirical call for
  the experiment (ARCH §6.3), not an architecture decision. Vendor head-to-head
  quality claims are unverified marketing until measured on Aluna's own task.
- **The bounded-loop's exact shape** — step cap, which tools the loop gets
  (filesystem write + type-check at minimum), retry budget on a failing
  behavioral assertion — is **Capability Builder** work (modules.md §2.5, §3.5),
  not 1.5. Epic 1.5 only stands up the provider contract + streamed structured
  round-trip; the loop arrives with the first real build.
- **Whether to layer Mastra** (deterministic Workflows + Agents, *built on the AI
  SDK*) over the raw spine for orchestration ergonomics. Its Workflow/Agent split
  maps cleanly onto "deterministic pipeline, bounded agent inside each step," but
  it adds surface area a speed-first PoC may not want. Deferred to whichever
  module finds the raw SDK orchestration too thin.

## Context / why

- Epic 1.5's job (modules.md §1) is a **thin** provider contract with **zero
  domain logic** — a streamed, structured round-trip, BYO-key, one global model.
  The owner's constraint going in: *be provider-agnostic, but do not hand-build a
  streaming SDK for a solved problem.* This ADR records the research that settled
  how to honor both at once.
- **The reframe that drove the decision.** Aluna's pipeline is deliberately
  *constrained* (ARCH §6.2, §9.1): the spec is the source of truth; handlers,
  HTML, and tests are version-keyed derived caches; only affected units
  regenerate; a fail-closed gate precedes an atomic pointer flip. A roaming
  autonomous agent is in direct tension with every one of those. So "a coding
  agent that writes files" is the right *capability* but the wrong *shape* if
  unbounded — the fit is a loop bounded to one unit, which preserves the
  determinism while still buying the self-correcting code muscle.
- **Provider-agnosticism turned out to be nearly free.** The Anthropic Messages
  API is now the common wire format for coding models; the major open Chinese
  models all ship an Anthropic-compatible endpoint alongside an OpenAI-compatible
  one. Targeting the wire shape (via the SDK's `baseURL` providers) gets
  agnosticism without an abstraction layer we maintain — which is exactly the
  "thin, pluggable provider interface" ARCH §4 already asked for, made concrete.
- **What the SDK removes from our plate:** the streaming client, retries and
  provider routing, structured-output validation (`generateObject` + Zod is
  type-validated), and the multi-provider switch. **What it pointedly does not
  give us — and what stays our job:** the orchestrator pipeline, the Diff Engine,
  the layered behavioral gate, and the migration runner. No turnkey
  "self-building-CRUD harness" exists; that absence is the project's contribution,
  not a missing dependency.
- **Bun + Hono + AI SDK is a documented, common combination.** The spine is
  fetch-based and streams cleanly through Hono SSE — consistent with the locked
  stack (ARCH §4) and the SSE conventions in [ADR-0002](0002-sse-transport-conventions.md).

## Consequences

- **ARCH §4** ("AI" stack row + "Model strategy") and **modules.md epic 1.5** are
  updated to name the spine and the provider-registry mechanism, and to point at
  this ADR. The abstract "`generate(prompt, schema)` contract, not a specific
  SDK" line now has a concrete, swappable implementation behind it.
- **The bounded per-unit loop is a Capability Builder concern (M2–M3), not M1.**
  Epic 1.5 proves the streamed structured round-trip and the one-line provider
  swap; the write→type-check→fix loop lands with epic 2.5 and tightens (behavioral
  retries) in epic 3.5. A forward-pointer note is added to 1.5, in the style of
  the 2.6 note.
- **The Chinese coding models are first-class provider options, not an
  afterthought** — the registry treats them identically to Claude/GPT/Gemini.
  Selecting the global default is an experiment output (M7), recorded in metrics.
- **No sandbox dependency is taken on now.** If a future module hands the loop
  arbitrary-code execution with isolation needs, E2B (Firecracker, TS SDK) or
  Daytona (fast cold start) are the pre-vetted options to reopen this with.
- **If orchestration ergonomics strain the raw SDK,** Mastra is the pre-vetted
  layer to reconsider — superseding or amending this ADR rather than bolting on
  silently.

## Implementation note (epic 1.5, issue 02)

The spine landed in `src/provider/spine.ts` as a **three-wire** registry, `selectWire`
keying off the endpoint host:

- **`openai`** — the first-party `@ai-sdk/openai` (`createOpenAI`) for OpenAI's *own*
  host (`api.openai.com`). It gives native structured-output validation and the
  reasoning-effort knob that makes "fast mode" a real call-site setting
  (`reasoningEffort: 'minimal'`). This wire is OpenAI-specific by design: the
  first-party provider defaults to OpenAI's proprietary **Responses API**, which
  third-party "compatible" endpoints do not implement.
- **`openai-compatible`** — `@ai-sdk/openai-compatible` (`createOpenAICompatible`,
  Chat Completions) for *every other* OpenAI-compatible endpoint. **This is the path
  the open Chinese coding models take** (Qwen, GLM/Zhipu, Kimi/Moonshot, MiniMax,
  DeepSeek) — first-class targets, exactly as this ADR requires. Reached by
  `OMNI_BASE_URL` alone; no per-model code.
- **`anthropic`** — `@ai-sdk/anthropic` (`createAnthropic`) for the Anthropic Messages
  endpoint.

> **Correction (supersedes the original first draft of this note).** The first cut
> used `createOpenAI` for *all* non-Anthropic endpoints and claimed "the open Chinese
> models reach the first-party provider by `baseURL` alone." That was **wrong**: the
> first-party provider's Responses-API default (plus the OpenAI-only `reasoningEffort`
> option and strict `json_schema` outputs) would have failed against those Chat-
> Completions endpoints. Keeping the Chinese models first-class is why this ADR named
> `createOpenAICompatible` in the first place; the dedicated `openai-compatible` wire
> restores that. (The compatible wire is wired but not yet verified against a live
> third-party endpoint — no such key on hand.)

- **The shipped default is `gpt-5` in fast mode, not Claude Opus** — the platform
  with credits/key on hand. This exercises (not contradicts) the "which model is the
  configured default … is deliberately open" clause above: a one-env swap of the
  trio (`OMNI_MODEL` + `OMNI_BASE_URL` + `OMNI_API_KEY`) moves it to any `claude-*`
  or other model. Selecting the *empirical* default remains M7 experiment work.
