# The desk ground: wallpaper, a floating prompt bar, and the clearance no window may enter

Status: done

## Epic

Module 5 — The Desk · Epic 5.4 — The desk: wallpaper, logo layer, prompt bar
(PLAN decisions 1 (the page's three layers), 5; design D5:
`modules/05-the-desk/PLAN.md`)

## What to build

A wallpaper, a logo layer and a prompt bar are what the page ships. This issue
lays the ground and the bar; the logo layer is 5.4/02.

- The desk ground fills the viewport. The header row that carried the styled
  wordmark is deleted, and the wordmark is placed nowhere else — only the Aluna
  name is left.
- The prompt bar floats clear of all four edges and is never full width.
- **The stylesheet owns the clearance number and JavaScript reads it back.**
  `--prompt-clearance` lives in the token layer, and the desk's geometry script
  reads the token at load rather than restating the number, keeping the literal
  only as a fallback for a stylesheet that has not applied. This is the seam that
  makes the floor in 5.6/02 correct by construction rather than by two files
  agreeing.
- Nothing may be dragged or resized into that strip. Maximise already respects
  the clearance under `design/`; the shipped shell reserves no strip at all, so
  this issue carries the token and the reserved strip over, and 5.6/02 carries
  the drag and resize floors once windows exist.

The point of the reservation is concrete: the tail of a records list is exactly
where a user scrolls, and it must never be hidden under the bar or unclickable.

## Acceptance criteria

- [x] The page is a wallpaper and a floating prompt bar; no header row and no
      wordmark survive in the codebase
- [x] The prompt bar clears all four edges and is not full width at any viewport
      the desk supports
- [x] The clearance is declared once, in the token layer, and read back from it
      at load; the JavaScript literal exists only as a fallback
- [x] Content bounded by the clearance stops above the bar rather than under it
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Open the homepage: the meadow ground with the prompt bar floating over it, clear
of every edge. Type a prompt and confirm the build still runs and narrates.

## Blocked by

- modules/05-the-desk/5.3-content-region-lifecycle/issues/02-every-swap-target-fails-loudly.md

## Implementation notes

**The ground was already there; the page shape was not.** 5.1/01 moved the token
layer, the fonts and the wallpaper under `design/` and had the shipped shell load
them, so `.shell` already filled the viewport with High Meadow's meadow. What it
still had was the Module 1–4 page shape: a content column with the prompt bar as
the last item in its flow, cleared of the bottom edge by padding. This issue
changes the shape, not the artwork.

**The bar floats, and it floats over the ground the user can see.** `.prompt` is
`position: absolute` against `.content-column` rather than the viewport. Anchoring
it to the viewport would centre it across a sidebar that is still on screen, so
the bar would sit off-centre on the ground and drift as the rail collapsed. The
containing block goes away with the rail in 5.4/02; the anchor does not have to.

**The bar's width is bounded twice and full at neither.** `min(46rem, calc(100% -
6rem))` above the desk breakpoint and `calc(100% - 2.5rem)` below it — the second
because 6rem of gutter on a phone leaves a bar too narrow to type in. Ground shows
either side of it at every width the desk supports. A bar welded to the bottom
edge is a taskbar, and D4 removed the taskbar.

**One number, three surfaces, no two files agreeing.** `--prompt-clearance` is
declared once, in `design/styles/tokens.css`, and registered there as a `<length>`
so `getComputedStyle` resolves it to pixels rather than handing back the rem
literal. Everything that stands on the strip reads it from there:

- the content area reserves it as a block at the end of its own content,
- the logo grid's bottom edge sits on it (`design/styles/components/desk.css`),
- the bar itself is anchored by it, as `calc(var(--prompt-clearance) -
  var(--control-h-lg) - var(--space-1))` — the clearance less the bar's own
  height, which is the composer's `min-height` stated from the same two tokens.
  Written as that subtraction, the bar's top edge lands *on* the strip by
  construction, which is exactly where the content area stops. Measured live: the
  content's inner bottom and the bar's top are the same pixel, at 100% and at 150%
  browser text size.

**Say plainly which half of the readback ships.** `design/scripts/desk-geometry.js`
is the JavaScript half and already reads the token at load
(`readLength("--prompt-clearance", FALLBACK.clearance)` inside `refreshGeometry()`,
called at module top level), keeping `78` only as the fallback for a stylesheet
that has not applied. **It is not imported by the shipped page.** What this issue
put in the product is the *CSS-side* readback — the reserved strip and the bar's
anchor, both `var(--prompt-clearance)` — and the invariant tests around it. The
JavaScript half stays in `design/` because nothing on the shipped page computes
geometry yet: there is no window until 5.6/01, and the logo grid's floor is pure
CSS. 5.6/01 wires the module in the way `public/ink.js` wires `design/scripts/ink.js`
(`import … from "../design/scripts/ink.js"`), and 5.6/02 is its first consumer.
Written down here so that issue does not assume the import already exists.

**The bar's width came from the design, not from the shell it replaces.** The
temporary shell's composer was 46rem wide; `design/styles/components/desk.css`
ships `.prompt-bar` at `min(33.75rem, calc(100% - 6rem))` with a
`calc(100% - 2.5rem)` phone form, and `design/styles/` is the source of truth for
the visual system (PLAN decision 7). The shipped bar now carries the design's
width and both gutters rather than quietly keeping a wider one.

The two structures are not the same element, which is why this is a port and not a
shared rule: the design draws `.prompt-bar` itself, while the shipped bar splits
into a drawn rail (`.prompt__composer`, which is what `public/ink.js` names) and a
notice above it. One divergence is deliberate and marked in the stylesheet: the
design puts the bar at `z-index: 20`, which in the shipped shell is the legacy
drawers' own level, so the bar would stay bright over a dimmed desk. It sits at 5,
under the backdrop, until those drawers are deleted and 5.6/01 sets the order
against the window instead.

**The notice moved above the rail.** Below the rail is the ground the bar floats
over — a notice there would sit off the bottom of the screen or push the bar out
of its own strip. It is set as a desk label already (surface-coloured, with the
shared shadow), so above the bar is where it was always dressed to sit.

**The header row and the wordmark.** Both were already gone (5.1/01 deleted the
styled lockup with the header row that carried it; ADR-0001 records that its
visual half is superseded). This issue holds that deletion rather than repeating
it, and `desk-ground.test.ts` now fails if either comes back.

### Demo-vs-real boundary

None. Everything here ships in the product page a user loads at `/`. There is no
`/demo/*` surface for it, because the desk ground *is* the homepage.

## Verification

```
bun run test
bun run typecheck
bun run lint
```

`bun run test` → 1315 passed, 0 failed (2 shards, 76s). Typecheck and lint clean.

New coverage — `src/presentation/desk-ground.test.ts`:

- the ground fills the viewport (`100dvh`, the wallpaper, `cover`);
- no header row and no wordmark survive in the shipped page or its stylesheets;
- the bar is placed against `.content-column` rather than pinned into the flow, and
  the markup actually puts it inside that column — the box the centring resolves
  against;
- both widths are bounded, neither reaches an edge, and the centring pull-back is
  pinned, without which a bounded width still runs off the ground;
- the bar's whole box is the rail: the notice is out of flow and click-through, so
  nothing in the form's flow can push its top edge past the strip;
- `--prompt-clearance` is declared exactly once across every shipped stylesheet,
  script and page, and registered as a `<length>`;
- the number is restated nowhere — the reserved strip, the logo grid and the bar
  all read the token;
- the strip is deep enough to hold the bar, so the subtraction that anchors it can
  never compute a negative offset and slide the bar off screen;
- the geometry script reads the token at load, with `78` appearing only inside
  `FALLBACK`.

Updated: `src/presentation/high-meadow-token-layer.test.ts` — the assertion that
pinned the bar's old bottom-edge padding now pins the floating anchor.

Mutation-checked, so the rung is not vacuous: shrinking the clearance below the
bar's height, dropping the reserved strip, giving the bar `width: 100%`, and
restating the clearance as `1.875rem` each fail it. The adversarial pass found two
more mutations that did *not* fail it — a deleted centring transform and a notice
back in the bar's flow — and both are pinned now.

Live-checked against the dev server on `:3030`, with the served files confirmed to
match the working tree:

- `--prompt-clearance` resolves to `78px`; the strip's top edge and the bar's top
  edge are the same pixel — a difference of 0, with no notice, with a one-line
  notice, and with a wrapped one.
- Scrolled to the end of an overflowing list, the last row stops above the bar and
  is still hit-testable; a point just above the strip hit-tests to the content
  rather than to the form, and the bar's own centre hit-tests to `.prompt__field`.
- At 1280×800 the bar is 540px wide — the design's 33.75rem — clearing 362px of
  ground either side and 30px below; at 375×812, 20px either side and 30px below.
  The field is 432px inside it, so the placeholder still fits at the design width.
- At 150% browser text size the strip grows to 117px and the content still stops
  exactly at the bar — the layout grows with the reader (decision 46).
- A notice — none, one line, wrapped — renders 4px above the rail, never moves the
  bar, and never breaches the strip: the form's top stays on the strip's top edge in
  all three cases. A click at the notice's centre lands on the content behind it.
  The out-of-band swap and `public/app.js` both find the notice by id, so moving it
  in the DOM changed nothing about how it is written.
- With the developer drawer open, the point over the bar hit-tests to `.backdrop`:
  the bar is dimmed with the desk rather than floating above the drawer.
- The rail is still drawn by the ink system (`is-ink`, two SVG layers per edge),
  the focus ring still lands on the rail, and the HTMX wiring is untouched.

### Adversarial findings, fixed

- **The notice grew the bar up out of its own strip, over live content, and ate the
  clicks there.** `.prompt` is anchored by its bottom edge, so a notice in its flow
  added its height to the *top* of the bar. A one-line notice put the bar's top
  22px above the strip and a wrapped one 59px — a transparent `<form>` lying over
  the tail of a scrolled records list, with `elementFromPoint` returning
  `#prompt-notice` where it should return the list. That is precisely the failure
  the reservation exists to prevent, and it was new: as a flow child the bar could
  not overlap by construction. Deflection copy is model-written, so nothing bounded
  the wrap count. The notice is now `position: absolute; bottom: 100%` — out of the
  bar's flow, so the bar's box is the rail and nothing else and what the anchor
  assumes about its height is simply true — plus `pointer-events: none`, because a
  message with nothing to click must never be what a click lands on. Re-measured:
  the bar's top is the strip's top edge in all three states (no notice, one line,
  wrapped), and the point just above the strip hit-tests to the content again.

  Worth recording that my own first check missed this. I measured the *composer's*
  top edge, which never moved, and read that as the bar staying inside the strip.
  The box that had to be measured was `.prompt`.

- **The strip was reserved in the one form an engine is allowed to drop.**
  `padding-bottom` on a scroll container has a long history of being left out of the
  scrollable overflow area, and where it is, the last strip's worth of a list is
  unreachable — the exact symptom the reservation is for, on the exact surface it
  matters. Verified honoured in Chromium here and unverifiable in WebKit from this
  environment, so the strip is now an in-flow `.content::after` block of the same
  token height. Identical layout; no engine drops content.

- **The width test could not catch the bar sliding off the ground.** It pinned
  `position`, both bounded widths and three full-width forms, but never
  `transform: translateX(-50%)`. Deleting that one line left both test files green
  while the bar's right edge ran 104px off the column and the page grew a horizontal
  scrollbar. The centring pull-back is now asserted, as is the bar's containment
  inside `.content-column` — the markup the centring resolves against, which was
  also unpinned.

- **Three brittle assertions in the new rung.** `\b78\b` matches inside a decimal, so
  an unrelated `0.78` anywhere in `desk-geometry.js` would have failed under a
  message about the clearance; it now uses lookarounds. The `readLength` check
  matched one exact source line and broke on a rename or a wrap; it is a regex now.
  And `selector.replace(".", …)` escaped only the first dot — harmless for today's
  single-class selectors, latent for any compound one.

- **The sweeps had holes.** "Declared once / never restated" skipped `public/app.css`,
  `public/*.js` and `src/web/`; the wordmark guard read three files. Both widened —
  the rung went from 127 to 189 assertions.

- **The bar was quietly wider than the settled design.** It kept the temporary
  shell's 46rem while `design/styles/components/desk.css` ships `.prompt-bar` at
  `min(33.75rem, calc(100% - 6rem))`, and `design/styles/` is the source of truth
  (PLAN decision 7). Keeping the wider one would have been a design decision made
  by omission. It now carries the design's width and both gutters.

- **Stale comments in the bridge manifest.** `public/app.css` still described
  `shell.css` as a "top bar" and `prompt.css` as the "bottom-pinned prompt composer".

Accepted rather than fixed, and recorded here: the focus ring paints 6px above the
rail (`outline: 3px` at `outline-offset: 3px`), so while the field is focused the
ring overhangs the strip onto the last few pixels of content. Outlines do not
hit-test, so nothing is covered or blocked, and shrinking the ring would break the
focus rule (PLAN decision 45) for a purely visual overlap.

Checked and clear: stacking (the bar is dimmed and pointer-blocked under any open
drawer, and the record modal is `showModal()` in the top layer, so z-index cannot
reach it); containing block (no transform/filter/contain ancestor, and
`src/web/fragments.ts` never touches the form on any path, `/capability/:id`
included); the notice move itself (every writer addresses it by id, all swaps are
`hx-swap-oob="innerHTML"`, no combinator or ordering assertion depends on it); and
the existing rungs (no custom property beyond the two `--ink-*` the seam permits,
no border, no literal colour, and the rail is still drawn).

## HITL test instructions

1. Use the server already on `http://localhost:3030` (or `bun run dev`).
2. Open `http://localhost:3030/`.
   - The page is the meadow, edge to edge, with the prompt bar floating over it.
     Ground is visible above, below and either side of the bar. The bar is not
     full width and is not welded to the bottom edge.
3. Type *"I want to keep track of my notes."* and press **Make it**. The build
   runs and narrates as before — the bar's wiring is unchanged.
4. Open a capability with enough records to scroll, and scroll to the very end.
   - The last record stops **above** the bar. It is never hidden under it, and it
     is still clickable.
5. Set the browser's text size to 150% and scroll to the end again.
   - Everything grows together and the last record still stops above the bar.
6. Narrow the window to phone width.
   - The bar keeps ground either side of it and still clears the bottom edge.
7. Open the developer panel with the `</>` icon.
   - The bar dims with the rest of the desk rather than staying bright over the
     drawer, and clicking it dismisses the drawer.

8. If you have Safari to hand, repeat step 4 there. The strip is reserved as
   in-flow content precisely so this cannot differ by engine, and this is the one
   check that could not be run from here.

Known and deliberately untouched: with capabilities present, the collapsed legacy
capability rail leaves a narrow sliver of itself on the left. It predates this
issue (`flex: 0 0 16rem` with `flex-basis: 0` and `min-width: auto`,
`public/css/toolbar.css`) and that rail is deleted outright by 5.4/02, when the
logo layer replaces it.
