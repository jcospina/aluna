# Per-incarnation read gates and atomic token sets

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.9 — Dependency-safe
permanent capability deletion
(PLAN decision 34 (read side):
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`)

## What to build

The read-token layer deletion drains against.

- Every target route and declared cross-capability query (and later M5
  whole-catalog query and M6 file serve — the interface must accommodate them)
  acquires ownership-validated read tokens for the incarnations it can
  observe.
- An operation acquires its **complete** incarnation token set atomically
  against one gate/catalog snapshot; if any member is missing, stale, or
  closing, it receives no tokens and does not begin. The complete set releases
  in `finally`.
- A per-incarnation read gate supports `active → closing`: closing refuses new
  tokens, waits for tracked readers to release by a fixed deadline, and
  signals cancellation. Failure/timeout before the database point of no return
  reopens the gate in `finally`; boot recovery reopens gates left closing by a
  crash.

## Acceptance criteria

- [x] Plan acceptance: atomic all-or-nothing multi-incarnation token
      acquisition — a set containing one closing incarnation acquires nothing
      and does not begin
- [x] Plan acceptance: read-gate drain, timeout, and reopen — closing refuses
      new tokens, drains tracked readers by deadline, reopens in `finally` on
      timeout, and boot recovery reopens a crashed closing gate
- [x] Token release in `finally` on success, failure, and cancellation;
      ownership-validated (a stale token cannot release another's)
- [x] Reads uninvolved in any closing gate stay concurrent and unaffected
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Not directly user-visible on its own; a dev preview shows per-incarnation gate
state (active/closing, tracked reader count) live while browsing capabilities —
the surface 4.9/02–03 will animate.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.2-mutation-coordinator-split-tools-and-routing-actions/issues/06-read-dependencies-rehydration-and-search-normalization.md

## Implementation notes

- Added a shared, process-local read-gate coordinator keyed by exact capability
  and incarnation identity. Complete target-plus-dependency sets validate and
  acquire atomically from one active catalog snapshot.
- Routed the direct capability View and all five Action routes through the same
  ownership boundary before request parsing or generated-module loading.
  Mutation Actions hold both their read set and mutation lease through the full
  transaction.
- Closing signals cooperative cancellation through route phase checkpoints and
  the physically read-only query port. Normal release revokes ownership before
  signalling and before reader counts reach zero, so retained ports and
  reentrant/stale release attempts cannot outlive their exact owner.
- Added fixed-deadline drain, timeout/failure reopen, exact close-lease ownership,
  and boot recovery from the active registry catalog.
- Added the dev-only `/demo/read-gates` live preview. Its hold and close exercises
  use the shared coordinator; close also owns and finally releases deletion
  admission so the demo cannot bypass the production ordering contract.
  **Retired in 4.9/04** — a demo is scaffolding for work in progress, and once
  this issue was signed off the surface came down. Everything it demonstrated is
  covered by `src/router/router.read-gates.test.ts`, `src/read-gates/index.test.ts`,
  and the deletion fault battery, so its removal took no evidence with it. The
  HITL steps below are therefore historical.
- Closing mutation requests now retarget the existing create/edit/delete
  aria-live error regions with warm, structured feedback.

## Verification

- `bun run test --shards=2` — 1,073 passed, 0 failed across 112 files.
- Final focused read-gate, router, and preview pass — 18 passed, 0 failed.
- `bun run typecheck` — clean.
- `bun run lint` — clean across 294 files.
- `git diff --check` — clean.
- Independent adversarial re-review — blocker-free after cancellation,
  mutation-feedback, demo-ownership, five-Action, retained-port, and reentrant
  release findings were repaired and regression-tested.
- Live browser verification on `http://localhost:3030/demo/read-gates` confirmed
  `active / 0 → active / 1 → closing / 0 → active / 0`; the closing target was
  warmly refused while an unrelated capability remained browsable.

## HITL test instructions

> Historical: `/demo/read-gates` was retired in 4.9/04 and these steps no longer
> run. Kept as the record of how this issue was signed off.

1. Reuse the running development server, or run `bun run dev` if port 3030 is
   not already listening.
2. Open `http://localhost:3030/demo/read-gates`.
3. Choose a capability and click **Hold a reader**. Confirm its live table row
   changes from `active / 0` to `active / 1`, then returns to `active / 0`.
4. Click **Hold a reader** again and then **Exercise close/reopen**. Confirm the
   row becomes `closing / 0`, showing that the held operation was signalled and
   drained.
5. While it is `closing`, open that capability's **Browse capability** link and
   confirm the warm “careful change” refusal. Open a different capability and
   confirm it remains usable.
6. After about 1.5 seconds, confirm the row returns to `active / 0` and the
   original capability is browsable again.

## Post-epic review hardening (2026-08-04)

An independent review of the closed epic found and fixed three things here:

- **A retired gate could be resurrected.** `tryAcquire` runs `synchronizeCatalog`, which
  re-created a gate `finalizeClose` had retired, so a caller holding a catalog captured
  before the commit could receive a live read token for a dropped table. Only call-site
  adjacency (catalog read and `tryAcquire` with no `await` between) made this
  unreachable. The coordinator now keeps a `retired` set that no catalog can override,
  cleared by `recoverAtBoot`; pinned by two tests in `src/read-gates/index.test.ts`.
- **A hung Handler made a capability permanently undeletable.** Read tokens released only
  in the router's `finally`, so a generated Handler that never settled pinned its token
  forever and every future `closeAndDrain` timed out — with "try again" copy that could
  never come true. Handler execution is now bounded
  (`src/router/generated-code.ts`, `DEFAULT_CAPABILITY_HANDLER_TIMEOUT_MS`, injectable
  per-router), and the mutation ports gained the ownership guard the query port already
  had, so an abandoned Handler cannot write after its route rolled back.
- **`ownershipId` was dead.** It was generated on every close lease and never read;
  ownership is enforced by lease object identity. Removed, along with the `createId`
  option that existed only to feed it.

Gate growth is now documented rather than pruned: `synchronizeCatalog` is legitimately
called with subsets, so pruning there would silently drop live gates. Superseded
incarnations leave a zero-reader gate until restart — bounded and harmless, unlike the
alternative.
