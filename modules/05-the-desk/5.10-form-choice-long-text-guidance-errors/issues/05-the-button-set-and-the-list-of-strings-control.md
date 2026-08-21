# The button set drops `neutral`, renames `ghost` to `outline`, adopts C9's sizes — and a `string[]` field gets a drawn control

Status: ready-for-agent

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
Repeatable reordering is not drag-only: each row has labelled keyboard-operable
move-up, move-down and remove actions, disabled at the applicable boundary, and
focus follows the moved/surviving row predictably.

**File fields wait for Files, now Module 7.** They do not exist yet and nothing is
built for them here.

## Acceptance criteria

- [ ] `neutral` is gone and `ghost` is renamed to `outline` everywhere, including
      the handbook and the generator prompt
- [ ] Seven variants survive, with outline the only unfilled one, and each reads
      correctly on the window surface
- [ ] Three heights plus a full-width modifier resolve from the control-height
      token
- [ ] Primary carries a light label on `--shade`; secondary carries ink on
      `--leaf`
- [ ] `comma_separated` and `repeatable` both render drawn controls and preserve
      their existing distinct normalization contracts; repeatable supports add,
      edit, reorder and remove, and both round-trip the same ordered-array wire
      shape
- [ ] Repeatable reorder/remove is fully operable without dragging, with labelled
      controls, correct boundary disabled states and stable focus after mutation
- [ ] Nothing is built for file fields
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Open a record form and confirm the button row: a filled primary, a filled
secondary, and an outline as the only unfilled variant, at the declared heights.
Build a capability with a tags field and confirm the drawn list control adds,
edits, reorders and removes entries inside the window.

## Blocked by

- modules/05-the-desk/5.10-form-choice-long-text-guidance-errors/issues/04-in-field-errors-and-client-side-required-checking.md
