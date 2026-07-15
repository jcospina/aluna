# Split toolbox: scoped mutation adapters and the read-only query port

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.2 — Mutation
coordinator, split tools, and complete routing Actions
(PLAN decision 11: `modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`;
ADR-0004 split injected tools)

## What to build

Split the injected Handler toolbox into constrained mutations and free reads.

- **Mutation authority.** `create` receives mutation authority bound to the
  target capability (update/delete gain record-target binding in 4.2/05).
  These adapters are the only path to canonical writes. Generated Handlers
  choose no table, capability, or record target. Cross-capability rejection
  applies only to mutation.
- **Query port.** Every Action may receive the distinct query interface for
  capability behavior; `read | search` necessarily use it. It accepts arbitrary
  parameterized `SELECT`/joins and is backed exclusively by a **physically
  read-only** SQLite connection. Each call declares a closed ordered result
  descriptor (alias/type); the adapter returns only those aliases, discards
  extra SQL result columns, and fails on missing/duplicate/type-invalid
  declared values — so `SELECT *` can never make a later additive column
  observable to old generated code. A write attempted through the query port
  fails physically.
- Live and scratch adapters satisfy the same interfaces (scratch data arrives
  with the reference capability in 4.2/04).

## Acceptance criteria

- [x] Cross-capability mutation is unrepresentable through the supplied
      mutation interface (no parameter names another table/capability)
- [x] A write attempted through the query port fails physically (read-only
      connection), pinned by a test
- [x] Result descriptors: extra columns discarded; missing, duplicate, or
      type-invalid declared values fail; `SELECT *` returns only declared
      aliases
- [x] Existing create/read Handlers run through the split adapters; Handlers
      still import nothing (ADR-0004)
- [x] Gate practice toolbox uses the same split interfaces
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Existing prompt-built capabilities keep working on the homepage through the
split toolbox — same visible behavior, new seams underneath (note this in the
issue when closing; the visible proof is no regression plus the physical
read-only failure in tests).

## Implementation notes

- Replaced the combined Handler data tool with distinct `CapabilityMutationPort`
  and `CapabilityQueryPort` interfaces. Create receives a capability-bound
  `mutation.create(values)` surface with no table/capability/record selector;
  read receives no mutation authority.
- The query port accepts parameterized SQL on the injected physically read-only
  SQLite connection. Every call supplies an ordered alias/type descriptor; the
  adapter returns keys in that order, drops undeclared columns (including from
  `SELECT *`), and rejects missing, duplicate, or type-invalid declared values.
- The router, generated-unit prompts/static contracts, hand-written fixtures,
  Field lifecycle tracer, smoke Gate, and behavioral Gate now construct and use
  the same split interfaces. Gate execution continues to use its synthetic
  shared-memory read-write/read-only pair.
- No new UI was needed: this is a seam replacement beneath the current homepage
  flow. Reinstalling the idempotent Field lifecycle tracer refreshed its
  generated v1 artifacts to the split contract; the user-owned server on port
  3030 then returned its live `read` fragment successfully.

## Verification

- `bun test src/capability-data/tool.test.ts`
- `bun test src/router/router.test.ts src/builder/units.test.ts src/builder/gate.test.ts src/builder/gate-design-lint.test.ts`
- `bun test` (438 passing)
- `bun run typecheck`
- `bun run lint`
- `git diff --check`
- `bun run demo:field-lifecycle`
- `curl http://localhost:3030/capability/field_lifecycle_demo/read` (HTTP 200 through the refreshed split-port artifact)

## HITL test instructions

1. Run `bun run demo:field-lifecycle`, then reuse the app server on port 3030
   (or run `bun run dev` if it is not already running).
2. Open `http://localhost:3030`, reload, and choose **Field lifecycle** from the
   capability toolbar.
3. Open **New Field lifecycle**. Enter an event, enter
   `fantasy, historical fiction, classic` in **Tags**, and enter `Doe, Jane` as
   one **Other names** value. Submit with **Add**.
4. Confirm the new item appears without an error, open it, and verify the three
   tags render separately while `Doe, Jane` remains one value. Reload and confirm
   the record still appears. This exercises scoped create mutation followed by
   the physically read-only descriptor-projected read through the real router.

## Blocked by

None — can start immediately (parallel to 4.1; epic order applies).
