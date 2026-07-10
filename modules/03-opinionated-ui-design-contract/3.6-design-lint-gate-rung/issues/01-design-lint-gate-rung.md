# Design-lint gate rung

Status: done

## Epic

Module 3 — Opinionated Capability UI · Epic 3.6 — Design-lint gate rung
(`docs/modules.md` §3.6, ARCH §6.2 gate, ADR-0005 §4, PLAN decision 6 & flow
step 5: `modules/03-opinionated-ui-design-contract/PLAN.md`)

## What to build

Add the fail-closed **design-lint rung** to the **Gate** (`src/builder/gate.ts`):
render the generated **item renderer** with **synthetic and hostile** field values
*within the capability's declared collection layout* and reject off-token
styling (raw values on the token-owned color/font/type/spacing/border axes, forbidden
style constructs — token-disciplined inline `style` passes, per ADR-0005 §4 as
amended 2026-07-01), fabricated/unknown classes, executable markup, and unsafe
field interpolation.
Violations re-enter the **same bounded fix loop** as the type-check rung; the
per-rung outcome is captured for metrics. Platform wrapper/payload/modal
invariants stay deterministic platform tests, not rungs the model can fail
(ADR-0005 §4).

- Rung placement in the layered gate after structural/smoke/behavioral,
  fail-closed, on the scratch db.
- Render the item with synthetic + hostile values inside the declared
  `collection.layout`; detect the forbidden set using the 3.1/01 contract and the
  3.1/02 enforcer.
- On violation, feed the precise failure back through the bounded fix loop
  (default 2 attempts, reused); on exhaustion the build fails cleanly with no
  version bump and no pointer flip.
- Capture the design-lint per-rung outcome for the metrics row (flow step 7).

## Acceptance criteria

- [x] A fail-closed design-lint rung runs in the Gate on the scratch db, rendering
      the item renderer with synthetic + hostile values within the declared layout
- [x] It rejects off-token styling (raw values on the token-owned axes,
      `url(...)`, item-escaping position, field values interpolated into
      `style`), fabricated/unknown classes, executable markup, and unsafe
      interpolation — while token-disciplined inline `style` passes clean
- [x] Violations feed the existing bounded fix loop (default 2); exhaustion fails
      the build with no version bump / no pointer flip
- [x] The per-rung outcome is recorded for metrics
- [x] Tests cover a clean pass, a violation-then-fix, and cap exhaustion with a
      fake provider; no real provider call
- [x] AFK — rung correctness is test-verified; the friendly-narration-on-failure
      visual is confirmed as part of 3.7's acceptance

## Blocked by

- modules/03-opinionated-ui-design-contract/3.1-closed-value-contract-and-primitives/issues/02-runtime-allow-list-enforcer.md
- modules/03-opinionated-ui-design-contract/3.4-one-item-renderer/issues/02-recut-unit-generation-item-renderer.md

## Delivered

Done 2026-07-10. The rung lives in the Gate and owns a bounded regeneration of the
**item renderer** — the affected unit — reusing the type-check rung's mechanism.
The gate is where generated code is *executed* (`unit-checks.ts` explicitly reserves
design-lint for the gate, not the static generation loop), so the rung renders rather
than statically inspects.

- `src/builder/gate-design-lint.ts` — new. `runDesignLintRung` renders the item
  renderer against a **synthetic** probe (catches hard-coded off-token styling /
  fabricated classes) plus one **hostile** probe per injection family (HTML/script,
  attribute breakout, `style` injection, `javascript:` URL, quote/markup soup — each
  stuffed into every user field) **within the declared `collection.layout`** (the real
  adapter → wrapper → detail-template path, arranged by `renderCollection`). Detection
  reuses 3.1/02 as the *rejecter*: `enforceItemMarkup(inner) !== inner` means the
  render-time enforcer had to neutralize the composition, so it is off-contract. A
  focused raw-color scan closes the one documented enforcer residual — a **named CSS
  color inside a mixed shorthand** (`background: white`), inert at render time but still
  off-token. `findDesignViolation` is exported for direct testing.
- **Bounded fix loop, reused.** On a violation the rung regenerates the item renderer
  via `generateUnitContent` (a new single-pass helper factored out of `units.ts`, the
  same write step + `buildUnitPrompt` the type-check loop runs) with the precise failure
  fed back, then **re-validates the fresh unit's shape/type** with `checkGeneratedUnit`
  (structural's job re-applied — a regenerated renderer never saw the structural rung)
  before re-rendering. Capped by the existing `DEFAULT_UNIT_FIX_ATTEMPTS` (default 2;
  overridable via `CapabilityGateInput.designLint.maxAttempts`). Without a provider the
  rung detects once and cannot fix — a clean renderer passes, a dirty one fails closed.
- **Gate placement + fail-closed.** `gate.ts` runs `design-lint` after
  structural → smoke → behavioral. Exhaustion throws `DesignLintRungError`, which the
  gate wraps into `CapabilityGateError(failedRung: "design-lint")`; because the whole
  build runs in one write transaction, that rolls back — **no version bump, no pointer
  flip** (ARCH §6.2 failure path). The diagnostic (attempts + last violation) rides into
  the developer preview like the behavioral rung's. The rung touches no database — it
  renders synthetic records in-process, so it is isolated from real data by construction.
- **Commit gets the fix.** `CapabilityGateResult.designLint` carries the final
  (clean-or-fixed) item renderer; `build-run.ts` folds a fix back into the committed
  `item.ts` (`applyDesignLintFix`) so a build never ships the rejected composition.
- **Metrics.** `design-lint` added to the gate rung order and to the metrics store's
  validated rung-name enum (with a compile-time exhaustiveness guard so a future rung
  can't silently fail validation on write); the per-rung outcome flows into `gateRungs`,
  and any regeneration tokens into the honest usage total (`recordGateMetrics`).

## Verification

- `bun test src/builder/gate-design-lint.test.ts` — 17 pass. Detector coverage: clean
  + token-disciplined `style` + an escaped field flowing into `<img src>` (the media
  pattern) all pass; off-token color, named-color shorthand (the residual), `url(...)`,
  item-escaping `position`, fabricated class, interactive descendant, field-into-`style`,
  unescaped interpolation, and a throwing renderer all rejected. Rung coverage: clean pass
  (no provider call), clean pass with no provider, violation→fix (commits the fixed
  renderer, precise failure fed back, one regeneration), structural re-validation of a
  regenerated renderer, cap exhaustion (fail-closed + diagnostic), and a no-provider
  violation failing closed. All fake providers; no real provider call.
- **Gallery/gate agreement** — ran all three 3.5 few-shot exemplar renderer sources
  through the full detector: all clean. (This caught and fixed a false-positive where the
  media exemplar's legitimate `<img src="${field}">` was flagged because a hostile probe
  carried a `javascript:` URL — sanitizing a per-record URL *value* is the runtime
  enforcer's job, not a renderer violation, so the probes carry no dangerous URL scheme.)
  The taught design must pass the gate that enforces it, or every real build would loop.
- `bun test` — 360 pass / 0 fail across 28 files (updated the gate/app rung-order
  assertions; the fake item renderers were already design-clean, so provider-call counts
  and token totals are unchanged — design-lint passes first look).
- `bun run typecheck` — clean (both configs). `bun run lint` — clean (128 files).
- Living demo: the rung runs automatically in the `/demo/spec-build` and `/prompt`
  pipelines; `app.test.ts` asserts the streamed `gate-preview` now carries
  `design-lint:passed` and the metrics row records it — so the integration is live, not a
  gap deferred to the end-to-end slice.

## HITL test instructions

Rung correctness is test-verified (above); the friendly-narration-on-failure *visual* is
3.7's acceptance, so there is no human sign-off gate here. To watch the rung live in the
real pipeline (a real provider build):

- Run: with the dev server on `:3030`, open `http://localhost:3030/`, open the developer
  panel (`</>`), enter e.g. `track books I've read with a title, author, and rating`, and
  click `Make it`.
- Confirms: the dev **gate preview** (`spec-gate-preview`) lists four rungs and ends with
  `design-lint: passed` — the generated item renderer cleared the closed-value contract
  within its declared collection layout before commit. The committed capability renders
  styled, on-token items (no raw colors, no fabricated classes).
- (Raw stream) `http://localhost:3030/demo/spec-build?prompt=...` — the `gate-preview`
  event's `rungs` array includes `design-lint`.
