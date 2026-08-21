# The window ships: created client-side, dragged, resized, two lamps

Status: ready-for-agent

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

- [ ] Clicking a capability's logo opens its collection in a window; the clay
      lamp puts the window away and the leaf lamp maximises
- [ ] No minimise control exists anywhere
- [ ] The window is created and destroyed client-side; the toolbar and old
      content-region anchors are deleted, while the temporary modal anchor stays
      functional until 5.7/01; every missing live anchor throws (5.3/02)
- [ ] The window frame uses the ink system shipped in 5.2 rather than introducing
      a CSS border or a second drawing implementation
- [ ] Putting the window away releases the content's scope through the region
      rule — no window-scoped cleanup hook exists
- [ ] A long window title truncates with an ellipsis rather than growing the bar
- [ ] Architecture §6.1 carries the restated blockquote, and the
      never-changes-after-first-load sentence is gone
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

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
