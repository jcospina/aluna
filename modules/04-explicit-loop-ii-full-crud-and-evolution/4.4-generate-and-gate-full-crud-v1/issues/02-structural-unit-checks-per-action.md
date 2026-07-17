# Structural unit checks per Action over the whole snapshot

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.4 — Generate and
Gate full-CRUD v1 capabilities
(PLAN decisions 11 (checks) and 12, epic text:
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`; ADR-0004)

## What to build

Extend the Gate's structural/static rung so no generated Handler can bypass
the split toolbox, across the complete five-unit snapshot.

- No Handler can emit raw mutation SQL: canonical writes only through the
  supplied mutation adapters; a mutation attempt through the query port is
  already physically impossible, and the static check rejects the known
  textual/structural bypasses (direct imports, connection access, dynamic
  import) before execution.
- Every Action may use the read-only query interface only over its **declared**
  read-dependency catalog; undeclared table access in generated SQL is
  rejected at the Gate against the same scratch catalog the live adapter
  enforces.
- Structural validation covers the whole snapshot: all five Handlers,
  `item.ts`, and the spec inventory — not just the units that happened to be
  exercised by smoke.
- Generated execution remains in-process; this is accidental-output
  protection, not hostile-code containment (decision 11).

## Acceptance criteria

- [x] A fixture Handler with raw `INSERT`/`UPDATE`/`DELETE`/DDL fails the
      structural rung with a per-unit, actionable failure
- [x] A fixture Handler importing anything, touching the connection, or
      querying an undeclared table fails; the same SQL over a declared
      dependency passes
- [x] The rung runs over every unit of every candidate snapshot regardless of
      which units were regenerated
- [x] Gate failures repair per-unit within ADR-0003's bounded repair loop
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Not directly user-visible; the dev Gate preview (existing `/demo` Gate surface)
shows the structural rung's pass/fail per unit for the latest build. Note the
rung output there when closing.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.4-generate-and-gate-full-crud-v1/issues/01-generate-five-handlers-and-item-renderer.md

The implementation dependency is present and verified. Issue 01's separate
real-provider full-CRUD human sign-off remains `ready-for-human` and is not
redefined by this structural issue.

## Implementation notes

- Unit generation and the Gate now share one source-safety contract. Each
  Handler is checked for static export shape, isolated typing, imports and
  ambient-runtime bypasses, raw HTTP, direct connection access, raw mutation
  SQL, and Action-scoped query-table access.
- Query-table validation resolves literal, concatenated, and statically
  resolvable template SQL passed through `query.all` or `query.records`, follows
  renamed/aliased query ports, and fails closed when query SQL cannot be
  inspected statically. It compares against the same canonical target and
  declared-dependency table names used by the runtime query scope.
- Connection validation follows renamed Handler contexts and toolbox aliases,
  including destructured and computed access, while allowing ordinary result
  fields named `database`, `db`, `sqlite`, or `connection`.
- Raw mutation detection covers `INSERT`, `UPDATE`, `DELETE`, and DDL variants
  including unique indexes, temporary tables, and virtual tables. AST-based
  inspection avoids treating guidance comments as executable SQL or HTTP.
- The structural rung evaluates the complete candidate inventory and returns a
  stable result for `spec.json`, `item.ts`, and every advertised Handler. A
  shared TypeScript program attributes diagnostics per Handler without paying
  for five separate compiler runs.
- Passing Gate previews now carry the complete per-unit structural result.
  Failing structural errors attach the same result as a developer diagnostic,
  so the existing build-error preview identifies every implicated unit.
- The bounded generation loop receives the dependency catalog and repairs only
  the rejected Handler; accepted sibling units are not regenerated.

## Verification

- `bun test` — 536 passing, 0 failing, 2 snapshots
- `bun run typecheck` — application and browser TypeScript configurations clean
- `bun run lint` — 190 files checked, no fixes
- `git diff --check`
- Focused structural Gate suite — 13 passing, covering every raw-write family,
  imports/runtime bypasses, connection access, declared and undeclared tables,
  complete inventory, per-unit diagnostics, and ordinary ambient-looking field
  names.
- Focused adversarial unit checks — DDL modifiers, comment false positives,
  composed SQL, renamed query/context ports, computed connection access, and
  legitimate connection-named result fields all pinned.
- Builder-stage demo test — the Gate preview contains passed outcomes for
  `spec.json`, `item.ts`, `create.ts`, `read.ts`, `update.ts`, `delete.ts`, and
  `search.ts` before commit.
- Existing `http://localhost:3030` server was reused for a real-provider build.
  The candidate reached Gate and failed closed without committing; no fallback
  server or reset was used. The deterministic builder-stage demo remains the
  successful complete-preview proof for this turn.

## HITL test instructions

1. Reuse the app already running on port 3030. If it is not running, start it
   with `bun run dev`; do not reset the existing runtime data.
2. Open `http://localhost:3030`, submit a unique prompt such as **“Track workshop
   inspections with a title, findings, and completion status”**, and wait for
   the build to finish.
3. Open the `</>` developer panel and inspect the latest **Gate** preview.
4. Confirm `structural.units` lists `spec.json`, `item.ts`, `create.ts`,
   `read.ts`, `update.ts`, `delete.ts`, and `search.ts`, each with
   `status: "passed"`, before the smoke/behavior/design results. The capability
   should commit only after all seven structural outcomes pass.
5. For the fail-closed proof, run
   `bun test src/builder/gate.structural.test.ts -t "attributes every raw write"`.
   Confirm all five Action fixtures pass the test because Gate reports the
   poisoned Handler as `failed` with an actionable raw-mutation message.
