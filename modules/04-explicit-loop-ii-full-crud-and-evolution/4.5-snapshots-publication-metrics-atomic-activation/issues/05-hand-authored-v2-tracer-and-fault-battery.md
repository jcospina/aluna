# Hand-authored v2 candidate, regenerate-all tracer seam, and the fault battery

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.5 — Incarnated
snapshots, publication, metrics, and atomic activation
(Epic 4.5 text + decisions 24, 26, 27, 29:
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`)

## What to build

The 4.5 closing tracer: because candidate generation and Diff ownership arrive
in 4.6, exercise the whole publication/activation lifecycle with **one
hand-authored complete v2 candidate** and a **temporary regenerate-all tracer
seam** (clearly marked; removed in 4.6). Its sole purpose is to prove:

- complete immutable history: after v2 activates, verified `v1` remains
  committed history with authoritative `spec.json`;
- tier-on and tier-off snapshot shapes (test artifacts present/absent per
  decision 24);
- a unique loader/cache path per version — v2 executes v2 code, never a cached
  v1 module;
- one complete View swap through the 4.5/04 delivery contract;
- rollback/recovery at every filesystem, SQLite, and presenter fault point
  (staging failure, publish failure, pre-commit DB failure, post-commit
  presenter/transport failure, interrupted process).

## Acceptance criteria

- [x] The hand-authored v2 flows: staging → manifest → verification →
      no-overwrite publication → atomic activation → one `commit` View swap;
      existing records survive and render under v2
- [x] `v1` remains complete, immutable, and verifiable after v2 activates; a
      deliberate corruption of committed history fails closed
- [x] Tier-on and tier-off v2 runs produce the decision-24 snapshot shapes and
      matching metrics stage states (`absent`/`skipped`)
- [x] Fault battery green at every injection point; each pre-commit fault
      leaves v1 live and routable, each post-commit fault leaves v2
      authoritative
- [x] The tracer seam is a single, clearly-marked temporary entry point (4.6
      removes it; it is not a second evolution path)
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean
- [ ] **Human sign-off**: watch the live v1→v2 swap on the homepage — one
      complete View swap, records intact

## Living demo

A dev affordance submits the hand-authored v2 against a chosen capability on
the homepage: the foreground story plays, the View swaps once, and the version
list in the dev preview shows v1 (history) and v2 (live).

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.5-snapshots-publication-metrics-atomic-activation/issues/04-complete-view-delivery-and-restoration-descriptor.md

## Implementation notes

- A single, explicitly temporary hand-authored v2 tracer reuses verified snapshot
  publication, history reconciliation, CAS activation, durable lifecycle metrics,
  and the existing terminal presenter; it introduces neither Diff policy nor a
  second evolution delivery contract. Module 4.6/05 removes this seam.
- The developer-panel affordance opens the standard SSE build subscriber. Its
  stream narrates the foreground work, then sends metrics preview, commit preview,
  exactly one `commit` complete-View swap, and `done`. Post-activation delivery
  failures preserve the durable pointer and use the normal recovery narration.
- The affordance and its endpoint are deliberately one-time: they only admit a v1
  capability and are removed from the developer panel after v2 activates. This
  prevents the temporary seam from becoming an unowned v3 evolution path.
- The temporary candidate copies the complete verified unit inventory and adds one
  harmless, observable v2-only read marker. This proves the router loads the
  incarnation/version-keyed v2 handler and renderer rather than a cached v1 module.
- The focused battery covers v1 history verification/corruption refusal; tier-on and
  tier-off snapshot shapes; staging/publication and transactional activation seams;
  post-commit authority; durable lifecycle state; one commit presentation; and
  reconciliation of interrupted/never-activated candidates through the shared
  artifact-reconciliation suite.

## Verification record

Verified 2026-07-22 (America/Bogota):

- `bun test src/pipeline/hand-authored-v2-tracer.test.ts`: 8 passed.
- Focused tracer, build-job, activation, terminal-presentation, and complete View
  suite: 61 passed. An unsandboxed repository-wide `bun test` rerun passed,
  including the local boot-server and artifact-reconciliation tests.
- `bun run typecheck`, `bun run lint`, and `git diff --check`: passed.
- Browser automation on the local homepage confirmed the control is visibly inside
  the opened developer panel for a v1 capability and absent after v2; the required
  human observation remains intentionally unchecked below.

### Follow-up UX fixes (2026-07-22, post-review)

Three UI/UX regressions reported against the first implementation were diagnosed
and fixed:

- **Empty state lost after v2**: the v2 read marker used to be prepended even to an
  empty read, so the records region was never `:empty`. The candidate now emits the
  marker only for non-empty reads (verified in the published snapshot), and the
  temporary legacy-marker CSS branch was removed — no snapshot with the old shape
  exists after the data reset.
- **Developer panel empty after refresh**: direct `GET /capability/:id` full-page
  loads never seeded `#spec-metrics-preview`, so every devbar block hid after a
  refresh (the URL the swap leaves you on). Both full-page paths now share the same
  lifecycle + committed-versions injection, so the v1-history/v2-live version list
  survives refresh.
- **Flicker on commit**: the promotion hook re-fetched the records region after
  every successful commit, re-rendering records that had already loaded inside the
  subscriber (HTMX fires the region's `load` trigger there). Reverted to reloading
  only on restoration; also, an in-flight records read no longer counts as "empty",
  so the commit swap cannot flash "Nothing here yet" before records land.

Verified live against the dev server: `board_games` traced v1→v2 (records survive,
marker present, control absent after v2); `movie_watchlist` left at v1 with one
record so the human sign-off swap can be watched on the homepage.

## HITL test instructions

1. Run `bun run dev` from the repository root, then open `http://localhost:3030`.
2. Create or open a capability with at least one record, open the developer panel,
   and use **Trace next version** from the developer panel.
3. Watch the foreground narration, then confirm exactly one complete View swap. The
   record remains present; the developer preview shows the committed v2 and the
   version list shows v1 history plus v2 live.
4. Refresh and read the capability again. Its records remain and the committed v2
   View rehydrates through the version-keyed router path.
