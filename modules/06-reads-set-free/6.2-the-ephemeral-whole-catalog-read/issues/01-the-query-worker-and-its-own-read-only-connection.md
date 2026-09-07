# The query worker opens its own read-only connection, and a write through it still fails

Status: done

## Epic

Module 6 — Reads Set Free · Epic 6.2 — The ephemeral whole-catalog read
(PLAN decisions 6, 7; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

A Worker that holds its own `SQLITE_OPEN_READONLY` connection to the one
documented database file (`DB_PATH`, `data/omni-crud.db`) and executes one
parameterized read at a time on behalf of the main thread. Nothing calls it from
a prompt yet; this issue is the seam and the proof that the seam survived the
move.

**Why it moves off the main thread at all.** `bun:sqlite` is synchronous and
`src/platform/persistence/db.ts` opens on the main thread, so a clumsy join
across three capabilities would block the event loop for its whole duration —
no request served, no stream advancing, the desk frozen — while returning a
single row that no result-size bound could ever catch. Decision 7 admits the
worker; this issue is what makes the admission true in the repo rather than in a
measurement.

**The move is admissible only because the safety seam survives it**, so the two
facts decision 7 measured on Bun 1.3.12 become tests here, not prose:

- a write attempted through the worker's connection fails at the SQLite seam with
  *attempt to write a readonly database* — decision 6's blast radius is zero by
  construction, and it is still zero one thread away;
- the main thread stays live while the worker runs a pathological query. Decision
  7's measurement was 39 ticks against an expected 40 during two seconds of a
  runaway recursive query; the test asserts liveness, not that exact number.

**The worker is whole-catalog, and that is a different shape from a generated
Handler's read.** `query.records` in `src/runtime/data/access/query-runtime.ts`
requires a target capability scope and produces records to present. A question
crosses capabilities and returns aggregates, so this tool returns rows, not
record handles, and does not borrow the per-capability scoped record path.

**The worker holds no ownership.** It never receives a read token, never learns
which incarnations it is reading, and never decides whether a read is allowed —
that all stays on the main thread and lands in 6.2/02 (decision 11). The worker
is only where SQL executes.

## Acceptance criteria

- [x] A Worker opens a read-only connection against the one documented database
      file and returns rows for a parameterized statement issued from the main
      thread
- [x] A write attempted through that connection fails at the SQLite seam, proved
      by test rather than asserted in a comment
- [x] The main thread remains responsive while the worker runs a pathological
      query, proved by a test that fails if the query runs in-process
- [x] The worker receives no read token and no incarnation identity
- [x] Nothing the worker does creates registry, version, artifact, cache or
      `read_dependencies` state
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Headless. Nothing on the desk changes and nothing new is reachable from a prompt:
the module becomes visible in 6.5, which is stated up front in the plan's epic
order rather than discovered late. Exercise it with a focused run of this issue's
tests, and read the liveness assertion — it is the one that would have caught a
frozen desk.

Epic 6.1 is independent of this branch and does not gate it; a collection count
and a query worker share nothing.

## What landed

- `src/runtime/query/query-worker-thread.ts` — the Worker thread. Opens its own
  `SQLITE_OPEN_READONLY` connection against the path it is handed, refuses the statement
  forms that leave that file behind, then runs one parameterized statement per message and
  posts rows back. Prepares and finalizes each statement rather than using the connection's
  statement cache, since a question's SQL is written once and never asked again.
- `src/runtime/query/query-worker.ts` — the main-thread side. `createQueryWorker(path =
  DB_PATH)`, `read(sql, parameters)`, `close()`, and a `QueryWorkerError` family
  (`Statement`/`Busy`/`Closed`) in the shape of `ReadGateError`. One read at a time; a
  second concurrent read is refused rather than queued.
- `src/runtime/query/query-worker.test.ts` — 17 tests.

## Findings

**`SQLITE_OPEN_READONLY` is not the seam on its own.** It means "cannot write *this*
database", which is narrower than it reads. Through a read-only connection, `VACUUM INTO`
wrote a complete copy of the catalog to an arbitrary path, `CREATE TEMP TABLE` spilled
293 MB to disk, and `ATTACH DATABASE` opened and read any other SQLite file on the machine
— the last of which `PRAGMA query_only` does not stop, and none of which the first draft
refused. The connection now opens `query_only`, and the worker refuses
`ATTACH`/`DETACH`/`PRAGMA`/`VACUUM`/`REINDEX`/`ANALYZE` and multi-statement SQL at the
seam, mirroring `RAW_MUTATION_SQL_PATTERN` in `builder/units/safety/handler-source-safety.ts`.
Refusing `PRAGMA` is load-bearing: without it `PRAGMA query_only = OFF` reopens everything.

**`terminate()` does not stop a running statement, which decision 10 assumes it does.**
Measured on Bun 1.3.12: after `terminate()` returned, the thread went on burning 2.98s of
CPU over the next 3s of a runaway query, and a `process.exit` issued during one waited for
the statement to finish. `terminate()` reclaims the thread when the statement ends;
interrupting the statement itself needs `sqlite3_interrupt` through FFI against
`Database.handle`. Recorded in `query-worker.ts` because 6.2/03 is built on this.

**The SQLite runtime loads once per process, not per thread.** `configureSqliteRuntime()`
throws `SQLite already loaded` from the worker, so the thread does not call it and inherits
the library the main thread pinned; a `sqlite_version()` parity test asserts that rather
than trusting it (on macOS it has teeth — Bun ships 3.51.0, the pinned build is 3.53.1).

**`platform_search_normalize` cannot be registered on this connection yet, and trying
segfaults the process reproducibly.** The guard in `assertExtensionAbiMatchesRuntime` keys
off `sqliteLibraryPath`, which `configureSqliteRuntime` assigns *after* `setCustomSQLite` —
and that call throws on the worker thread, so the path stays unset whatever the thread
does, the ABI check silently skips itself, and the extension compiles against the system
headers while Homebrew's library is loaded. A generated search's SQL will fail here with
*no such function* until the epic that needs it gives the thread the pinned path without
re-pinning it. Pinned by a test so the day it changes is deliberate.

**A throw at the thread's module scope surfaces only through `worker.onerror`** — without
it every read waits forever on a thread that is already dead.

**Bun's bundler leaves `new URL("./query-worker-thread.ts", import.meta.url)` as written**,
so a bundled `dist/` build would look for the thread beside `dist/index.js`. Nothing
imports the worker yet, so `dist` is unaffected; recorded in the code for whoever first
makes it reachable from the server.

## Verification

- `bun run test src/runtime/query` — 17 pass
- `bun run test` — 2620 pass, 0 fail; `bun run typecheck` and `bun run lint` clean
- The liveness assertion discriminates: the same query in-process fired **0** heartbeats
  against the test's floor of 10, and held 47/50 under 32 spinners on 16 cores.

## Comments

**2026-09-04 — the store sweep moved, and the authorizer note was wrong.** 6.2/02 needed
the same no-state proof, so this issue's `sweep` helper now lives in
`src/runtime/query/store-sweep.test-support.ts` and is shared by both query suites;
`query-worker.test.ts` consumes it and asserts exactly what it did before, with a per-table
contents digest added. Separately, this issue's `query-worker-thread.ts` header said
decision 6's table bound "needs `sqlite3_set_authorizer` through FFI". PLAN decision 6 names
`assertScopedQuery`'s `EXPLAIN`-opcode enumeration instead, and says it generalises to a
whole-catalog scope without change; the comment is corrected. An authorizer is still
unavailable through `bun:sqlite`, which is why that half was written — it is just not the
mechanism the plan points at.

**2026-09-04 — the bundler finding is resolved, by the issue it was addressed to.** It ended
*"whoever first makes the worker reachable from the server has to ship the thread alongside
it"*, and 6.3/01 is that: `/demo/question` runs a question turn, so `src/index.ts` now
reaches this file. Bun still emits the specifier exactly as written — dropping `.href` does
not make it follow the worker either — so `scripts/build.ts` copies
`query-worker-thread.ts` beside the bundle, which works precisely because this thread
imports `bun:sqlite` and nothing else. `scripts/build.test.ts` asserts the copy is there,
that the bundle asks for that exact name, and that the thread has grown no relative import
the copy could not resolve.

**The table bound the header pointed at is built.** `query-worker-thread.ts` recorded that
bounding a statement to the catalog's *tables* — as opposed to the connection's own file —
was "the loop's to wire up in 6.3/01". It is `assertWholeCatalogQuery` in
`src/runtime/query/whole-catalog-query-scope.ts`.
