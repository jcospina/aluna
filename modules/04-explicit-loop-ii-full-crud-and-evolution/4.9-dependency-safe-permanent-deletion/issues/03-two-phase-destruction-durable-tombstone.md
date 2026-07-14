# Two-phase destruction with a durable tombstone

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.9 — Dependency-safe
permanent capability deletion
(PLAN decisions 34 (destruction) and 25 (recreation):
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`)

## What to build

Deletion as a durable two-phase lifecycle, not pretend cross-store atomicity.

- After the deletion lease is admitted, the per-incarnation read gate goes
  `active → closing` and drains (4.9/01). Destruction begins only with a
  proven zero reader count.
- While the table still exists, platform cleanup adapters collect a
  deduplicated owned-resource manifest, **including inactive fields**.
- In one SQLite transaction: the registry row becomes a non-routable deletion
  tombstone carrying that manifest, capability-owned Event Log payloads are
  purged/redacted when M7 is installed (fake seam in 4.9/04), and the table is
  dropped. That commit is deletion's point of no return; the gate can never
  reopen after it.
- After commit: idempotent adapters delete version artifacts and external
  resources; then the tombstone is removed. Crash/failure after commit leaves
  the capability logically gone with durable cleanup work; boot recovery
  retries it. The tombstone reserves id/incarnation until cleanup completes,
  preventing a recreated capability from racing stale cleanup.
- **UI is not optimistic.** Before tombstone commit, the committed
  toolbar/View remains authoritative; refusal, timeout, or pre-commit failure
  reopens reads and restores the canonical View. At commit the capability
  becomes logically absent: toolbar entry/routes disappear; if it was active,
  content becomes the neutral surface. Later cleanup failure cannot resurrect
  the deleted surface.
- **Recreation.** After cleanup completes, the same semantic id may be created
  again with a new incarnation and path — executing new v1 Handler code, never
  a Bun-cached deleted module.

## Acceptance criteria

- [ ] Plan acceptance: deletion failure before/after the database point of no
      return — pre-commit failure reopens reads and restores the canonical
      View; post-commit crash leaves it logically gone and boot retries
      cleanup idempotently
- [ ] Deterministic pre-/post-tombstone UI pinned: authoritative View before,
      neutral surface/absent toolbar after, no resurrection on cleanup failure
- [ ] Owned-resource manifest collected pre-drop includes inactive-field
      resources; keys deduplicated and incarnation-bound
- [ ] Module-acceptance step 7: recreate the deleted capability — new
      incarnation, new path, new v1 code (not a cached module)
- [ ] Tombstone reserves id/incarnation until cleanup completes; recreation
      during pending cleanup is refused
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean
- [ ] **Human sign-off**: full permanent-delete + recreate flow on the running
      app (module-acceptance steps 6–7)

## Living demo

Delete a dependency-free capability: toolbar entry vanishes, content falls to
the neutral surface, and recreating it by prompt yields a visibly fresh v1 at
a new incarnation path (dev preview shows both incarnations' metrics).

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.9-dependency-safe-permanent-deletion/issues/02-deletion-lease-reverse-dependency-refusal-and-confirmation.md
