# The picker's full feature set, and a per-field declaration of how a choice presents

Status: done

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

- [x] Grouped options, per-option notes and per-option disabled states all render
      and all round-trip
- [x] Group headings are announced as option groups and option notes are exposed
      as descriptions rather than visual-only text
- [x] A choice field declares picker, radio group or segmented control per field;
      nothing is inferred from option count
- [x] All three presentations produce the same stored value for the same choice
- [x] The picker carries the design's full keyboard/focus/ARIA/typeahead behavior,
      skipping disabled options; radio and segmented remain keyboard-operable
- [x] An unknown option group fails closed; a presentation outside the three
      fails closed
- [x] Group ids/headings are validated per choice field; ids cannot be renamed and
      referenced groups cannot be removed during evolution
- [x] A disabled option is announced as disabled, not merely unclickable
- [x] A newly disabled stored value remains renderable and is preserved on an
      unrelated edit, while new selection of it is refused
- [x] A crafted submission of a disabled value fails as `choice_disabled` with
      the affected field and never reaches the generated Handler
- [x] Every option/presentation evolution fact has the stated View, validation,
      test-input and no-DDL mapping; no fact is silently copied or unmapped
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Build a capability carrying three choice fields — one picker with grouped options
and notes, one radio group, one segmented control — and confirm each renders as
declared and stores the same way.

## Blocked by

- modules/05-the-desk/5.10-form-choice-long-text-guidance-errors/issues/01-the-choice-field-type-round-trips.md

## What landed

**The option grows.** `choiceOptionSchema` gains `group`, `note` and `disabled`. `disabled` is
`z.literal(true)` rather than a boolean, so an enabled option has exactly one spelling and two
specs cannot differ by a key nobody set. `groups` stops being frozen empty and carries ordered
`{ id, heading }` declarations. Every authored string an option or group holds is now bounded and
single-line and holds no control character, and the two collections are capped (64 options, 16
groups) because every option is serialized into a generation prompt.

**Three presentations.** `CHOICE_PRESENTATIONS` opens to `picker | radio | segmented`, and
`src/presentation/choice-control.ts` is a total switch over it. The picker is
`design/scripts/listbox.js` ported to `public/choice-picker.js`; radio is native radio inputs;
segmented is the design's joined button row. `validateChoiceInputs` is where the one cross-half
rule lives: a segmented control has nowhere to put a heading or a second line, so it admits
neither groups nor notes and a spec declaring either is refused.

**Announced, not painted.** The design marks a picker group heading `role="presentation"`, which
says nothing to a screen reader. The heading keeps that role and gains a `role="group"` wrapper
named by it, so the grouping is announced without a second non-option child breaking the listbox's
required children. A grouped *radio* set cannot copy that — `radiogroup` owns radios and nothing
else — so the runs become the radiogroups and the outer becomes a plain group. A note is
`aria-describedby` and `aria-hidden`: hidden from the option's name-from-contents, which would
otherwise read it twice, and still reachable as its description.

**Retiring an option.** `disabled` is the only way to take an option out of use, since removing one
is refused. A row already holding it renders it, keeps it through an unrelated edit, and can move
off it; nobody may newly arrive at it. `assertAdmittedChoiceValues` runs two refusals in order over
the whole submission — undeclared, then retired — and the update path passes the record's own
current values, which is what makes "the one you already have" admissible. `choice_disabled` is a
typed 422 with `data-error-fields`, claimed by `public/app.js` and refused as an authored
`behavioral_errors` code. A field may not retire every option.

**Seven evolution facts**, in `src/builder/evolution/diff-choice.ts`. `choice_values` and
`choice_option_disabled` are validation shape; `choice_option_labels`, `notes`, `order`, `groups`
and `choice_presentation` are the View's. Option order became a View fact, so candidate validation
stopped refusing a reorder and every comparison moved from index to value. `groups` is now blanked
in the totality residual, because a fact explains it.

**The projections are what make the matrix true.** The item renderer is given sorted `{value,
label}` pairs and the writing Handlers sorted admitted value strings — so a note, a group, a
retirement and the drawing order provably cannot reach a generated unit, which is the positive
proof ADR-0006 wants before a unit is copied rather than rewritten. `units/choice-prompt.test.ts`
pins it from the other side: two specs differing only in those facts produce byte-identical prompts.

## Findings fixed

Every finding from the three adversarial passes, INFO included.

- **The picker's panel was unusable in the real form.** Positioned absolutely, it was clipped flat
  by `.capability-create-form__fields`' scroller — one row visible. Positioned against the viewport
  it then hung outside the desk window, behind the prompt bar, where its lower rows could not be
  pressed at all. It now measures its containing block once per opening (a desk window is dragged
  by `transform`, so it is one), and hangs inside it: flipping above when there is more room there,
  clamping horizontally, and sizing its scroller to the space that is actually left.
- **An append left the card showing the raw wire value.** The item renderer bakes in a value→label
  table, so `choice_values` had to regenerate it when the field is on the card, exactly as a
  relabel does. Five facts were leaving units copied whose prompts provably differed; narrowing the
  two projections and adding this row closed all five.
- **`choice_option_disabled` regenerated both Handlers from an unchanged prompt.** A retired option
  is still admitted, so it never reaches them. It now selects the two suites and no unit.
- **`choice_disabled` was not in `PLATFORM_OWNED_ERROR_CODES`**, so a capability could author the
  platform's own refusal and earn an unsatisfiable behavioral case.
- **The Gate seeded a retired value.** The smoke rung's create/update sample drew from every
  declared option; a capability with one disabled option could not pass its own smoke. Both smoke
  paths now draw from the selectable ones.
- **`form.reset()` could not clear the picker.** A hidden input's `value` *is* its content
  attribute, so choosing rewrote the very default a reset restores. The server writes
  `data-choice-initial` once and the control is put back from that.
- **The placeholder was read back off the rendered value**, which is the chosen label whenever
  there is one — an emptied control would have shown the last thing chosen.
- **A rename rule that refused a legitimate split.** Splitting one group into two was reported as
  renaming a group id. The rule now recognizes a rename by what it actually does and admits every
  real restructure; its two-step reachability is stated rather than pretended away.
- **The behavioral digest did not move** when the appended option was already disabled. It carries
  `retired_values` now — named for what it is, and documented in the prompt as never submittable
  and never seedable, because an undocumented list of legal-looking strings beside `values` is a
  trap.
- **`aria-required` on `role="group"`** (the segmented row) is not a supported state; it is gone.
  The radio group got back the native `required` it had thrown away — `required` on a radio binds
  the whole same-named set, so it is the one presentation that keeps a real constraint.
- **The segmented row stretched the full form width**, blockified by `.field`'s column; it hugs its
  buttons again.
- **`choiceOptionRuns` silently dropped** an option naming an undeclared group, taking it off the
  control with nothing said. It throws, like its siblings.
- **The fact detectors read `undefined` off a removed option**, which would report one refused
  change as three facts. A removal now fails loudly where the comment used to be the only guard.
- **The DOM double lied in five ways**, each of which could have made a green test hide a real bug:
  `:not([disabled])` parsed as its own inverse, `stopPropagation` was a no-op the doc-comment
  claimed worked, `capture` was dropped (so the scroll watch was unmodellable), `hidden` never
  cleared its attribute, and every DOM constructor was bound to one class, making every
  `instanceof` guard a tautology. All fixed, and the mount-once test that could not fail was
  replaced.
- **`openPickers` was module-global**, so one document's press closed another's panel; it is per
  document now. A picker missing its carrier failed open, posting nothing while looking correct; it
  refuses to mount. `aluna:choice-change` was dispatched to nobody — it is a native bubbling
  `change` on the carrier, which every form already understands.
- Also: the four new spec rules the generator was never told about, a false comment about the
  search fixture crossing platform validation, a router-typed error thrown from a Gate-internal
  path, an unbounded option value, and the two-mechanics disabled announcement left undocumented.

### Found in use, after the issue closed

Two user-reported faults on the shipped picker, and the adversarial pass over their fixes.

- **The edit form's picker was dead.** It opened on a fresh record and on nothing after. Mounting
  hung off htmx's landing events, and `record-view.js` opens a record by cloning the view out of a
  `<template>` and swapping it in itself — no landing is announced, so the field stood there with no
  script. Those three listeners are gone; a `MutationObserver` mounts a picker when its field enters
  the document, whoever put it there. That also covers the three `region.innerHTML = html` swaps in
  `records-refresh.js`, `search-chrome.js` and `capability-deletion.js`, which the landings never
  reached either.
- **The panel fought the pointer.** `pointerover` revealed the active row on every fire — including
  re-firing on the row already active — and `scrollIntoView` scrolls *every* ancestor, so revealing a
  row nudged the form, which moved the button, which re-placed the panel, which put a new row under a
  hand that had not moved, which asked to be revealed. Revealing is now `#reveal`, which moves the
  list's own scrollport and nothing else; a row already active is not re-activated; and the pointer
  is disarmed until it moves again, so walking with the arrows no longer hands the selection back to
  wherever the cursor is resting.
- **The placement watch answered the panel's own list.** Placement re-caps the list's height, so a
  scroll inside the list resized the box being scrolled, on every frame of the scroll. In-panel
  scrolls are skipped; every other scroll still re-places.
- Carried back to `design/scripts/listbox.js`, which is the contract this was ported from, so the
  two do not drift.

From the adversarial pass, all fixed: `#reveal` measured the border box where it meant the
scrollport (a horizontal scrollbar parked the last row underneath it) and had dropped
`scrollIntoView`'s horizontal axis; `mountChoicePickers` flagged a field as mounted *before*
constructing it, so one that refused was marked done and never offered a script again, and a single
refusal inside an observer batch took every other form that landed beside it down with it;
`restore()` left a standing panel open with an active row describing nothing; the pruning walk ran
once per inserted node rather than once per batch, and never let go of a picker left open when its
form was swapped away. And `record-view.js`'s `FIRST_FIELD_SELECTOR` — with its twin in
`list-container.ts` — matched neither drawn choice control, so a capability whose fields are all
picker or segmented opened onto no focus at all.

Five tests were passing for the wrong reason and now bite: the clipping walk was entirely
unexercised because the DOM double had no `parentElement` (`clipBounds` is exported and pinned
directly now); `getAttribute("style")` always answered `null` because the double never wrote style
through to the attribute; the observer stub ignored `observe()`'s own arguments, so a watch
configured for anything but `childList` over the subtree shipped green; the early return had no
assertion that distinguished it; and one fixture asserted a `scrollTop` no browser could report,
because the double left it unclamped. Every fix above is now mutation-checked: undoing any one of
them fails a test.

## Known temporary seams

- `data-error-fields` still has no client reader. It is contract, emitted by all three refusals,
  and 5.10/04 is what relocates the sentence into the field.
- The picker and the segmented row have no native required constraint. `aria-required` says so;
  5.10/04 recovers the check.
- A record standing on a retired option is given no visual signal that the option is closing. The
  contract asks that the value render and survive, which it does; saying more about it is wording
  this issue does not author.

## Verification

`bun run test` 2200 passing, `bun run typecheck` and `bun run lint` clean.

Live, on the running desk. A capability built from the prompt bar — **Freelance invoices** —
authored all three presentations from the semantics alone: `stage` as a **picker** with twelve
options under two declared groups (Open, Closed) and a note on the two that close an invoice,
`payment_terms` as a **radio group** of three, and `billing_model` as a **segmented** row of two
carrying neither a group nor a note, which is what the spec gate would have refused. All four Gate
rungs passed and it activated.

In the browser: the picker opens on Enter/Space/either arrow/Home, opens onto the last option on
End, walks and wraps with the arrows, jumps on typeahead — typing `p` landed on Paid under the
CLOSED heading with its note beside it — commits on Enter, closes on Escape and on a press outside,
and never moves focus off the button. A record stored `paid` / `net_30` / `fixed_price` through the
three controls, the card read the labels rather than the wire values, all three controls reset for
the next entry, and reopening the record brought each one back to what it holds.

Everything the panel does wrong, it does about *where it is*, and only a real window in a real size
shows it. Four faults, found in that order and each fixed above: it was clipped flat by the create
form's own scroller; positioned against the viewport instead, it hung outside the desk window where
its lower rows could not be pressed; bounded by the window it then covered the title bar, because
what clips it is the window's *body* and the box it is measured against is the window; and sized
from the room on one side, it could still run past the edge once its top was clamped. It now
measures the box that paints it, fits itself to the room at the position it actually takes, and
closes when its control is scrolled out of the form. `choice-picker.mounting.test.ts` builds that
exact window — transformed frame, clipping body, static scroller between — and pins the bounds the
walk answers with, directly.

The first two build attempts failed at the behavioral rung on generated-suite quality unrelated to
this work — a search Handler that did not normalize accents, and an update suite whose own
`setupRows` omitted the required fields the case was about. Structural, smoke and design-lint
passed on all three attempts, smoke included, which is the rung that exercises a real create and
update through these controls.
