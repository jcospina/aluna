# Window geometry: the prompt-bar floor, a maximised flag, clamping, and the phone form

Status: ready-for-agent

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

- [ ] A window cannot be dragged or resized so that any part of it enters the
      prompt bar's strip; the floor is read from the token, not restated
- [ ] Maximised persists as a flag, not as a box; the pre-maximise box is kept
      as the record's normal box and un-maximising restores it
- [ ] A stored box larger than the viewport is clamped on load **and** on a live
      resize
- [ ] The pointer-only resize grip is not exposed as a dead keyboard button; every
      element that remains in the focus order has an operable keyboard action
- [ ] Below 720px the phone class is set, the window fills the screen, and the
      drag and grip handlers never bind; the desktop flag/box are ignored without
      being overwritten and resume correctly above the breakpoint
- [ ] The desk breaks at 720px and forms at 620px; no 768 or 480 breakpoint
      survives
- [ ] `localStorage` holds one capability-window presentation record from this
      issue — normal box plus maximised flag — and creates no extra key
- [ ] Corrupt or partial stored presentation data falls back to safe defaults and
      cannot block desk/capability rendering
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Drag a window to the bottom edge and confirm it stops above the prompt bar; try
to resize into the strip and confirm the same floor. Maximise, reload, and confirm
it comes back maximised. Un-maximise and confirm the pre-maximise box returns.
Reload on a narrower screen and confirm the stored box clamps to the viewport
rather than reaching past it, then resize live and watch it clamp again. Narrow
past 720px and confirm the window fills the screen with no grip and no drag.

## Blocked by

- modules/05-the-desk/5.6-window-and-developer-panel/issues/01-the-window-ships.md
