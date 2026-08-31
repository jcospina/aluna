# Long text, `guidance` and `max_length`, with the field chrome renamed

Status: done

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

- [x] A long-text field renders a multi-line control; a short string still renders
      a single-line input
- [x] `guidance` renders under its field, survives typing, and carries the
      default-announcing sentence; no placeholder key exists
- [x] `max_length` drives platform mutation validation, native `maxlength` and
      the character counter from one declaration; generated Handlers receive an
      already-admitted value
- [x] A crafted over-limit submission returns `max_length_exceeded` with the
      affected field and changes no canonical state
- [x] The optional marker and disabled render with no spec change; no read-only
      state exists anywhere and an absent value is an empty input
- [x] The field chrome carries the design's outer-shell-and-input split
- [x] Field labels render in small caps
- [x] Long-text, guidance and max-length facts are total in canonical equality and
      Diff; a max-length activation that would invalidate an existing row is
      refused before the pointer changes
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Build a capability with a notes field and confirm it renders multi-line with its
guidance underneath and a character counter tied to its declared limit. Type to
the limit and confirm the native control stops further input while the counter
agrees. Then use the developer preview's crafted-request path to submit an
over-limit value and confirm the server refuses the same limit. Confirm the
guidance is still readable while ordinary typing is valid.

## Blocked by

- modules/05-the-desk/5.10-form-choice-long-text-guidance-errors/issues/02-the-picker-feature-set-and-the-three-presentations.md

## What landed

**Two collections and one key.** `ui_intent.form` had two collections that are *total* over
their field type — every active `string[]` has an input mode, every active choice has a
presentation, because neither can be drawn without one. The two added here are **subsets**:
a string field renders perfectly well as a single-line input and a field is complete without
a hint, so naming one is opting it in. That difference is the only thing `long_text` and
`guidance` do not inherit from the `list_inputs` precedent, and it is why their order check
is a strictly increasing walk of schema positions rather than `sameOrderedStrings` against a
built expected list. Both live in `src/registry/form-intent.ts`; both fail closed on an
unknown, inactive, duplicate, ineligible or out-of-order entry.

**`max_length` is the third optional key on a field**, and unlike `values`/`groups` it is
optional in both directions: a scalar `string` may or may not declare one, and every other
type is refused one. It has a floor as well as a ceiling. The ceiling keeps the key honest —
a limit of a million is a limit nobody reaches, counts toward, or is stopped by. The floor
(64) is the number the Gate forced: the smoke's create/update samples and the search tier's
inclusion, literal, Latin and duplicate fixtures all write real sentences into every string
column, the longest 45 characters, so a tighter bound would author a field the capability's
own Gate could not fill.

**One declaration, three readers.** `maxlength` stops the typing, `data-length-limit` is what
the counter counts down from, and `assertAdmittedStringLengths` refuses anything longer
however it arrived — all off the same number. Lengths are UTF-16 code units everywhere,
because that is what the native attribute counts: the number a browser stops at has to be the
number the server enforces, or one declaration means two things.

**The refusal has no held-value exemption, and needs none.** The disabled-option refusal
beside it has one, because a row can legitimately be standing on an option that was retired
after it stored it. No stored value can ever violate a live limit, because a limit may only
be added or lowered after `assertStoredValuesFitMaxLengths` has proved the committed column
fits it. An exemption would be an exemption for a case the platform refuses to create.

**The scan is the one check that reads data rather than a spec.** It runs right after the
Diff, inside the exclusive build lease the whole run already holds, so no record write can
land between it and the activation that follows — which is what lets it sit early, before an
assembly is spent on a candidate that cannot activate, rather than immediately before the
pointer moves. It reads the physical column whatever the field's lifecycle, because hiding
never drops a column or clears it and reactivation would otherwise reveal exactly the
stranded rows it exists to prevent. Its `WHERE length(col) * 2 > ?` is not an approximation:
SQLite counts code points and the limit counts code units, one code point is at most two code
units, so the doubled count is a superset of every possible violator and the exact count is
then taken in the same JavaScript the write path takes it in.

**Three change facts, and the asymmetry that lets units be copied.** `long_text_input` and
`field_guidance` are the View's and buy platform work alone. `max_length` is create/update
validation shape, so it moves both writing suites' total-input digests — and it is
deliberately absent from both Handler generation contexts, which is the positive proof
ADR-0006 wants before a unit is copied rather than rewritten: two specs differing only in a
limit produce byte-identical unit prompts, pinned from the other side in
`units/max-length-prompt.test.ts`.

**The field chrome took the design's meaning.** `.field__control` is now the outer shell
carrying the boundary, the fill, the padding and every state, with `.field__input` /
`.field__textarea` bare inside it. The product's own `.field__control` block is gone rather
than renamed: every rule it restated already ships from
`design/styles/components/form-controls.css`, which the page loads. That split is what gives
the design's `:focus-within`, `:has(:disabled)` and `.is-invalid` rules something to attach
to — the disabled state the issue calls free is free exactly because the shell now exists.

**The counter sits beside the guidance rather than replacing it.** The design's page has one
field with a limit and no hint, so its counter takes the guidance slot outright. A real
capability declares both, and a hint that vanished the moment the field said something about
its own length would leave exactly when it is being read.

**The counter's sentence is written twice on purpose** — once by the server for the field's
opening value, once by the client on every keystroke — and pinned against each other, and
against `design/scripts/controls-main.js`, which is the contract this was ported from. The
singular fix ("1 character left", not "1 characters left") was carried back to that contract
so the two do not drift.

## Findings fixed

Every finding from the two adversarial passes, INFO included.

- **A NUL hid a row from the pre-activation scan, and the scan failed open.** SQLite's
  `length(X)` over text counts characters *up to the first NUL*, so a stored value carrying
  one measured as the prefix before it and sat behind any limit at all. The narrowing
  activated, and `updateBoundTarget` — which merges every held value and puts the whole
  record to validation — then refused every later edit of that row: readable forever, never
  saveable. Exactly the stranding the scan exists to prevent, caused by the scan. It filters
  on `length(CAST(col AS BLOB))` now, which counts through a NUL and is still a sound
  superset, because every code point is at least as many UTF-8 bytes as it is code units.
- **A long-text value beginning with a newline was silently shortened on every edit.** HTML
  drops one U+000A immediately after a `<textarea>` start tag, so the control opened holding
  one character less than the counter beside it had been written for — and because the edit
  form posts every field, saving an unrelated one rewrote the value without its first line.
  The renderer writes the newline the parser eats. The DOM double did not model the rule, so
  the test that would have caught it was passing on markup a browser shortens; it models it
  now, and the round trip is pinned from both sides.
- **The two new facts were not in the `ui_change` allow-list.** "Give me more room to write in
  the notes field" is the purest UI change these keys support, and it was refused before
  assembly — `long_text_input` and `field_guidance` are exactly the character
  `list_input_mode` is, and that was already admitted. Both the scope gate and the resolver's
  own closed list of what `ui_change` covers now name them.
- **A repeatable list's declared guidance was rendered and referenced by nothing.** Every
  other field type wires `aria-describedby`; this one drew the line and left it visual-only,
  against the module's own stated contract. A repeatable list has no single control to hang a
  description on, so it rides every row — which an added row inherits for free, because
  `addListFieldRow` clones a row and `syncListFieldRows` restates only what is positional.
- **A boolean's guidance landed beside its label rather than under the field.** `.field--inline`
  is a row, so the hint became a third item in it and read as part of the label. Any active
  field may carry a hint, a boolean included, so this was a legal spec.
- **Adding a list row left two drawn boxes on it.** The row's control is a shell now, which is
  a drawn element; the ink system keys what it has mounted on the element itself, so it did
  not recognise the clone and drew it a second pair — the stale ones keeping the width the row
  had when it was copied. The clone drops its inherited layers before it is appended.
- **A refusal at load could take the observer down with it.** `startLongTextFields` scanned
  before installing its watch, so one bad control at page load left every form htmx landed
  afterwards with no script for the rest of the session. The watch is armed first.
- **The growth ceiling was declared twice, in two units.** `max-height: 16.25rem` and
  `data-grow-max="260"` agree only at a 16px root; below that the script would set a height
  the stylesheet clipped and turn scrolling *off* for content it believed fitted. The CSS
  ceiling is gone — the constant the renderer writes is the only one — and the rule's stated
  reason was wrong anyway, since a `rows="3"` box is already a field before any script runs.
- **The scan materialized a whole column.** It asks `max(length(...))` first, so the ordinary
  case costs one scalar, and iterates rather than collecting when a column really has a
  candidate. It also refuses to build a statement over an identifier that does not match
  `SQL_NAME_PATTERN` — the one SQL-building site in the evolution path with no schema parse
  of its own.
- Also: create-mode `datetime` never carried `step="any"` while its edit mirror hard-coded it,
  so a created record could not hold the seconds canonical storage keeps (pre-existing, and a
  one-line fix now that both go through one function); `renderInlineField`'s
  `checked ? " checked" : required` encoded a mutual exclusion nothing stated; and `public/ink.js`
  still explained `.field__control`'s absence from its list by saying it was a bare `<input>`.

Each fix is mutation-checked: reverting the NUL predicate fails three tests, reverting the
renderer's newline fails four, reverting the observer order fails one.

### Found in use, after the issue closed

**The create form's long-text control had no height at all.** It rendered as something the
size of a single-line input, with the rest of the field's space empty below it, and could not
be clicked into. User-reported, on the Reading Log built for the demo.

The create form lives inside a panel that is `display: none` until "New" is pressed, and the
observer mounts a control when it *enters the document* — which is well before anyone opens
that panel. An element with no layout answers 0 to every measurement, so the opening `grow()`
measured 0 and wrote `height: 0px`, and that inline style stayed after the panel opened.
Typing repaired it, which is exactly why it survived the live pass: every check I ran on the
create form dispatched an `input` first, and the edit form is swapped in already visible so it
was never wrong there. The measurement was in my own output — `from: "0px"` — and I read it as
"initial" rather than as the bug.

`grow` now refuses to write a height it measured with no layout, leaving the `rows` the server
wrote. A `ResizeObserver` per control supplies the missing half: it measures again the moment
the control has a box, which is when the panel opens. That also fixes a second fault nobody had
hit yet — a width change re-wraps the text, so the height it needs is a different height, and a
window narrowed after typing would have clipped what was already written. It compares widths
rather than heights, because the height is what `grow` itself writes.

The DOM double gained a `ResizeObserver` that fires once on `observe`, the way the browser's
does, and `Doc.resize` to move a width and tell the watches. Both halves are mutation-checked:
reverting either fails two tests.

## Known temporary seams

- The disabled visual state is available rather than exercised. The shell is what makes the
  design's `:has(:disabled)` rule apply at all, and it does — measured live, a disabled
  control fades the whole object to 0.42 with `cursor: not-allowed`. Nothing in the platform
  form lifecycle disables a *field* today: `record-mutations.js` disables the submit, cancel
  and back buttons during a pending submission, which are `.btn`s and already fade.
- `data-error-fields` still has no client reader. The over-length refusal emits it like its
  three siblings; 5.10/04 is what relocates the sentence into the field.

## Verification

`bun run test` 2350 passing, `bun run typecheck` and `bun run lint` clean.

Live, on the running desk. A capability built from the prompt bar — **Reading Log**, from
"track the books I read: the title, a short takeaway I keep brief, and my full notes on each
one" — authored all three declarations from the semantics alone, with nothing in the prompt
naming a control: `long_text: ["notes"]` for the field asked to hold full notes,
`max_length` 300 on the title and 280 on the takeaway that was to be kept brief, none on the
notes, and one line of guidance on the takeaway ("Keep this to the main idea or lasting
impression from the book."). All four Gate rungs passed and it activated.

In the browser: notes drew a textarea and grew with what was typed to exactly the 260px
ceiling before switching to scrolling; the takeaway carried its guidance *and* its counter as
two readable lines, both named in one `aria-describedby`; the counter counted down through
"212 characters left" to "0 characters left"; eight real keystrokes past the limit were
refused by the native control with the counter agreeing; and a crafted 281-character
submission earned a 422 `max_length_exceeded` naming `takeaway`, retargeted to the create
error region, with the guidance still readable throughout. A record saved, reopened with
every field prefilled, and — the case the newline bug broke — a notes value stored with two
leading blank lines came back at exactly its 52 stored characters with both intact.

The field chrome was checked on a capability built *before* this change, which is what proves
the storage canonicalization: the desk loaded its four existing capabilities with no console
error, and their forms drew the shell carrying a 2px boundary, the well fill and the 36px row
height, with a bare transparent input inside it and "optional" beside the caps labels of the
fields that are. The drawn picker still opens, walks and commits, with no console error.

The design page's own counter was re-checked after the singular fix was carried back to it,
and now reads "1 character left" on both sides of the port.
