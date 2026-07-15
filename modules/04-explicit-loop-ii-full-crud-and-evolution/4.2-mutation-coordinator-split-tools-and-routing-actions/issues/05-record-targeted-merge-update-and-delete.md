# Record-targeted merge update and delete

Status: done

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

- [x] Epic tracer cases: hidden (inactive) values and `extra` survive a partial
      update; an old row missing a new required value cannot be saved
- [x] Update/delete cannot substitute the validated target (pinned by test);
      unknown/inactive/platform keys are rejected
- [x] Preserve-vs-clear is unambiguous: omitted active values preserved,
      submitted-empty clears, explicit `null` clears only optional actives
- [x] Missing target returns the stable `record_not_found` failure and writes
      nothing, for both update and delete
- [x] Post-merge requiredness uses the one total-by-type definition over the
      complete resulting record
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Curl a partial update and a delete against the reference capability: the
response and a follow-up read show merged values, preserved hidden
data/`extra`, and the warm not-found failure for a bogus target.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.2-mutation-coordinator-split-tools-and-routing-actions/issues/04-five-action-reference-capability-and-scratch-adapters.md

## Implementation notes

- Split capability mutation authority into create, target-bound update, and
  target-bound delete ports. Update/delete expose no target selector to generated
  code; the router binds the validated target before loading the Handler.
- Update snapshots the submitted-field set at the platform boundary, rejects
  unknown/inactive/platform/unsubmitted keys, merges only submitted active
  values, validates the complete resulting active record, and writes only the
  submitted columns. Inactive values, `id`, `created_at`, and `extra` remain
  untouched and outside the returned Action-safe projection.
- Update/delete share the platform-owned `RecordNotFoundError` with stable
  `record_not_found` code. The router maps it to warm HTTP 404 product copy.
- The five-Action reference now seeds stable merge, historical-null, and delete
  targets and its authored update/delete Handlers exercise the real ports.
- Gate structural declarations now type-check generated update/delete Handlers
  against their Action-specific contexts. The Gate-backed app failure suite uses
  the repository's existing 15-second timeout convention because its valid
  behavioral failure path consistently exceeds Bun's 5-second default.

## Verification

- `bun test` — 460 passing, 0 failing, 2 snapshots
- `bun run typecheck`
- `bun run lint`
- `git diff --check`
- Focused mutation/router/demo/Gate run — 25 passing, 0 failing
- Live `localhost:3030` probes after `bun run demo:five-action-reference`:
  partial update HTTP 200 with hidden/`extra` preservation, exact-target delete
  HTTP 200, and bogus update/delete HTTP 404 with `record_not_found`.
- In-app browser: opened **Journal entry**, observed the merged record with its
  preserved tags, and confirmed no browser console errors.

## HITL test instructions

1. Reuse the app server on port 3030 (or run `bun run dev` if it is not already
   running), then run `bun run demo:five-action-reference`.
2. Open `http://localhost:3030`, choose **Journal entry**, and confirm the seeded
   **A quiet beginning** record is visible.
3. Run:

   ```sh
   curl -i -X POST http://localhost:3030/capability/field_lifecycle_demo/update \
     --data-urlencode 'entry=A changed beginning' \
     --data-urlencode '__aluna_present=entry' \
     --data-urlencode '__aluna_record_id=merge-target'
   curl -s http://localhost:3030/capability/field_lifecycle_demo/read
   sqlite3 -json data/omni-crud.db \
     'SELECT entry,reflection,tags,aliases,retired_note,extra FROM cap_field_lifecycle_demo WHERE id="merge-target";'
   ```

   Confirm HTTP 200, the read shows **A changed beginning** with the original
   tags, and SQLite still shows the original reflection, aliases, hidden
   `retired_note`, and `extra`.
4. Run the delete and missing-target tracers:

   ```sh
   curl -i -X POST http://localhost:3030/capability/field_lifecycle_demo/delete \
     --data-urlencode '__aluna_record_id=delete-target'
   curl -i -X POST http://localhost:3030/capability/field_lifecycle_demo/update \
     --data-urlencode 'entry=Missing' \
     --data-urlencode '__aluna_present=entry' \
     --data-urlencode '__aluna_record_id=bogus-target'
   ```

   Confirm delete returns HTTP 200 with **That entry is gone.**, while the bogus
   update returns HTTP 404 with `data-error-code="record_not_found"`.
5. Re-run `bun run demo:five-action-reference`, then update `historical-null`
   with only `reflection` submitted. Confirm HTTP 422 names missing required
   fields `entry tags`, and SQLite shows the reflection was not changed.
