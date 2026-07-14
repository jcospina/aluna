# Per-Action read dependencies, id→canonical-row rehydration, and the search normalization function

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.2 — Mutation
coordinator, split tools, and complete routing Actions
(PLAN decisions 12, 13, and 20 (function):
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`; ADR-0006)

## What to build

The lifecycle-aware read side, closing epic 4.2 with its full tracer.

- **`read_dependencies` enforcement.** One key per Action, each a
  canonical-order unique array of strict `{ capability_id, incarnation_id }`
  pairs; each pair must resolve to one active registry row; self-dependency is
  implicit and rejected if listed. The query adapter permits arbitrary SQL over
  that committed catalog and rejects access outside it. The Gate observes the
  same catalog against scratch tables. Build the reverse-dependency index
  (deletion refusal consumes it in 4.9). Additive execution ABI: a committed
  Handler may keep reading an externally soft-hidden field (columns are never
  dropped by soft-hide), while **new** generation contexts see only the
  dependency's active projection; live and scratch adapters retain full
  physical columns for copied code.
- **Rehydration.** Generated `read`/`search` SQL may join other tables but
  returns ordered unique **target record ids**. On the same read-only
  snapshot, the query adapter re-fetches each id with a platform-owned full
  target-row projection and restores Handler order; missing, duplicate, or
  foreign ids fail. Handlers receive only the Action-safe active-field
  projection, declared query-result values, and an opaque record handle;
  canonical-row inactive fields and `extra` never cross the interface or enter
  the DOM. The presentation adapter narrows again to `item.shows` plus the
  actives needed for detail/edit and `created_at`.
- **Normalization function.** The one platform-owned SQL function used by all
  search matching: JavaScript `normalize("NFKC").toLocaleLowerCase("und")`
  over both query terms and stored values, registered on the connection.
  The reference capability's hand-written `search` uses it (the full
  adversarial baseline fixture lands in 4.4).

## Acceptance criteria

- [ ] A declared cross-capability read succeeds; an undeclared one is rejected;
      a listed self-dependency is rejected; pairs must resolve to active rows
- [ ] Dependency compatibility (plan acceptance): an old declared reader still
      executes after an external field is soft-hidden, while new model contexts
      omit that field
- [ ] Rehydration: order restored; missing/duplicate/foreign ids fail; an old
      explicit projection cannot omit a newly added column; inactive/`extra`
      never reach Handler input or the DOM (pinned by tests)
- [ ] The normalization function matches composed vs decomposed non-ASCII text
      and non-ASCII case where SQLite `NOCASE`/`lower()` would not
- [ ] Epic tracer on the reference capability: create → read → partial update →
      search → delete; a read-port write fails physically; the paused-build
      race from 4.2/01 passes against the full route set
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

A second dev capability declares a read dependency on the reference capability
and renders joined data on its View; the reference capability's search route
returns normalized matches via curl.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.2-mutation-coordinator-split-tools-and-routing-actions/issues/01-atomic-mutation-coordinator.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.2-mutation-coordinator-split-tools-and-routing-actions/issues/05-record-targeted-merge-update-and-delete.md
