# Real provider implementation & structured round-trip test

Status: done

## Epic

Module 1 — Platform Scaffold & Runtime Spine · Epic 1.5 — Pluggable AI provider
(`docs/modules.md` §1.5, ARCH §4 "Model strategy")

## What to build

Implement the `generate(prompt, schema)` contract from issue 01 with one real provider behind it — a SOTA LLM with a fast mode (default: Claude Opus fast mode, per ARCH §4), streaming, returning a structured object that conforms to the requested schema.

Prove it with a test round-trip: a real invocation returns a validated structured response. This is the final wire of Module 1's runtime spine — after it, the shell renders, SSE streams, both DB connections are open, and the AI provider answers.

## Acceptance criteria

- [x] One real provider implements the issue-01 contract behind the pluggable interface
- [x] The call streams and returns a structured object that conforms to the requested schema
- [x] A test round-trip invokes the provider and asserts a valid structured object comes back
- [x] It uses the globally configured model and the BYO key from issue 01
- [x] Failure modes (missing key, malformed/non-conforming response) surface clearly rather than silently

## Blocked by

- modules/01-platform-scaffold-runtime-spine/1.5-pluggable-ai-provider/issues/01-provider-interface-and-byo-key-config.md

## Comments

**2026-06-09 — implemented.** The one real provider lives in
[`src/provider/spine.ts`](../../../../src/provider/spine.ts) — the thin AI SDK spine
ADR-0003 settled on. `createProvider(env)` resolves the config trio (key + model +
endpoint), picks the wire off the endpoint, and returns a `Provider` whose
`generate(prompt, schema)` is a direct map onto the SDK's `streamObject`:
`partialObjectStream → partialStream`, `object → object`. The SDK types are sealed
inside this one file; nothing upstream sees past the contract.

- **Default = `gpt-5` in fast mode**, not Claude Opus. We're on the OpenAI platform
  for now (the account with credits + key on hand). This is squarely inside
  ADR-0003's "which model is the configured default … is deliberately open" — a
  one-env swap (`OMNI_MODEL` + `OMNI_BASE_URL` + `OMNI_API_KEY`) moves it back to
  any `claude-*` / other model. "Fast mode" is the call-site knob the config comment
  always deferred to here: the spine sets `reasoningEffort: 'minimal'` for the
  OpenAI wire, keeping gpt-5 on its low-latency path.
- **Registry keyed by `baseURL`** (ADR-0003): `selectWire(baseURL)` routes Anthropic
  Messages hosts to `@ai-sdk/anthropic`'s `createAnthropic`, OpenAI's *own* host to
  the first-party `@ai-sdk/openai` (`createOpenAI` — Responses API, native structured
  outputs, the `reasoningEffort` fast-mode knob), and **every other OpenAI-compatible
  endpoint to `@ai-sdk/openai-compatible`'s `createOpenAICompatible` (Chat
  Completions) — the path the open Chinese coding models take** (Qwen, GLM, Kimi,
  MiniMax, DeepSeek), first-class per ADR-0003. Adding a provider is adding an
  endpoint, not code. (The three-wire shape — and the correction from an earlier
  OpenAI-only cut that would have excluded the Chinese models — is recorded in
  ADR-0003's implementation note.)
- **Failure modes surface, never silent.** Missing key throws at *construction*
  via `requireApiKey`, naming the var and the BYO-key contract — never a confusing
  mid-stream error. Non-conforming output rejects on `.object`: that's the SDK
  validating against the schema, mapped straight onto the contract's existing
  guarantee (proved in [`contract.test.ts`](../../../../src/provider/contract.test.ts)).

**Tests** ([`src/provider/spine.test.ts`](../../../../src/provider/spine.test.ts)):
deterministic, no-network cases pin the wire routing (`selectWire`) and the loud
missing-key throw. There is **no test that calls a real provider** — see the
2026-06-09 (rework) note below for why and what proves the round-trip instead.

**2026-06-09 (rework) — round-trip moved out of the test suite and into the shell.**
Two course corrections after review:

- **No unit test bills the BYO key.** The earlier key-gated live round-trip in
  `spine.test.ts` was deleted: because the real key sits in `.env` (bun auto-loads
  it), that test fired a paid call on *every* `bun test`. `spine.test.ts` is now
  network-free.
- **The round-trip is proven where Module 1 actually finalizes — the running shell,
  not a test.** The throwaway `/demo/stream` (fixed strings) is replaced by
  [`/stream`](../../../../src/app.ts), which asks the **real provider** for a short,
  product-voice greeting and streams it into the content area: `greeting` narrated
  as it builds (the contract's `partialStream`), then `invitation` from the
  *validated* object (the contract's `object`) as an escaped HTML `fragment`, then
  `done`. The shell's `Meet Aluna` trigger drives it; it is **user-initiated**, so
  the provider is never called on page load. Zero domain logic — nothing is built,
  persisted, or routed (the prompt-bar → capability build is Module 2).
- **The route is tested without spend** via dependency injection:
  `createApp({ getProvider })` takes a `Provider`, so
  [`app.test.ts`](../../../../src/app.test.ts) drives the stream through a **fake**
  provider (the same fakeability `contract.test.ts` was built for) — asserting the
  narration reassembles to the greeting, the invitation fragment is escaped, the
  stream closes, and a thrown-from-`getProvider` (missing key) surfaces a
  product-voice apology rather than a crash or an internals leak.

**Verified by running it** (`bun src/index.ts`, one call): `GET /` serves the shell
with the `intro` trigger; `GET /stream` streamed a live `gpt-5` greeting — *"Hi, I'm
Aluna. I'm glad you're here—let's see what wants to take shape together."* — word by
word as `narration`, then the invitation fragment *"What would you like to keep track
of?"*, then `done: ok`. Product voice intact, no internals leaked. `bun test`
(35 pass, network-free), `bun run typecheck`, and `biome check` all green.

This is the final wire of Module 1's runtime spine: the shell renders, SSE streams,
both DB connections are open, and the AI provider now answers — *in the shell*.
