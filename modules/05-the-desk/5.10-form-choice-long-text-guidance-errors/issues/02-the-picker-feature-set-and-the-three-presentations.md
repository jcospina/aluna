# The picker's full feature set, and a per-field declaration of how a choice presents

Status: ready-for-agent

## Epic

Module 5 — The Desk · Epic 5.10 — The form: choice, long text, guidance and
in-field errors
(PLAN decision 27 (the feature set): `modules/05-the-desk/PLAN.md`)

## What to build

The design's full picker feature set lands on the choice type: **grouped options,
per-option notes and per-option disabled states.**

**A choice field declares its presentation per field in the spec** — picker, radio
group, or segmented control — **rather than having it inferred from how many
options it has.** Option count is a bad proxy for intent: three mutually exclusive
states want a segmented control, three options out of a domain of thirty want a
picker, and nothing about the number tells them apart.

- Each choice field carries one ordered `groups` array of `{ id, heading }`
  declarations. Ids are unique, stable and nonblank; headings are nonblank. An
  option may name one group id declared on its own field. Reordering groups or
  options and changing a heading are presentation-semantic but never change the
  stored value. A group id cannot be renamed, and a group cannot be removed while
  any option refers to it.
- An option may carry a short note.
- An option may be disabled, and a disabled option is announced as such rather
  than merely unclickable. It cannot be newly selected. If an existing record
  already stores a value that later becomes disabled, edit renders and announces
  that selected value, preserves it when unrelated fields are saved, and lets the
  user move to an enabled option; it never silently clears or invalidates the row.
  An attempted new selection fails as typed 422 `choice_disabled`, naming the
  field in `data-error-fields`, before the generated Handler or canonical state.
- The three presentations render the same declared values and produce the same
  stored value.
- **It fails closed.** An unknown option group is rejected; a presentation outside
  the three is rejected.

The drawn picker gives up native constraint validation, which 5.10/04 recovers
with a client-side required check rather than leaving it lost.

The picker ports the design's complete select-only combobox behavior, not only its
paint: Enter/Space/arrows/Home/End open it; arrows plus Home/End move the active
enabled option; printable typing performs typeahead; Enter commits; Escape and
click-away close; focus remains on the button and
`aria-expanded`/`aria-controls`/`aria-activedescendant` report the panel. Disabled
options are skipped by movement and typeahead. Radio uses native radio inputs in
one labelled radiogroup; segmented exposes one mutually exclusive pressed value
and supports ordinary button keyboard activation.

Evolution is explicit: group headings, option labels/notes/order and presentation
mode are platform-View facts only; appending an option or changing `disabled`
also changes create/update validation shape and their behavioral total-input
digests. None of these facts selects DDL or logo work, and every admitted fact has
a positive Diff mapping.

## Acceptance criteria

- [ ] Grouped options, per-option notes and per-option disabled states all render
      and all round-trip
- [ ] Group headings are announced as option groups and option notes are exposed
      as descriptions rather than visual-only text
- [ ] A choice field declares picker, radio group or segmented control per field;
      nothing is inferred from option count
- [ ] All three presentations produce the same stored value for the same choice
- [ ] The picker carries the design's full keyboard/focus/ARIA/typeahead behavior,
      skipping disabled options; radio and segmented remain keyboard-operable
- [ ] An unknown option group fails closed; a presentation outside the three
      fails closed
- [ ] Group ids/headings are validated per choice field; ids cannot be renamed and
      referenced groups cannot be removed during evolution
- [ ] A disabled option is announced as disabled, not merely unclickable
- [ ] A newly disabled stored value remains renderable and is preserved on an
      unrelated edit, while new selection of it is refused
- [ ] A crafted submission of a disabled value fails as `choice_disabled` with
      the affected field and never reaches the generated Handler
- [ ] Every option/presentation evolution fact has the stated View, validation,
      test-input and no-DDL mapping; no fact is silently copied or unmapped
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Build a capability carrying three choice fields — one picker with grouped options
and notes, one radio group, one segmented control — and confirm each renders as
declared and stores the same way.

## Blocked by

- modules/05-the-desk/5.10-form-choice-long-text-guidance-errors/issues/01-the-choice-field-type-round-trips.md
