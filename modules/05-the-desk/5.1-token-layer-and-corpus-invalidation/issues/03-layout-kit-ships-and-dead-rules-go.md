# Ship the layout kit under `design/styles/`, rename `layout.css`'s `.stack`, and delete the dead control rules

Status: ready-for-agent

## Epic

Module 5 — The Desk · Epic 5.1 — The token layer, and the corpus it invalidates
(PLAN decisions 12, 49 (the `controls.css` vs `form-controls.css` row):
`modules/05-the-desk/PLAN.md`)

## What to build

Two pieces of stylesheet housekeeping that the token swap makes urgent.

**The layout kit ships, keeping its current names.** `.stack`, `.cluster`, the
flex and grid utilities, `.gap-*`, `.text-*`, `.truncate`, `.line-clamp-*` and
`.media-frame` are the vocabulary every generated screen already speaks, and they
return nothing under `design/styles/` today. Shipping them preserves ADR-0005's
stated goal that common arrangement never needs inline `style`, which is what
keeps the gate's surface small.

**`layout.css`'s own `.stack` is renamed.** The incidental `.stack` that does
exist under `design/styles/` is a page column in a file whose header states it
owns no product component. Renaming that one is cheaper than renaming the one the
model writes, and leaving both would silently give a generated stack a page
column's spacing with no error raised anywhere — the worst of the three outcomes,
because nothing fails.

**The two control stylesheets stay two files and lose their dead rules.** They
are not merged: concatenated they run 693 non-blank lines against the repo
linter's 500-line ceiling, which applies to CSS, and deleting every dead rule
still lands near 630 — so a merge can only choose a new seam rather than produce
one file. `controls.css` is no subset of the other either: four of its blocks are
page chrome (`.search`, `.pill`, `.segmented`, `.control`), and `.btn` draws half
its declarations from each file, the later one overriding only `background` and
`padding`. The defect is dead code. Fifteen of `controls.css`'s twenty-four rules
are dead or exact duplicates, including a `.btn--danger` whose hard-coded
`#fff0f2` never paints because a later rule sets `color`.

## Acceptance criteria

- [ ] Every class in the layout kit resolves under `design/styles/` and a
      generated screen using them renders correctly with no inline `style`
- [ ] The page-column `.stack` carries a name of its own; `.stack` in a generated
      screen picks up the kit's spacing and nothing else
- [ ] No dead or exactly-duplicated rule survives in either control stylesheet;
      the two files stay separate and each sits under the linter's ceiling
- [ ] The hard-coded danger-button colour is gone rather than left unreachable
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

A built capability whose item renderer uses `.stack`, `.cluster` and `.gap-*`
arranges correctly on the desk stylesheet, and its record cards no longer depend
on inline `style` for ordinary arrangement.

## Blocked by

- modules/05-the-desk/5.1-token-layer-and-corpus-invalidation/issues/02-design-lint-rung-re-derived-and-three-bans.md
