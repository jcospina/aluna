# `storage/` — object store (user file blobs)

Default local-filesystem backing for the platform's S3-shaped object store
(ARCH §6.3 "Object Store", §7 "Files"). Blobs are written here **at runtime** by
`Bun.write` and served by the platform `/files/:key` route via `Bun.file`.

```
storage/<key>   opaque-key-addressed blob (bytes only)
```

Bytes live here; the *reference* (storage key + mime + size + original name) lives
as a `file`-typed field in the owning capability's data table. The store is
platform infrastructure — the AI never builds storage. Swappable to R2 / S3 /
Garage by config without touching this layout.

## Tracking

This directory is tracked (via this README) so it exists in a fresh checkout, but
the uploaded blobs are **not** committed — see [`.gitignore`](../.gitignore).
