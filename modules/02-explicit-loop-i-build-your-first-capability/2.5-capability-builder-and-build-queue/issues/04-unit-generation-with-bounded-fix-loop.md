# Unit generation with the bounded fix loop

Status: done

## Epic

Module 2 — Explicit Loop I: Build Your First Capability · Epic 2.5 — Capability
builder + global serial build queue (`docs/modules.md` §2.5, ARCH §6.2 step 3,
ADR-0003 "bounded tool-loop", ADR-0004 (handler contract, data-free views), PLAN
decision 5 & flow step 5:
`modules/02-explicit-loop-i-build-your-first-capability/PLAN.md`)

## What to build

The stage that generates the capability's four units from the spec, each through
a bounded type-check fix loop — agentic *within* a unit, deterministic *across*
units (ADR-0003; never a roaming agent).

- **Two handlers** — `create` and `read` — to the ADR-0004 skeleton: one
  default-exported async function receiving the platform-built context (parsed
  input + the capability-scoped data tool) and returning an HTML fragment.
  Generated code contains **no imports, no raw HTTP, no table names** — the
  contract is deliberately nearly unflubbable.
- **Two views** — `list` and `create` — data-free scaffolding per ADR-0004:
  chrome, forms, and HTMX hooks only. The list view's dynamic region loads
  through the capability's `read` action; the create form submits through the
  fixed router convention. Zero user data ever enters a view, which is what
  keeps the version-keyed cache honest.
- **The fix loop** (PLAN decision 5): write → type-check → feed the error back
  → fix, per unit, capped by a config knob (default **2 attempts**). Every
  attempt is recorded for the metrics row. A unit that exhausts its cap fails
  the build cleanly — a broken unit never continues downstream.
- **Measure**: code-gen and HTML-gen durations, tokens, and fix-loop attempts
  per unit, all captured for metrics.

## Acceptance criteria

- [x] Generated handlers conform to the ADR-0004 skeleton (single default-export
      async function, context in, fragment out; no imports/HTTP/table names)
- [x] Generated views contain zero user data; dynamic regions load via the
      `read` action and forms target the fixed router convention
- [x] Type-check failures feed back into regeneration, capped by the config knob
      (default 2); attempts and per-unit timings are recorded
- [x] An exhausted cap fails the build cleanly — never a committed broken unit
- [x] Tests with a fake provider cover clean generation, fail-once-then-fix, and
      cap exhaustion; no test calls a real provider

## Blocked by

- modules/02-explicit-loop-i-build-your-first-capability/2.5-capability-builder-and-build-queue/issues/02-spec-generation.md
- modules/02-explicit-loop-i-build-your-first-capability/2.2-constrained-data-tool-and-additive-ddl/issues/02-capability-scoped-data-tool.md

## Implementation notes

_2026-06-23 — implemented and verified._

- Added the unit-generation stage in
  [`src/builder/units.ts`](../../../../src/builder/units.ts), exported through
  [`src/builder/index.ts`](../../../../src/builder/index.ts).
  `generateCapabilityUnits({ provider, spec, maxAttempts })` deterministically
  generates the four M2 units in order: `handler:create`, `handler:read`,
  `view:list`, `view:create`.
- The stage uses the existing structured `Provider` seam: every provider call
  returns `{ content }`. No tests call a real provider.
- Handlers run through ADR-0004 static checks before acceptance: exactly one
  `export default async function`, one platform-built `CapabilityContext`
  parameter, no imports, no raw HTTP, and no `cap_*` table names. Accepted
  handlers are then type-checked in an isolated temp TypeScript program with
  global contract declarations, so generated files still need no platform
  imports.
- Views run through data-free scaffolding checks: no scripts or interpolation
  placeholders, no baked row markers, `list` must load live data through
  `hx-get="/capability/<id>/read"`, and `create` must submit through
  `hx-post="/capability/<id>/create"` with controls for every spec field.
- The bounded fix loop is per unit. It writes, checks, feeds the precise failure
  back into the next prompt, and stops at the config knob
  (`DEFAULT_UNIT_FIX_ATTEMPTS = 2`). Every attempt records duration, token usage,
  and the failure text when present; successful unit metrics aggregate duration
  and tokens across attempts.
- Cap exhaustion throws `UnitGenerationError` with unit identity and attempt
  metrics, and `generateCapabilityUnits` returns no partial artifact result on
  that path. A broken unit therefore cannot flow downstream from this stage.
- Added focused tests in
  [`src/builder/units.test.ts`](../../../../src/builder/units.test.ts) covering
  clean four-unit generation, fail-once-then-fix with type-check feedback, default
  cap exhaustion, data-free view rejection, and retry prompt construction.
- Wired the homepage builder-stage demo through
  [`/demo/spec-build`](../../../../src/app.ts): after spec generation and scratch
  migration preview, it now runs unit generation and streams a `units-preview`
  event containing the four generated units, attempt counts, durations, token
  usage, and generated content. The shell displays this in a third developer-only
  preview pane (`#spec-units-preview`) so the integration path is visible before
  the final end-to-end prompt flow lands.
- Follow-up from the live demo: unit generation can take long enough that a
  single final `units-preview` event risks an idle SSE connection. Added generic
  unit-generation observer hooks (`onUnitStart`, `onUnitPartial`,
  `onUnitAttempt`, `onUnitGenerated`) and changed the demo to stream repeated
  running `units-preview` snapshots while each unit is generated.
- The connection-liveness fix is transport-level, not demo-only. Long-running SSE
  routes now send id-less `heartbeat` events below the server idle timeout, so a
  stage that is generating or checking without user-visible output still keeps
  the TCP/SSE connection open. App-level event ids remain monotonic because
  heartbeats carry no id.

## Verification

- `bun test src/builder/units.test.ts`
- `bun test src/app.test.ts`
- `bun run typecheck`
- `bunx biome check src/app.ts src/app.test.ts public/index.html public/app.js public/app.css src/builder/index.ts src/builder/units.ts src/builder/units.test.ts docs/adr/0002-sse-transport-conventions.md docs/agents/issue-tracker.md docs/modules.md AGENTS.md modules/02-explicit-loop-i-build-your-first-capability/2.5-capability-builder-and-build-queue/issues/02-spec-generation.md modules/02-explicit-loop-i-build-your-first-capability/2.5-capability-builder-and-build-queue/issues/04-unit-generation-with-bounded-fix-loop.md`
- `bun test`

## HITL test instructions

1. Run `OMNI_API_KEY=<your key> bun run dev`.
2. Open `http://localhost:3030/` (or the port Bun prints if `PORT` is set).
3. Leave the default prompt or type `I want to keep track of my notes`, then click
   **Make it**.
4. Confirm the page streams product-voice narration, then shows three
   developer-only preview panes: the generated spec, the scratch migration, and
   the generated units. The generated-units pane should appear and update before
   the final completion message, not only after the whole build-stage demo ends.
5. In the generated-units preview, confirm it contains four entries:
   `create.ts`, `read.ts`, `list.html`, and `create.html`, each with `attempts`,
   `durationMs`, `usage`, and `content`. The final visible message should say
   Aluna has made a place for `Notes`.
6. In the browser Network tab, inspect the EventStream for the request. If any
   generation/checking stage is silent for more than 15 seconds, confirm id-less
   `heartbeat` events arrive before the final `done` event and the request stays
   open.
