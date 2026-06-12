# Commit & rollback

Status: ready-for-agent

## Epic

Module 2 — Explicit Loop I: Build Your First Capability · Epic 2.5 — Capability
builder + global serial build queue (`docs/modules.md` §2.5, ARCH §6.2 step 5,
§9.5, PLAN flow steps 7–8 & failure path:
`modules/02-explicit-loop-i-build-your-first-capability/PLAN.md`)

## What to build

The pipeline's terminal stage — the atomic moment a build becomes real, and the
clean exit when it doesn't.

- **Commit = one pointer flip.** Write the version-1 artifacts (handler files +
  views) to the capability's version directory, insert the registry row pointing
  at it, and flip the pointer as a single atomic step. Then hand the commit
  fragments to the job's stream — the client-side swap (content area + toolbar
  out-of-band) is epic 2.6's issue; this issue produces a committed capability
  and the stream events that announce it, ending with `done`.
- **Commit is unreachable unless the full gate passed.** With the behavioral
  tier ON by default, that means structural, smoke, *and* behavioral rungs —
  fail-closed end to end (owner's decision: commit is blocked behind the
  behavioral tier issue, so no intermediate state ever commits on a partial
  gate).
- **Rollback on any failure**, at any stage: roll back the migration
  transaction, orphan any written files for GC (never half-register them),
  leave **nothing** in the registry, stream a warm product-voice apology, and
  close with `done`. A failed build never creates a capability and never bumps
  a version.
- **Metrics either way.** The build's metrics row is written **before the job
  ends** on both success and failure — failure is data (ARCH §9.6).

## Acceptance criteria

- [ ] A successful build leaves artifacts in the version directory, a registry
      row at version 1 with the artifacts pointer, and a capability immediately
      usable through the router
- [ ] Commit cannot be reached with any active gate rung unpassed (behavioral
      tier ON by default included)
- [ ] Any failure rolls back the migration, orphans files harmlessly, leaves no
      registry row, and streams a warm apology before `done`
- [ ] The metrics row is written before the job ends on both outcomes, complete
      per the metrics schema (timings, rungs, attempts, tokens, outcome)
- [ ] An end-to-end test with a fake provider goes prompt → committed capability
      → create/read through the router; no test calls a real provider

## Blocked by

- modules/02-explicit-loop-i-build-your-first-capability/2.5-capability-builder-and-build-queue/issues/03-migration-derive-and-apply.md
- modules/02-explicit-loop-i-build-your-first-capability/2.5-capability-builder-and-build-queue/issues/05-structural-and-smoke-gate-on-scratch-db.md
- modules/02-explicit-loop-i-build-your-first-capability/2.5-capability-builder-and-build-queue/issues/06-behavioral-tier.md
- modules/02-explicit-loop-i-build-your-first-capability/2.7-metrics-writing/issues/01-metrics-table-and-writer.md
