# A short context menu opens on a capability's logo, three ways in, and Rename changes the label and nothing else

Status: done

## Epic

Module 5 — The Desk · Epic 5.9 — Rename and delete from the logo
(PLAN decision 19: `modules/05-the-desk/PLAN.md`)

## What to build

A short context menu opens on a capability's logo, carrying **Rename** and
**Delete**. Delete's confirmation is 5.9/02; this issue builds the menu and the
rename.

**Three ways in, one component.** Right-click for a mouse, press-and-hold for
touch, and the menu key or Shift+F10 for the keyboard — which the logo already
accepts because it is a real `<button>` (5.4/02).

Choosing Rename turns that logo's label into the one inline rename form: a real
text input with Save and Cancel, anchored where the label already lives. It does
not open a modal or take over the capability window. The effective-label
validator used by generated capability names applies here too; blank or invalid
labels are refused in the editor, and rendering continues to escape the stored
value as text. Save shows a busy state while its coordinator write waits, Cancel
or Escape restores the prior label, and every exit returns focus to the logo.
Client label errors stay in the editor; a structured coordinator/stale/deleted
refusal follows 5.8/03's desk-furniture rule to the prompt bar while preserving
the typed value and editor focus for retry or Cancel.
Pointer long-press cancels on movement, scrolling or early release and suppresses
the following click, so opening the menu cannot also open the capability.

This settles the homeless trash icon and the rename doorway with the same menu,
and it respects the design's constraint literally: **the doorway is on the logo,
not on the window chrome**, so no lamp goes signal red and D3 stands.

**Rename changes the effective display label and nothing else** — not its id, not
its address, not its artwork, which L7 forbids redrawing. It is a short
platform-owned registry write under the mutation coordinator, bound to the exact
incarnation/version the menu opened on. It writes a nullable
`display_label_override`; the immutable authored `spec.label` and every
`spec.json` snapshot stay byte-for-byte truthful, so no version and no build are
manufactured merely to rename desk furniture. Shell and resolver-catalog reads
use `display_label_override ?? spec.label` as the effective label. The override
survives evolution, disappears with deletion, and participates in the resolver
catalog fingerprint/revision, so a request resolved before the rename but not yet
successfully revalidated at the lease head is refused stale rather than running
against the old visible name. The coordinator's existing FIFO order is unchanged;
rename does not jump ahead of a build already queued.

Three alternatives were rejected and should not be reintroduced: drag-to-trash
solves only delete, costs a desk slot and is keyboard-hostile; the prompt bar puts
the AI in charge of identifying the target on a path that is deliberately zero-AI;
and a developer-panel manage list hides an ordinary action behind a developer
surface while duplicating the ground.

## Acceptance criteria

- [x] Right-click, press-and-hold and the menu key or Shift+F10 all open the same
      menu on a capability's logo
- [x] Rename opens one inline label form with Save and Cancel; it does not open a
      modal or displace the capability window
- [x] The menu carries Rename and Delete and nothing else
- [x] It exposes menu/menuitem semantics, arrow-key movement and Escape, and
      opening/closing it returns focus predictably
- [x] No destructive affordance appears in window chrome; no lamp changes colour
- [x] Rename changes the label live on the desk; the id, the address and the
      artwork are untouched and no build runs
- [x] Blank/invalid labels fail in the inline editor, stored text is escaped, and
      Save exposes its waiting state rather than appearing to lose the action
- [x] A server-side rename refusal speaks on the prompt bar, preserves the inline
      value/focus and performs no partial label/catalog update
- [x] Rename is one coordinator-owned, incarnation/version-bound platform write;
      it cannot join another transaction or race a deleted/recreated incarnation
- [x] Authored `spec.label`, immutable snapshots and the active version stay
      unchanged; shell and resolver reads use the effective label override
- [x] The rename advances the resolver catalog binding; an older resolved request
      that has not revalidated is refused stale, without rename jumping the
      coordinator's FIFO queue
- [x] The menu is dismissible by keyboard and by clicking away, and returns focus
      to the logo
- [x] Touch movement/scroll/release cancels a pending long-press and its consumed
      gesture cannot also fire the logo's ordinary open action
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Right-click a capability's logo and rename it — the label changes on the desk
while the address, the artwork and the id stay where they were. Open the menu
again with Shift+F10 and confirm the same menu with the same two items. Press and
hold on a touch device and confirm the third way in.

## Blocked by

- modules/05-the-desk/5.8-message-surfaces-and-restoration/issues/04-closing-during-a-build-warns-first.md

## What landed

**The name a capability answers to is now two.** A nullable
`display_label_override` column (migration `0014`) sits beside the authored
`spec.label`, and `canonicalCapabilityLabel` resolves `override ?? label` once so
no display path has to remember the precedence. The field is on the row schema
only, never the write shape, and the CAS `SET` list does not name it — so an
evolution structurally cannot wipe a rename, and only `renameCapability` moves it.
It is required rather than optional on the label helpers' parameter type, so a row
projection has to opt in instead of silently reverting a rename.

**One route, one write.** `POST /capability-rename/:id` (`src/capability-rename/`)
is a top-level platform route: no Handler, no resolver, no provider. The label is
checked, then a cheap readonly look refuses a submission that provably cannot
match, then `withPlatformWrite` queues the one conditional UPDATE bound to the
exact incarnation and version. Because the override is ordinary semantic registry
content, it is inside the resolver catalog's fingerprint with no extra machinery,
so a build resolved before a rename is refused stale at its lease head.

**The logo became a slot.** `renderCapabilityLogo` now emits
`<div data-logo-slot>` holding the button, the two-item menu and the inline rename
form, both shipped hidden. The slot carries the element id, so everything addressed
at one capability's place on the desk means the whole of it. The one exception is
the logo attempt, which swaps `renderCapabilityLogoFace` — the button alone —
because a picture arriving is the only swap nobody asked for and it must not take
away a name someone is typing.

**`public/logo-menu.js`** owns the three ways in and the editor. An open panel is
lifted into a new `#capability-menus` layer (the logo layer sits under the windows,
which is right for logos and wrong for a menu) and put back on its own logo on the
way down. `public/desk-doorway.js` answers the presses on the ground that need a
window before htmx resolves their target.

## Findings fixed

Every one from the two adversarial passes.

- **An evolution that kept its name sent no logo replacement**, so the desk went on
  holding the old version number and *every* rename of that capability was refused
  stale for ever, until a reload. The commit swap now always re-renders the slot.
- **The rename route could be flooded.** Any valid label with a nonsense id still
  took a coordinator ticket, and short writes and deletion refuse while anything is
  queued — so an unauthenticated loop could turn every record write on the desk into
  `mutation_busy`. A readonly pre-check now refuses before the queue, the way the
  logo attempt already guards its own paid claim. The request's abort signal is
  passed through, and a cancelled admission is answered rather than raised.
- **A logo attempt landing under an open editor destroyed it.** The attempt now
  replaces the face, not the slot.
- **Duplicate/overlap identity matched only the authored label** while the resolver
  was shown the effective one — so "journal" missed a capability the desk plainly
  called Journal, and a second identically-named tile could be admitted. Both
  matchers now carry every name a capability answers to.
- **Escape leaked to two other document-level handlers** — a standing record
  confirmation and the leaving-a-run question — because `stopPropagation` does not
  stop a listener on the same node. The whole keydown moved outside the document,
  in capture, which holds whatever order these modules load in.
- **An out-of-band swap orphaned the lifted panel**, and a deletion's `delete:`
  fires no swap event at all. `htmx:oobAfterSwap` and a settle-time reconcile now
  bring home anything whose logo has left the document.
- **A doorway could leave an empty window standing** on a failed request, and named
  the window after whatever was already in it — a destructive confirmation under
  another capability's name. Both fixed; a run narrating into the window is left
  untouched, and the prompt-bar refusal still governs.
- **The consumed post-hold click could eat a keyboard activation**, so the first
  press of Rename did nothing on a platform that suppresses its own click. Only
  clicks with a press behind them are taken now.
- **A native `contextmenu` fired beside the hold timer** and tore the menu down and
  rebuilt it; it is moved rather than reopened.
- **No touch-callout or selection suppression on the logo**, so a press-and-hold
  raised the platform's own menu beside ours.
- **A scroll left both panels glued to the viewport.** The menu is put away; the
  editor follows its label, because it is holding typed text.
- **`.btn--sm` was dead on the product surface.** `public/css/components.css`
  restated the control height and padding the design layer owns and loaded after
  it, silently defeating every size modifier. Removed, per that sheet's own rule.
- **A refusal with no readable sentence would have been swapped into the slot.**
  Rename refusals now answer `HX-Reswap: none`.
- Delete no longer drops focus on the body; the logo says `aria-haspopup` and
  carries `aria-expanded`; Save says `Saving…` rather than only going grey; a press
  that goes nowhere leaves a half-typed name alone.
- The `aluna:ink-moved` seam was **removed after measuring**: the ink system's own
  mutation pass already re-registers a drawn element that changes parent.

## Verification

`bun run test` (1978), `bun run typecheck` and `bun run lint` clean.

Exercised live against the running desk: all three ways in; rename end to end with
the artwork, id and address unchanged and focus returning to the logo; Cancel and
Escape; the client refusal staying in the editor; a stale refusal speaking on the
prompt bar with the typed value and focus preserved and no partial write; Delete
opening the confirmation in the window, titled after its own capability, and
backing out with **Keep it**; the menu standing over an open window.
