# Complete-View delivery and the restoration descriptor

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.5 — Incarnated
snapshots, publication, metrics, and atomic activation
(PLAN decision 29: `modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`;
ADR-0002 SSE conventions)

## What to build

One bounded complete-View delivery contract for every terminal build path.

- Before placing foreground generation in the content area, explicit work
  records a **data-free restoration descriptor** for the pre-build content
  (active capability id/incarnation, or the neutral empty surface).
- Activation sends one `commit` event containing the complete data-free View
  for the new spec; records reload through committed `read`. A new/separate
  capability appends a toolbar entry; evolution replaces it only when its
  label changes. `commit` remains reserved for real pointer activation and is
  attempted only after the success transaction commits.
- Every non-activating terminal path — `no_change`, stale/collision,
  cancellation, or failure — resolves the descriptor against the then-current
  registry and re-renders its canonical live View plus `read` result (or the
  neutral surface if it no longer resolves) through ADR-0002's existing
  `fragment` event, with no toolbar sidecar, then sends `done` with the
  appropriate outcome. Restoration clears search and closes any modal;
  ephemeral query/edit state is not preserved across foreground generation.
- Terminal presenter work is bounded and cannot hold mutation ownership
  indefinitely: the active lease releases through `finally` whether delivery
  succeeds or fails. After activation, a missed/failed `commit` delivery
  leaves `success/activated` intact; normal shell/toolbar rehydration resolves
  the live pointer and recovers the UI. Before activation, terminal delivery
  failure is a presentation/transport failure on the non-activating path — not
  permission to publish.

## Acceptance criteria

- [ ] Descriptor recorded before generation occupies the content area; failure
      paths restore the canonical committed View + `read` via `fragment` with
      search cleared and modal closed (plan acceptance)
- [ ] `commit` only after the activation commit; non-activating paths never
      send `commit`
- [ ] Plan acceptance: a disconnect/timeout after SQLite activation preserves
      the new pointer and `success/activated`, releases the lease, and a
      reload rehydrates the activated View from the registry
- [ ] Toolbar behavior: append for new capability; replace only on label
      change
- [ ] Presenter teardown bounded; lease release in `finally` on every path
- [ ] `bun test` (headless SSE via fetch+ReadableStream), `bun run typecheck`,
      `bun run lint` clean

## Living demo

Start a build while viewing a capability, watch the foreground story, then see
either the one-shot complete View swap (success) or the canonical prior View
restored with search cleared (failure/cancel) — both live on the homepage.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.5-snapshots-publication-metrics-atomic-activation/issues/03-atomic-cross-store-activation-and-reconciliation.md
