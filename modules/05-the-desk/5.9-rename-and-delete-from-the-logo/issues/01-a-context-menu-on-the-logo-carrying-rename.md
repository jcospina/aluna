# A short context menu opens on a capability's logo, three ways in, and Rename changes the label and nothing else

Status: ready-for-agent

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

- [ ] Right-click, press-and-hold and the menu key or Shift+F10 all open the same
      menu on a capability's logo
- [ ] Rename opens one inline label form with Save and Cancel; it does not open a
      modal or displace the capability window
- [ ] The menu carries Rename and Delete and nothing else
- [ ] It exposes menu/menuitem semantics, arrow-key movement and Escape, and
      opening/closing it returns focus predictably
- [ ] No destructive affordance appears in window chrome; no lamp changes colour
- [ ] Rename changes the label live on the desk; the id, the address and the
      artwork are untouched and no build runs
- [ ] Blank/invalid labels fail in the inline editor, stored text is escaped, and
      Save exposes its waiting state rather than appearing to lose the action
- [ ] A server-side rename refusal speaks on the prompt bar, preserves the inline
      value/focus and performs no partial label/catalog update
- [ ] Rename is one coordinator-owned, incarnation/version-bound platform write;
      it cannot join another transaction or race a deleted/recreated incarnation
- [ ] Authored `spec.label`, immutable snapshots and the active version stay
      unchanged; shell and resolver reads use the effective label override
- [ ] The rename advances the resolver catalog binding; an older resolved request
      that has not revalidated is refused stale, without rename jumping the
      coordinator's FIFO queue
- [ ] The menu is dismissible by keyboard and by clicking away, and returns focus
      to the logo
- [ ] Touch movement/scroll/release cancels a pending long-press and its consumed
      gesture cannot also fire the logo's ordinary open action
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Right-click a capability's logo and rename it — the label changes on the desk
while the address, the artwork and the id stay where they were. Open the menu
again with Shift+F10 and confirm the same menu with the same two items. Press and
hold on a touch device and confirm the third way in.

## Blocked by

- modules/05-the-desk/5.8-message-surfaces-and-restoration/issues/04-closing-during-a-build-warns-first.md
