# Owned-resource cleanup seam fakes and the deletion fault battery

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.9 — Dependency-safe
permanent capability deletion
(PLAN decision 35: `modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`)

## What to build

The cleanup seam that pre-pays Module 6 (files) and Module 7 (Event Log),
proven with fakes, plus the epic's consolidated fault battery.

- **Artifact collector/cleaner.** M4's real contribution: collect and delete
  version artifacts idempotently (an already-absent resource is success).
- **Fake owned-resource acceptance adapter (M6 seam).** Proves the manifest
  absorbs every target-incarnation file lifecycle state before table drop:
  committed references from active **and inactive** `file | file[]`-shaped
  fields, pending ownership, and already-enqueued cleanup. Keys deduplicated
  and incarnation-bound through tombstone cleanup.
- **Event Log fake (M7 seam).** Event ownership provenance is derived
  server-side from admitted route/query/read-token context and canonical
  payload production; client- or model-supplied incarnation labels are never
  trusted. Ingestion validates and appends the complete derived set atomically
  only while every pair remains active/current — a late pre-deletion batch
  cannot resurrect purged data.
- Generation metrics are explicitly outside this seam.
- **Fault battery (plan acceptance).** Before/after DB commit, partial cleanup,
  restart, same-id recreation with a new incarnation, read-token
  timeout/reopen, late stale Event Log ingestion, path traversal/symlink
  rejection in artifact cleanup, and repeated (idempotent) cleanup.

## Acceptance criteria

- [ ] The fake resource adapter proves absorption of committed, pending, and
      already-enqueued cleanup states before table drop; keys deduplicated,
      incarnation-bound
- [ ] The Event Log fake proves server-derived provenance (spoofed labels
      ignored) and atomic late-batch rejection once any pair is closing/gone
- [ ] Artifact cleanup rejects path traversal and symlink escapes; repeated
      runs are idempotent; absent resources succeed
- [ ] The full fault battery is green and each case is listed in the issue's
      verification notes
- [ ] Generation metrics survive every deletion scenario
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Not user-visible beyond deletion continuing to work; the dev preview lists the
collected manifest and cleanup progress for the last deletion (including the
fake adapters' absorbed states), demonstrating the M6/M7 seams are real.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.9-dependency-safe-permanent-deletion/issues/03-two-phase-destruction-durable-tombstone.md
