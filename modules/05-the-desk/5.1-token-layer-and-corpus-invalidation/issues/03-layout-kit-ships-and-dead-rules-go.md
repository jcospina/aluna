# Ship the layout kit under `design/styles/`, rename `layout.css`'s `.stack`, and delete the dead control rules

Status: done

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

- [x] Every class in the layout kit resolves under `design/styles/` and a
      generated screen using them renders correctly with no inline `style`
- [x] The page-column `.stack` carries a name of its own; `.stack` in a generated
      screen picks up the kit's spacing and nothing else
- [x] No dead or exactly-duplicated rule survives in either control stylesheet;
      the two files stay separate and each sits under the linter's ceiling
- [x] The hard-coded danger-button colour is gone rather than left unreachable
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Implementation notes

- The kit ships as `design/styles/layout-kit.css` — the file moved out of
  `public/css/primitives.css` rather than being copied, so there is still one copy of
  every value. `index.css` imports it after the components and above `ink.css`: a
  utility and a component class are both one class of specificity, so the utility has
  to load after the component to win the tie. Every inbound reference moved with it —
  the allow-list and its cross-check test, three `public/css` headers, the developer
  preview page, the handbook and `design/README.md`.
- `.gap-0_5` and `.gap-1` became one grouped rule. They resolved to the same token
  before and after; High Meadow has no half step, and two rules with one body read as
  a scale that has one. The handbook says so now rather than claiming a clean 1:1 map.
- The page-column rename was already in the tree: `layout.css` has named it
  `.page-column` since the design corpus landed. What this issue adds is the guard on
  both sides — the kit's `.stack` comment names the collision, and a test walks every
  stylesheet under `design/styles/` to fail if a second one ever claims the name.
- `controls.css` lost fourteen rules and two `.btn` declarations that
  `form-controls.css`, imported directly after it, already restated or replaced: the
  three fill variants, the press, and every `.field*`/`.form*` block. `.field__chevron`
  stayed — it is the one field part with no counterpart there, and the native-select
  shell still reaches for it. The file went from 248 to 175 lines and now says in its
  header what it actually owns.
- Deleting `.btn:active` left `form-controls.css`'s `.btn:disabled:active { transform:
  none }` with nothing to suppress, because the surviving press rule is already
  `:not(:disabled)`. That rule went too — a cleanup that creates a dead rule in the
  other file has not met the criterion.
- What did *not* go: `color: var(--ink)` on the light button variants restates the
  base, but each variant naming its own measured AA label colour is the convention the
  palette audit reads, and `high-meadow-token-layer.test.ts` pins two of the pairs
  outright. Removing them would trade documented dead weight for an undocumented rule.
- The issue's premise about `#fff0f2` was stale before the work started: issue 01
  had already turned that literal into `var(--surface)` under its no-literal-colour
  criterion. The criterion is met because the whole unreachable `.btn--danger` rule is
  gone, not because this change removed a hex.
- `layout-kit.test.ts` pins the move and the cleanup. Each of its guards was
  mutation-tested: re-adding a dead `.btn--danger`, re-adding `.btn:disabled:active`,
  restating a `.btn` property inside the reduced-motion block, letting a new
  `design/styles/` file claim `.stack`, and letting shell chrome claim a kit class are
  all caught.

## Verification

- `bun run test` — 1,211 passed, 0 failed. `bun run typecheck`, `bun run lint`,
  `git diff --check` — clean.
- Cascade proof on the live controls bench: re-inserting all fourteen deleted rules
  at their exact position inside `controls.css` through the CSSOM changed **0 of 1,082
  elements across 28 computed properties**. The rules were unreachable, not merely
  redundant.
- `.btn:active:not(:disabled)` is the only rule in the manifest that transforms a
  button, and it does not match a disabled one while pressed — confirmed against the
  live rule set, which is why the suppression rule was safe to delete.
- Browser at `http://localhost:3030/` — every stylesheet 200 including
  `/design/styles/layout-kit.css`, no request for the retired path, no console errors.
  `.stack`, `.cluster`, `.gap-*`, `.grow`, `.truncate` and `.line-clamp-2` all resolve
  on live record cards; the only inline `style` left on a card is a chip fill, which is
  the escape hatch rather than arrangement.
- `design/controls.html` renders unchanged: the seven button variants with their
  measured contrast pairs, all six field types, and the filled / invalid / read-only /
  disabled states.
- Independent quality and adversarial reviews were run before the live test. Every
  adversarial finding was repaired: the dead suppression rule, a test filter blind to
  `--modifier` classes, a parser that compared only the first rule per selector, a
  hard-coded file list, an overstated cascade claim in the kit header, the stale
  manifest header, and the handbook's `.gap-*` sentence.

## HITL test instructions

1. `bun run dev` if the project is not already listening on port 3030.
2. Open `http://localhost:3030/capability/reading_log`. The record card should read as
   one column: title and rating on one row with the rating pushed right, the author
   under it in muted type, and a wrapping row of chips below — no overlap, no full-width
   chips, no collapsed spacing.
3. Open DevTools → Network and confirm `design/styles/layout-kit.css` returns 200 and
   nothing requests `/static/css/primitives.css`.
4. Inspect the card's outer `<div class="stack gap-2 w-full">` and confirm it computes
   to `display: flex; flex-direction: column; row-gap: 8px`.
5. Open `http://localhost:3030/design/controls.html` and scroll to **Buttons** and
   **Fields**. Confirm the seven variants still carry their fills and labels, that
   pressing one displaces it 2px, that a disabled button does *not* move when pressed,
   and that the field states (filled, invalid, read-only, disabled) look as before.
6. Optional, and the only step that spends a provider call: type a new capability into
   the prompt bar and confirm the freshly generated card arranges on the same classes.

## Living demo

A built capability whose item renderer uses `.stack`, `.cluster` and `.gap-*`
arranges correctly on the desk stylesheet, and its record cards no longer depend
on inline `style` for ordinary arrangement.

Exercised on the running corpus: `reading_log` and `medication_tracker` both compose
their cards from `.stack`, `.cluster`, `.gap-*`, `.grow`, `.truncate`, `.line-clamp-2`
and the `.text-*` steps, and every one of those now resolves from `design/styles/`
rather than from the shell bridge. The kit also reaches the surfaces the bridge never
covered — the standalone architecture documents, the GitHub Pages build and
`/demo/few-shot-gallery` — because they load the manifest and nothing else.

## Blocked by

- modules/05-the-desk/5.1-token-layer-and-corpus-invalidation/issues/02-design-lint-rung-re-derived-and-three-bans.md
