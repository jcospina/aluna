# Switch to the new artifact shape (reset, not migrate)

Status: ready-for-agent

> **HITL — human visual sign-off required.** This is the module's end-to-end
> acceptance. A human runs the full "Verify by running it" script below on the
> running app and signs off before this issue is done.

## Epic

Module 3 — Opinionated Capability UI · Epic 3.7 — Switch to the new artifact shape
(reset, not migrate) (`docs/modules.md` §3.7, ADR-0005 §7 (amended 2026-06-30),
PLAN decision 8 & flow: `modules/03-opinionated-ui-design-contract/PLAN.md`)

## What to build

Make the Module 3 shape (platform-rendered **Views** + one **item renderer**) the
**only** shape the build pipeline produces and the registry/router serve, and
retire the remaining M2 `list.html`/`create.html` paths end to end. Because the
project is greenfield and under development, the M2→M3 transition is **`bun run
reset` + rebuild fresh** — **no** preservation cutover, **no** dual-serving of
old/new artifacts, **no** persisted `artifact_contract` marker (all deferred
post-M8, ADR-0005 §7). This epic is also the module's end-to-end acceptance.

- Remove any remaining M2 four-unit generation/serving paths so only the M3 shape
  is produced and served.
- Confirm a `bun run reset` + rebuild yields styled, varied capabilities through
  the full happy path (spec → migration → item renderer + Handlers → Gate incl.
  design-lint → commit / pointer flip).
- Add no preservation machinery.

## Acceptance criteria

The module acceptance is `docs/modules.md` §Module 3 "Verify by running it", kept
**word-for-word**:

- [ ] Run `bun run reset`, then build *"I want to keep track of my notes"* fresh →
      the styled list truncates long text and exposes a **New note** button → the
      shared modal opens with an on-brand form → a created note appears through the
      same item renderer used by the read path → clicking its platform-owned
      wrapper opens the same modal prefilled and read-only
- [ ] Build *"save links with a title and a url"* and confirm its item composition
      differs from Notes while reusing the same modal and primitives
- [ ] Build something visual (e.g. *"a place for my photos"*) and confirm it comes
      out as a `grid` collection while Notes stays a `feed`
- [ ] Make an item renderer emit an unknown class or unsafe field value and confirm
      the design gate fails with friendly narration and no pointer flip
- [ ] The M2 `list.html`/`create.html` artifact shape is fully retired; the
      platform produces and serves only the M3 shape (no dual-serving, no
      `artifact_contract` marker)
- [ ] Human runs the full "Verify by running it" script above and signs off before
      done

## Blocked by

- modules/03-opinionated-ui-design-contract/3.5-few-shot-design-gallery/issues/01-few-shot-gallery-and-injection-harness.md
- modules/03-opinionated-ui-design-contract/3.6-design-lint-gate-rung/issues/01-design-lint-gate-rung.md
