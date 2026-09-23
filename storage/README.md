# `storage/` — object store (user file blobs)

Default local-filesystem backing for the platform's S3-shaped object store
(ARCH §6.3 "Object Store", §7 "Files"). Blobs are written here **at runtime** by
`Bun.write` and served by the platform `/files/:key` route via `Bun.file`.

```
storage/<key>             opaque-key-addressed blob (bytes only)
storage/.incoming/<key>   an upload not yet renamed into place (emptied at boot)
```

Bytes live here; the *reference* (storage key + kind + verified mime + size +
original name) lives as a `file`-typed field in the owning capability's data table,
and the platform's file ledger is the one place ownership is asserted
([ADR-0009](../docs/adr/0009-files-platform-admission-and-the-file-ledger.md)). The store is
platform infrastructure — the AI never builds storage. Swappable to R2 / S3 /
Garage by config without touching this layout.

Each key is exclusively owned by one capability incarnation/record/field in the
PoC. A file streams into `.incoming/` with no ledger row, gets its row as
`pending` once admitted, and only then is renamed into place; a failed
create/update changes nothing, so its pending references stay with the open form,
while replacement/removal and record deletion enqueue cleanup, and capability deletion
collects both active and inactive file fields before dropping the table. Whole-
capability deletion also absorbs pending ownership and already-enqueued cleanup
for the target incarnation into the durable tombstone manifest; keys are
deduplicated without losing incarnation ownership. Cleanup is idempotent, so an
already-absent key is success rather than a second failure, and it unlinks
`.incoming/<key>` before `<key>` so a racing rename cannot leave bytes behind.

## Tracking

This directory is tracked (via this README) so it exists in a fresh checkout, but
the uploaded blobs are **not** committed — see [`.gitignore`](../.gitignore).
