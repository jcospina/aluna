# Hand-authored v2 candidate, regenerate-all tracer seam, and the fault battery

Status: ready-for-agent

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

- [ ] The hand-authored v2 flows: staging → manifest → verification →
      no-overwrite publication → atomic activation → one `commit` View swap;
      existing records survive and render under v2
- [ ] `v1` remains complete, immutable, and verifiable after v2 activates; a
      deliberate corruption of committed history fails closed
- [ ] Tier-on and tier-off v2 runs produce the decision-24 snapshot shapes and
      matching metrics stage states (`absent`/`skipped`)
- [ ] Fault battery green at every injection point; each pre-commit fault
      leaves v1 live and routable, each post-commit fault leaves v2
      authoritative
- [ ] The tracer seam is a single, clearly-marked temporary entry point (4.6
      removes it; it is not a second evolution path)
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean
- [ ] **Human sign-off**: watch the live v1→v2 swap on the homepage — one
      complete View swap, records intact

## Living demo

A dev affordance submits the hand-authored v2 against a chosen capability on
the homepage: the foreground story plays, the View swaps once, and the version
list in the dev preview shows v1 (history) and v2 (live).

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.5-snapshots-publication-metrics-atomic-activation/issues/04-complete-view-delivery-and-restoration-descriptor.md
