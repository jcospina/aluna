# Layout and type go to rem; drawing constants stay in pixels

Status: ready-for-agent

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

- [ ] Every layout and type value in the token layer is expressed in rem; the
      named drawing constants remain in pixels
- [ ] At 150% browser text size the layout grows with the text — no clipped
      label, no overflowing control, no fixed-height box cutting its contents
- [ ] At 150% browser text size the ink line's weight and the logo tile's
      contour are unchanged
- [ ] The rem-versus-pixel rule is stated once, in the handbook, with no values
      restated there
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Set the browser's text size to 150% on a built capability and watch the records,
the controls and the prompt surface grow together, while the drawn line keeps its
weight.

## Blocked by

- modules/05-the-desk/5.1-token-layer-and-corpus-invalidation/issues/03-layout-kit-ships-and-dead-rules-go.md
