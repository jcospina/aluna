# Build-id staging, spec.json, snapshot.json, and atomic no-overwrite publication

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.5 — Incarnated
snapshots, publication, metrics, and atomic activation
(PLAN decisions 24 (shape) and 26:
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`; ADR-0006
immutable snapshots and publication)

## What to build

Staged, verified, atomic, no-overwrite artifact publication. The epic begins
with a greenfield reset so v1 is born under this contract (no 4.4 pre-manifest
directory is recut, mutated, or retained as history).

- Each build writes to a unique **same-filesystem** build-id staging
  directory. The artifact-lifecycle module writes every required file
  (all five Handlers, `item.ts`, exact `spec.json`, frozen tests when the tier
  is on), computes `snapshot.json`, verifies inventory/digests and Gate
  success, then atomically publishes to the final
  `capabilities/<id>/<incarnation_id>/v<n>/` path without overwriting an
  existing path.
- `snapshot.json` records capability incarnation, version, build id,
  behavioral tier, exact file inventory, and audit-only per-derived-unit
  dependency-generation provenance (exact dependency incarnation/version,
  verified dependency snapshot content digest/fingerprint, and active-context
  digest used when those bytes were last generated; copied units carry their
  original provenance forward). The manifest lists itself **without** a
  self-digest and records content digests for every other file. Provenance is
  audit evidence only — never authored spec, equality input, Diff fact, or
  cascade trigger.
- A tier-off snapshot contains no behavioral-test artifacts; a tier-on
  snapshot contains the frozen tests.
- Only a verified published snapshot may become a registry pointer. Direct
  writes into final version directories and recursive “make it exist” commits
  are forbidden.

## Acceptance criteria

- [ ] Every build stages under a unique build id; publication is atomic (same
      filesystem rename) and refuses to overwrite an existing `v<n>/`
- [ ] `snapshot.json` verification: self-digest-free manifest, content digests
      for every other file, exact inventory; a tampered/missing file fails
      verification before publication
- [ ] Tier-on vs tier-off snapshot content matches decision 24's shape
- [ ] Plan acceptance: staging/publish fault injection — kill between staging
      and publish leaves no partial final directory; retry works without
      overwrite
- [ ] `bun run reset` + build produces v1 under the manifest contract
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Build a capability, then view its published `v1/` through a dev preview (or
`ls` + manifest dump in the issue notes): `spec.json`, `snapshot.json`,
inventory and digests all present and verified.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.4-generate-and-gate-full-crud-v1/issues/05-final-reset-remove-transitional-shapes.md
