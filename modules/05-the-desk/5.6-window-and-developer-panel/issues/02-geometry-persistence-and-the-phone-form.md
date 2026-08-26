# Window geometry: the prompt-bar floor, a maximised flag, clamping, and the phone form

Status: done

## Epic

Module 5 — The Desk · Epic 5.6 — The window, and the developer panel's second one
(PLAN decisions 5 (the drag and resize floors), 18, 47, 48; design D9:
`modules/05-the-desk/PLAN.md`)

## What to build

Where the window sits, how big it is, and what survives a reload.

**No window can be dragged or resized into the strip the prompt bar occupies.**
Maximise already respects that clearance; dragging and resizing now respect it
too, so the tail of a records list — which is exactly where a user scrolls — is
never hidden under the bar and never unclickable. The number comes from the token
5.4/01 established, read back from the stylesheet rather than restated, so the
logo grid and every window stop on the same floor by construction.

**Maximised is stored as a flag and recomputed against the current screen.** The
capability-window presentation record carries one normal box plus that flag; the
normal box is the pre-maximise box while maximised, so no third geometry record
or storage key is needed. Any stored box is clamped to the viewport on load
**and on resize** — which means growing the `window` resize listener the desk
scripts currently lack. Three
symptoms close together:

- a maximised window on a wide screen writing *width minus 36* into the persisted
  box and stranding it on a narrower one,
- a reload that keeps the size and forgets the state,
- a resize that nothing reacts to.

**Below the breakpoint the window is the screen, and the script is told so.** No
drag, no resize, no maximise; icons stay on the ground. The phone class is
actually *set* rather than only read, and the drag and grip handlers **do not bind
at all** rather than binding to hidden controls. Most of this is already painted
in CSS; the missing piece is telling the script what the stylesheet already knows.
Phone mode ignores (but does not erase) the persisted desktop maximised flag and
normal box. Crossing back above 720px recomputes the maximised box or restores and
clamps the normal box, so a responsive resize cannot turn phone geometry into a
new desktop preference.

The corner grip is pointer geometry, not a fake button. Unless this issue gives it
a complete keyboard resize interaction, it is a non-focusable, aria-hidden handle;
the focus order must not advertise a control whose Enter/Space action does
nothing. The leaf maximise lamp remains the keyboard-operable size alternative.

**The breakpoints are the design's 720px for the desk and 620px for forms.** The
built app's 768 and 480 were derived for the sidebar-and-modal layout being
deleted, so nothing is owed to them.

The capability-window record is one of exactly two presentation records
`localStorage` holds; the developer-panel record in 5.6/04 is the other. This is
presentation state, which the shell is allowed to remember.
Parsing is fail-soft: malformed JSON, non-finite geometry, wrong flag types or a
partially missing record fall back to that window's defaults before clamping. A
bad presentation preference may never prevent the desk or an addressed
capability from loading.

## Acceptance criteria

- [x] A window cannot be dragged or resized so that any part of it enters the
      prompt bar's strip; the floor is read from the token, not restated
- [x] Maximised persists as a flag, not as a box; the pre-maximise box is kept
      as the record's normal box and un-maximising restores it
- [x] A stored box larger than the viewport is clamped on load **and** on a live
      resize
- [x] The pointer-only resize grip is not exposed as a dead keyboard button; every
      element that remains in the focus order has an operable keyboard action
- [x] Below 720px the phone class is set, the window fills the screen, and the
      drag and grip handlers never bind; the desktop flag/box are ignored without
      being overwritten and resume correctly above the breakpoint
- [x] The desk breaks at 720px and forms at 620px; no 768 or 480 breakpoint
      survives
- [x] `localStorage` holds one capability-window presentation record from this
      issue — normal box plus maximised flag — and creates no extra key
- [x] Corrupt or partial stored presentation data falls back to safe defaults and
      cannot block desk/capability rendering
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Drag a window to the bottom edge and confirm it stops above the prompt bar; try
to resize into the strip and confirm the same floor. Maximise, reload, and confirm
it comes back maximised. Un-maximise and confirm the pre-maximise box returns.
Reload on a narrower screen and confirm the stored box clamps to the viewport
rather than reaching past it, then resize live and watch it clamp again. Narrow
past 720px and confirm the window fills the screen with no grip and no drag.

## Implementation notes

**One record, and the maximised size is never in it.** `localStorage` holds
`aluna.desk.window.v1`: `{x, y, w, h, max}` — one normal box and a flag, no second
geometry and no second key. `presentationOf` reads `entry.box.restore ?? entry.box`,
so while a window is maximised what is written is the box it will be *given back*,
not the desk it is filling. That is the whole of decision 18's first symptom: a
maximised window on a wide screen used to write *width minus 36* into the record and
strand itself on a narrower one. Verified live — maximise at 1280px, and the record
reads `{"x":243,"y":18,"w":794,"h":462,"max":true}`.

**The opening sequence is one exported step, because its order is the whole of it.**
`openingGeometry(el, stored, bounds, isPhone)` runs `setMaximised` *first*, so the
remembered box is stashed as the one to restore before `fitBox` overwrites the live
one with this desk. Backwards, there is nothing to restore to and the desk's own size
silently becomes the preference. It is exported so that order is a test rather than a
careful reader.

**`fitBox(state, bounds, isPhone)` is the whole geometry decision, told its form
rather than reading one.** Maximised fills the desk, everything else is clamped inside
the edges and above the prompt bar's floor, and a phone decides nothing and touches
nothing. Being told the form is what makes the 720px crossing — the one hard case here
— a single call made twice with the answer changed, so all four sequences run in Bun
instead of being grepped for.

**A clamp is not a preference.** `fitToDesk` only ever pulls a box in, so writing the
re-fit back on every resize tick would let one transient narrowing — a browser dragged
small, a sidebar opened, a tablet turned — erode the remembered box for good, with no
way back to the screen it was authored on. The screen is clamped on load and on every
resize; the record is written only where the user authored something: a finished drag
or resize, the maximise lamp, and the moment a phone becomes a desk. That also keeps a
synchronous, disk-backed write off the resize path.

**The window is a container, and what is inside it stops asking the screen.** The
window is dragged to any width from `--window-min-w` up on a viewport of any width, so
`.capability-collection__header` and `.capability-deletion` asking the *viewport* how
much room they had were asking the wrong box — a 276px-wide window on a 1920px screen
kept a layout meant for 1920px, and no viewport breakpoint could ever have fixed it.
`.desk-window__region` is now `container: window / inline-size` and those two ask
`@container window`. The record modal's card is `container: record / inline-size` and
`.detail-field` / `.detail-modal__delete-confirm` ask it. Verified live: shrinking the
window to its 276px minimum on a 1280px screen now wraps the header and gives the
search field the full width, which it never used to.

**The breakpoints are the design's two, and only where the viewport is really what
decides.** 768, 480, 479 and 639.98 are gone. What is left on a viewport query is the
phone form (`shell.css`), the panel that floats over the whole page (`devbar.css`) and
the dialog that is a sibling of the shell (`detail-modal.css`). `detail-modal.css` and
`devbar.css` are stated from the desk *down* rather than from the phone up, because a
`min-width` counterpart to `max-width: 720px` would have to be `720.02px` to avoid
overlapping it — an off-by-one nobody should have to keep in step with the desk.

**Below the breakpoint nothing binds.** `desk--phone` is set on `.shell`; the grip is
never built and the drag never bound, rather than bound to controls the stylesheet has
hidden; the maximise lamp is taken out of the focus order with `hidden`, because the
window already *is* the screen and a tab stop whose Enter does nothing is worse than no
tab stop. The desktop record is read past and never written over. A window already up
when the browser narrows keeps its listeners — `addWindowDrag` offers no way off the
bar — and stands them down through the host, which is the only half a listener can do.

**Two documentation duties came out clean.** `docs/architecture.md` §6.1, `CONTEXT.md`'s
**Window** / **Shell** / **Put away** entries and PLAN decisions 5/18/47/48 already
described this behaviour ahead of the code; nothing was stale and no ADR is owed. One
thing to carry forward: decision 18 says Forget removes "the one layout storage entry",
which describes the design page's single key. The product splits one key per window, so
5.6/04's Forget will remove two.

### Adversarial findings fixed

Two subagents reviewed the branch — one against the runtime, one against the spec and
the tests. Every finding is fixed.

- **A transient narrowing permanently destroyed the remembered box.** `onResize` clamped
  `entry.box` in place and wrote the result, and `fitToDesk` never grows a box back, so
  the record was eroded by the narrowest viewport the browser had ever had. Only an
  authored change is written now, and only a crossing writes from the resize path.
- **`localStorage` write storm on a live resize.** Sixty synchronous disk-backed writes
  per second of browser-edge drag, each behind a `getComputedStyle` cascade. Gone with
  the fix above.
- **The drag class survived the crossing down, swallowing touch on the phone.**
  `.window__bar--draggable` carries `touch-action: none`, and `addWindowDrag` adds it
  permanently. On the phone form the title bar is the top strip of a full-screen window,
  so the browser handed every touch starting there to a drag that stood itself down — a
  scroll begun on the title bar did nothing at all. `syncForm` now toggles the class.
- **`fillDesk` had no minimum.** The one path that computes a size instead of clamping
  one: on a desk shorter than the inset plus the strip it produced a height of zero or
  below, which is not a length — `height: var(--win-h)` falls back to `auto` and the
  window silently stops being maximised. Floored like every other size. Reachable now
  that a re-fit runs it on every resize.
- **A window could overshoot the prompt bar's floor.** `clampSize` floors at the
  minimum, so on a short desk it handed back a box taller than the room its position
  left, and those pixels were spent *downward* into the strip. `fitToDesk` is now
  position → size → position: a window at its minimum lands exactly on the floor. Where
  the desk cannot hold a minimum window at all the two rules cannot both hold; the
  minimum wins, and a test pins that so it is a decision rather than a surprise.
- **`refit` had no laid-out guard.** `whenDeskIsLaidOut` exists because the layer can
  measure 0×0 — stylesheets arrive by `@import`, and a `ResizeObserver` reports zero for
  anything an ancestor takes out of flow. Fitting to a desk of no size is the smallest
  box there is, in the corner, and it would then have been remembered. `laidOut` is
  stated once and `fitBox` opens with it.
- **A stale per-tab mirror could suppress a write that should happen.** The dedupe was a
  copy of the record kept in this tab, wrong the moment another tab wrote — or the
  moment a future Forget removed the key. It compares against the store now.
- **`watchViewport` was not idempotent.** Three subscriptions with no way off them, and
  nothing stopping a second call stacking a second set.
- **The design page's own desk violated the decisions it exists to embody.** Decision 47
  is written about `desk--phone` and `design/scripts` by name, and `design/scripts/desk.js`
  bound both gestures on a phone and left the maximise lamp in the focus order with
  nothing to do; its `#load` spread stored JSON over the defaults, so `{"x":"nope"}`
  became the box and the window landed at `NaN`. It now has the same `#syncForm` split
  and reads through the shared validator.
- **A third `localStorage` key on the product's origin.** `/design/*` is served from the
  product's own origin, so the handbook's `aluna.desk.layout.v2` sat beside the product's
  records looking exactly like one. Renamed `aluna.design.desk.layout.v2`; the old key is
  orphaned and can be cleared (greenfield, nothing reads it).
- **The design page wrote a maximised size and a second geometry beside it.** Its record
  held the desk-filled box *and* the box to restore to — the extra geometry decision 18
  forbids, and a remembered width belonging to whatever screen the window happened to be
  maximised on. It writes the normal box beside the flag now, exactly as the product does,
  and `setMaximised` at mount is where the box to give back comes from. Found by checking
  the handbook after changing its loader: validating the record had quietly dropped the
  restore box, so un-maximising after a reload left the window stuck at full size.
- **The design page's phone form was undecided until something moved.** Its `desk--phone`
  was set only by the first `ResizeObserver` tick rather than at construction, so the form
  a window mounted into depended on timing. Decision 47 says the class is *set*.
- **`readBox` is now the one definition of what a remembered box is,** in
  `desk-geometry.js`, shared by both surfaces so neither can drift into believing
  something the other rejects.
- **Sixteen forced style reads per resize tick.** `refreshGeometry` called `readLength`
  four times and each did its own `getComputedStyle`; every clamp calls `refreshGeometry`,
  so a single tick paid four times over — and so did every frame of a drag. One call, four
  reads off it.
- **Detail fields stacked in a card with room to spare.** Moving `.detail-field` from 479
  to 620 put the stack exactly where the card is at its *widest*. It asks the card now.
- **The collection header stopped wrapping between 620 and 640.** Same rule, same fix —
  and the container query also gives it the wrap at any narrow window, which the viewport
  version never did.
- **Two stale comments claiming deleted behaviour.** `public/index.html` and
  `public/css/shell.css` both still described the developer panel's backdrop as
  mobile-only; it rises at every size.
- **The crossing was asserted by grep.** Both reviewers landed on the same point
  independently. `fitBox`, `openingGeometry`, `syncForm`, `deskGround`, `loadPresentation`
  and `savePresentation` are exported and run for real, against a window double and an
  injected store; the source-shape assertions that survive are only the ones a return
  value cannot expose (an ordering, a call count) or that live in CSS.
- **The breakpoint sweep read a hardcoded file list.** It globs `public/css/` off disk and
  checks the list against `app.css`'s own imports, so it cannot stop sweeping the day
  someone adds a file. `design/styles/layout.css` and `doc.css` carry 900px and 760px and
  ship with the token layer; they style the handbook's own document furniture (`.cols`,
  `.numbers`, `.gallery`), and a test now proves the shell renders none of it.
- **A test helper leaked a fake `document` into the rest of the suite.** `withDocument`
  restored by assigning `undefined` where the property had not existed; the shell's
  classic scripts self-start on `typeof document !== "undefined"`, so three later test
  files ran against the stand-in. It restores the descriptor, or deletes the property.

## Verification

```
bun run test       # 1714 passed, 0 failed
bun run typecheck
bun run lint
```

Live, against the dev server on :3030, at 1280×720 and at emulated 600/700/1000/1100px:

- maximise wrote `{"x":243,"y":18,"w":794,"h":462,"max":true}` — the pre-maximise box,
  never the maximised one; reload came back maximised; un-maximise returned exactly
  `{243, 18, 794, 462}`;
- a drag 5000px past the bottom stopped with the window's bottom edge at 622px, which is
  the prompt bar's own top edge; the grip stopped on the same floor and at the desk's
  right edge, and bottomed out at exactly `--window-min-w` × `--window-min-h` (276×176);
- a stored `99999×99999` box at `9000,9000` was clamped on load to the desk exactly, and
  a crossing back above 720px clamped `x` from 243 to 191 on a 985px desk;
- garbage JSON in the key opened the addressed capability with all four records and all
  three logos, on the default box, with a clean console;
- below the breakpoint: `desk--phone` on `.shell`, the window the full screen, **no grip
  element built**, **no `window__bar--draggable` on the bar**, the leaf lamp `hidden`, and
  the desktop record byte-identical throughout;
- Alpine's `:class` on `.shell` and the `desk--phone` toggle coexist — opening and closing
  the developer panel leaves the phone class untouched;
- shrinking the window to its 276px minimum on a 1280px viewport wrapped the collection
  header and gave the search field the full width.

One harness note: the in-app browser's device emulation delivers **no** `resize`,
`matchMedia` change or `ResizeObserver` callback to the page — a freshly installed
observer and both listeners registered zero fires across a 1185px → 600px change. The
live crossing was therefore driven with a real `resize` event, and the load-time paths
with reloads at each width.

## Living demo

The homepage desk *is* the demo surface; no `/demo/*` route was added or needed. The
window on `/` now remembers where it was and how big it was, comes back maximised if it
was left maximised, clamps to whatever screen it returns to, and becomes the screen
below 720px.

## HITL test instructions

1. Use the server already on `http://localhost:3030` (or `bun run dev`).
2. Open `http://localhost:3030/` and click a capability's logo.
3. **The floor.** Drag the window down by its title bar — it stops with its bottom edge
   on the prompt bar's top edge, never under it. Resize from the bottom-right corner
   into the same strip: same floor.
4. **Maximise survives a reload.** Press the **leaf** (green) lamp, then reload. The
   window comes back maximised. Press the leaf lamp again — it returns to exactly the
   box it had before you maximised, not to some fraction of the screen.
5. **The record.** In the console, `localStorage.getItem("aluna.desk.window.v1")`. While
   maximised it reads the *pre-maximise* box plus `"max":true` — one box, one flag, and
   `Object.keys(localStorage)` shows no second key from the desk.
6. **Clamping.** Maximise on a wide window, un-maximise, drag the window to the right
   edge, then make the browser window much narrower and reload: the window is pulled
   inside rather than reaching past the edge. Now drag the browser edge in and out
   *live* — it clamps as you go, and the box you authored is still in storage.
7. **Corrupt storage cannot block anything.** `localStorage.setItem("aluna.desk.window.v1",
   "{{{")` and reload an addressed capability (`/capability/<id>`). The capability opens
   normally on a default box, console clean.
8. **The phone form.** Narrow the browser past 720px. The window becomes the screen, the
   corner grip is gone, the title bar no longer shows a grab cursor, and the green
   maximise lamp is gone from the title bar and from Tab order — only the clay lamp is
   left. Check the console: `localStorage.getItem("aluna.desk.window.v1")` is unchanged.
   Widen back above 720px — the window returns to its remembered box, clamped, and the
   grip and the lamp come back.
9. **The window is its own container.** On a wide screen, drag the window's corner until
   it is as narrow as it will go. The collection's search field and **New** button stack
   to full width instead of staying crammed in one row — the layout follows the window,
   not the screen.

## Blocked by

- modules/05-the-desk/5.6-window-and-developer-panel/issues/01-the-window-ships.md
