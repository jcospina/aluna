# The window ships: created client-side, dragged, resized, two lamps

Status: done

## Epic

Module 5 — The Desk · Epic 5.6 — The window, and the developer panel's second one
(PLAN decisions 1, 2; design D1, D3, D12: `modules/05-the-desk/PLAN.md`)

## What to build

One window, dragged by its title bar and resized from the bottom-right corner,
with two lamps — leaf maximises, clay puts it away. **There is no minimise:** with
no taskbar a minimised window hides exactly as thoroughly as a closed one, and
both come back by the same click on the same logo.

- **The window is created and destroyed by the client.** The toolbar and old
  content-region anchors are removed here. The modal mount remains as an explicit,
  temporary compatibility anchor because record opening still uses it until
  5.7/01; removing it in this issue would break the only record surface before its
  replacement exists. 5.7/01 deletes the modal and collapses final page assembly
  to the logo-layer anchor alone.
- **The capability's collection opens into the window.** Record views, the
  deletion confirmation and the build narration follow in 5.7 and 5.8; this issue
  is the frame and the first thing that goes in it.
- **The window releases its content's scope when it is put away**, through
  5.3/01's region rule rather than a window-scoped hook of its own. Putting the
  window away is now the only way a region disappears.
- **Two documentation amendments land here**, because this is the change that
  makes them true. Architecture §6.1's blockquote is restated in exactly this
  form: *the shell may remember how things look to the user; it never decides what
  is true.* Window geometry, maximised state and where the user likes things are
  presentation state and the shell's to keep; which records exist, what is valid,
  what a capability means and what an intent was are canonical state and the
  server's alone. One sentence carries the boundary, with no enumeration to
  maintain — it admits future desk furniture without another amendment while still
  standing between the browser and any re-implementation of capability logic. And
  *"A single static HTML page. It never changes after first load"* is retired,
  because the window is created and destroyed.

Long window titles truncate with an ellipsis, which is the only behaviour a
locked-height title bar has.

## Acceptance criteria

- [x] Clicking a capability's logo opens its collection in a window; the clay
      lamp puts the window away and the leaf lamp maximises
- [x] No minimise control exists anywhere
- [x] The window is created and destroyed client-side; the toolbar and old
      content-region anchors are deleted, while the temporary modal anchor stays
      functional until 5.7/01; every missing live anchor throws (5.3/02)
- [x] The window frame uses the ink system shipped in 5.2 rather than introducing
      a CSS border or a second drawing implementation
- [x] Putting the window away releases the content's scope through the region
      rule — no window-scoped cleanup hook exists
- [x] A long window title truncates with an ellipsis rather than growing the bar
- [x] Architecture §6.1 carries the restated blockquote, and the
      never-changes-after-first-load sentence is gone — **already true before this
      issue**; see the note below
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Click a capability's logo on the desk: a window opens carrying its collection.
Drag it by the title bar, resize it from the corner, maximise it with the leaf
lamp, and put it away with the clay lamp. Open a second capability and confirm one
window, not two.

## Blocked by

- modules/05-the-desk/5.5-capability-logo/issues/01-spec-and-registry-carry-the-logos-inputs-and-state.md

5.5/01 performs the last reset before this window/record path starts. The hosted
provider work in 5.5/02–04 then runs as the independent branch and does not hold
window work behind provider latency or human artwork sign-off. The branches join
at 5.10/01, before the final record-bearing form corpus.


## Implementation notes

**`public/desk-window.js` is the product's half of the window seam**, the way
`public/ink.js` is the drawn line's. It owns the one window: when it exists, what is
in it, where it sits, and what the two lamps do. `design/scripts/window.js` still
draws every frame.

**The three gestures were extracted rather than copied.** Dragging by the title bar,
resizing from the corner and maximising now ship from `design/scripts/window-gestures.js`
and are used by both the product's window and the design page's desk. The first draft
re-implemented them beside `design/scripts/desk.js` and the two had already drifted —
the design's grip was a focusable `<button>` whose Enter did nothing, the product's was
a non-focusable handle. One implementation, one shape.

**Page assembly lost the content target.** `renderCapabilityShell`,
`renderCachedCapabilityShell`, `EMPTY_CONTENT_TARGET` and `requireContentTarget` are
gone; `PAGE_ASSEMBLY_ANCHORS` is the logo layer and the temporary modal mount, and both
still throw. `renderRehydratedShellPage` is now the only full-page assembly there is,
and `/capability/:id` renders it — the window is the client's, so there is no hole in
the served page to compose a collection into. The client opens the window over the logo
the address names and asks for the same fragment a click on that logo asks for.

**The shell's content area is gone with it.** `<main class="content">`, `.content`,
`.content::after`, `.content__active`, `.intro` and `.intro__output` are deleted, and
`.intro__output` left `SHELL_INK` — the window's own frame is the only line around its
content now.

**"New X" gives the window to the create form.** Asked for during the live test, and
taken here rather than left to 5.7/01 because the window arriving is what made the old
shape wrong: a form disclosed *above* the records competes with a list it cannot
replace, and it had nowhere to put its action row. The collection is now two views of
one surface (design D2) — the list, and the form that replaces it — shown by one flag.
Cancel is the only way out; a back control beside it would be one control twice. The
fields scroll and **Cancel/Add are stuck to the window's bottom edge**, which needed an
unbroken height chain from the region down to the form: every link claims the height
and can give it back (`flex: 1 1 auto` + `min-height: 0`), and a link that forgets the
second half pushes the scroll one level up, which is where a sticky row starts
drifting. 5.7/01 still owns opening an existing *record* by view swap, the back control
it arrives under, and deleting the modal.

The field chrome came with it, converged on `design/styles/components/form-controls.css`
rather than redesigned: caps labels, one row height (`--control-h`), the well fill
(`--surface-2`), the design's horizontal padding, `--space-4` between fields, and the
hairline rule above the action row instead of full ink. The control is still a bare
`<input>` carrying its own ruled border — the shell-plus-bare-element split a drawn
boundary needs is 5.10/03.

**Two things this issue was not asked for and did anyway, both forced.** The client
reads `/capability/:id` at load (5.6/03 owns the *history* contract; without this a
deep link or a reload landed on a bare desk, which the anchor deletion caused). And the
window puts itself away when a swap leaves it holding nothing (5.9/02 owns the
deletion confirmation's shape; the CSS that used to hide the shell's empty content area
went with that content area). Both are recorded in those issue files.

**Architecture §6.1 needed no edit.** Both amendments landed ahead of the code in
commit `4efb13b`; the blockquote and "The page is not inert after first load" were
already live. `src/presentation/desk-window.test.ts` pins them so they stay true, and
`docs/modules.md` was swept for the retired "single static HTML page" claim.

### Adversarial findings fixed

- **`htmx.remove` is not a teardown.** It is `parentElement.removeChild` and runs no
  cleanup, so detaching the window with it left the SSE extension holding an open
  `EventSource` for a build streaming into a node that was nowhere — and the
  `htmx:sseClose` that unlocks the prompt bar fired from a detached node and never
  reached the document, disabling the prompt bar for the life of the page. The window
  is now swapped empty through `htmx.swap`, which does run htmx's cleanup, while it is
  still connected.
- **Putting the window away during a build now cancels the build**, through the run's
  own cancel route. The window is the only way back to a run's narration, so leaving
  the server building something nobody can see was the worse half of a half-done
  teardown. *5.8/04 puts a warning in front of this; today the clay lamp cancels a
  build without asking.*
- **The window's content scrolled sideways.** The ink system sizes each layer in
  pixels when it draws, so a drawn element that has just been made narrower keeps a
  layer as wide as it used to be until the redraw lands — and resizing the window by
  its corner is that, every frame. Under `overflow-x: auto` each one flicked a
  horizontal scrollbar in and out. The region scrolls down only now, with long
  unbroken text wrapping so a clip can never put anything out of reach.
- **The phone form lost the prompt bar's clearance.** Below 720px the stylesheet places
  the window and overrides the geometry that stops it above the bar, so the tail of a
  records list sat behind it. The strip is reserved again, as an in-flow block rather
  than scroller padding, for the reason the retired `.content::after` gave.
- **A logo click whose response never swapped** left an empty window titled with a
  capability that no longer exists. It is taken back down.
- **The deferred load-time opener** could fire after the user had opened something
  else, flipping a live build's window over to a capability. Anything the user does
  first now cancels it, and its observer always disconnects.
- **Focus went nowhere on put-away.** It returns to whatever opened the window, unless
  that has gone too.
- **The missing-layer failure never ran at startup**, so a shell shipped without a
  window layer rendered a normal-looking desk and failed on the first click. The layer
  is demanded when the module starts.
- **The severed-deletion recovery** reported "I still can't tell what happened" when
  the window had been put away, even though the recheck had succeeded. It reads the
  answer out of the reply and leaves it at the prompt bar.
- **A per-window title id**, so 5.6/04's second window cannot duplicate this one's.
- Stale "content area" comments across `index.html`, `region-scope.js`, `prompt.css`,
  `deletion.css`, `demo.css`, `fragments.ts` and `cached-view.ts`; the dead
  `classNames` helper in `router.test-support.ts`; and `CONTEXT.md`'s content-region
  entry, which still said the window had not shipped.
- **Test quality.** The source-grep assertions that would not have caught a regression
  were replaced with behavioural ones: the teardown's order and htmx seam, focus
  return, the capture-phase registration, the missing-layer throw, `trackPointer`
  unbinding on all three endings, `setMaximised`'s box handling, and the desk's clamps.

## Verification

```
bun run test       # 1654 passed, 0 failed
bun run typecheck
bun run lint
```

Live, against the dev server on :3030 — a real build admitted, its stream opened for
8.9s, `/build/:id/cancel` fired on put-away, the prompt bar unlocked, no orphan tile
and no console error.

## Living demo

Clicking a capability's logo on the desk opens its collection in the window. The
window drags by its title bar, resizes from the bottom-right corner, maximises with
the leaf lamp and is put away with the clay one. Opening a second capability swaps
what is inside the frame. Submitting a prompt on a bare desk opens the window at
submit.

## HITL test instructions

1. `bun run dev` (or use the server already on `http://localhost:3030`).
2. Open `http://localhost:3030/`. The desk is a wallpaper, the logos, and the prompt
   bar — **no window until there is something to show**.
3. Click a capability's logo. A drawn window opens carrying that capability's
   collection, with two lamps in the title bar and no third one.
   - Drag it by the title bar. It stops at the desk's edges and **above the prompt
     bar** — drag it downward and confirm it will not go under the bar.
   - Resize it from the bottom-right corner. Same floor.
   - Press the **leaf** (green) lamp: it fills the desk, still clear of the bar.
     Press again: it returns to exactly the box it had.
   - Press the **clay** (orange) lamp: the window disappears, the logo stays, and
     the desk is bare.
4. Click one logo, then another. **One window** — the title and the contents change
   and the frame does not move.
5. Open a capability, copy the address, and reload. The same capability is back in the
   window. (Back/Forward is 5.6/03's and does not follow the window yet.)
6. Focus a logo with Tab and press Enter, then Tab to the clay lamp and press Enter.
   Focus lands back on the logo you opened from, not at the top of the page.
7. **The build path.** Type something buildable into the prompt bar and press
   **Make it** on a bare desk: the window opens at submit titled *Making it* and
   narrates. Now press the **clay lamp** mid-build:
   - the window goes away and the prompt bar becomes usable again immediately;
   - the build is cancelled (its tile does not linger, and no capability appears on
     the desk a minute later);
   - the browser console stays clean.
   *This is the current, deliberate behaviour: putting the window away during a build
   cancels it without asking. 5.8/04 adds the warning.*
8. Type something Aluna cannot build (`hello there`). The window opens, the refusal
   arrives at the prompt bar, and the window puts itself away rather than standing
   there empty.
9. Delete a capability from the prompt bar and confirm. The logo goes, the prompt bar
   says what happened, and the window does not stay behind holding nothing.
10. **The create form.** Press **New X**. The collection is gone and the form has the
    window, with the first field focused. Cancel and Add sit on the window's bottom
    edge; scroll the fields and they stay there. Cancel returns to the list with focus
    back on **New X**, and so does a successful Add. Resize the window by its corner
    while a record is on screen: no horizontal scrollbar appears at any size.
