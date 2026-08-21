# Long text, `guidance` and `max_length`, with the field chrome renamed

Status: ready-for-agent

## Epic

Module 5 — The Desk · Epic 5.10 — The form: choice, long text, guidance and
in-field errors
(PLAN decisions 28, 29 (the remaining form additions), 32 (the field-chrome half), 33:
`modules/05-the-desk/PLAN.md`)

## What to build

**Long text is an ordered `ui_intent.form.long_text` field-name list**, following
the existing `list_inputs` precedent. Entries may name only active scalar
`string` fields; unknown, inactive, duplicate, choice, list or non-string entries
fail closed, and canonical order follows schema-field order. It needs a refinement
beside the existing list-inputs validation and a generator clause. The input factory returns a single-line text
input for every string unconditionally today, which is why a field holding three
sentences gets the same input a title does. This fixes **every notes, description,
review and journal field** the product will ever generate.

**Two per-field additions carry the rest.**

- **`ui_intent.form.guidance`** — ordered `{ field, text }` entries for active
  fields, with the same unknown/inactive/duplicate and schema-order checks. It is
  a short hint under the field. It **also carries the sentence
  announcing a default**, so defaults need no key of their own. There is **no
  placeholder key**: guidance survives typing, which is exactly when a format hint
  matters.
- **`max_length` on a scalar `string` field** — a positive integer driving
  the platform's canonical mutation validation, the browser counter and native
  `maxlength` from one declaration. Generated Handlers receive the already
  admitted string and do not re-implement the structural limit. A crafted
  over-limit submission fails as typed 422 `max_length_exceeded`, carrying that
  field in `data-error-fields`, before the Handler or canonical mutation. The key is
  rejected on choice, list and non-string fields. Soft-hide preserves the key
  exactly with the rest of the inactive field definition; reactivation cannot
  reveal values that violate it.

Long-text and guidance changes are platform-View facts. `max_length` additionally
changes create/update validation shape and behavioral total-input digests. Adding
or lowering a limit performs a lease-held pre-activation scan of the physical
column, including currently inactive values, and is refused if any committed
value already exceeds it; an evolution may not strand a valid row
or make an unrelated future edit impossible.

**Two markers are free** — renderer work with no new authored key: the optional
marker is the inversion of `required`, and the disabled visual state is used only
when platform form lifecycle already disables a control (for example during an
admitted submission). This does not introduce a model-authored per-field
`disabled` property; choice-option disabled state is the separate 5.10/02
contract.

**Read-only is not a third**, because clicking a record opens it in edit mode, in
the form, so nothing renders a record read-only and no field ever reaches that
state. The muted em dash for an absent value goes the same way: an absent value is
an empty input.

**The field chrome takes the design's meaning.** The outer shell carries the
boundary, the fill and the states; the input is the input. This rename is free
because the corpus using the old naming was deleted in 5.1/01.

**Field labels stay uppercase.** Small caps is one role marker across the whole
surface — labels, counts and kickers all take it — and the form becoming the only
place a record is read changes nothing about what the marker means.

## Acceptance criteria

- [ ] A long-text field renders a multi-line control; a short string still renders
      a single-line input
- [ ] `guidance` renders under its field, survives typing, and carries the
      default-announcing sentence; no placeholder key exists
- [ ] `max_length` drives platform mutation validation, native `maxlength` and
      the character counter from one declaration; generated Handlers receive an
      already-admitted value
- [ ] A crafted over-limit submission returns `max_length_exceeded` with the
      affected field and changes no canonical state
- [ ] The optional marker and disabled render with no spec change; no read-only
      state exists anywhere and an absent value is an empty input
- [ ] The field chrome carries the design's outer-shell-and-input split
- [ ] Field labels render in small caps
- [ ] Long-text, guidance and max-length facts are total in canonical equality and
      Diff; a max-length activation that would invalidate an existing row is
      refused before the pointer changes
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Build a capability with a notes field and confirm it renders multi-line with its
guidance underneath and a character counter tied to its declared limit. Type to
the limit and confirm the native control stops further input while the counter
agrees. Then use the developer preview's crafted-request path to submit an
over-limit value and confirm the server refuses the same limit. Confirm the
guidance is still readable while ordinary typing is valid.

## Blocked by

- modules/05-the-desk/5.10-form-choice-long-text-guidance-errors/issues/02-the-picker-feature-set-and-the-three-presentations.md
