# 0003 — AI provider spine and the code-writing harness

Status: Accepted

## Context

Every language-model call Aluna makes, from resolving a sentence to writing a Handler,
asks for the same thing: a structured object, streamed while the model writes it and
validated against a schema at the end. The person brings their own API key and may
choose any model, whether Claude, GPT, Gemini or one of the open Chinese coding models
such as Qwen, GLM, Kimi, MiniMax or DeepSeek. A streaming client, retries,
structured-output validation and a switch between providers are solved problems, and the
Vercel AI SDK solves them.

The step that writes code adds a constraint of its own. The Core Builder fixes
everything around the model's output: the spec is the source of truth and every unit
derives from it, an evolution regenerates only the units the Diff Engine selects
(ADR-0006), the Gate fails closed, and a version goes live when the registry's pointer
moves to it. An autonomous coding agent decides for itself which files to touch, so it
would choose the scope the Diff Engine exists to fix. Writing code is the right job for
a model only inside a loop bounded to one unit. No SDK ships the Core Builder, the Diff
Engine or the Gate, so those stay Aluna's own code.

## Decision

### One contract, with the AI SDK behind it

Every language-model call goes through one contract, `generate(prompt, schema)`, in
`src/platform/provider/contract.ts`. It returns at once with a stream of partial
objects, the final object validated against the Zod schema, and the call's token usage.
It takes no model and registers no SDK tools: one configured model serves every call,
and every call returns one structured object. The question loop's one tool is a step its
schema describes, which the platform runs (ADR-0008).

The AI SDK implements the contract inside the server's own Bun process.
`src/platform/provider/spine.ts` calls the SDK's `streamObject`, which streams,
validates and, by its default, retries a request the provider marks retryable, such as a
rate limit, and no other production file imports it. Aluna writes no streaming client,
retry logic or schema validation of its own, and the partial objects the SDK streams
feed a build's server-sent events (ADR-0002).

A transport fault, such as a rejected key or a dropped connection, fails the call, and
so does a generation still running after five minutes, so no call leaves a stage
waiting.

### Three wires, chosen by the endpoint's host

Aluna writes no wire format of its own. The API key, the model and the base URL
configure the provider, and the spine picks the wire from the base URL's host:

- an `anthropic.com` host takes the Anthropic Messages wire, `createAnthropic`;
- an `openai.com` host takes OpenAI's first-party provider, `createOpenAI`, which speaks
  the Responses API, holds the model to the schema through strict structured output and
  accepts a reasoning-effort setting;
- every other host takes the generic OpenAI-compatible provider,
  `createOpenAICompatible`, which speaks Chat Completions.

The compatible wire is separate because third-party endpoints do not implement the
Responses API, which the first-party provider speaks by default. They also share no
reasoning-effort option and no strict JSON-schema output. Only Anthropic's own host
takes the Messages wire, so a third-party model, including the open Chinese coding
models, is reached through its OpenAI-compatible endpoint. These models are first-class
targets: reaching one needs configuration, never code.

### The default model

With no model or endpoint set, Aluna calls `gpt-5.6-terra` at OpenAI's endpoint at
medium reasoning effort, which trades some latency for better reasoning. The effort is
fixed in the spine and sent on the first-party wire alone. The Anthropic wire runs
Claude without extended thinking, and the compatible wire sends no reasoning setting,
because its vendors share none. The default model and endpoint are constants in
`src/platform/provider/config.ts`, and the three settings move Aluna to any other model
with no code change.

### The harness retries within a unit

A unit is written as structured output too. Each attempt is one generation of the whole
file, such as `create.ts`. The platform runs the source check on it, a strict type check
included ([The Core Builder](../architecture.md#43-the-core-builder)), and a failed
check goes back into the prompt for a fresh whole-file attempt. A unit that fails its
second attempt fails the build.

The model calls no tools, never touches the file system and never chooses its scope. The
Core Builder fixes which units a build writes and in what order, and the Diff Engine
chooses which ones an evolution regenerates. The Gate's repairs keep the same bound: at
most one regeneration of each unit a failure points at, with the failure fed back
([Quality gates](../architecture.md#44-quality-gates)). The retry stays inside one Core
Builder step, so the guarantees across units hold.

### No orchestration layer over the SDK

Aluna does not use Mastra or another orchestration layer. Mastra's split between
Workflows and Agents suits a deterministic pipeline with a bounded agent inside each
step, and no Core Builder step holds an agent: each is a structured generation followed
by deterministic checks. The question loop (ADR-0008), where the model chooses each next
step, is built on `generate` too, and the platform runs every step it chooses. Adding an
orchestration layer is a change to this record.

### Generated code runs in the server's process

Generated code runs inside Aluna's server process, in the Gate and when it serves
requests, with no process sandbox. Aluna serves one person and listens only on
`127.0.0.1`, so it has no multi-tenant threat model. The source check and the supplied
adapters (ADR-0004) catch a model's mistakes. They do not contain code written to escape
them, or an unknown way into Bun or the operating system.
[Trust boundary](../architecture.md#5-trust-boundary) lists what limits generated code.

## Considered options

**A hand-rolled streaming client and provider adapters.** Aluna would maintain every
provider's wire format and its own structured-output validation, which the SDK already
supplies.

**An autonomous coding agent as the builder, such as Claude Code, Codex or opencode.**
It owns the loop and the file system, chooses which files it touches, and runs as a
heavyweight separate process with its own session. The Diff Engine could no longer
rebuild only the affected units and copy the rest from the immutable version before.

**A hosted agent API, where the provider runs the loop on its own servers.** The loop,
and the person's data with it, would live on the provider's servers, while Aluna runs
on the person's machine with their own key. Aluna would also lose control of a build's
latency.

**A process sandbox, such as E2B or Daytona.** Not adopted while Aluna serves one
person on their own machine: it would contain hostile code, which is outside that
threat model. It becomes necessary when generated code must run as untrusted code.

## Consequences

- Replacing the SDK or adding a provider package changes `spine.ts` alone among
  production files. The tests that check a schema's strict fit through the SDK's
  `zodSchema` move with it.
- Comparing two models means running the same request twice with different settings.
- Every schema sent to the provider fits strict structured output, which requires every
  property. A value that may be absent is a required, nullable property, and the null is
  dropped after parsing (`promptCapabilitySpecSchema` in `src/registry/spec/spec.ts`).
- The compatible wire asks for a JSON object and sends no schema, so on that wire the
  Zod check after the stream is the only check on shape.
