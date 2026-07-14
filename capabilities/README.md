# `capabilities/` — generated capability snapshots

Runtime-generated, versioned capability code lives here (ARCH §6.2–§6.3;
ADR-0006). Module 4 gives each capability lifetime an opaque incarnation so
delete/recreate never reuses a dynamic-import cache path:

```text
capabilities/<id>/<incarnation_id>/
├── .staging/<build_id>/       unique, never routable
└── v<n>/                      immutable published snapshot
    ├── spec.json              exact committed authored spec
    ├── snapshot.json          inventory, digests, tier + audit provenance
    ├── item.ts
    ├── create.ts
    ├── read.ts
    ├── update.ts
    ├── delete.ts
    ├── search.ts
    └── tests/                 present only when that snapshot's tier is on
```

The Builder writes only to unique staging. After the Gate passes, the artifact
lifecycle verifies `snapshot.json` and atomically publishes to a final `v<n>/`
path with no overwrite. The registry's `artifacts_path` points only at a verified
published snapshot. `snapshot.json` is completeness evidence; the router still
loads the direct files under the one registry pointer—there are no overlays or
per-unit pointers. It lists itself in the inventory but omits its own digest; all
other files have content digests. Per derived unit it also records the exact
dependency incarnation/version, verified dependency snapshot content
digest/fingerprint, and active-context digest used when those bytes were last
generated. Copied units carry their original provenance forward. This is audit
evidence only—not authored spec, equality input, Diff fact, reverse-dependency
input, or cascade trigger.

## Recovery states

- A `.staging/<build_id>/` directory is incomplete/unpublished and never live.
- For an active incarnation at `vN`, every verified `v1..vN` is committed
  immutable history even though only `vN` is live. It is not an orphan merely
  because the registry points at a newer version.
- A verified published `v>N` that never activated is a complete failed-candidate
  orphan. Recovery needs positive evidence of non-activation before reclaiming it.
- A registry pointer whose snapshot is absent or fails its inventory/digests is
  corruption and must fail closed.
- Startup and pre-build reconciliation remove/quarantine only state proven never
  committed. They never overwrite a final version, reclaim committed history, or
  follow a path/symlink outside this configured root.
- Capability deletion records durable cleanup before removing snapshots. A pending
  deletion tombstone reserves the id/incarnation until idempotent cleanup finishes.

Handlers, `item.ts`, and tier-on tests are derived caches. Each version's
`spec.json` is authoritative authored history and `snapshot.json` is
platform-authored publication evidence; all committed files are immutable.
Nothing here is hand-edited or checked in. This README is tracked only so the
runtime root exists in a fresh checkout; generated contents remain ignored by
[`.gitignore`](../.gitignore).
