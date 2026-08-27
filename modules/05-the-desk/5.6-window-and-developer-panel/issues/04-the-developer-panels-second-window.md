# The developer panel is the one second window

Status: done

## Epic

Module 5 — The Desk · Epic 5.6 — The window, and the developer panel's second one
(design D13; PLAN "What this module does not do":
`modules/05-the-desk/PLAN.md`)

## What to build

The developer panel is the single exception to the one-window rule — read-only,
opened from its own tile, and allowed to sit beside the capability being watched.
It is furniture rather than a capability and already sits outside the product
voice.

- Its own tile on the desk opens it. It is not a capability and never appears in
  the capability list.
- When already open, its tile brings it to the front rather than toggling it shut;
  its clay lamp is the one put-away action, matching capability-window semantics.
- It may be open at the same time as the capability window, which is the whole
  point: a developer watches a capability while it runs.
- It is read-only. Nothing in it mutates canonical state.
- Its presentation record — box plus open/closed flag — is the second and last
  thing `localStorage` holds.
- On a phone it follows the same full-screen placement rule as the capability
  window. Only the frontmost window is exposed at a time; opening either brings
  it to the front without closing or overwriting the other window's desktop box.
  Moving back above 720px restores and clamps both desktop boxes.
- **This is one exception, not two.** No third window and no general window
  manager is added here. Module 9's experimenter surface inherits this precedent
  and lives in the same window, which is why metrics, latency and gate tuning
  belong beside it rather than in a window of their own.

The design's **Forget the remembered boxes** control lands with the second record.
It removes the single layout storage entry and resets any mounted windows to their
default, clamped desktop boxes without replacing their content, changing the
capability address or closing/cancelling a run. It resets the developer panel's
next-load open preference to closed; if the panel is currently visible it stays
visible until its own clay lamp puts it away. Capability and record state are
untouched.

## Acceptance criteria

- [x] The developer panel opens from its own tile and sits beside the capability
      window
- [x] Re-pressing the open panel's tile focuses it; only its clay lamp puts it away
- [x] It never appears in the capability list and is never confused for one
- [x] Nothing in the panel mutates canonical state
- [x] Its box and open flag persist across a reload; `localStorage` now holds
      exactly two presentation records and nothing else
- [x] Phone mode exposes only the frontmost full-screen window and does not
      overwrite either persisted desktop box; widening restores both safely
- [x] No general window manager and no third window exists
- [~] ~~Forget remembered boxes clears both presentation records and resets live
      geometry~~ — **cut by the user during review.** See *Forget remembered boxes
      was cut* below. It was built to this contract, verified live against every
      clause of it, and then removed along with the machinery behind it.
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Implementation notes

### The terminal reading is settled here

D13 said the eight stages are "set as a terminal", and design's *Still open* table
said how far past a monospace face and a well that goes was not decided. It is
decided now, and the table entry is gone: **each stage is a code block** — a drawn
frame, a caption naming the stage and the bytes that came down the wire, and the
payload in a **dark well** below it. No further. No gutter, no prompt mark and no
clock, because those describe a *session* and this describes a *build*; and no
imported editor theme, because every colour a payload wears is already on this
palette.

The well is dark, and it took two tries to get there. It began on `--ground-deep`,
which is the desk showing through a band, and the user's verdict was immediate and
correct: nobody reads code on green. The second attempt washed it out to four
percent `--ink` over surface, which was worse — Aluna's surfaces are *themselves*
green-tinted and `--ink` is a green-black, so the wash stayed green and threw away
the contrast as well. There is no neutral on this palette; every ground is the
meadow. So the well is `--ink`, which is exactly the reading D13 asked for and the
same exemption that already gives this panel the only monospace face in the
product: it shows raw payloads and stands outside the product voice. The exemption
stops at that one element — `--ink` is lines and type everywhere else, and nothing
a capability generates may fill with it.

The five tints were re-picked for the dark ground rather than carried over at half
the contrast: keys `--sky`, strings `--leaf`, numbers `--sun`, literals `--violet`,
punctuation `--ink-3`, each clearing 6:1 against the well. `--signal` is not among
them and never will be: it is the alert colour, and a payload reporting a failed
Gate is a reading rather than an alarm.

Two things that only showed up on screen. `base.css` styles every `<code>` as an
inline prose chip — a `--surface-2` fill and side padding — which inside the well
painted a pale box behind *every line*; `.devpanel__code` resets it. And the well is
inset inside the block rather than run to its edges, or the drawn frame disappears
into it on three sides.

The caption's separation from the payload is a change of fill, not a rule. A
second straight line inside a drawn box would read as the one thing on the surface
nobody bothered to draw.

### The tile is a small window now

`public/ink.js` carried a note saying the panel's readouts "stay ruled until
5.6/04 gives that panel a window of its own", because they were hidden by
`:empty` and a drawn element can never be `:empty` — the two ink layers are
children. In its own window every block stands whether a payload has arrived or
not, so `.devpanel__block` asks the ink system for its frame by name
(`data-ink`, already in `INK_SELECTOR`) and the readouts are drawn like every
other boundary on the desk.

The tile's `</>` glyph is gone. The tile is now **a small window**: a title bar in
the `--title-bar` pane gradient over a face, which is what pressing it opens, and
which no capability's artwork can be confused with because that is full-bleed and
carries no chrome.

The mark on the glass took three passes, and the last one is the only one worth
keeping. It is **drawn here, not borrowed**: a heavy prompt in the upper left with the
cursor on the line below and to the right of it, and the bottom right left empty.

That composition is the reference's, not an invention — macOS Terminal's own icon,
read off this machine rather than described from memory. What it teaches is the part
the first two passes got wrong: `>_` is not two characters typed on one baseline. The
chevron is a prompt and the bar is a cursor **on the next line**, and the empty bottom
right is what makes the pair read as a screen with something on it rather than as type
sitting on a tile.

The two failed passes, because both failures were the same mistake in different
clothes:

1. Lucide's `square-terminal` centred in a plain white tile. A frame inside a frame,
   and the tile read as unfinished beside the artwork around it.
2. Lucide's `terminal`, frameless, centred under the title bar. Better shape, still
   wrong: a **line icon from a UI set is drawn to sit inside running text at a hairline
   weight**, so at 64px on a wallpaper it read as a small piece of type someone had
   left there. Centring it in the leftover room under the band made it worse — the
   glyph's own internal asymmetry then had nothing to be asymmetric *against*.

So the weight is a subject's weight rather than `--line`. That token governs
*boundaries*, and the boundary on this tile is its edge; what sits on the glass is
artwork, with the same freedom a capability's full-bleed logo has. The stroke is 5.5 on
a 60-unit face — about 8.6% of the tile, where the reference is 6.7% — and the SVG is
handed the whole face so its own coordinates do the placing, rather than being centred
in whatever room is left.

Nothing of Lucide's geometry survived the third pass, so the attribution came back out
of `NOTICE` rather than being left there as a courtesy that was no longer true. A test
pins the two surfaces to one mark: the handbook builds the tile in script and the shell
ships it as static markup, so it exists twice and has already drifted once.

### One window implementation, two records, and a pair for a stack

- `public/desk-dev-panel.js` is the second window. Same frame, same two lamps and
  same three gestures as the capability window — a window is a window — with
  `window--dev` for the one difference that is real: what is inside it is a payload
  rather than a sentence.
- `public/desk-stack.js` is stacking, and it is deliberately a **pair rather than a
  counter**: `--win-z` is one of two literals and `is-focused` follows it. A stack
  that could grow is a window manager, and a test pins that nothing in it counts up.
- `design/scripts/devpanel.js` is the eight blocks, the tokenizer and the byte
  count, **shared** by the handbook's desk and the product's window. The panel is
  the surface a developer checks the product against; the two must not drift.
- `loadPresentation` / `savePresentation` take the key, so reading and writing the
  two records is one piece of code and they cannot differ in how much they believe
  of what they find. `fitBox`/`openingGeometry` take a per-window `first` box
  function — the capability window takes most of the desk because a collection is a
  list, the panel takes a narrow column at the right edge because it is meant to be
  read *beside* one. Everything after that first box is the same question and is
  answered once.
- Stacking coordinates the two, and nothing else does. `joinStack`/`raise`/`leaveStack`
  are the whole seam; `--win-z` is one of two literals; and below the breakpoint the
  window behind is taken out of the page, which is what "only the frontmost is exposed"
  means in practice.

### The panel had to stop being a place payloads are written into

The eight `<pre>` elements lived in the shell, so everything wrote into them by id:
the subscriber's `data-preview-target`, `app.js`'s `getElementById`, the OOB clear
on an accepted prompt, and the server seeding lifecycle metrics. A window that may
not be standing has no such elements, so all four moved:

- The subscriber's listeners name a **stage** (`data-preview-stage`), not an element.
- `app.js` **hands the payload over** (`aluna:stage-payload`) instead of writing it.
- The panel **keeps** the latest payload per stage whether it is open or not, and
  replays them when it opens. This is a real improvement, not just a port: a
  developer who starts a build and *then* reaches for the tile used to find an
  empty panel, because the interesting stages were over by the time they pressed it.
- The server seeds lifecycle metrics onto the page (`data-dev-stage-seed`) and the
  panel files them at start, which is what keeps the version history across a
  refresh. It is compact there and indented where it is shown — the panel formats
  every stage the same way, and one stage arriving pre-indented would be the only
  one it could not.
- The accepted-prompt OOB clear of eight `<pre>`s became one announcement
  (`aluna:stages-cleared`).

### Forget remembered boxes was cut

It shipped, was verified live against every clause of its contract, and was then
**removed at the user's direction**: *"its only two windows, remove that button."*

The judgement is sound. The control exists in design as a handbook-page control for
resetting the working demo, and the product case for it was always thin: a box that
no longer fits is already pulled inside on load and on every resize
(`fitToDesk`), so the stranded-window problem it answers cannot actually happen, and
what is left is a button for tidying two windows. On a surface whose whole premise
is that there is no window manager, a layout-reset control is the first piece of one.

Removed with it, because a control-less escape hatch is dead code:
`FORGET_BOXES_EVENT`, `forgetPresentation`, `resetGeometry`, `resetPanelGeometry`,
the two listeners, `Store.removeItem`, and `.devpanel__foot`. The panel now carries
**no controls at all** — eight readouts and the frame's own two lamps — and a test
pins that: it builds no `<button>` and reaches for no `.btn--` variant.

The handbook page keeps its own reset button. It resets
`aluna.design.desk.layout.v2`, which is the demo's storage and not the product's.

### Deletions

The rail this replaces is gone rather than hidden: `public/css/devbar.css`, the
`<aside class="devbar">`, the shared `.backdrop`, the `.shell-controls` toggle and
its `.panel-toggle` chrome (from `shell.css`, `a11y.css`, `components.css` and
`ink.js`'s seam list), `.spec-build__preview` in `demo.css`, and Alpine's
`devbarOpen`. `app.js`'s `formatPreviewPayload` went with them — the panel formats
its own payloads.

### Adversarial findings, all fixed

An adversarial pass over the finished change found eleven, and every one is fixed.
The four that mattered:

- **A capability window that was already up was never brought forward, and on a phone
  that made it unreachable.** `raise` was only ever called from `mount` and from a
  window's own `pointerdown`, so pressing the logo of the capability *already in the
  window* — which correctly opens nothing — did nothing at all. Below the breakpoint
  the window behind is `display: none`, so the only way back to your own capability
  was to put the panel away. A build was worse: it narrated into a hidden window, with
  no visible narration and no reachable Cancel. Three call sites now raise: `openWindow`
  (every opening, so a capability swapped into a standing window comes forward too), the
  declined press (it opens nothing, but it is still a press on the logo of the thing you
  want to look at), and a submit that finds a window already up.
- **On load the restored panel covered the capability the address named.** Both
  modules bootstrap on `DOMContentLoaded` and every `joinStack` raised, so whichever
  mounted last won — and which that was depended on whether the desk had been laid out
  yet. The address is what the page is *for*, so `joinStack` takes a `front` flag and
  the panel restored from a remembered preference joins behind. It is still raised when
  it is the only window, because a lone window behind nothing is a blank desk on a phone.
- **Opening the panel wrote a box the user never chose — and on a cold load, a
  degenerate one.** `openPanel` wrote the whole record at mount, so the computed default
  became a stored preference immediately and no later screen ever recomputed it. Worse,
  a desk that has not been laid out yet measures zero, and a box fitted to a 0×0 desk is
  `MIN_SIZE` in the corner — which is exactly what would have been written down and
  reopened on for good. The flag is now written on its own (`rememberOpen`), preserving
  whatever box is stored including none at all, and the box is only ever written where
  `fitBox` says there were edges to fit to. A freshly opened panel's record reads
  `{"open":true}` and nothing else.
- **Putting the panel away on a phone could not be heard.** The flag went through
  `savePresentation`, whose phone guard correctly refuses — but that guard is about not
  letting a narrow browser author a *desktop box*, and a flag is not one. A panel put
  away on a phone came back on the next phone load with nothing the user could do about
  it. `rememberOpen` carries no phone guard and touches no geometry.

And the rest:

- **A refused prompt wiped the panel.** The clear moved from the subscriber's
  out-of-band swap to `htmx:beforeRequest`, so a blank prompt, a queued sibling or a 500
  emptied all eight blocks — including the lifecycle history the page seeded, which
  nothing restores until a reload. It now waits for the subscriber to arrive and keys off
  its job id, so a re-swap cannot clear a build's own stages either.
- **The terminal error overwrote the Gate's verdict.** `build-error-preview` filed under
  `gate`, and for a build that failed *after* the Gate the verdict was already there.
  It files under `commit` now — the block a build fills when it lands — so a build that
  did not land says why there and every block above it still reads.
- **The tile stopped being last after the first build.** Both out-of-band logo writers
  append to the end of the layer, so a build's tile and the capability it commits landed
  to the *right* of "Developer" until the next reload put it back. `.logo--dev { order:
  1 }` is the grid's own answer and needs nothing maintained.
- **The tile's accessible name shared no word with its visible label**, which leaves a
  voice-control user with nothing to say. `Open Developer`, matching the capability
  logo's `Open Notes`.
- **A fake `document` installed at module scope broke an unrelated test file.**
  `devpanel.test.ts` needs a stand-in for four functions, and Bun loads every test file
  in a shard into one process *before* running any of them. Every browser module here
  bootstraps behind `typeof document !== "undefined"`, so the stand-in answered that
  question for all of them and `logo-attempt.js` started against a document with no
  `addEventListener`. `beforeAll`/`afterAll` now.
- **The panel's one control sat under the prompt bar on a phone** (found in the live
  phone check, and moot once the control was cut — the clearance stays, because the last
  code block would otherwise scroll under the bar).
- **`syncForm` would have written the panel's box into the capability window's record.**
  It binds gestures whose finished drag is remembered under `WINDOW_STORAGE_KEY`;
  reusing it would have stranded both windows. The panel keeps its own `syncDevForm`,
  and a test pins that it never calls the other one.
- **Dead vocabulary.** `ink-seam.test.ts` still listed `spec-build__preview` as
  ruled-on-purpose; `ink-system.test.ts` built a fake `.shell-controls`; `prompt.css`
  still explained its `z-index` against a backdrop and a panel rail that are both gone.
  An HTML comment on the tile contained the literal `[data-capability-logo]`, which two
  tests count across the raw page.

One suspicion the pass raised I acted on, and the fix was worse than the risk. The
worry was that a span per token is too many elements for the units stage, so tinting
stopped at a 20,000-character budget and the rest of the payload rode through as plain
text. That shipped, and the user hit it immediately on the very first block: the real
metrics payload is 27,000 characters pretty-printed, its third `gateRungs` sits at
character 19,949, and the panel went monochrome for the last quarter of the one thing
it exists to show.

**The budget is gone**, because the cost it was answering is not there. Measured in
the browser: the real metrics payload tints end to end in 15ms, and a 99kB units
payload in 2.5ms — a generated unit is mostly one long string, which is the cheapest
shape a tokenizer sees. The cost is real but a long way off: a synthetic 595kB of
20,000 tiny objects is 220,000 spans and 680ms, roughly forty times denser in tokens
than anything the pipeline emits. If a stage ever approaches that, the answer is a
caption that admits what is not being shown, not going quiet halfway down and letting
the reader guess whether the payload ended or the colour did.

The lesson is the one worth keeping: an unmeasured performance worry bought a
guaranteed, visible quality loss. Measure first, and never let a mitigation degrade the
surface silently.

Two it raised that are recorded rather than changed: there is no `storage` listener, so
a record written in one tab does not reach another tab's live windows (each writes only
what its own user authored, and compares against the store before writing); and the
handbook's own key is discussed below.

### A note the reviewer may want

A `localStorage` key named `aluna.desk.layout.v2` may still be sitting in a browser
that used this app before issue 02 renamed the handbook's key to
`aluna.design.desk.layout.v2`. No code in the tree writes or reads it. It is a
leftover from a previous version rather than a third record, and greenfield rules
say clear it rather than carry machinery for it (`localStorage.removeItem` in the
console, or `bun run reset` plus a site-data clear).

The two default boxes overlap on a fresh profile, and that is a consequence of the
desk rather than a defect in the panel. The logo column owns the left of the ground,
which is why the capability window is centred rather than left-anchored; the panel is
right-anchored so it sits as far from that window as the desk allows; and the right
gutter a centred 62%-wide window leaves is narrower than `--window-min-w`, so there is
no width at which two default boxes tile. The panel's default was narrowed to 30% to
leave the capability window's search rail and most of its list clear, it opens in
front, and it drags. "Side by side" in this issue means the two may stand at once —
which is the exception's whole point — not that they tile.

## Living demo

The developer panel *is* the demo surface: it is wired into the homepage desk, not
a `/demo/*` route. Open a capability, then open the developer panel from its tile,
and watch the two windows sit side by side. Move and resize the panel, reload, and
confirm it comes back where it was; put it away with its clay lamp and confirm it
does not come back on the next load. Submitting a prompt fills the eight code blocks
live as the build streams.

## Verification

```
bun run test        # 1765 passed, 0 failed
bun run typecheck
bun run lint
```

Live, against the dev server on :3030:

- the tile opens the panel beside the capability window, and re-pressing it focuses
  rather than closes;
- a freshly opened panel's record reads `{"open":true}` — the flag and no box;
- a drag writes `{x,y,w,h,max,open}`, and a reload restores both windows to their
  remembered boxes exactly;
- loading `/capability/:id` with the panel remembered open puts the **capability** in
  front (`--win-z` 6) and the panel behind it (5);
- at 375px only the frontmost window is in the page, pressing a capability's logo
  brings that window back and takes the panel out, and neither desktop record is
  overwritten;
- Forget remembered boxes was verified to its full contract — both keys cleared, both
  windows reset and neither closed, the address, content and run untouched — before it
  was cut.

One live check misread itself and is worth recording: the addressed capability
appeared not to open, which looked like a regression in the raise fix. The browser tab
had collapsed to 0×0, so `whenDeskIsLaidOut` was correctly refusing to place a window
on a desk with no edges. Restoring the viewport restored the behaviour. The lesson is
the guard working, not failing.

## HITL test instructions

Start the app (or use your running dev server on :3030):

```bash
bun run dev
```

1. Open `http://localhost:3030/`. **A small-window tile stands last on the desk,
   after every capability** — a pane-gradient title bar over a `>_` prompt, labelled
   "Developer".
2. Click a capability logo, then click the Developer tile. **Both windows stand at
   once, the panel narrow against the right edge.** The address still reads
   `/capability/<id>` — the panel is never in it.
3. Click the Developer tile again. **The panel comes to the front; it does not
   close.** Only its clay (orange) lamp puts it away.
4. Type a prompt and press *Make it*. **The eight code blocks fill as the build
   streams** — a drawn frame each, the stage name and byte count in the caption, and
   the JSON tinted on a dark well. Open the panel *mid-build* if you like:
   everything already received is there.
5. Drag the panel's title bar and resize it by the corner grip, then reload.
   **It comes back exactly where you left it.**
6. Press the panel's **clay (orange) lamp**. **It closes and the capability window
   stays exactly as it was.** Reload: **the panel does not reopen, the addressed
   capability still does.**
7. Narrow the browser below 720px. **Only the front window is on screen**, with no
   drag, no grip and no maximise lamp, and the last code block scrolls clear of the
   prompt bar. Widen again: **both windows return to their remembered desktop
   boxes.**

Expected developer-only output: none in the console. `localStorage` should hold
exactly `aluna.desk.window.v1` and `aluna.desk.dev.v1` (plus
`aluna.design.desk.layout.v2` if you have also visited `/design/`).

## Blocked by

- modules/05-the-desk/5.6-window-and-developer-panel/issues/03-the-address-names-the-capability-and-nothing-else.md
