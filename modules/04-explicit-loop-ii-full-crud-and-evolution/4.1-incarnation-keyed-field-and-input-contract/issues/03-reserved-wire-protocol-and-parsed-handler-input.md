# Reserved __aluna_ wire protocol and parsed Handler input

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.1 — Incarnation-keyed,
evolution-ready field and input contract
(PLAN decision 6: `modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`;
ADR-0004 parsed Handler input)

## What to build

One closed HTTP protocol for repeated values, edit presence, and record
targets. Generated code never sees raw HTTP or platform marker keys.

- **Reserved namespace.** Spec field names may not use the `__aluna_` prefix;
  candidate/spec validation rejects them.
- **Parsed Handler input.** Handlers receive a values map of
  `string | readonly string[]` plus a platform-validated submitted-field set.
  Repeated query/form keys preserve arrival order. Singleton scalar controls
  remain scalar; spec-known list fields normalize to an array even with one
  value. Duplicate scalar input fails deterministically rather than silently
  choosing one value.
- **Presence markers.** Platform create forms emit repeated `__aluna_present`
  values for every rendered active field; the router validates and strips them.
  Create treats every rendered active field as submitted: an empty optional
  scalar becomes `null`, an unchecked boolean `false`, an empty list `[]`
  (list type lands in 4.1/04); required empties fail decision 3's validation.
- **Record-target marker seam.** The router-side parsing/validation for
  `__aluna_record_id` lands now: edit/delete forms must emit exactly one
  nonblank value; missing, duplicate, or unexpected target markers fail before
  generated code. Create rejects a record target. (The update/delete routes
  that consume the bound target arrive in 4.2.)

## Acceptance criteria

- [x] A spec field named with the `__aluna_` prefix is rejected at validation
- [x] Handler input is the values map + submitted-field set; marker keys are
      stripped before generated code runs
- [x] Repeated keys arrive as an ordered array; a spec-known list field with one
      value normalizes to a one-element array; a scalar field stays scalar
- [x] Duplicate scalar input fails deterministically with a warm error
- [x] Create presence semantics: empty optional scalar → `null`, unchecked
      boolean → `false`; required empties fail with the structured error
- [x] Missing, duplicate, or unexpected `__aluna_record_id` markers fail before
      any generated code; create rejects a record target
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The platform create form on the homepage emits `__aluna_present` markers for
every rendered active field, and submitting it exercises the presence
semantics live. A curl with a duplicated scalar key shows the deterministic
warm failure.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.1-incarnation-keyed-field-and-input-contract/issues/02-field-labels-lifecycle-nullable-storage-requiredness.md

## Implementation notes

- The router now owns one closed parser for all five eventual M4 Actions. It
  preserves arrival-order multiplicity, normalizes spec-known list fields to
  arrays, rejects duplicate scalars and unknown reserved keys, validates
  submitted-field markers, and returns the record target separately from Handler
  input. Update/delete target binding remains owned by 4.2.
- Handler input is `{ values, submittedFields }`, where values are
  `string | readonly string[]`. Reserved marker keys never enter either member.
  Generated-unit prompts, structural declarations, Gate smoke/behavioral inputs,
  fixtures, and the field-lifecycle living demo all use the same contract.
- Platform create forms emit one `__aluna_present` hidden input for every rendered
  active field. Create requires the exact active-field marker set, so an unchecked
  boolean is distinguishable from an omitted field and an empty optional scalar is
  explicitly clearable. Inactive fields are not marked or admitted.
- Spec validation has an explicit `__aluna_` reserved-prefix rule. Parser tests
  pin the next issue's `string[]` singleton/repeated behavior without admitting
  that field type into the spec before 4.1/04.
- Duplicate scalar and record-target protocol failures return a warm,
  internals-free HTTP 400 before item-renderer or Handler loading.

## Verification

- Focused router, wire-protocol, registry, presentation, Builder, Gate, demo, and
  app tests: 145 pass, 0 fail
- `bun test` — 391 pass, 0 fail, 2 snapshots
- `bun run typecheck`
- `bun run lint`
- `git diff --check`
- `bun run demo:field-lifecycle` installed
  `capabilities/field_lifecycle_demo/30fcc47d-cc95-401a-ab5f-0c8afa5f20c0/v1/`
- Live browser verification on the existing `localhost:3030` server: the create
  form contained `__aluna_present=entry` and `__aluna_present=reflection`;
  whitespace-only required input showed the warm structured error while the form
  stayed open; a valid create with an empty reflection added the record and stored
  `reflection` as `NULL`.
- Live duplicated-scalar curl returned HTTP 400 with the warm protocol error and
  wrote no record.

## HITL test instructions

1. Run `bun run demo:field-lifecycle`, then reuse the server on port 3030 (or
   start it with `bun run dev`).
2. Open `http://localhost:3030/`, choose **Field lifecycle**, and open
   **New Field lifecycle**.
3. Enter only spaces in **What happened?** and select **Add**. Confirm the warm
   “I still need a little more” message appears, the form stays open, and no
   record is added.
4. Enter a real **What happened?**, leave **A small reflection** empty, and select
   **Add**. Confirm the form closes and the new item appears.
5. Run:
   `curl -i -X POST http://localhost:3030/capability/field_lifecycle_demo/create -H 'content-type: application/x-www-form-urlencoded' --data-urlencode 'entry=one' --data-urlencode 'entry=two' --data-urlencode '__aluna_present=entry' --data-urlencode '__aluna_present=reflection'`
   Confirm HTTP 400 and the warm “couldn't make sense” response; no item is added.
