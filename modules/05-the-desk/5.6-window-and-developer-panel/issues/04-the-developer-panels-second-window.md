# The developer panel is the one second window

Status: ready-for-agent

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

- [ ] The developer panel opens from its own tile and sits beside the capability
      window
- [ ] Re-pressing the open panel's tile focuses it; only its clay lamp puts it away
- [ ] It never appears in the capability list and is never confused for one
- [ ] Nothing in the panel mutates canonical state
- [ ] Its box and open flag persist across a reload; `localStorage` now holds
      exactly two presentation records and nothing else
- [ ] Phone mode exposes only the frontmost full-screen window and does not
      overwrite either persisted desktop box; widening restores both safely
- [ ] No general window manager and no third window exists
- [ ] Forget remembered boxes clears both presentation records and resets live
      geometry without closing content, changing the address, cancelling work or
      mutating capability state
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Open a capability, then open the developer panel from its tile, and watch the two
windows sit side by side. Move and resize the panel, reload, and confirm it comes
back where it was. Use Forget remembered boxes and confirm both live windows move
to safe defaults without closing; reload and confirm the panel no longer opens by
preference while the addressed capability still does.

## Blocked by

- modules/05-the-desk/5.6-window-and-developer-panel/issues/03-the-address-names-the-capability-and-nothing-else.md
