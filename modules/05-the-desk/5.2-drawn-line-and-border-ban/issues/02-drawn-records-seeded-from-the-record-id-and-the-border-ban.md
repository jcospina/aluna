# Generated records carry a drawn boundary seeded from the record id, and the rung bans `border`

Status: ready-for-agent

## Epic

Module 5 — The Desk · Epic 5.2 — The drawn line, and the border ban
(PLAN decisions 9 (generated half), 10 (the fourth ban):
`modules/05-the-desk/PLAN.md`)

## What to build

The drawn line reaches the record cards, rows and tables a capability generates.
D11 applies everywhere it says it does — windows, prompt rail, buttons, inputs,
**and the records themselves**. Records are what a user looks at longest, a
straight-edged card on a drawn desk reads as unfinished, and the deleted weight
ladder leaves no softer setting to fall back on.

Both stated blockers are answered without touching the generation pipeline:

- **The hand is seeded from the record's own id.** The id is stable across view
  swaps and resizes, and it is not derived from where the element sits, which the
  rule forbids. Two renders of the same record in different positions get the
  same hand.
- **The spec, the generator and the registry are asked for nothing.** Generated
  code never learns the ink system exists — the platform's presentation layer
  applies the boundary to the containers it already owns.
- **Cost is bounded** by observing resize once per list container rather than
  once per card, since the children of a list resize together. What remains is a
  speed measurement on long lists rather than a design fork; measure it and
  record the number.

With generated boundaries drawn, ADR-0005's fourth closed axis loses its
successor list and `border` joins font family, `border-radius` and `box-shadow`
in the never-declared category. The ink system owns every boundary. This is the
ban that could not land in 5.1/02, because a generated card with neither a border
nor a drawn boundary is invisible.

## Acceptance criteria

- [ ] A card's drawn hand is a function of the record id alone — equal across two
      renders of the same record in different positions, and stable across a
      resize
- [ ] Record cards, rows and tables all carry a drawn boundary; nothing in the
      generated markup, the spec, the generator prompt or the registry references
      the ink system
- [ ] One resize observer per list container, not one per card, with the measured
      cost on a long list recorded in the issue notes
- [ ] The design-lint rung rejects any `border` declaration in generated markup
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Build a capability, add several records, and confirm every card carries a drawn
boundary rather than a CSS border. Resize the window and confirm each card keeps
its own hand. Reorder or filter the list and confirm a record's hand travels with
it.

## Blocked by

- modules/05-the-desk/5.2-drawn-line-and-border-ban/issues/01-the-ink-system-ships-in-the-product.md
