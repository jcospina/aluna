# One question, one whole-catalog read scope: the complete token set or nothing

Status: done

## Epic

Module 6 — Reads Set Free · Epic 6.2 — The ephemeral whole-catalog read
(PLAN decisions 2, 11; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

The main-thread scope that hands Aluna the whole active catalog for the length of
one question and takes it back afterwards.

**The complete per-incarnation read-token set is acquired atomically against one
catalog snapshot, or not at all**, and released in `finally` — the existing
contract in `src/runtime/concurrency/read-gates.ts`, used unchanged. One
immutable active-registry view is captured before any query work begins, and the
scope owns every incarnation in it or owns none of them. A question that half-owns
the catalog would read one capability across a deletion of another, which is the
race the gate exists to make impossible.

**Ownership never enters the worker** (decision 11). The scope lives beside the
gate on the main thread; 6.2/01's worker is only where SQL executes, and it is
handed statements, not authority.

**Disposable by nature, not by policy** (decision 2). The scope creates no
registry row, no logo, no version, no artifact, no cache, no persisted read
dependency and no conversation thread. The same question asked twice opens two
scopes and runs twice. This is the module's single exception to *everything is
cached*, and it is an exception in the direction of less state — a test sweeps the
platform stores before and after a scope and proves nothing was added.

**Release is unconditional.** The scope releases in `finally`, so a failed
statement, a thrown error and a cancelled question all leave the gate with no
readers rather than with a leaked token that would later fail somebody's
deletion.

## Acceptance criteria

- [x] A query scope acquires the complete per-incarnation token set for one
      captured catalog snapshot, or acquires nothing and fails
- [x] The snapshot is captured once, before any query work, and the scope reads
      no capability outside it
- [x] Tokens are released in `finally` on every exit — success, throw and cancel
- [x] The worker never receives a token, an incarnation id or the catalog
- [x] No registry, version, artifact, cache, `read_dependencies` row or
      conversation state exists after a scope closes, proved by a store sweep
- [x] The same question opened twice acquires and releases twice, with nothing
      reused between them
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Headless; the module is still invisible until 6.5. Exercise it by running this
issue's tests, in particular the store sweep — it is the deterministic form of the
plan's *no registry row, version, artifact, cache or read dependency was created
by any of it*, and it is cheaper to run here than to check by eye at the end.

## Blocked by

- modules/06-reads-set-free/6.2-the-ephemeral-whole-catalog-read/issues/01-the-query-worker-and-its-own-read-only-connection.md

## What landed

- `src/runtime/query/whole-catalog-read-scope.ts` — `withWholeCatalogReadScope(deps, body)`.
  One `readActiveCatalog` call captures the immutable active registry view, every row in it
  becomes a `CapabilityIncarnation`, and that same set is passed as both the catalog and the
  requested set to the existing `ReadGateCoordinator.withTokens` — so the complete set is
  acquired against one snapshot or `ReadGateUnavailableError` is thrown having acquired
  nothing. The scope hands the body `catalog`, `incarnations` (the set the gate granted),
  `signal` and `read(sql, parameters)`. `WholeCatalogReadScopeDeps` carries the seams:
  `readGates`, and optional `database`, `readActiveCatalog` and `createWorker`.
- **The worker is started on the first statement and closed in `finally`.** A question that
  runs no SQL starts no thread, and the ordering is close-then-release, so `close()` always
  runs before the gate is told there are no readers left. A `close()` that throws does not
  replace the failure the question reported.
- **Two guards seal the end of the window**, and both are the scope's rather than the
  gate's: an `over` flag refuses a read arriving after the body returned (ownership only
  ends a microtask later, in `withTokens`' own `finally`), and an ownership re-check after
  the worker answers refuses rows whose incarnation began closing while they were being
  read.
- `src/runtime/query/store-sweep.test-support.ts` — the platform store sweep, lifted out of
  6.2/01's test file and now shared by both query suites, plus a per-table contents digest
  and `sweepPlatformArtifacts()` for a baseline taken before any scope has opened.
- `src/runtime/query/whole-catalog-read-scope.test.ts` — 18 tests.
  `src/runtime/query/query-worker.test.ts` consumes the extracted sweep; `src/runtime/data/index.ts`
  re-exports `assertReadOwnership`, which this scope is the first consumer of outside
  `runtime/data`.
- No registry, artifact or generated code changed, and nothing new is reachable from
  `src/index.ts` — `bun run build` still emits no reference to the worker thread.

## Findings fixed

Two review agents (adversarial and spec-conformance). Every finding is fixed, INFO and
pre-existing included.

**A read could start a Worker the scope would never close, after the gate had already
counted it as drained.** `worker?.close()` runs in this module's `finally`; the token
release runs in `withTokens`' own, one microtask later. A read landing in that gap passed
the signal check, found `worker` undefined, and started a fresh thread — which, proved end
to end, went on executing SQL after a blocked deletion had drained and dropped the table,
and kept the process alive on its own. The `over` flag closes it, and a test sweeps five
microtask hop counts asserting no worker outlives the scope.

**A read already in flight when its gate closed handed its rows back.** The ownership check
only ran before dispatch, and for a single-statement question that meant the abort was
observed by nothing at all. There is now a re-check after the worker answers.

**The test that claimed the worker was gone proved nothing about the worker.** It called
`scope.read`, which refuses on released ownership before the thread ever comes into it, so
deleting `worker?.close()` entirely left it green. It now asks the worker itself, and a
second test asserts the released-ownership refusal by type.

**The store sweep could not see the state decision 2 most wants excluded.** Two ways: a
cache is keyed to a *stable* path, and the sweep's baseline was captured after ten earlier
tests had each opened a scope, so a fixed-filename write was already in `before` and swept
clean; and `read_dependencies` is a column on `capability_registry`, not a table, so a
persisted read dependency would move no row count. Fixed with a file-level artifact baseline
taken before any scope opens, asserted in `afterAll`, and a per-table contents digest —
both proved by mutation.

**An abandoned read took the process down.** A body that starts a read and returns without
awaiting it gets that promise rejected by `close()`; with no subscriber that is an unhandled
rejection. The scope now attaches its own ignoring subscriber, which hides nothing from a
caller's `await` — the same move `query-worker.ts` already makes for its open.

**A `close()` that threw replaced the body's error with its own.** Now swallowed, because a
thread that will not end is not what the caller needs to hear about while its own failure is
on the way out.

**Comments that were not true.** The header claimed the thread executing SQL is "gone"
before the release, which is exactly the belief 6.2/01 measured false — `terminate()`
reclaims the thread only when the statement ends. And both this module and
`query-worker-thread.ts` attributed decision 6's table bound to an SQLite authorizer needing
FFI, where PLAN decision 6 names `assertScopedQuery`'s `EXPLAIN`-opcode enumeration and says
it generalises without change. Both corrected; the second is 6.2/01's text, fixed there too.

**One capability in `closing` refuses every question, not only its own.** Whole-catalog
atomicity is what this issue asks for, so this is recorded in the module header beside
decision 13's residual risk rather than engineered away: for the length of a drain (up to
`DEFAULT_READ_DRAIN_TIMEOUT_MS`) an unrelated question fails. The router is not exposed this
way because it asks for one target and its dependencies. Turning that into a sentence Aluna
says rather than a raw `ReadGateUnavailableError` belongs to 6.4 and 6.6.

**Smaller ones.** `WholeCatalogReadScopeDependencies` renamed to `…Deps`, the repo's only
naming for a dependency bag. `assertReadOwnership` is now imported through
`runtime/data`'s barrel instead of reaching past it. `database` is typed
`PlatformDatabase["readonly"]`. `PlatformStoreSweep.stores` is typed instead of `unknown`,
which had left every `toEqual` between two sweeps unchecked. A test pins that
`scope.incarnations` is the set the *gate granted* — a reversed snapshot comes back in the
gate's canonical order — because exposing the pre-acquisition array instead had left every
test green. The factory is asserted to be called with no arguments.

**Not a defect, recorded.** A body that never settles holds its tokens and times the drain
out — decision 13's residual risk, working as written.

## Verification

- `bun run test` — 2638 pass, 0 fail; `bun run typecheck` and `bun run lint` clean
- `bun run test src/runtime/query` — 35 pass across 2 files
- Nine mutations, each turning exactly the intended test red: removing `worker?.close()` (6
  tests), the `over` guard (the microtask-gap sweep), the pre-dispatch ownership check (the
  released-ownership refusal), the post-await ownership check (the in-flight rows), the
  abandoned-read subscriber (the unhandled-rejection test), the `close()` try/catch (the
  replaced-failure test), exposing the pre-acquisition array (the granted-set test), the
  sweep's contents digest (the store sweep), and writing a fixed-name file into `artifacts/`
  from inside a scope (the `afterAll` baseline)

## Comments

**2026-09-04 — `capabilityIncarnation` and `ActiveCatalogReader` moved to their real homes.**
This issue originally reached into `runtime/router/admission/read-admission.ts` for the
row-to-gate-identity mapping and recorded at the import that the home was arguably wrong.
It was: `capabilityIncarnation` now lives beside `CapabilityIncarnation` in
`src/runtime/concurrency/read-gates.ts`, typed structurally (`{ id, incarnation_id }`) so
that module still depends on nothing, and `lifecycle/logo/storage/recovery.ts`'s private
duplicate is collapsed onto it. `ActiveCatalogReader` could not follow it there — it names
an `ActiveRegistryCatalog`, which read-gates must not import — so it moved the other way,
to `src/registry/store/active-catalog.ts` beside the `readActiveRegistryCatalog` whose
signature it describes, and is exported from the registry barrel. The scope's `database`
seam lost a `as Database` cast in the process. Behaviour unchanged; suite green.

**2026-09-04 — the last bullet of *What landed* stopped being true, and 6.3/01 is why.** It
read *"nothing new is reachable from `src/index.ts` — `bun run build` still emits no
reference to the worker thread."* Both halves are now false: `createApp` registers
`/demo/question`, which reaches `runDataQueryTurn` and through it this scope, and the
bundle does emit `new URL("./query-worker-thread.ts", import.meta.url)` — `scripts/build.ts`
copies the thread beside it and `scripts/build.test.ts` asserts the name the bundle asks for
is the name that is there. The bullet is left as written because it is a dated record of
what landed here; this comment is where it stops being a live claim.

**The scope's default worker also moved.** It opened `DB_PATH` whatever connection the
scope had been handed, which was invisible while every caller passed `createWorker`. It now
opens `(deps.database ?? dbReadonly).filename`, so a scope given a scratch connection cannot
answer from the product's database. Pinned in `question-turn.test.ts` by a turn that injects
no worker factory.
