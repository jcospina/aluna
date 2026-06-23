# Spec generation

Status: done

## Epic

Module 2 — Explicit Loop I: Build Your First Capability · Epic 2.5 — Capability
builder + global serial build queue (`docs/modules.md` §2.5, ARCH §6.2 "Capability
Builder" step 1, PLAN decision 8 & flow step 3:
`modules/02-explicit-loop-i-build-your-first-capability/PLAN.md`)

## What to build

The first real stage of the build job's pipeline: prompt + resolved intent → the
capability **spec** (`schema + ui_intent + behavior`) through the provider
contract, validated against the registry's Zod spec shape. The spec is the
diffable source of truth everything downstream derives from (ARCH §9.1).

- **Validation is the gate into the pipeline.** A non-conforming model output
  surfaces as a failed-build path — never a silently accepted malformed spec
  flowing downstream. (The provider contract already rejects non-conforming
  objects; this stage maps that rejection onto the build's failure path.)
- **M2 bounds baked in**: `tools` is `create` + `read`; views are `list` +
  `create`; field types stay inside the M2 enum — the spec shape enforces all of
  it.
- **Identity.** Derive the capability's engineering `id` and user-facing `label`
  (CONTEXT.md: engineering names never face the user).
- **Narration.** Product-voice narration streams over the job's stream while the
  spec generates, driven by the intent's `user_facing_label` — never internals
  (no "spec", no "schema" in anything user-visible).
- **Measurement.** Spec-gen duration and token usage are captured for the
  build's metrics row.

Until the resolver is wired in front (epic 2.4), the stage runs from a hardcoded
`new_capability` intent — the PLAN's build order is explicit about this.

## Acceptance criteria

- [x] The stage consumes prompt + intent and yields a Zod-valid spec, or fails
      the build cleanly — a malformed spec can never continue downstream
- [x] Generated specs respect the M2 pantry: create+read tools, list+create
      views, the four field types
- [x] Narration streams in product voice during generation; no internals leak
- [x] Spec-gen duration and token usage are captured for metrics
- [x] Tests with a fake provider cover the happy path and the non-conforming
      output path; no test calls a real provider

## Blocked by

- modules/02-explicit-loop-i-build-your-first-capability/2.1-capability-registry/issues/01-registry-store-and-capability-spec-shape.md
- modules/02-explicit-loop-i-build-your-first-capability/2.5-capability-builder-and-build-queue/issues/01-build-job-single-flight-queue-and-busy-refusal.md

## Implementation notes

_2026-06-23 — implemented and verified; all five acceptance criteria met. Not
committed (held at the developer's request)._

### What shipped

- **Spec-gen stage** — `src/builder/spec-gen.ts` (+ `src/builder/index.ts`):
  - `generateSpec({ provider, prompt, intent, send })` → `{ spec, durationMs, usage }`.
    Narrates the intent's `user_facing_label` in product voice, generates through the
    provider contract, then **re-validates** with `capabilitySpecSchema.parse(await
    result.object)` so the gate is the stage's own — a non-conforming spec throws here
    and the build maps it onto its failure path.
  - `buildSpecPrompt` steers the model inside the M2 pantry (create+read tools,
    list+create views, the four field types, the platform trio excluded), reading the
    pantry lists off the registry enums so prompt and schema can't drift apart.
  - `hardcodedNewCapabilityIntent(prompt)` is the pre-resolver stand-in the PLAN's
    build order calls for; a real `IntentClassification` flows through unchanged once
    epic 2.4 is wired in front.

### Key decisions

- **Provider contract extended with a required `usage` handle** (`TokenUsage =
  { inputTokens, outputTokens, totalTokens }`) on `GenerateResult` — the only way to
  satisfy the measurement criterion through the single provider seam. Mapped from
  `streamObject.usage` in the spine; every fake provider updated. (Required, not
  optional — confirmed with the owner.)
- The stage *produces* the measurements (`durationMs`, `usage`); persisting them to a
  metrics row is Epic 2.7.

### Bug found and fixed (outside this issue's stated scope, but required for it to run)

- `streamObject` is **pull-based**: its `object`/`usage` promises only settle once the
  partial stream is consumed. `generateSpec` (and `classifyIntent` in epic 2.4) awaited
  `object` without draining, so both **hung against a real provider** — even though the
  provider contract documents that awaiting `object` directly is allowed. Fixed in the
  **spine** (`src/provider/spine.ts`, `pumpStream`): a background pump drains the SDK
  stream so `object`/`usage` self-resolve while `partialStream` stays live for
  narration. Guarded by network-free unit tests. This also un-breaks the resolver.
- Raised Bun's `idleTimeout` to 120s (`src/index.ts`): SSE streams fall silent during
  generation, and the 10s default would sever the real build streams, not just this one.

### Verification

- `bun test`: 96 pass / 0 fail. Stage tests use a fake provider only (happy path + five
  pantry-violation cases); pump tests are network-free; no test calls a real provider.
- Live, against the real provider: prompt → product-voice narration → spec → confirmation;
  the server logged the validated spec, ~4s spec-gen duration, and token usage (e.g.
  `{ input: 532, output: 159, total: 691 }`).

### Demo scaffolding (verification only, not part of the stage)

- A "Build a capability (demo)" affordance (`GET /demo/spec-build`; shell +
  `public/app.js`), sibling to "Meet Aluna", runs the stage live. For developer
  verification it currently **streams the spec into the UI** (a `spec-preview` event).
  That spec-streaming-to-UI portion is **slated for removal before commit** (the
  developer's call); the base liveness demo (narration + confirmation + server-console
  spec log) may remain, matching the committed "Meet Aluna" pattern.

### Intentionally deferred (later issues)

- Not wired into the `BuildJobQueue` pipeline — assembling spec → migration → units →
  gate → commit spans issues 03–07, and Epic 2.6 wires the prompt bar to it.
