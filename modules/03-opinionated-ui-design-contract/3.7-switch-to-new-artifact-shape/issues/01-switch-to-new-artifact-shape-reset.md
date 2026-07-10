# Switch to the new artifact shape (reset, not migrate)

Status: done

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

- [x] Run `bun run reset`, then build *"I want to keep track of my notes"* fresh →
      the styled list truncates long text and exposes a **New note** button → the
      shared modal opens with an on-brand form → a created note appears through the
      same item renderer used by the read path → clicking its platform-owned
      wrapper opens the same modal prefilled and read-only
- [x] Build *"save links with a title and a url"* and confirm its item composition
      differs from Notes while reusing the same modal and primitives
- [x] Build something visual (e.g. *"a place for my photos"*) and confirm it comes
      out as a `grid` collection while Notes stays a `feed`
- [x] Make an item renderer emit an unknown class or unsafe field value and confirm
      the design gate fails with friendly narration and no pointer flip
- [x] The M2 `list.html`/`create.html` artifact shape is fully retired; the
      platform produces and serves only the M3 shape (no dual-serving, no
      `artifact_contract` marker)
- [x] Human runs the full "Verify by running it" script above and signs off before
      done

## Blocked by

- modules/03-opinionated-ui-design-contract/3.5-few-shot-design-gallery/issues/01-few-shot-gallery-and-injection-harness.md
- modules/03-opinionated-ui-design-contract/3.6-design-lint-gate-rung/issues/01-design-lint-gate-rung.md

## Implementation notes

Completed 2026-07-10 after the human reported the full fresh-capability verification
above passing. The final consistency sweep aligned runtime code, checked-in fixtures,
tests, metrics, comments, and current architecture docs with the mandatory M3 shape.

- Removed the router's transitional missing-item-renderer compatibility adapter. Every
  committed capability now requires `item.ts`; a missing or malformed renderer fails
  through the normal product-voice boundary before any Handler loads. There is no path
  on which an M2 Handler can keep serving self-authored item markup.
- Re-cut the hand-written router fixtures to `item.ts` + action Handlers. Deleted the
  checked-in `list.html`/`create.html` fixtures, moved record composition into the one
  item renderer, and made both `create.ts` and `read.ts` call `present(record)`.
- Added a regression that asserts the fixture directory is exactly the M3 artifact shape
  and another that proves a missing `item.ts` cannot fall back to Handler execution.
- Renamed current preview/metrics contracts from HTML generation to presentation
  generation. Additive migration `0005_generation_metrics_presentation_gen` adds
  `presentation_gen_ms`; M2's `html_gen_ms` remains only as historical schema data.
- Updated current architecture, module, issue, registry, pipeline, and metrics language
  to describe version directories containing the item renderer + Handlers and to keep
  artifact-contract preservation/markers explicitly deferred until after M8.

## Verification

- `bun test src/router/router.test.ts src/presentation/adapter.test.ts src/metrics/store.test.ts src/migrations.test.ts src/app.test.ts` — 76 pass / 0 fail.
- `bun test` — 362 pass / 0 fail across 28 files; 2 snapshots.
- `bun run typecheck` — clean (server and browser configs).
- `bun run lint` — clean (128 files).
- Targeted `bunx biome check` across all touched TypeScript/fixture files — clean.
- `git diff --check` — clean.
- Consistency search: no `list.html`/`create.html` files remain under `src/`,
  `scripts/`, or `public/`; no current `unavailablePresentationAdapter`, `htmlGenMs`,
  or `htmlGenDurationMs` references remain.

## HITL test instructions

The full visual acceptance was completed by the human before this consistency sweep.
For a lightweight post-change confirmation:

1. Restart or reuse the app on `:3030` with `bun run dev` (restart once so migration
   `0005_generation_metrics_presentation_gen` applies).
2. Open `http://localhost:3030/`, open the developer panel (`</>`), and build a fresh
   capability after `bun run reset`, for example *"I want to keep track of my notes"*.
3. Confirm the unit preview contains exactly `item.ts`, `create.ts`, and `read.ts`; the
   committed capability is styled; create and read use the same item composition; and
   no generated `list.html` or `create.html` appears under `capabilities/<id>/v1/`.
4. Click a created item and confirm the shared read-only detail modal opens with the full
   record, proving the required item renderer is flowing through the platform adapter.
