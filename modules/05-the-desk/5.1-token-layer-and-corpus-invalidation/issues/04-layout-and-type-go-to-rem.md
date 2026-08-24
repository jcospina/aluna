# Layout and type go to rem; drawing constants stay in pixels

Status: done

## Epic

Module 5 — The Desk · Epic 5.1 — The token layer, and the corpus it invalidates
(PLAN decision 46: `modules/05-the-desk/PLAN.md`)

## What to build

One pass re-deriving the design's numbers so browser text scaling grows the box
along with the text it holds. Text scaling is the most-used accessibility setting
there is, and a layout in pixels ignores it.

**To rem:** body size, the 20px window title, the 10.5px small caps, the 96px
label measure, the 180px grid track, the 276×176 window minimum, every gap and
padding, and geometry clearances such as the prompt-bar floor introduced in
5.4. JavaScript reads the computed value (reported in pixels by the browser) and
does not own a second layout constant.

**Staying in pixels:** the ink line's 2px weight and its deviation, the logo
tile's 32px box and its 1.25px contour, and the 10% corner clip. These describe a
picture rather than a layout, and scaling them changes the artwork's character —
a hand-drawn line that thickens with the user's text size stops reading as the
same hand.

The rule is the deliverable, not just the conversion: a value that positions or
sizes a box goes to rem, a value that draws goes in pixels, and the distinction
is recorded where the next person adding a token will read it.

## Acceptance criteria

- [x] Every layout and type value in the token layer is expressed in rem; the
      named drawing constants remain in pixels
- [x] At 150% browser text size the layout grows with the text — no clipped
      label, no overflowing control, no fixed-height box cutting its contents
- [x] At 150% browser text size the ink line's weight and the logo tile's
      contour are unchanged
- [x] The rem-versus-pixel rule is stated once, in the handbook, with no values
      restated there
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Implementation notes

Every conversion is the original number divided by 16 — the browser's default
text size, and the size `rem` resolves against, since nothing declares a
`font-size` on the root. The whole diff round-trips: each rem value multiplied
by 16 is the pixel value it replaced, so the surface at the default text size is
pixel-identical to what it was.

**What moved.** `tokens.css` carries the type ladder, the small caps, the eight
spacing steps, the prompt-bar clearance and the logo cell. Everything the
component sheets stated as a raw length — the window bar's padding and its
lamps, the record's padding and the grid track it lays out on, the control
heights and the shell padding inside them, the listbox panel, the prompt bar's
own box, the desk's floor, and the document furniture on the design pages —
moved with them. `public/css/` needed three: the detail modal's width and the
two 20px icon boxes. Nothing else there states a length of its own.

**What stayed.** The line and every weight of it, the deviation and the rest of
`scripts/spec.js`, the focus ring, the hard shadow offsets, the press and lift
displacements, the hatch on a pending tile, the gutters a drawn line overhangs
into, the 1px visually-hidden clip, and the two breakpoints. The logo tile's
corner was already a percentage and needed nothing.

**The window minimum, the maximise inset and the clearance.** These were the one
place the rule needed a mechanism rather than a substitution: `desk-geometry.js`
held `276 × 176` and `18` as literals and parsed `--prompt-clearance` out of the
computed style. A custom property normally hands back what was written — a rem
literal, which the old parse would have read as `4.875` pixels — so `tokens.css`
now registers the four lengths with `@property … syntax: "<length>"`. The
browser resolves them, `getComputedStyle` reports pixels, and the script keeps
one `readLength` helper with the old literals demoted to fallbacks. Where the
registration did not take it resolves the rem itself rather than dropping to the
literal — falling back there would leave the windows stopping on one floor and
the logo grid on another, which is the drift the file reads the stylesheet to
avoid.

Reading them once was not enough either. The reader's text size is a setting that
changes with the page open, and geometry held from module load would clamp a
window to a floor the prompt bar had already grown past. Every function that
answers a question about the desk re-reads first, so a clamp is right whether or
not anything noticed the change, and the desk watches its own box as well as the
viewport — the two no longer move together, because text scaling grows the desk
without the window resizing at all.

**The logo tile, and the cell that had to learn to carry both.** The tile stays
in pixels. It was converted first, on the argument that the cell is derived from
it and that a bigger tile is the same picture — and that was wrong. The artwork
is a filled-path drawing with its own contour, so a tile scaled to 96px scales
every edge inside it, which is the hand thickening: exactly what the pixel side
of the rule exists to prevent. The handbook and the issue both name it, and both
are right. (The "32px box" they name belonged to the shell-drawn landform tile,
deleted from the tree and recorded as deleted in `logo.html`; the tile that
shipped is `logo-contract.css`'s at 64px.)

That leaves `--logo-cell-w` and `--logo-cell-h` as the one place a length is part
pixels and part rem, because what they measure is: a px tile stacked with rem
padding, a rem gap and two lines of rem label. Written as a plain rem literal the
cell is only the right size at a 16px root — the grid lays these out as fixed
`auto-fill` tracks, so at Chrome's "Very small" the row overflows a desk that
clips, and at "Very large" a third of every row is dead space. They now state the
sum, `calc(64px + 2.8125rem)` and `max(6rem, calc(64px + var(--space-1) * 2))`,
and the track matches its content at every setting the browser offers.

**The rule.** Already stated, without values, in `design/design-system.md`
§Spacing and units — written ahead of the conversion, as PLAN decision 5 was for
`--prompt-clearance`. Nothing was added to it and nothing was added elsewhere.
`design-tokens.test.ts` now pins the split to the stylesheet so the next token
cannot land in the wrong unit.

The §Type section of `design/index.html` states the same rule in its own words,
and did so before this issue. It was left alone: the pages are the settled record
and the handbook is the names-only companion, and every other rule in the system
— the palette, the line, the type — is written in both. The pages also carry a
convention the handbook cannot ("the pixel sizes named on these pages are what
those come to at the browser's default"), which is what keeps every `20px` and
`36px` in the spec tables true. If that reading of "stated once" is wrong, the
fix is to delete the page's paragraph and point at the handbook — say so and it
goes.

## Verification

- `bun run typecheck` and `bun run lint` clean.
- `bun run test`: 1236 passed, 0 failed, 129 files across 2 shards, 575s. Worth
  recording because it took a quiet machine to get there: three earlier runs each
  timed out on a different handful of the heavy build and evolution integration
  tests (1, 3 and 5 of them) while review agents were running beside them, and
  every one of those passes on its own in seconds. None reads a stylesheet.
- The conversion arithmetic was checked mechanically across the whole diff, twice
  and independently: every removed pixel value and its replacement rem value × 16
  agree exactly, to 1e-12, across all ~150 conversions.
- `design-tokens.test.ts` gained a units rung — the spacing and type ladders and
  the four lengths the desk script parses must be rem, the logo cell must carry
  both a rem term and its px tile, every `--line*` weight must be px, and no
  stylesheet under `design/styles/` or `public/css/` may set a type size in
  pixels. Proven to bite: flipping `--space-3` to `12px` and `--line` to
  `0.125rem` fails two of them.
- Live, on the running app at :3030 with a built capability open. At the default
  size nothing moved. At 150%: the search shell 44 → 66, the button 36 → 54, the
  record 219 → 324 tall, type 15.04 → 22.56, and no horizontal overflow.
- Live, on `design/controls.html` at 150%: `--control-h` 36 → 54px, the field and
  the button both 54 tall, type 22.56. Every one of the 234 drawn paths still
  carries `stroke-width="2"`, and the ink SVGs map their viewBox 1:1 to CSS
  pixels, so that is 2px on screen.
- Live, on the desk: the logo cell measured against its own content at five root
  sizes — 9px, 12px, 16px, 20px, 24px — track and content agree to within 0.1px
  at every one (89.3, 97.8, 109, 120.3, 131.5). The tile holds 64px throughout.
- Live, the geometry with the text size changed mid-session and no reload: the
  clearance follows CSS 78 → 117, the minimum 276×176 → 414×264, the inset
  18 → 27, a maximised box recomputes 1076×546 to 1051×819, and a window shoved
  past the floor stops with a gap equal to the clearance at both sizes. Setting
  the size back returns every number.
- Independent quality and adversarial reviews were run before the live test, and
  every finding is repaired or answered — see below.

## What the adversarial reviews found

Repaired: the logo tile wrongly converted, and the mixed-unit cell that revealed;
the units test pinning the cell in a form that would have blocked its own fix;
geometry frozen at module load, so a text-size change left windows clamping to
the old floor; a fallback that dropped to the pixel literal when a `@property`
registration had not taken, leaving the window floor and the logo grid on
different floors in a browser without it; `tokens.css` pointing "below" at
`@property` blocks that are above it; PLAN decision 5 still quoting
`calc(20px + …)`; the units test not scanning `public/css`.

Answered rather than changed, and worth overruling if you disagree:

- **The rule appears in the handbook and on the design page.** Left as it was —
  see the implementation note above.
- **The breakpoints stay in pixels.** PLAN decision 48 states them that way, so
  the layout scales with the reader's text size but the point at which it changes
  shape does not. `em` in a media query would track it. That is a decision to
  take deliberately, not a unit to convert in passing.
- **`--line-logo-tile` and `--line-logo-subject` are consumed by nothing.** They
  describe the deleted shell-drawn tile. This issue names the contour as staying
  in pixels, so they were left in place; deleting a dead token belongs with the
  dead-rule sweep, not here.
- **The handbook says "Two breakpoints" and `design/styles/` has four.** The
  other two are in `doc.css` and `layout.css`, which style the design documents
  rather than the product. Pre-existing, and not about units.

## HITL test instructions

1. `bun run dev` if the project is not already listening on port 3030.
2. Open `http://localhost:3030/` and click a capability's logo — `Medication
   tracker` or `Reading log`. Note how the record card, the search field and the
   `NEW …` button look.
3. In Chrome, open Settings → Appearance → **Font size** and set it to **Very
   large** (150%). Firefox and Safari have the equivalent under their own
   Appearance / Advanced font settings.
4. Return to the tab — no reload. The records, the search field, the button and
   the prompt bar at the bottom should all be half again as big, with nothing
   clipped, no label cut off, and no sideways scrollbar.
5. Open `http://localhost:3030/design/controls.html` and scroll to **Fields** and
   **Buttons**. Every control should be taller and set in larger type — and the
   drawn line around each one should be exactly as thick as it was. That is the
   thing to look for: the boxes grew, the hand that drew them did not.
6. Open `http://localhost:3030/design/index.html` and scroll to **The desk**. The
   logos should be the same size as before — the tile is a drawing and does not
   grow — while their labels and the prompt bar do. The bottom row should still
   stop clear of the prompt bar rather than sliding under it, and the rows should
   sit evenly with no gap opening up between them.
7. Still at 150%, open a capability on that desk, press the green lamp to maximise
   it, and drag it downward. It should stop on the prompt bar's strip rather than
   sliding under it — that is the geometry reading the grown clearance rather
   than the one it was loaded with. Try "Very small" too: the logo rows should
   still not collide.
8. Put the font size back to Medium and confirm the surface is exactly as it was.

## Living demo

Set the browser's text size to 150% on a built capability and watch the records,
the controls and the prompt surface grow together, while the drawn line keeps its
weight.

Exercised on the running corpus: `medication_tracker` open on the desk at 150%
grows its record, its search field and its create button by exactly half again,
and the prompt bar under it with them. The design pages show the other half of
the rule — every drawn boundary on `controls.html` holds its 2px at the same
setting, and the logo tile on `index.html` holds its 64px box and its corner
while the cell around it grows to give the label room.

## Blocked by

- modules/05-the-desk/5.1-token-layer-and-corpus-invalidation/issues/03-layout-kit-ships-and-dead-rules-go.md
