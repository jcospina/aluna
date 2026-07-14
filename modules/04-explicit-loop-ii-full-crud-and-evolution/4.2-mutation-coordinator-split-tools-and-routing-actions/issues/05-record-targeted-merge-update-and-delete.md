# Record-targeted merge update and delete

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.2 — Mutation
coordinator, split tools, and complete routing Actions
(PLAN decisions 14, 15, and 3 update-side:
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`)

## What to build

Update as a record-targeted **merge patch** (never replacement) and
target-bound delete, with the mutation interface as the sole authority for
structural write invariants.

- The router binds the update/delete mutation adapter to the single validated
  record target before generated code runs; neither the marker nor the id is
  writable Handler input, and the Handler cannot substitute another record.
- Target-bound update: rejects unknown, inactive, and platform keys; loads the
  scoped row; merges only submitted active values; preserves omitted active
  values, every inactive value, `id`, `created_at`, and `extra`; validates the
  resulting active record (full post-merge logical requiredness — decision 3);
  persists; retains the canonical result inside platform code, exposing only
  the Action-safe active projection/record handle. `extra` is preserved and
  not directly patchable in M4.
- Presence semantics on update: absent from the submitted set means preserve;
  submitted-empty explicitly clears (empty optional scalar → `null`, unchecked
  boolean → `false`, empty list → `[]`). Explicit `null` clears only an
  optional active field.
- One platform-stable `record_not_found` typed failure for update/delete owned
  by the mutation interface (never duplicated in the authored spec); a missing
  target writes nothing. Target-bound delete uses the same validated target and
  not-found contract.
- Handlers still own capability behavior: they may normalize input, apply
  stronger intent-derived rules, and translate typed failures into product
  voice, but cannot bypass or weaken platform invariants.

## Acceptance criteria

- [ ] Epic tracer cases: hidden (inactive) values and `extra` survive a partial
      update; an old row missing a new required value cannot be saved
- [ ] Update/delete cannot substitute the validated target (pinned by test);
      unknown/inactive/platform keys are rejected
- [ ] Preserve-vs-clear is unambiguous: omitted active values preserved,
      submitted-empty clears, explicit `null` clears only optional actives
- [ ] Missing target returns the stable `record_not_found` failure and writes
      nothing, for both update and delete
- [ ] Post-merge requiredness uses the one total-by-type definition over the
      complete resulting record
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Curl a partial update and a delete against the reference capability: the
response and a follow-up read show merged values, preserved hidden
data/`extra`, and the warm not-found failure for a bogus target.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.2-mutation-coordinator-split-tools-and-routing-actions/issues/04-five-action-reference-capability-and-scratch-adapters.md
