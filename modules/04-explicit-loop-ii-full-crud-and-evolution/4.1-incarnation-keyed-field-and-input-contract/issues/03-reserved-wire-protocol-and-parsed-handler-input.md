# Reserved __aluna_ wire protocol and parsed Handler input

Status: ready-for-agent

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

- [ ] A spec field named with the `__aluna_` prefix is rejected at validation
- [ ] Handler input is the values map + submitted-field set; marker keys are
      stripped before generated code runs
- [ ] Repeated keys arrive as an ordered array; a spec-known list field with one
      value normalizes to a one-element array; a scalar field stays scalar
- [ ] Duplicate scalar input fails deterministically with a warm error
- [ ] Create presence semantics: empty optional scalar → `null`, unchecked
      boolean → `false`; required empties fail with the structured error
- [ ] Missing, duplicate, or unexpected `__aluna_record_id` markers fail before
      any generated code; create rejects a record target
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The platform create form on the homepage emits `__aluna_present` markers for
every rendered active field, and submitting it exercises the presence
semantics live. A curl with a duplicated scalar key shows the deterministic
warm failure.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.1-incarnation-keyed-field-and-input-contract/issues/02-field-labels-lifecycle-nullable-storage-requiredness.md
