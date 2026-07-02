# Design-lint gate rung

Status: ready-for-agent

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

- [ ] A fail-closed design-lint rung runs in the Gate on the scratch db, rendering
      the item renderer with synthetic + hostile values within the declared layout
- [ ] It rejects off-token styling (raw values on the token-owned axes,
      `url(...)`, item-escaping position, field values interpolated into
      `style`), fabricated/unknown classes, executable markup, and unsafe
      interpolation — while token-disciplined inline `style` passes clean
- [ ] Violations feed the existing bounded fix loop (default 2); exhaustion fails
      the build with no version bump / no pointer flip
- [ ] The per-rung outcome is recorded for metrics
- [ ] Tests cover a clean pass, a violation-then-fix, and cap exhaustion with a
      fake provider; no real provider call
- [ ] AFK — rung correctness is test-verified; the friendly-narration-on-failure
      visual is confirmed as part of 3.7's acceptance

## Blocked by

- modules/03-opinionated-ui-design-contract/3.1-closed-value-contract-and-primitives/issues/02-runtime-allow-list-enforcer.md
- modules/03-opinionated-ui-design-contract/3.4-one-item-renderer/issues/02-recut-unit-generation-item-renderer.md
