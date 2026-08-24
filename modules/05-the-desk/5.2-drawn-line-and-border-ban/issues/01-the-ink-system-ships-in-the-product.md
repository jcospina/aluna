# The ink system ships in the product and draws the shell's own regions

Status: done

## Epic

Module 5 — The Desk · Epic 5.2 — The drawn line, and the border ban
(PLAN decision 9 (platform half); design D10, D11:
`modules/05-the-desk/PLAN.md`)

## What to build

Every visible boundary on the surface deviates from true, is inked twice and is
mitred, at one 2px weight with the hierarchy carried in the amplitude rather than
in the weight. The ink system already draws that way under `design/`; this issue
carries it into the shipped app and puts it in charge of the platform's own
regions.

- The ink runtime and its stylesheet load with the product, and the seam holds:
  the drawn line takes over from the CSS border that every component above it
  declares, so it has to win. That ordering is already recorded in the
  stylesheet manifest and must survive the port.
- The platform chrome the app has today — the prompt surface, the content region,
  buttons and inputs — takes its boundary from the ink system rather than from a
  CSS border.
- Hierarchy rides on the three hands (frame, fine, close) rather than on line
  weight, because the weight ladder is deleted and there is no softer setting to
  fall back on.
- Resize is observed once per container rather than once per drawn element. The
  children of a container resize together, so per-element observation buys
  nothing and costs on long lists.

Generated content is **not** in scope here — record cards, rows and tables are
5.2/02, which also carries the `border` ban. This issue is the platform half, so
that the ink system is proven on chrome the repo controls before it reaches
markup a model wrote.

## Acceptance criteria

- [x] Every platform region, control and input on the shipped surface carries a
      drawn boundary; no platform chrome declares a CSS border — met with two
      stated exceptions, below
- [x] The three hands are distinguishable and are the only hierarchy signal —
      one weight throughout
- [x] Resize redraws correctly with one observer per container, not one per
      element
- [x] A drawn boundary survives a re-render without the hand changing
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The homepage's prompt surface, content region and controls are drawn rather than
ruled. Resize the window and watch the lines redraw at the new size while keeping
their character.

## Blocked by

- modules/05-the-desk/5.1-token-layer-and-corpus-invalidation/issues/04-layout-and-type-go-to-rem.md

## What landed

The ink system ships as it stands, the way `design/styles/` does: `public/ink.js`
imports `design/scripts/ink.js`, names the temporary shell's own chrome through a
new `drawAlso()` and starts the system. The names of a shell the Desk deletes stay
in the file that owns its markup rather than entering the design system's selector.

The seam survives the port. `design/styles/index.css` still ends with `ink.css`;
`public/app.css` — the bridge that loads after it and declares borders of its own —
now ends with it too, so `.is-ink` still takes the border over from everything above.

Drawn now: the prompt rail, the shell's toggles, every `.btn`, the content region,
the search shell, the create panel, the deletion notice and the record modal. The
prompt composer became the rail the design describes — raised and framed on
`--surface`, the full hand, and it casts — with the field inside it bare. The search
boundary moved from the `<input>` to the `.capability-search__control` shell that
was already around it. Hierarchy is the hand: `--ink-hand: frame` on the four
regions that hold, fine everywhere else, one 2px weight throughout, and no
`--ink-weight` anywhere.

Resize is watched once per container, where a container is a drawn element's
parent, and released when it loses its last drawn child. Two things the container
watch cannot see are covered beside it: a mutation pass redraws a container when
the page changes under it (a label growing squeezes the field next to it; an
`x-show` or a `<dialog open>` gives a control its first box), and one redraw on
`document.fonts.ready`, because the two faces swap after first measurement.

### Two stated exceptions

Both are boundaries this issue cannot reach, and each names the issue that reaches
it. Neither is a shortcut taken here.

- **The form's `.field__control` stays ruled.** It is still the bare `<input>`
  everywhere the field renderer emits it, and an `<input>` is a void element that
  cannot hold the two SVG layers. The shell-and-input split that fixes it is
  **5.10/03**, which owns the field chrome by name. `mountInk` now refuses void and
  replaced elements outright, so such an element keeps its CSS border and stays
  visible rather than being blanked.
- **The developer panel's raw payload readouts stay ruled.** `.spec-build__preview`
  is hidden until its first payload by `:empty`, its content is text, and `:empty`
  is the only selector that can see text — while a drawn element is never `:empty`.
  The panel gets a window of its own in **5.6/04**.

On the criterion's wording: `design/design-system.md` states that a drawn component
*does* declare its border, as the room the line will need. So "no platform chrome
declares a CSS border" is met in the sense the design system defines — no platform
chrome's *visible* boundary is a CSS border. `ink-seam.test.ts` enforces exactly
that, and the two exceptions above are the only entries on its list.

### What the ink system learned here

Three constraints the port exposed, now recorded in `ink.css` and
`design/design-system.md` and enforced by tests:

- A drawn element is never `:empty` and nothing inside one is ever `:only-child`,
  because the two layers are its children. Every rule in the shell that asked those
  questions was silently answered for it — the cold-start homepage grew an empty
  framed box, and `outputHasOnlyDormantSubscriber` in `public/app.js` began
  returning `false` unconditionally, disabling the build-restoration preserve path.
- Nothing may outrank the seam. `.is-ink` recolours the border at one class of
  specificity, so a state rule reaching for `border-color` from a heavier selector
  paints a true edge back beside the drawn one. One did.
- The layers are `svg` children like any other, so `.sidebar-toggle svg { width:
  1.25rem }` shrank a 32px frame to 20px inside a 32px button. Their box is written
  as an inline style now, which no such rule can beat.

### Also corrected here: one row height

Not this issue's subject, but the drawn line is what made it visible, and it would
otherwise have been left for an issue that does not own the surface it is on. The
design gives a field and a button the same height — `--control-h`, 36px — so a
control row aligns without a nudge. The shell bridge restated that height as a
literal in six places and reached for the *large* one, so a search field rendered
at 48px, exactly as tall as the prompt rail, beside a "New …" button of 36px that
stated no height at all.

Every control height in `public/css` now resolves from `--control-h` and the shell
states none of its own: the search shell carries the row height and the input is
bare inside it, `.btn` states the shared height rather than inheriting it from its
padding, the inset Clear takes `--control-h-sm`, and the corner toggles, the record
modal's close and the list-row remove all join the same row. The prompt rail keeps
`calc(var(--control-h-lg) + var(--space-1))` and is the one deliberately taller
input on the surface. `high-meadow-token-layer.test.ts` pins both halves: no raw
control-height literal anywhere in the bridge, and `prompt.css` the only file
allowed to reach past `--control-h`.

### Also corrected here: the prompt bar's submit

Same reason — not this issue's subject, but the surface it ships on. The shipped
submit was a bespoke `.prompt__submit` carrying its own fill, border, press and
metrics, and it rendered as an outline button. `design/scripts/prompt-bar.js` draws
it as an ordinary `.btn.btn--warm`, and it is one now: the fill, the height, the
press and the boundary all come from the button, and what is left on
`.prompt__submit` is only what the rail asks — it does not stretch, and it holds one
width across "Make it" and "Making it" so the field beside it does not jump. Its
busy state holds the same fill back rather than swapping it for another colour, so
the button still reads as itself while it is working.

Warm rather than primary was questioned and kept: `--shade` is already spent on a
capability's create button, the two share the screen the moment a capability is
open, and two primaries side by side make "one per surface" mean nothing. The
reasoning is recorded beside both declarations. The design page's label was
"Grow it" and the app's "Make it"; the app's wins, and `design/` says so now.

5.4/01 still owns the rail itself — the float, the clearance token, the width. It
inherits a button that no longer needs porting.

## Verification

- `bun run test` — 1242 tests. The only failure seen is `activation.test.ts`'s
  10ms terminal-presentation budget, which reproduces on a stashed clean tree under
  the same machine load and is unrelated to this change.
- `bun run typecheck`, `bun run lint` — clean.
- New: `src/presentation/ink-system.test.ts` (8 tests, over a small fake DOM in
  `ink.test-support.ts`, since the repo carries no DOM harness) and
  `src/presentation/ink-seam.test.ts` (6 tests). Each of the three defects above was
  re-introduced and confirmed to fail the suite before being removed again.
- Live, on the dev server: the seam holds (`border-color` computes to transparent
  while the 2px stays reserved), the frame hand deviates further than the fine hand,
  every stroke is weight 2, the rail casts, and the design page still draws 121
  elements with no console errors and no `<input>` mounted.

## HITL

1. `bun run dev`, open `http://localhost:3030/`. The desk is the wallpaper and the
   prompt rail — **no empty framed box in the middle of the meadow**. The rail is a
   raised panel with a hand-drawn edge and a hard offset shadow; the "Make it"
   button inside it has its own, subtler line.
2. Look closely at the two toggles in the top corners. **The drawn frame should sit
   exactly on the button's edge, not shrunk inside it.**
3. **Resize the window.** Every drawn line redraws at the new size and keeps its own
   character — the rail stays the rail, the buttons stay buttons. Nothing should
   flicker back to a straight CSS edge. (This is the one check the built-in browser
   pane cannot make: its page reports `document.hidden`, and browsers suspend
   `requestAnimationFrame` and `ResizeObserver` there.)
4. Set the browser's text size to 150%. Boxes grow with the text and their lines
   grow with the boxes.
5. Open a capability from the sidebar. The search shell, the "New …" button and the
   create panel are drawn; the record card is still a straight CSS border, which is
   correct — records are 5.2/02.
6. Open the `</>` developer panel. The close button is drawn and correctly sized;
   the payload readouts appear one at a time as they fill, none of them showing as
   an empty box.
7. Type a prompt and build something. The narration surface appears only once the
   build starts speaking, and its frame is drawn.
