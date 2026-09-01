# The button set drops `neutral`, renames `ghost` to `outline`, adopts C9's sizes — and a `string[]` field gets a drawn control

Status: done

## Epic

Module 5 — The Desk · Epic 5.10 — The form: choice, long text, guidance and
in-field errors
(PLAN decisions 31, 32 (the list-of-strings half):
`modules/05-the-desk/PLAN.md`)

## What to build

**The button set.** Buttons sit on the near-white window surface, **not on the
green ground**, and the re-check pass recorded on the design's status row left the
fills alone. `neutral` drops and `ghost` becomes `outline`. What survives is
primary, secondary, info, feature, warm, danger and outline, **with outline as the
only unfilled variant**. They are expressive and they read correctly on the window
surface.

C9's three heights plus a full-width modifier land on the control-height token,
which lost its PROPOSED label in 5.1/01 on the strength of this decision.

The primary/secondary pair resolves to the greens swapped in 5.1/01 — primary
`--shade` under a light label, secondary `--leaf` under ink. One observation from
that measurement outlives it: ink on leaf loses its counters at 10.5px small caps,
so **the harder pairing sits on the second action rather than the first**, and
dropping small caps on a button stays available if it is needed.

**Both `string[]` modes get a drawn control.** It is a shipped type with no
picture in the design, which is a **present gap rather than a future one**.
`comma_separated` stays one drawn text control with the existing trim/drop-empty
normalization and commas as separators. `repeatable` gets drawn rows that add,
edit, reorder and remove entries while preserving commas as data. Both normalize
to the same ordered array before generated code, and the visual work must not
collapse or reinterpret the model-authored list-input mode.
Repeatable reordering is dragged by a grip and is not drag-only: the grip is a
button, so space picks the row up for the arrow keys and escape puts it back, with
focus following the moved/surviving row predictably.

**File fields wait for Files, now Module 7.** They do not exist yet and nothing is
built for them here.

## Acceptance criteria

- [x] `neutral` is gone and `ghost` is renamed to `outline` everywhere, including
      the handbook and the generator prompt
- [x] Seven variants survive, with outline the only unfilled one, and each reads
      correctly on the window surface
- [x] Three heights plus a full-width modifier resolve from the control-height
      token
- [x] Primary carries a light label on `--shade`; secondary carries ink on
      `--leaf`
- [x] `comma_separated` and `repeatable` both render drawn controls and preserve
      their existing distinct normalization contracts; repeatable supports add,
      edit, reorder and remove, and both round-trip the same ordered-array wire
      shape
- [x] Repeatable reorder/remove is draggable *and* fully operable without dragging,
      with labelled controls, correct disabled states and stable focus after mutation
- [x] Nothing is built for file fields
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Open a record form and confirm the button row: a filled primary, a filled
secondary, and an outline as the only unfilled variant, at the declared heights.
Build a capability with a tags field and confirm the drawn list control adds,
edits, reorders and removes entries inside the window — by dragging a row's grip,
and by picking a row up from the keyboard with space and moving it with the arrows.

## Blocked by

- modules/05-the-desk/5.10-form-choice-long-text-guidance-errors/issues/04-in-field-errors-and-client-side-required-checking.md

## What landed

**The button half was already in the stylesheets; what was missing was the enforcement and
two sentences that contradicted it.** `neutral` and `ghost` are gone as names, and no prompt
ever carried them — a generated item may not hold an interactive descendant at all, so the
model was never told about a button. The handbook said "Seven variants carry a fill" and
listed six; the controls page said "Seven variants and a default" while the same system
denies an eighth standing behind an absent modifier. Both now say what the CSS has said
since 5.1. Two developer previews rendered a bare `class="btn"`, and the product's own base
filled with `--surface` — an unnamed eighth face by omission and by fill. Both are gone, and
`button-set.test.ts` is what stops them coming back: the set is closed across *every* shipped
sheet, `outline` is the only unfilled one in both, the three heights and `.btn--block`
resolve from the control-height token, and every rendered button names one of the seven —
the design pages included, which is where the rule is authored.

**All seven pairs are measured now, not two.** `high-meadow-token-layer.test.ts` reads each
variant's label and fill out of the manifest and computes the ratio, so changing a fill
re-measures rather than keeping a number that was true of the colour it replaced. The
tightest is still secondary at 4.54.

**The design gap is closed in the design first.** `controls.html` grows a section drawing
both `string[]` modes and records the decision as C16; the "no picture here" note retires and
the file field is left standing as the one absence that is not a gap. The control's rules are
`design/styles/components/list-field.css` — a file of its own because `form-controls.css` was
at 478 of its 500-line ceiling, and because the subject is different: that file draws one
control and this one arranges several into a field. Nothing in it declares an edge, because
a row's shell is a `.field__control` and its actions are `.btn`s, both of which the ink
system already names — which is also why `.field-list__remove` left the shell's own ink list.

**One control, not two copies.** `design/scripts/list-rows.js` is the mechanics and ships as
it stands, the way `design/scripts/ink.js` does; `public/list-field.js` is the product's half
of the seam — the delegation and the two ways a create form finishes — importing it over the
same `../design/` path `public/ink.js` uses. The picker was ported and now exists twice; this
one is imported and exists once.

**Order is data, so it is moved rather than relabelled.** Every row posts under the same name
and the wire keeps the order they arrive in, so moving a row moves the row.

**It is dragged by a grip, and the grip is a button.** The first draft gave every row
move-up and move-down buttons; in review that read as three controls on a row and as a
mechanism nobody had learned anywhere else, and the decision was amended (PLAN 32). Six dots
is what a row you can drag looks like, and that recognition is the whole reason to draw it.
The grip being a `<button>` rather than a `draggable` div is what puts it in the tab order,
gives it a focus ring, and lets space pick the row up so the arrow keys can move it — space
puts it down, escape puts it back, and tabbing away or clicking elsewhere drops it, because
a row nobody can put down is the one failure a grab mode has. Each step is said into the
field's own live region, which is in the form from the start rather than written when the
drag begins: a region added and filled in the same turn is one no screen reader is watching
yet.

**The drag is a drag, not a jump between slots.** The first attempt reordered the list as the
pointer crossed each row's midpoint, which worked and looked wrong: you could not see the row
you were holding move. Nothing in the document changes places while a finger is down now. The
row in hand is translated to wherever the pointer is; the rows it passes are translated by a
whole slot to open a gap; the list is measured once, at the moment the finger goes down; and
the one real move happens on release, into the slot the row is already drawn in — which is why
letting go looks like nothing happening. It also means the ink system is never asked to redraw
a boundary mid-drag. Depth follows the same rule as everything else on this surface: no
shadow, so the held row is lifted by taking the field's own paper and by stacking over its
neighbours.

**One movement, two ways to drive it.** The drag aims at a position and the arrows step by
one, and both end in the same `placeAt` and the same announcement — so a row moved by a
finger and a row moved by a key provably cannot land somewhere different. The remove stays a
button, because taking a row away is a different job from ordering it.

**The judgment decision 43 left open is recorded rather than reopened.** `Add another` is
`btn--secondary` — ink on leaf, small caps at 10.5px, the pairing the plan flags. It is the
second action beside the form's own Save, which is exactly where the plan says the harder
pairing belongs, so small caps stays. The row actions carry no text at all, so the
observation is moot for them rather than dodged by them.

## Findings fixed

Every finding from the three adversarial passes, INFO and pre-existing included.

- **A required `string[]` in `repeatable` mode emitted no `required` anywhere,** so the same
  declared field was refused before the request in one mode and a round trip later in the
  other. It cannot be fixed by putting `required` on a row — a list wants one nonblank row,
  not a filled one in every row, and per-row would refuse a list that is complete. The field
  says `data-list-required` and is enforced beside the drawn picker's, which is the second
  field in exactly that position; `missingRequiredChoices` became `missingRequiredValues` and
  is now asked of the fields rather than the carriers, so its answer comes back in document
  order and the person is put on the first one.
- **Every added row was drawn with the hand of the row it was copied from.** The clone lost
  its ink layers but kept `data-ink-seed`, and `mountInk` takes a seed if it finds one — two
  rows wearing the same squiggle, which is the one thing a hand per element rules out.
- **One move press re-inked every drawn element in the field.** Reordering re-appended all N
  rows, and re-appending an existing child queues a removal *and* an insertion, which the ink
  system answers by unmounting and remounting. The one row moves now; a row that did not move
  keeps the very SVG nodes it had, verified live.
- **Add, move and remove cleared no standing field error.** Removing the duplicated row a
  refusal named is the correction that refusal asked for, but a removed node and
  `input.value = ""` fire nothing, so the field kept a sentence it had already answered until
  an unrelated character was typed. Every mutation announces a bubbling `input`, which is what
  `field-errors.js` already clears on.
- **The product kept a filled eighth face and overrode the design's disabled treatment.**
  `.btn { background: var(--surface) }` made a bare button opaque where the manifest's base is
  fill-less, and `.btn:disabled` refilled the background and greyed the label — the two things
  the design names as the wrong answer ("greying the boundary on its own would make it a
  second ink"). Both are gone and the press rules exclude a disabled button instead. It
  matters from here on: a row's move controls are the product's first structurally disabled
  buttons.
- **`design/index.html`'s status row still described "a default that fills with surface",**
  the eighth face this issue denies, in the very row the issue quotes.
- **`mountListRows` was re-exported by the product and called by nothing there.** The server
  writes every boundary state into the form it renders, so the product has nothing to put
  right on arrival; a re-export nothing calls is a seam that looks wired and is not.
- **The design pages broke the rule they state:** five bare `class="btn"` across the two, the
  size rack included. The test now runs over `design/*.html` as well.
- **Seven test escapes, each proved by a mutant that survived the full suite.** The variant
  scan was anchored at line start, so `.card .btn--muted` declared an eighth face invisibly;
  the rendered-button scan only matched `btn` as the *first* class, so the row actions could
  drop every modifier; the hook, the label, the glyph and the boundary state were checked
  separately, so swapping the two move hooks left Up moving the row down with everything
  passing; the disabled-press test was passing on the bounds check rather than the guard it
  named; the collapse test asserted a row count that comes back either way rather than which
  row survives; the two custom-event listeners were only ever string-asserted, because the
  fake root delivered nothing but clicks; and nothing asserted the manifest imports every
  component sheet — the full suite stayed green with this control's stylesheet orphaned.
- **The DOM double was lenient in three ways that let tests pass for the wrong reason, and
  strict in one that rejected a correct implementation.** Selectors matched attributes only,
  so the line hunting `.ink__ground` was a no-op under test; focus was a latch that was never
  cleared, so "focus landed here" only meant "was focused at some point"; all five
  constructors were one class, so five `instanceof` guards had no coverage; and `disabled`
  existed only as an attribute, so `move.disabled = true` — correct, and identical in a
  browser — failed three tests. It now matches on classes, holds one active node, refuses
  focus on a disabled control the way a browser does, reflects `disabled`, and clones into the
  constructor the node actually has. That last one was a bug the rewrite immediately caught: a
  cloned `<input>` came back as a plain node and failed every check the control makes of it.
- **The fixtures were flat where the shipped row is nested,** so a press landing on the glyph
  inside a button — which is what every real press does — was never exercised, and the rows
  carried no `name`, which is the whole basis of "the order they are in is the order they
  post in".
- **The round trip was proved against the normalizer alone.** It now renders the form,
  harvests every control in document order, and posts it through the real
  `parseCapabilityRequest`, in both modes.
- **`setPointerCapture` could take the whole drag down with it.** It throws outright when the
  pointer it names has already gone, and it was the last thing `startListDrag` did — so a
  throw there left a row held by a gesture that had never started. It is an improvement on
  the drag rather than a condition of it (the delegated `pointermove` is what the drag runs
  on), so it is attempted and the failure ignored.
- **A press on a second row's grip did nothing at all, silently,** while another row was
  still held. Reaching for a second row is putting the first one down.
- **A row taken out of the list under the gesture holding it could be moved back into it.** A
  collapse or an htmx swap does exactly that; an arrow press then re-inserted a removed row.
  A hold whose row has left the list ends instead.
- **The keyboard mode broke on its first press, and only a browser showed it.** Moving a row
  takes it out of the document and puts it back, which blurs whatever inside it had focus —
  here the very grip driving the move. `focusout` then read that as the person leaving and
  dropped the row the arrow key had just picked up. The grip takes the focus straight back,
  and a blur raised by a move of our own is not a blur to act on. The DOM double now blurs on
  removal exactly as a browser does, so the test that pins this fails without the fix.
- **A hold could be stranded forever.** If the form was swapped out from under a drag, the
  control went on holding a row that was no longer anywhere and refused every grab after it.
  A hold whose row has left the document, or that belongs to another field, is let go of
  silently.
- **`.field-list__add` stretched the full width of the form.** It carried only
  `justify-self: start`, which is inert in the product's flex-column `.field`; measured at
  600px where the design draws it hugging at 125px.

## Verification

`bun run test` 2425 passed / 0 failed, `bun run typecheck` and `bun run lint` clean. Every
fix above was re-checked by re-applying its mutant and confirming a test now fails. Exercised
live on the running dev server: a pointer drag from first row to last — the held row tracking
the pointer 1:1, its neighbours sliding a whole slot clear, the order unchanged until release —
the grab-and-arrow
keyboard path with its four announcements, escape restoring the order, add, remove, focus
landing, the ink seeds and layers, the disabled treatment in both layers, and the
comma-separated control inside a real desk window.
