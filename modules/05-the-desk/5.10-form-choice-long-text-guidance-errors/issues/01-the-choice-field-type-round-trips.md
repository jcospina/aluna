# The choice field type carries its declared values, end to end

Status: done

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

- [x] A spec declaring a choice field round-trips through the DDL mapper, both
      field-renderer switches and the generator
- [x] A record with a choice value stores, reads back and edits correctly
- [x] A `values` array on a non-choice field fails closed; empty, duplicate or
      blank option values/labels fail closed
- [x] Every new choice emits `groups: []`; non-choice fields reject `groups`, and
      5.10/01-generated specs need no persisted-shape rewrite for 5.10/02 grouping
- [x] A value outside the declared list is refused by platform validation before
      canonical mutation as `invalid_choice` with its error field; generated
      Handlers receive only admitted values
- [x] Scratch/sample generation, unit context, behavioral total inputs,
      canonical equality and the total Diff matrix cover `choice`; no admitted
      fact reaches the unmapped fallback
- [x] Evolution may append options but cannot remove or rename a stable stored
      value, and existing records remain valid across the change
- [x] Pre-5.10 active rows parse missing new form collections as canonical empty
      without rewriting their snapshots or forcing a reset; new specs emit the
      complete shape and absence equals empty in Diff
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Build a capability whose spec carries a choice field, add a record choosing one of
its values, reopen the record and confirm the choice survives the round trip.

## Blocked by

- modules/05-the-desk/5.9-rename-and-delete-from-the-logo/issues/03-a-link-to-a-deleted-capability-loads-the-bare-desk.md
- modules/05-the-desk/5.5-capability-logo/issues/04-the-desk-load-sweep-retries-to-a-cap-of-three.md

This is the branch join. The hosted-logo path's reset must be behind us before
this issue creates the final, record-bearing form corpus that no later issue may
reset.

## What landed

**The type.** `choice` joins `SCALAR_FIELD_TYPES`. The contract lives in
`src/registry/choice.ts`: option objects (`value` + `label`), the group declaration
shape, the closed `CHOICE_PRESENTATIONS` enum, `INVALID_CHOICE_ERROR_CODE`, and both
fail-closed validators. `specFieldSchema` gains optional `values`/`groups`; a non-choice
field carries neither, a choice field carries both, and `groups` must be empty until
5.10/02 gives an option a way to name one. `ui_intent.form.choice_inputs` mirrors
`list_inputs` exactly — one entry per active choice field, in schema order.

`spec.ts` was over the file-size cap once the contract landed, so the spec shape split
into `spec-text.ts` (validation primitives), `identifiers.ts`, `tools.ts` (the fixed
Action inventory), `behavioral-errors.ts` and `choice.ts`. `spec.ts` re-exports all of
it, so no consumer's import path changed.

**The provider seam.** A strict structured-output schema cannot express an absent key, so
`promptCapabilitySpecSchema` is no longer an alias of `capabilitySpecSchema`: it declares
`values`/`groups` as required-nullable and transforms `null` away on the way in. The
domain shape — the one stored, diffed and rendered — keeps them optional. Everything that
validates an already-materialized spec uses `capabilitySpecSchema`.

**Storage.** `canonicalizeStoredCapabilityShape` fills `choice_inputs` at the two
persisted-read boundaries (`registry/store.ts`, `artifacts/artifact-lifecycle.ts`).
Absence canonicalizes to empty without rewriting a row or an immutable snapshot, so no
reset and no manufactured version. A pre-choice field needs nothing: absent `values` is
already the contract for a non-choice field.

**Validation.** `InvalidChoiceError` joins `MissingRequiredFieldsError` in
`capability-data/internal.ts`. `normalizeSpecFieldValues` checks the whole submission
against the declared options before normalizing anything, so one refusal names every
offending field; a blank choice is "no selection" and stores `null`. The router answers
it as a typed 422 with `data-error-fields`, and `public/app.js` claims the code — htmx
drops a 4xx the shell does not claim, so both halves had to move together.

**The control.** `renderChoiceField` draws the design's own select markup — the
`.field__control--select` shell, the bare `.field__select`, and the `.field__chevron`
caret. The drawn listbox is 5.10/02. A stored value the field does not declare selects
the placeholder rather than defaulting to the first option, which would rewrite the
record on the next save.

**Evolution.** Two new facts: `choice_values` (an appended option — validation shape, so
create/update and their suites) and `choice_option_labels` (View work alone). They are
independent, so one evolution can do both. Candidate validation refuses a removal, rename
or reorder of a committed value before the Diff ever runs, and a soft-hide freezes the
options exactly. `values` is blanked in the residual; `groups` deliberately is not, so a
group change fails closed until 5.10/02 maps it.

## Findings fixed

Every finding from the adversarial pass, including the INFO ones:

- Two hand-written `FieldType` mirrors in the ambient declarations generated units are
  compiled against (`unit-checks.ts`, `gate-structural.ts`) had no `choice`. A Handler
  projecting a choice column would have failed the structural gate while the runtime
  accepted it. Both now derive the union from `fieldTypeSchema.options`.
- `choice_values` and `choice_option_labels` were mutually exclusive (`else if`), so an
  evolution that appended an option *and* reworded another lost the label work. Now
  independent, with labels compared over the committed prefix.
- Hiding a choice field named no choice work. Added `choice_input_intent`; the Module 4
  row for `list_input_intent` is left exactly as its matrix documents it.
- A `choice_presentation` fact was unreachable (the enum has one member). Removed — it
  arrives with 5.10/02's enum expansion, and a choice row now lives in the shared MATRIX
  table so the whole-matrix property test covers it.
- Neither generator prompt said `invalid_choice` is platform-owned, though the schema now
  rejects it. Both say so.
- The item renderer received no option labels, so a card showed `in_progress` rather than
  "In Progress". `presentationFieldDescriptors` now carries a choice's options.
- The control was `.field__control` on the `<select>` with a hand-rolled gradient caret.
  Converged on the design's existing shell/bare-element/chevron contract.
- `choice` was declared searchable in four places with nothing proving it, and the search
  fixture treated it as non-matchable content. It is now in the searchable bucket, the
  exclusion tokens are guarded against a colliding declared value, and a test pins the
  projection.
- `fixtureFieldValue` returned `unknown` (no exhaustiveness) and `excludedNonTextValue`
  had a `default`. Both are now total switches with concrete return types.
- Documented why an update revalidates unsubmitted fields, and fixed an error message that
  passed a field name where a capability id was expected.
- The item-label fix above shipped without a test pinning it. `units/choice-prompt.test.ts`
  now pins both halves of the asymmetry: the writing Handlers receive the admitted values
  and are told not to re-validate them, the item renderer receives the option labels and is
  told to present them, and search receives neither.

## Verification

`bun run test` 2092 passing, `bun run typecheck` and `bun run lint` clean.

Live: a capability built from the prompt bar authored a real choice field
(`status`: applied/interviewing/offer/rejected, `groups: []`, `choice_inputs` with
`presentation: "picker"`) and cleared all four Gate rungs. A record stored, read back,
reopened with its value selected, and edited. A crafted undeclared value earned the typed
422 and left the record untouched. The desk's two pre-choice capabilities loaded
throughout — the compatibility path, exercised for real.

The first live build failed at the behavioral rung: the model-authored test seeded a
status the field never declared, because the fixture vocabulary named the field but not
its admitted values. The vocabulary now carries them.

## Known temporary seams

- The choice control is the native `<select>` in the design's shell. The drawn listbox —
  panel, typeahead, active-descendant ARIA — is 5.10/02, which is also what opens the
  presentation enum past `picker`. Closed, the control is the drawn surface; open, the
  popup is the browser's, which is exactly why the design rejects it.
- `public/css/fields.css` restates the select shell's row layout on the design system's
  own numbers, because the runtime's `.field__control` is still the bare-element rule that
  5.10/03's shell/input split replaces. That duplication collapses with 5.10/03.
