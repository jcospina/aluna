# An aggregate read leaves the connection able to see the next write

Status: ready-for-agent

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

- [ ] A write committed on the read-write connection is visible to the next read on the
      read-only connection, after an `all` exactly as it already is after a `records`
- [ ] The statement that was retaining the cursor is identified, and the fix is aimed at it
      rather than at the symptom
- [ ] `records` keeps the snapshot semantics it has — a selection and its rehydration still
      read one consistent moment
- [ ] A regression test asserts the visibility directly, and does not rely on the loader
      test noticing it second-hand
- [ ] `countCapabilityRecords` moves onto the port and the paragraph in its header
      explaining why it could not is deleted
- [ ] No generated artifact changes, and no capability is rebuilt for it
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Build a capability from the prompt bar, delete it, and build one with the same name again.
It should open on its new code. To see the failure first, temporarily route
`countCapabilityRecords` through `port.all` and run the loader test named above — it serves
the deleted incarnation's handler. The desk shows nothing today because no live capability
reaches for an aggregate read; the reproduction script above is the honest demo, and the
regression test is what keeps it fixed.

## Blocked by

Nothing.
