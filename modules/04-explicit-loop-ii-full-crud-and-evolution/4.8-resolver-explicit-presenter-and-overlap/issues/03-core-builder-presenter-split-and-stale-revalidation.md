# Core Builder / explicit presenter split and stale revalidation

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.8 — Resolver,
explicit presenter, active context, and overlap
(PLAN decisions 31 and 28 (stale rows):
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`; ADR-0002;
ADR-0006)

## What to build

Explicit-loop foreground presentation becomes an adapter over a reusable core
Builder — the seam Module 7's implicit loop will consume.

- The core Builder accepts an already-resolved build request and emits
  lifecycle events without owning the prompt route, active DOM, or SSE.
  Existing-capability work binds exact
  `{ capability_id, incarnation_id, expected_version }`; new-capability work
  binds the proposed semantic id plus an expected-absent condition. Both also
  bind the resolver's active-catalog revision/fingerprint.
- The coordinator revalidates target and catalog after active lease
  acquisition. A target, expected-absence, or catalog mismatch fails **stale**
  — never silently rebased, retargeted, or reclassified against a newer
  catalog, and it starts no provider work. While ownership is held, it writes
  one direct terminal admission row with
  `lifecycle_status=failed, outcome=stale` and all generation stages skipped;
  its incarnation is the expected incarnation for evolution, nullable only for
  a new-capability stale refusal before incarnation assignment.
- The M2–M4 explicit adapter resolves a typed prompt, occupies the active
  content area, and narrates the foreground product-voice story, emitting one
  View `commit`. Module 7 may hand an already-resolved confirmed proposal to
  the same Builder without reclassification and choose a different presenter;
  mutation, staging, Gate, activation, and metrics remain identical. Document
  the reuse seam.

## Acceptance criteria

- [ ] The core Builder is invocable without the SSE presenter (test-driven
      with a fake presenter), producing identical mutation/Gate/activation
      behavior
- [ ] Plan acceptance: stale target/collision/catalog-fingerprint refusal
      starts no provider work and writes the durable direct `failed/stale` row
      with the specified incarnation semantics
- [ ] Expected-version mismatch never reaches the canonical no-op comparison
      (distinct `failed/stale` vs `success/no_change`)
- [ ] A concurrent registry change between resolution and lease head produces
      the stale refusal and a warm foreground story with canonical View
      restoration
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Race two prompts against the same capability from two tabs: the second's build
fails stale with a warm story and restored View, and the dev metrics preview
shows its direct `failed/stale` row with stages skipped.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.8-resolver-explicit-presenter-and-overlap/issues/01-non-mutating-prompt-job-and-resolver-separation.md
