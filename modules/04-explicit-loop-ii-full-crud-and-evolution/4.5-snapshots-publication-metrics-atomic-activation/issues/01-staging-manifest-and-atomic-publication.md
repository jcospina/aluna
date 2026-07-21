# Build-id staging, spec.json, snapshot.json, and atomic no-overwrite publication

Status: done

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

- [x] Every build stages under a unique build id; publication is atomic (same
      filesystem rename) and refuses to overwrite an existing `v<n>/`
- [x] `snapshot.json` verification: self-digest-free manifest, content digests
      for every other file, exact inventory; a tampered/missing file fails
      verification before publication
- [x] Tier-on vs tier-off snapshot content matches decision 24's shape
- [x] Plan acceptance: staging/publish fault injection — kill between staging
      and publish leaves no partial final directory; retry works without
      overwrite
- [x] `bun run reset` + build produces v1 under the manifest contract
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Build a capability, then view its published `v1/` through a dev preview (or
`ls` + manifest dump in the issue notes): `spec.json`, `snapshot.json`,
inventory and digests all present and verified.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.4-generate-and-gate-full-crud-v1/issues/05-final-reset-remove-transitional-shapes.md

## Implementation notes

- Added an artifact-lifecycle boundary that assembles exact `spec.json`, all six
  derived units, tier-on frozen tests, and platform-authored `snapshot.json`
  beneath a unique build-id staging directory. It verifies the exact inventory,
  every non-self SHA-256 digest, the aggregate snapshot fingerprint, and
  per-unit active-context/dependency provenance before publication.
- Publication uses a fully written unique owner file atomically linked as the
  version lock, verifies again immediately before one same-filesystem rename,
  and refuses any existing final directory. Dead or legacy malformed crash
  locks advance through a content-addressed lock lineage instead of being
  deleted, so concurrent recovery can never remove a new live owner. Existing
  path components must be real directories rather than symlink redirects.
- The Gate now issues opaque immutable verdict evidence, and publication binds
  every staged Handler and `item.ts` byte to that exact verdict. The registry
  commit accepts only immutable evidence issued by atomic publication, rechecks
  final bytes, exact `spec.json`, manifest identity, and the resolved final
  pointer before inserting the registry row.
- The build pipeline reuses one build/job id across staging, manifest, commit
  preview, and metrics. The developer preview shows the build id, verified
  status, snapshot fingerprint, behavioral tier, and complete file inventory.

## Verification record

- `bun test`: 598 passed, 0 failed; 2 snapshots and 2,758 expectations.
- `bun run typecheck`: passed for server and browser TypeScript programs.
- `bun run lint`: passed; 207 files checked.
- `bun run build`: passed; the Bun entrypoint bundled successfully.
- `git diff --check`: passed.
- Focused lifecycle/commit coverage proves tier-on/off shapes, opaque Gate
  evidence, post-Gate byte substitution refusal, tampered/missing/forged
  inventory refusal, exact spec and pointer binding, unique staging, injected
  pre-rename failure and retry, live/stale/empty lock behavior, symlink refusal,
  and empty/populated final-directory no-overwrite behavior.

## Living demo result

After the required `bun run reset`, the existing `localhost:3030` server built
and routed a fresh Notes v1. The live developer Commit preview and disk verifier
agree on:

- Incarnation: `53c94692-960e-4b3d-b1a6-6b12ad1863b7`
- Build: `build-c7869806-2574-4520-b092-efb686308e72`
- Snapshot fingerprint:
  `sha256:ae0d9400fa559e68e5a43cd7891b0c955c4d135904df5e3863bbc8a3c58ffaae`
- Behavioral tier: on
- Exact files: `create.ts`, `delete.ts`, `item.ts`, `read.ts`, `search.ts`,
  `snapshot.json`, `spec.json`, `tests/behavioral.json`, `update.ts`

The routed create flow saved and rendered `Manifest-backed note` with its note
text and `snapshot`, `verified` tags. That record remains in the demo for HITL.

## HITL test instructions

1. Keep the existing server on port 3030. If it is no longer running, run
   `bun run dev` from the repository root.
2. Open `http://localhost:3030/capability/notes`. Confirm the visible
   `Manifest-backed note` record, then create another Note and verify it appears
   through the routed create/read flow.
3. Open the developer panel and inspect Commit. Confirm `snapshotVerified` is
   `true`, behavioral tier is `on`, and the nine-file inventory above is shown.
4. From the repository root, run:
   `bun -e 'import { verifyCapabilitySnapshot } from "./src/builder/artifact-lifecycle.ts"; console.log(verifyCapabilitySnapshot("capabilities/notes/53c94692-960e-4b3d-b1a6-6b12ad1863b7/v1"))'`
5. Confirm the command returns the same build id, fingerprint, tier, spec id,
   and exact inventory without a verification error.
