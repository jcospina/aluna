# An aggregate read leaves the connection able to see the next write

Status: done

## Epic

Module 6 — Reads Set Free · Epic 6.1 — What every collection holds
(ADR-0008: `modules/06-reads-set-free/PLAN.md`)

Filed under 6.1 because it surfaced here, in 6.1/02. It is platform data access rather
than collection chrome, and it blocks nothing in this epic — 6.1/02 shipped by reading
around it. It is filed against Module 6 because Module 6 is what will hit it.

## What to build

One call to `CapabilityQueryPort.all` pins the shared read-only connection to the moment
it ran. Every later read on that connection — including the `capability_registry` lookup
that resolves which artifacts a capability runs — answers from before any subsequent
commit, for the life of the process.

**It is a retained cursor, not an open transaction.** `database.inTransaction` is `false`
afterwards, and a *freshly prepared* statement on the same connection is stale too, while
a brand-new connection to the same file sees the write. So nothing is holding a `BEGIN`;
a cached statement is holding its read snapshot.

**The platform already knows this hazard and guards one path only.** `executeRecordQuery`
wraps its work in `withReadSnapshot` (`src/runtime/data/access/query-runtime.ts:164`),
which calls `clearQueryCache()` and brackets the work in `BEGIN`/`COMMIT` — and says why
in its own comment: "A cached `.get` statement can retain its last read snapshot until it
is reset." `all` (`src/runtime/data/tool.ts:131`) runs `executeProjectedQuery` with no such
bracket, so its cursor is never reset and the connection stays where it was.

```
none              inTransaction=false  label=CHANGED  OK
all               inTransaction=false  label=Notes    STALE
records           inTransaction=false  label=CHANGED  OK
all-then-clear    inTransaction=false  label=CHANGED  OK   ← clearQueryCache() releases it
```

**Reproduction**, as a standalone Bun script from the repo root:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./src/platform/persistence/db.ts";
import { runMigrations } from "./src/platform/persistence/migrations.ts";
import { createCapabilityQueryPort } from "./src/runtime/data/index.ts";
import { install, notesRow, rowSpec } from "./src/runtime/router/dispatch/router.test-support.ts";

const conns = openDatabase(join(mkdtempSync(join(tmpdir(), "port-")), "t.db"));
runMigrations(conns.readwrite);
install(conns, notesRow());
const port = createCapabilityQueryPort(conns.readonly, { target: rowSpec(notesRow()) });

port.all({
  sql: 'SELECT COUNT(*) AS "count" FROM "cap_notes"',
  result: [{ alias: "count", type: "number" }],
});

conns.readwrite.run("UPDATE capability_registry SET label = 'CHANGED' WHERE id = 'notes'");
// Prints "Notes". Swap the `all` for
//   port.records({ sql: 'SELECT "id" AS "target_id" FROM "cap_notes"' })
// or drop it, and it prints "CHANGED".
console.log(conns.readonly.prepare("SELECT label FROM capability_registry WHERE id='notes'").get());
```

**Why it matters more than it looks.** `dbReadonly` is a long-lived platform singleton every
concurrent read shares, and the registry lookup that resolves `artifacts_path` crosses it —
so a capability deleted and rebuilt at a new incarnation keeps serving its *previous*
artifacts. `query.all` is offered to generated Handlers by name in the generation contract
(`src/builder/units/generation/unit-prompts.ts:230`), so any capability whose model reaches
for an aggregate rather than `query.records` arms this. None of the 54 handler files on the
dev desk uses it today, which is the only reason the desk is not already showing it, and
Module 6's own `data_query` loop is an aggregate read loop.

**There is already a test that catches it.** Route `countCapabilityRecords`
(`src/runtime/data/access/record-count.ts`) through `port.all` and
`src/runtime/router/dispatch/router.views.test.ts` — "the default loader keys Bun imports by
incarnation path for a recreated semantic id" — fails, because the recreated capability
serves the first incarnation's handler. That is a good end-to-end check once `all` is fixed.

The likely fix is to give `all` the same `withReadSnapshot` bracket `records` has, but
confirm the mechanism rather than assuming it: find the statement that retains the cursor
(the scope check's `sqlite_master` read, its `EXPLAIN`, or `executeProjectedQuery`'s own
`statement.values`) and say which one it was.

## Acceptance criteria

- [x] A write committed on the read-write connection is visible to the next read on the
      read-only connection, after an `all` exactly as it already is after a `records`
- [x] The statement that was retaining the cursor is identified, and the fix is aimed at it
      rather than at the symptom
- [x] `records` keeps the snapshot semantics it has — a selection and its rehydration still
      read one consistent moment
- [x] A regression test asserts the visibility directly, and does not rely on the loader
      test noticing it second-hand
- [x] `countCapabilityRecords` moves onto the port and the paragraph in its header
      explaining why it could not is deleted
- [x] No generated artifact changes, and no capability is rebuilt for it
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Build a capability from the prompt bar, delete it, and build one with the same name again.
It should open on its new code. To see the failure first, temporarily route
`countCapabilityRecords` through `port.all` and run the loader test named above — it serves
the deleted incarnation's handler. The desk shows nothing today because no live capability
reaches for an aggregate read; the reproduction script above is the honest demo, and the
regression test is what keeps it fixed.

## Blocked by

Nothing.

## What landed

**The retaining statement is the scope check's own `EXPLAIN`**, not `all`'s projection —
`assertScopedQuery` in `src/runtime/data/access/query-runtime.ts`. An `EXPLAIN` (plain or
`QUERY PLAN`) is not reset by being stepped to the end the way an ordinary statement is, and
an unreset statement holds open the implicit read transaction that the *next* statement
opens. That is why the pin showed `inTransaction=false` and survived a freshly prepared
statement: nothing held a `BEGIN`, one statement was simply never released. Bisected against
a fresh WAL file per probe, and confirmed independently by a second agent:

```
STALE  EXPLAIN .all() / .get() / .values() / .run(), EXPLAIN QUERY PLAN, iterate() broken early
OK     SELECT .all()/.values()/.get(), .get() mid-scan, PRAGMA, sqlite_master, table-valued
       fns, a .all() that throws mid-scan, a fully consumed iterate(), a failed prepare()
OK     EXPLAIN prepared and finalized
```

Neither the statement cache nor `all`'s `statement.values` is implicated: an *uncached*
`prepare("EXPLAIN …").all()` without `finalize()` pins identically. **Finalizing is the
release.** `explainOpcodes` prepares the statement and finalizes it in a `finally`; using
`prepare` rather than `query` only keeps a statement used once out of the shared cache.

`records` was never affected because `withReadSnapshot` cleared the statement cache on its
way into its snapshot — which turns out to be load-bearing for a second reason, so it stays.
`BEGIN` inherits whatever snapshot the connection already sits on, so without the clear an
Action would be handed a moment older than its own call by any *other* read that left a
cursor open. Its comment blamed a cached `.get`; measurement disproved that, so the comment
now names the real mechanism. The margin is thinner than it looks:
`src/pipeline/evolution/assembly/length-scan.ts:141` runs `.iterate()` on `dbReadonly` and is
safe only because its loop body cannot `break`, `return` or throw.

**`countCapabilityRecords` now crosses `CapabilityQueryPort.all`** and the paragraph
explaining why it could not is gone. It costs the port's scope check per collection open —
four statements rather than one, ~43µs against a 500-row table, named in
`src/runtime/router/wire/collection-count.ts` where the hot-path cost is already recorded. A
count that cannot be read now throws rather than reporting zero records; the caller already
catches and renders no label, which is honest where "0" would be a visible lie.

No generated artifact changed and no capability was rebuilt.

## Findings fixed

Two review agents (correctness/adversarial and spec-conformance). Every finding is fixed,
INFO included.

- The `clearQueryCache()` deletion was a real regression: it heals a connection some *other*
  path pinned, and nothing covered it. Restored, comment corrected, and now tested.
- The record-query test asserted *bracketing* (which SQL ran while `inTransaction`), a
  structural proxy — it passed with the bug present. Rewritten behaviorally: a commit is
  landed between the selection and the rehydration, and the rehydration must not see it.
- The `explainOpcodes` doc blamed the statement cache and claimed `prepare` is "what makes it
  finalizable". Both false; rewritten.
- `collection-count.ts` still said "two statements" and "an unindexed scan" — it is four
  statements now, and it was always a covering-index scan.
- `record-count.ts` credited the port with spec validation and lease honouring, which the
  direct read already did; only the scoping is new.
- `record-count.ts` silently reported 0 when the count was absent. It throws.
- A test comment restated its own code instead of naming the non-obvious part: a pinned
  connection still answers the aggregate correctly, so the off-port read is the assertion
  with teeth.
- 6.1/02's "Carried out, not carried" section asserted the opposite of reality; retired under
  its `## Comments`. 6.1/01's description of the count's path updated.

## Verification

- `bun run test` — 2603 passed, 0 failed (74s). `bun run typecheck`, `bun run lint` clean.
- The issue's own reproduction script now prints `CHANGED` where it printed `Notes`.
- Every new test is load-bearing, checked by mutation. Restore the cached `EXPLAIN` and only
  "a committed write is visible to the next read after an aggregate query" fails; drop the
  `BEGIN`/`COMMIT` and only the two record-query tests fail; drop `clearQueryCache()` and only
  "a record query reads past a snapshot another read pinned to the connection" fails.
- The end-to-end guard the issue predicted holds: with the fix reverted and the count on the
  port, `router.views.test.ts` fails at "the default loader keys Bun imports by incarnation
  path for a recreated semantic id".
- A sweep of every real `dbReadonly` read path (`countCapabilityRecords`, `port.all`
  aggregate and projection, `port.records`, `selectCapabilityRows`,
  `readActiveRegistryCatalog`, both length-scan branches, three throwing paths) leaves the
  connection unpinned, 12/12.
- Live on `:3030`: the count sidecar renders through the port
  (`<!--aluna:count:22%20books-->`).
