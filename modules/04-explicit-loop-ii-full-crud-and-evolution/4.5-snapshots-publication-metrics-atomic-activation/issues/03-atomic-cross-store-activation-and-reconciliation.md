# Atomic cross-store activation and boot/pre-build reconciliation

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.5 — Incarnated
snapshots, publication, metrics, and atomic activation
(PLAN decision 27: `modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`;
ADR-0006)

## What to build

Cross-store activation ordered around one exact point of no return.

- Order: publish the complete final directory first, then — in **one SQLite
  transaction** — apply the additive migration, compare-and-swap the registry
  spec/version/pointer on expected incarnation/version, and finalize the
  metrics row `success/activated`. That commit makes the capability live and
  committed history authoritative; a stale CAS writer fails.
- A database failure before the commit leaves a never-activated complete
  candidate, never a live partial snapshot. A presenter, client, or transport
  failure after it cannot roll back the pointer, relabel the build as failed,
  or restore the prior version; the registry is the recovery authority.
- For an active incarnation at version N, verified `v1..vN` are committed
  immutable history (each `spec.json` authoritative) even though only vN is
  live. Only staging or `v>N` candidates (or directories with no
  active/tombstoned incarnation) may be reconciled, and only after positive
  proof they never activated. Missing/corrupt `v1..vN` is historical
  corruption and fails closed. Historical dependency pairs validate shape and
  digest, not current liveness. Retry may reuse `vN+1` only after its
  never-activated occupant is removed.
- Boot and pre-build reconciliation implement exactly those rules.

## Acceptance criteria

- [x] Fault injection at every seam (plan acceptance): failure before the
      transaction leaves prior version live and candidate reconcilable;
      failure inside rolls back all three effects together; failure after
      commit leaves the new pointer + `success/activated` authoritative
- [x] CAS: a stale writer (wrong expected incarnation/version) fails without
      touching the pointer
- [x] Reconciliation removes only proven never-activated staging/`v>N`;
      committed `v1..vN` retained; missing/corrupt history fails closed with a
      clear error
- [x] Retry after a failed build reuses `vN+1` only after its occupant is
      removed; no overwrite path exists
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Not directly user-visible beyond builds continuing to work. The live developer
preview reports the current build lifecycle and may be empty after reload; it is
not a persisted history or registry inspector. The issue notes record an
automated fault-injection run showing v1 surviving a failed v2 attempt.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.5-snapshots-publication-metrics-atomic-activation/issues/02-durable-generation-metrics-lifecycle.md

## Implementation notes

- Build work now generates and Gates against scratch state, publishes the
  complete verified snapshot, and only then opens the short activation
  transaction. Additive DDL, exact registry insert/CAS, and lifecycle
  `success/activated` finalization share that transaction and commit point.
- Activation re-verifies the published bytes immediately before database work.
  The registry CAS requires the exact expected capability incarnation and
  version; zero changed rows is a stale-writer error.
- Boot and mutation-lease-head reconciliation share one fail-closed
  implementation. It verifies every committed `v1..vN` plus the live pointer
  before planning cleanup, validates historical dependency provenance without
  a current-liveness lookup, and removes only staging or `v>N` candidates with
  positive failed/interrupted lifecycle proof.
- Tombstones, unknown entries, symlink aliases, live locks, stale lock owners,
  and content-addressed lock generations are never broadly swept. Stale lock
  recovery remains the publication protocol's responsibility, so a retry can
  safely advance without overwrite after reconciliation removes a proven
  candidate.
- Committed-version inventory is covered by the automated activation and
  reconciliation evidence; HITL does not treat the transient developer panel as
  a persisted registry inspector.
- Runtime reset coverage now clears both legacy generation metrics and the
  durable lifecycle table so the greenfield reset contract remains complete.

## Verification record

Verified 2026-07-21 (America/Bogota):

- `bun test`: 631 passed, 0 failed; 2 snapshots and 2,895 expectations across
  63 files.
- `bun run typecheck`: passed.
- `bun run lint`: passed across 218 files.
- `bun run build`: passed; 303 modules bundled.
- `git diff --check`: passed.
- Focused independent adversarial pass: 36 activation, reconciliation,
  publication, and app tests passed with no remaining actionable finding.
- Fault injection proves that failures before the activation transaction keep
  v1 live and leave the complete v2 candidate reconcilable; failures after
  DDL, CAS, or metrics finalization roll all three effects back; a failure after
  commit leaves v2 and `success/activated` authoritative. Wrong-incarnation and
  wrong-version writers leave the pointer untouched.
- Reconciliation coverage retains verified v1/v2 history, fails closed for
  missing or corrupt history, preserves tombstones and all lock forms, rejects
  symlink aliases, recovers retryable stale-lock publication, removes only
  positively proven candidates, and is idempotent on retry.
- Live read-only check against the existing `http://localhost:3030`: the
  homepage returned the existing capabilities and `/capability/notes` remained
  usable with its existing record. A subsequent human-run build of
  `experiment_journal` reached `success/activated` and its capability worked;
  an empty developer panel after reload is expected.

## HITL

1. Run `bun test src/builder/activation.test.ts src/builder/artifact-reconciliation.test.ts`.
   The command should finish with all focused fault-injection and recovery tests
   passing.
2. Keep the existing dev server on port 3030. If none is running, run
   `bun run dev` from the repository root; do not start a second port.
3. Open `http://localhost:3030` and open **Notes** from the capability rail. The
   route should load its existing records normally, confirming the active v1
   pointer and retained snapshot are still usable.
4. With provider credentials configured, try the prompt `I want to track
   houseplant watering`. A successful build should finish activation, add the
   new capability to the rail, open its working surface, and end the live
   developer preview with `lifecycleStatus: "success"` and `outcome:
   "activated"`. The streamed lifecycle row does not contain `liveVersion`, and
   the developer panel may be empty after reload because previews are transient.
   If a test-injected pre-commit seam fails instead, the prior live capability
   remains unchanged and the focused tests show the candidate becomes safely
   retryable after reconciliation.
