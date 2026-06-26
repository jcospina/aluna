# Behavioral tier (default ON)

Status: done

## Epic

Module 2 — Explicit Loop I: Build Your First Capability · Epic 2.5 — Capability
builder + global serial build queue (`docs/modules.md` §2.5, ARCH §6.2 step 4 +
"why the behavioral rung is a tier", §9.5, PLAN decision 5:
`modules/02-explicit-loop-i-build-your-first-capability/PLAN.md`)

## What to build

The third gate rung — the one that lifts "validated" from *compiles and runs* to
*behaves as specified* (SelfEvolve's TDD checkpoint, adapted to the CRUD domain).

- **Independence is the point.** Behavioral tests are generated from the spec's
  `behavior` field — from the stated intent, **never** from the handler code. A
  passing test is evidence the logic does what was asked, not merely that it
  agrees with itself (ARCH §2). Handler code must not appear anywhere in the
  test-generation input.
- **Execution** runs the generated tests against the capability on the scratch
  database through the practice toolbox — same isolation as the smoke rung;
  user data physically unreachable.
- **Failure fails the build** in M2: friendly product-voice message, nothing
  committed. The retry-the-affected-unit loop is deliberately M4 (epic 4.5) —
  do not build it here.
- **The tier is a global toggle, default ON** (PLAN decision 5). OFF exists
  *only* to measure the no-test baseline — "how much worse it got" — never as a
  working mode. When OFF, generation and execution are skipped and the metrics
  row records the tier as off, so M8 can compare the two runs.
- **Measure**: test-gen and test-run durations, tokens, and outcomes captured
  for the metrics row — these columns are the entire point of the tier being a
  toggle (ARCH §6.2).

## Acceptance criteria

- [x] Test generation consumes the spec's `behavior` + schema only; handler code
      never enters the test-gen input
- [x] Tests execute on the scratch database; a behavioral failure fails the
      build with nothing committed and no retry loop
- [x] Global toggle defaults ON; OFF skips generation + execution and records
      the tier as off in metrics
- [x] test-gen and test-run durations and outcomes are captured for metrics
- [x] Tests with a fake provider: a behavior-violating handler fails the rung, a
      conforming one passes, toggle-off skips cleanly; no test calls a real
      provider

## Blocked by

- modules/02-explicit-loop-i-build-your-first-capability/2.5-capability-builder-and-build-queue/issues/05-structural-and-smoke-gate-on-scratch-db.md

## Implementation notes

_2026-06-24 — implemented and verified._

- Extended [`src/builder/gate.ts`](../../../../src/builder/gate.ts) with the
  default-on behavioral rung after structural and smoke. The rung generates a
  structured test suite through the existing provider contract, using a prompt
  built only from `{ behavior, schema }`; handler source is not accepted by the
  prompt builder or passed to the provider.
- Behavioral tests are structured black-box cases, not arbitrary generated code.
  The deterministic runner opens a fresh shared in-memory scratch database,
  applies the build's own DDL, injects the practice toolbox, runs the generated
  handlers, and asserts scratch rows plus create/read fragments. Behavioral
  failure throws `CapabilityGateError` at the `behavioral` rung; there is no
  retry loop in M2.
- Added `OMNI_BEHAVIORAL_TIER` as the global tier knob. It defaults ON; `off`,
  `false`, `no`, or `0` records the behavioral rung as skipped with
  `tier: "off"` and does not call the provider or execute tests.
- The gate result now carries metrics-ready behavioral details:
  test-generation duration, token usage, generated test count, test-run
  duration, per-case outcomes, and the overall gate rung outcome.
- Wired the existing `/demo/spec-build` homepage verification stream to pass the
  provider into `runCapabilityGate` and include the behavioral metrics object in
  the developer-only `gate-preview` pane.
- Added fake-provider coverage in
  [`src/builder/gate.test.ts`](../../../../src/builder/gate.test.ts) and
  [`src/app.test.ts`](../../../../src/app.test.ts) for prompt independence,
  conforming/violating handler behavior, default-on/off toggle behavior, and the
  expanded demo preview. No test calls a real provider.
- Follow-up from live HITL: OpenAI Responses rejected the first generated test
  schema because `z.record(...)` emitted JSON Schema `propertyNames`, which that
  response format does not permit. Behavioral test cases now represent dynamic
  field maps as arrays of `{ field, value }` pairs, and the fake-provider test
  asserts the schema sent through the provider boundary contains no
  `propertyNames`.
- Follow-up from the same HITL: the product-voice failure narration was warm but
  the developer preview stayed blank. `/demo/spec-build` now emits a
  developer-only `build-error-preview` event, and the shell writes it into the
  gate preview pane while keeping the user-facing narration free of internals.
- Follow-up from behavioral failure HITL: newest-first tests can legitimately use
  `setupRows` as preexisting rows, but the runner originally inserted them in the
  same second as the action row. Setup rows are now aged deterministically inside
  scratch after insertion, so an order assertion like `Newest note` before
  `Older note` verifies the handler rather than SQLite timestamp resolution.
- `build-error-preview` now includes the failed behavioral case, setup rows,
  create input, scratch rows, and any create/read fragments captured before the
  assertion failed. That lets a human distinguish "the generated handler did not
  behave" from "the generated test made an invalid assumption" without exposing
  internals in product narration.

## Verification

- `bun test src/builder/gate.test.ts`
- `bun test src/app.test.ts`
- `bun run typecheck`
- `bunx biome check --write src/builder/gate.ts src/builder/gate.test.ts src/builder/index.ts src/app.ts src/app.test.ts`
- `bunx biome check --write src/builder/gate.ts src/builder/gate.test.ts src/builder/index.ts src/app.ts src/app.test.ts public/app.js`
- `bunx biome check src/builder/gate.ts src/builder/gate.test.ts src/builder/index.ts src/app.ts src/app.test.ts public/app.js`
- `bun test`
- `git diff --check`

## HITL test instructions

1. Run `OMNI_API_KEY=<your key> bun run dev`.
2. Open `http://localhost:3030/` (or the port Bun prints if `PORT` is set).
3. Leave the default prompt or type `I want to keep track of my notes`, then
   click **Make it**.
4. Confirm the page streams product-voice narration, then shows the
   developer-only gate preview.
5. In the gate preview, confirm `rungs` lists `structural`, `smoke`, and
   `behavioral` in that order with `status: "passed"` and `durationMs`.
6. Confirm `behavioral.tier` is `"on"`, `behavioral.testGen` includes
   `durationMs`, `usage`, `testCount`, and `outcome: "passed"`, and
   `behavioral.testRun` includes `durationMs`, `outcome: "passed"`, and passing
   case entries.
7. To verify the baseline toggle, restart with
   `OMNI_BEHAVIORAL_TIER=off OMNI_API_KEY=<your key> bun run dev`, run the same
   prompt, and confirm the gate preview records `behavioral:skipped` in `rungs`
   plus `behavioral.tier: "off"` without behavioral test generation details.
8. If the provider rejects a builder-stage schema or request, confirm the visible
   narration still says "Hmm, that didn't work. Mind trying again?" while the
   developer-only gate preview shows a `build-error-preview` JSON object with the
   technical error name and message.
9. If a behavioral assertion fails, inspect `build-error-preview.diagnostic`:
   compare `testCase`, `setupRows`, `createInput`, `scratchRows`,
   `createFragment`, and `readFragment`. A real handler failure should show the
   scratch data present but the returned fragment or row values not matching the
   generated assertion; an invalid generated test will usually be visible as an
   impossible or unsupported expectation in `testCase`.

## Comments

> *This was generated by AI during triage.*

2026-06-24 — HITL found that the current behavioral tier is correctly
independent from handler code, but still brittle when generated tests assert
literal product-copy error strings. A missing-required-fields case can be
semantically correct while failing because the generated handler says
`Missing required field(s): title, body` and the generated test expected
`Title is required` / `Body is required`.

Follow-up issue created:
[`08-stable-behavioral-error-markers.md`](08-stable-behavioral-error-markers.md).
It keeps this issue done and scopes the next step: make validation-error behavior
a structured spec-owned contract with stable error codes / semantic markers, so
handler generation and behavioral test generation stay independent but sync on
durable observable behavior instead of brittle copy.
