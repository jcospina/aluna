# `data/` — SQLite database file location

The canonical, single documented home for the platform's `bun:sqlite` database
(ARCH §4, §6.3). Both the read-write and read-only connections (Epic 1.4) open
against the **same file**:

```
data/omni-crud.db
```

This is the one convention later epics build on — there is exactly one path. SQLite
may create sidecar files next to it at runtime (`-wal`, `-shm`, `-journal`); those
live here too.

All four domain stores—capability registry, Event Log, data tables, and generation
metrics—plus small platform lifecycle metadata for mutation ownership, reader
gates, file ownership/cleanup, and deletion tombstones (ARCH §6.3) live inside
this single database file.

## Tracking

This directory is tracked (via this README) so it exists in a fresh checkout, but
the database file and its sidecars are **not** committed — see
[`.gitignore`](../.gitignore). The db is created at this location on first run if
it does not exist.

## Search-normalization runtime

The platform registers `platform_search_normalize(value)` on every generated-query
connection. Its SQLite bridge is compiled once into the operating-system temp
directory and calls the canonical case- and Latin-accent-insensitive JavaScript
implementation: NFKD decomposition, locale-independent lowercase, Latin-base
combining-diacritic folding, then NFKC recomposition. Marks on non-Latin bases are
preserved.

This requires a C compiler and SQLite extension headers. On macOS, Bun otherwise
uses Apple's extension-disabled SQLite, so install extension-capable SQLite with
`brew install sqlite`. The runtime discovers the standard Apple Silicon and Intel
Homebrew paths; set `OMNI_CRUD_SQLITE_LIBRARY` to the full `libsqlite3.dylib` path
when SQLite is installed elsewhere.
