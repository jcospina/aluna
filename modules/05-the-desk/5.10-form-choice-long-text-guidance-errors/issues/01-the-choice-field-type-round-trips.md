# The choice field type carries its declared values, end to end

Status: ready-for-agent

## Epic

Module 5 — The Desk · Epic 5.10 — The form: choice, long text, guidance and
in-field errors
(PLAN decision 27 (the type itself): `modules/05-the-desk/PLAN.md`)

## What to build

The field vocabulary gains a **choice** type that carries its declared values.

The scalar field types extend and the spec's field schema gains a `values` array,
which **forces** the DDL mapper, both total switches in the field renderer and the
generator prompt to handle it — the field-type union's own comment names this as
the designed extension path, so the compiler does the work of finding every
consumer. That is the point of the design: nothing can quietly skip the new type.

This is the thin end-to-end path, but it starts with the final storage shape so
5.10/02 does not invalidate specs built here. Each option is an object with a
stable nonblank `value` (the stored wire value) and a nonblank user-facing
`label`. Values are unique and canonically ordered as authored. The final option
object shape already reserves optional `group`, `note` and `disabled` keys, which
this slice leaves absent, and every choice field emits an ordered `groups: []`
collection so 5.10/02 can populate group declarations without another field-shape
cut. A non-choice field may carry neither `values` nor `groups`.
`ui_intent.form.choice_inputs` also lands now with one
entry per active choice field in schema order and `presentation: "picker"` as the
only admitted value. 5.10/02 expands the closed presentation enum and exercises
the reserved metadata without another persisted-shape cut.

No reset is allowed this late in the module: logo credits and user records now
exist. Registry parsing therefore treats the newly added form-intent collections
(`choice_inputs`, and the empty collections 5.10/03 will consume) as canonical
empty values when absent from an older active row, while every newly generated
spec emits the complete final form shape. Absence and explicit empty are equal for
Diff/equality, so compatibility does not manufacture a version or drift an
immutable historical `spec.json`.

- The spec declares a choice field with its values.
- The DDL mapper gives it `TEXT` storage.
- Both renderer switches produce a control for it.
- The generator knows how and when to declare one.
- Platform-owned input normalization and mutation validation reject a value that
  is not declared before canonical state changes, as a typed 422
  `invalid_choice` failure carrying that field in `data-error-fields`; generated
  Handlers receive only an admitted value and do not become a second enum
  validator.
- **It fails closed.** A `values` array on a non-choice field is rejected, and a
  choice field with no options, duplicate values, blank values or blank labels is
  rejected.

The extension must cross the existing total contracts, not only the compiler
switches: scratch/sample values, Action-safe schema projections, prior-source
admissibility, behavioral total-input digests, candidate canonicalization and the
Diff matrix all learn `choice`. Adding a choice field follows the ordinary new
text-field impacts. For an existing choice field, option values are immutable and
may only be appended; removal or rename is rejected before Diff so stored rows can
never become undeclared data.

## Acceptance criteria

- [ ] A spec declaring a choice field round-trips through the DDL mapper, both
      field-renderer switches and the generator
- [ ] A record with a choice value stores, reads back and edits correctly
- [ ] A `values` array on a non-choice field fails closed; empty, duplicate or
      blank option values/labels fail closed
- [ ] Every new choice emits `groups: []`; non-choice fields reject `groups`, and
      5.10/01-generated specs need no persisted-shape rewrite for 5.10/02 grouping
- [ ] A value outside the declared list is refused by platform validation before
      canonical mutation as `invalid_choice` with its error field; generated
      Handlers receive only admitted values
- [ ] Scratch/sample generation, unit context, behavioral total inputs,
      canonical equality and the total Diff matrix cover `choice`; no admitted
      fact reaches the unmapped fallback
- [ ] Evolution may append options but cannot remove or rename a stable stored
      value, and existing records remain valid across the change
- [ ] Pre-5.10 active rows parse missing new form collections as canonical empty
      without rewriting their snapshots or forcing a reset; new specs emit the
      complete shape and absence equals empty in Diff
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Build a capability whose spec carries a choice field, add a record choosing one of
its values, reopen the record and confirm the choice survives the round trip.

## Blocked by

- modules/05-the-desk/5.9-rename-and-delete-from-the-logo/issues/03-a-link-to-a-deleted-capability-loads-the-bare-desk.md
- modules/05-the-desk/5.5-capability-logo/issues/04-the-desk-load-sweep-retries-to-a-cap-of-three.md

This is the branch join. The hosted-logo path's reset must be behind us before
this issue creates the final, record-bearing form corpus that no later issue may
reset.
