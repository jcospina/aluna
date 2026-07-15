# Incarnation-keyed registry, artifact path, and loader

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.1 — Incarnation-keyed,
evolution-ready field and input contract
(PLAN decision 25: `modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`;
ADR-0006 §incarnation; ADR-0004 artifact contract)

## What to build

Give every capability lifetime a platform-owned **incarnation**. This is the
M3→M4 cutover slice: it begins with `bun run reset` (greenfield — no
preservation of M3 rows or artifacts, per the no-back-compat rule) and moves the
whole artifact/loader path onto the incarnation key in one step.

- A new capability (v1) receives an opaque platform-generated `incarnation_id`
  at creation. The AI never authors it.
- Registry rows carry the incarnation; generation-metrics rows are keyed by
  build id **and** incarnation.
- Artifacts live under `capabilities/<id>/<incarnation_id>/v<n>/`; the
  capability loader and Bun's dynamic-import cache key on that path immediately
  (this is what later makes delete/recreate safe — a recreated capability can
  never load a cached deleted module).
- The prompt-built explicit loop (resolve → build → Gate → commit swap) keeps
  working end-to-end on the new path.

## Acceptance criteria

- [x] `bun run reset` performed; no M3-shaped registry row or artifact directory
      remains (transitional-epic integrity: incarnation-keyed loading begins in 4.1)
- [x] A new capability gets an opaque `incarnation_id`; registry row, artifact
      path, and loader all share it
- [x] Metrics rows are keyed by build id + incarnation
- [x] Prompt-building a capability on the homepage works end-to-end and its
      artifacts land at `capabilities/<id>/<incarnation_id>/v1/`
- [x] Focused tests pin the path layout, registry shape, and loader keying
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The homepage explicit loop is the demo: build a capability by prompt and confirm
it renders and its artifacts/registry row live on the incarnation-keyed path.

## Blocked by

None — can start immediately (this is the first M4 issue).

## Implementation notes

- Platform migration `0006_incarnation_keyed_capabilities` adds
  `incarnation_id` to the registry and generation metrics. Registry rows require
  a valid opaque UUID; non-capability metrics remain nullable until the later M4
  lifecycle split.
- The Builder assigns the incarnation only after the AI-authored spec validates.
  The value is absent from the authored spec and remains stable through migration,
  Gate, commit, developer preview, registry storage, and generation metrics.
- Commit now writes `capabilities/<id>/<incarnation_id>/v1/` and records that exact
  path in the registry. The existing router loads both `item.ts` and Handlers from
  the pointer, so Bun's module URL includes incarnation and version.
- A focused router regression loads one semantic capability id from two distinct
  incarnation paths and proves the second lifetime executes its own Handler rather
  than Bun's cached first-lifetime module.
- The required greenfield reset cleared the M3 registry/metrics rows, dropped three
  generated capability tables, and removed three generated artifact/blob paths.
  No unrelated worktree content was modified.

## Verification

- `bun run reset`
- `bun test src/router/router.test.ts src/app.test.ts src/metrics/store.test.ts src/builder/commit.test.ts src/registry/store.test.ts src/registry/spec.test.ts src/migrations.test.ts`
- `bun test` — 365 pass, 0 fail
- `bun run typecheck`
- `bun run lint`
- `git diff --check`
- Live homepage build on the existing `localhost:3030` server: prompt
  `I want to keep track of my garden notes` committed **Garden Notes**, rendered
  its View, and wrote registry, metrics, and artifacts with the same incarnation
  `3ed1dd5a-0e87-4645-8944-8d451b8afe07` at
  `capabilities/garden_notes/3ed1dd5a-0e87-4645-8944-8d451b8afe07/v1/`.

## HITL test instructions

1. Reuse the running server on port 3030, or start it with `bun run dev`.
2. Open `http://localhost:3030/`.
3. Enter a new capability prompt such as
   `I want to keep track of my reading list` and select **Make it**.
4. Confirm the capability appears in the toolbar and its empty View renders after
   the build finishes. Open the developer panel and confirm the Commit preview
   shows one opaque `incarnationId` and an `artifactsPath` shaped as
   `capabilities/<id>/<same-incarnationId>/v1/`.
5. Inspect `capability_registry` and `generation_metrics` in
   `data/omni-crud.db`; confirm the successful build row and registry row carry
   that same incarnation and the three files exist under the previewed path.

## Post-epic quality review (2026-07-15)

- `commitCapability` now validates both the authored spec and the platform UUID
  before deriving or creating an artifact directory. Malformed path components
  therefore fail before filesystem or registry mutation.
- Regression coverage proves invalid semantic ids and incarnation ids create no
  artifact root and register no capability.
