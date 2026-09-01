# Reduce Motion quiets travel, not life

Status: done

## Epic

Module 5 — The Desk · Epic 5.11 — Contrast, motion and focus
(PLAN decision 44: `modules/05-the-desk/PLAN.md`)

## What to build

**Motion is on by default for everyone and is part of the product's personality.**
When the OS setting is on, Aluna stops **positional travel** — windows flying
open, content sliding, press-jumps — because that is what triggers nausea, while
**in-place character continues**: the companion will keep breathing, blinking and
reacting once it lands, and nothing else in place is flattened either.

Mechanically this is neither of the two things the codebase currently has:

- **not** the built blanket reset, which kills everything including in-place life,
- **not** the design's per-component opt-in, which leaves press transforms jumping
  because only transition declarations sit inside the no-preference branch.

**It is one authored axis.** The token layer exposes a central travel scale used
by positional translate/distance and its duration; Reduce Motion sets that scale
to zero. In-place animation uses a separate duration/transform path and is
untouched. A stylesheet check rejects positional travel that bypasses the shared
axis, which is what makes the promise enforceable without a hand-maintained
component selector list. A new component inherits the behavior by using the
ordinary motion primitives, and a raw bypass fails loudly.

## Acceptance criteria

- [x] With Reduce Motion on, no element travels: windows do not fly open, content
      does not slide, presses do not jump
- [x] With Reduce Motion on, in-place animation continues — nothing in place is
      flattened
- [x] With Reduce Motion off, motion is unchanged and on by default
- [x] The behaviour comes from one central axis, with **no per-component selector
      list**; a newly added component inherits it without being enumerated
- [x] A style check rejects raw positional travel that bypasses the shared axis,
      while allowing independently named in-place animation
- [x] The blanket reset is deleted and the per-component opt-in is not
      reintroduced
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Turn on the OS Reduce Motion setting and open a capability: the window appears
without flying, content swaps without sliding, and pressing a button does not
jump. Anything animating in place keeps animating. Turn the setting off and
confirm the full motion returns. Add a throwaway component with a travel
transition and confirm it is quieted without being listed anywhere.

## What landed

**The axis** (`design/styles/tokens.css`). `--travel: 1`, and every travelling
distance and duration is a multiple of it: `--travel-nudge` (1px), `--travel-press`
(2px), `--travel-lift` (−2px) and `--dur-travel: calc(var(--dur-fast) * var(--travel))`.
One media query — `@media (prefers-reduced-motion: reduce) { :root { --travel: 0 } }` —
is the whole of Reduce Motion. A distance times zero does not move; a duration times
zero lands instead of sliding, which is how a row displaced from JavaScript is reached.

**The convention that makes it enforceable without a selector list.** `transform`
says where a thing sits; `translate` is how far it travels and answers to
`--dur-travel`; `scale` and `rotate` are how it changes without going anywhere and
keep `--dur-fast`. Every mixed `transform` was split accordingly — the logo's hover
lift (travel) from its press squeeze (life), the lamp, the listbox chevron, the
choice mark, both button sets, the repeatable row. `.window--desk` moved from
`transform: translate(...)` to the `translate` property so a scale can compose about
its own centre rather than dragging the window towards the corner.

**The two old mechanisms, gone.** Every `@media (prefers-reduced-motion: no-preference)`
wrapper is deleted, and `public/css/a11y.css` — the blanket `!important` reset, whose
other half was the second focus ring decision 45 removed — is deleted with its
`@import`, its row in `AUDITED_SHEETS`, and a test pinning that it stays gone.

**The window arrival** (`design/scripts/desk.js`) no longer asks the OS anything. It
fades in and grows the last 4% into itself; the growth reads `--travel` off the token
layer, because 4% of a window sweeps its edges further than any press travels. Under
Reduce Motion it is a fade and nothing moves — measured live at 0px drift.

**The check** (`src/presentation/travel-axis.ts` + `travel-axis.test.ts`). The rules
are stated over stylesheet text rather than over files, so the same rules run against
the shipped surface and against rules written to defeat them. Twenty CSS bypasses and
five script bypasses are held as fixtures that must keep failing, and a throwaway
component written with the ordinary primitives is asserted to pass — the issue's demo,
run in the suite rather than only by hand. There is no allow-list of components in it.

## What the adversarial pass found, and what it changed

Two reviewers attacked the first implementation. Every finding is fixed.

| Finding | Fix |
| --- | --- |
| `transition: <time> <property>` is legal, and the parser read word 0 as the property — a `transform` slide passed | the layer parser classifies each word as time / easing / property |
| one `%` in a value laundered the rest (`translate: 0% 40px`) | every component is checked on its own; a state may not travel by a percentage at all |
| the length regex could not see `-40px` or `4dvh` | the rule is now "no non-zero length literal anywhere", units and signs included |
| `top`/`margin`/`padding`/`width` transitions were never checked | every geometry property answers to `--dur-travel` |
| `rotate` about a `transform-origin` outside the box is a sweep, not life | a `transform-origin` declaration is refused, with the reason |
| keyframes could fly (`left: 0 → 300px`), and `0%, 40%` steps escaped the state test | keyframe steps, comma-combined included, are checked as travel |
| `--travel-jump: 40px` in a component sheet counted as on-axis | travel tokens may only be declared in the token layer; any distance token named from a displacement must live there |
| `public/app.css` and `design/styles/index.css` were audited by nothing | both are in the motion sheet set now |
| state forms the selector list misses (`.dragging`, `[open]`, `:nth-child`) | a missed state no longer falls through to nothing: it still may not state a raw length |
| scripts could animate `{ translate: … }`, frames from a variable, or one frame | `.animate()` must state its frames inline and may not change a displacement; `style.transition` writes are refused |
| the window's 4% arrival scale was the largest surviving displacement, unreviewed | it consumes the axis (above) |
| the arrival pinned a stale box for 180ms | it animates no position at all now |
| dead `box-shadow` transition layers on both button sets | deleted |
| `scale: 1` / `translate: 0` still make a containing block | `none` where the intent is "off" |
| `will-change: transform` no longer named what moves | `will-change: translate` |
| the check only ever ran over code that passes | the fixtures above; verified by breaking a real sheet and watching it fail |
| stale prose: `docs/pet.md` still promised a static pose, `design-system.md` said the row drags "under `transform`", a test comment described a guard that no longer exists, the picker's note said windows are dragged by `transform` | all corrected; `CONTEXT.md` gained **Travel** as a term |

`PLAN.md` decision 45's mention of the a11y layer is left as written: the PLAN records
decisions as they were made, and the layer existed when it was.

## Verification

- `bun run test` — 2481 tests, 0 failures. `bun run typecheck`, `bun run lint` clean.
- Live, against the dev server on :3030 (real app and design surface):
  - the browser parses exactly one reduced-motion rule, in `tokens.css`, and it is
    `:root { --travel: 0; }`
  - at full motion: press `2px 2px`, lift `0 -2px`, travel duration `0.14s`, life
    duration `0.14s`, the working tile crawling at `1.5s`
  - with the axis at zero: press `0px`, lift `0px`, travel duration `0s` — while life
    stays at `0.14s` and the tile keeps crawling
  - a capability window arrives by fading and growing (drift −9px/−7px mid-flight),
    and with the axis at zero fades with 0px drift
  - dragging a repeatable row displaces the rows it passes through `translate`, and
    the drag lands rather than sliding when the axis is zero
  - no console errors on either surface
