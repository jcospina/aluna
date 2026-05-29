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

All four platform stores — capability registry, event log, data tables, and
generation metrics (ARCH §6.3) — live inside this single database file.

## Tracking

This directory is tracked (via this README) so it exists in a fresh checkout, but
the database file and its sidecars are **not** committed — see
[`.gitignore`](../.gitignore). The db is created at this location on first run if
it does not exist.
