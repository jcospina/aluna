# The logo layer replaces the capability toolbar, and an admitted build gets a provisional tile

Status: ready-for-agent

## Epic

Module 5 — The Desk · Epic 5.4 — The desk: wallpaper, logo layer, prompt bar
(PLAN decisions 3, 4; design D4: `modules/05-the-desk/PLAN.md`)

## What to build

Capabilities live on the ground as logos, and with no taskbar the logos are the
only standing list of what exists. The logo layer takes the toolbar's jobs —
listing what exists, navigating, announcing a new capability, and carrying a
rename (5.9). The fifth job, deletion, also lands on the logo, in 5.9/02.

- **Logos fill down a column and wrap to the next, across as many columns as the
  desk holds.** The two fixed tracks were a mockup shortcut sitting inside an
  `overflow: hidden` box, so everything past about a dozen capabilities was cut
  off with no scroll and no affordance — and the developer tile took one of those
  slots. A product whose premise is *make as many tools as you want* cannot have
  a ceiling of eleven. The grid is bounded top and bottom and flows down a
  column, so the row count derives from the desk's own height: measured at a 660px
  desk that is four rows to a column, and twenty capabilities stand in five
  columns with nothing clipped. The phone form resets to row flow **explicitly**,
  or the column flow leaks into it through the media query.
- **Every tile is a placeholder for now.** No capability has artwork until 5.5
  lands, so the designed placeholder tile is the state this issue ships, and it
  must read as a real, usable capability rather than as a loading failure.
- **An empty desk needs no gate.** The shell infers "this user is new" today by
  finding no capability entry after a swap, and CSS hides the rail until one
  appears. That check goes. An empty desk is a wallpaper and a prompt bar, and it
  reads correctly with nothing gating it.
- **A provisional tile lands only after resolution admits a new-capability
  build**, keyed by the build id rather than by a capability that does not exist
  yet. It uses the resolver's friendly label and brings the in-flight narration
  back into view when pressed. An evolution uses the capability's existing tile;
  `reject`, `data_query`, and work refused before admission never create one.
  Activation replaces the provisional tile with the registry-backed capability
  tile. Every non-activating terminal — stale, no-op, failure, cancellation, or
  pre-activation expiry — removes it in the same terminal cleanup path. A reload
  may forget this presentation-only tile; registry rehydration remains the source
  of truth. The narration still streams into the shell's existing content region
  at this point; it moves into the window in 5.7.
- **Deletions.** The capability toolbar, its rehydration from the registry, and
  the sidebar go with this change — code removed, not hidden. The logo reads the
  capability's label live, which is what makes 5.9's rename free.

The logo is a real `<button>`, which is what lets 5.9 open a context menu from
the keyboard without hand-written key handling.

## Acceptance criteria

- [ ] Logos flow down a column and wrap to the next; twenty capabilities stand
      unclipped on a desk of the design's height, with no scroll trap and no
      fixed ceiling
- [ ] Below the phone breakpoint the layer resets to row flow explicitly
- [ ] A capability with no artwork shows the designed placeholder tile and is
      fully usable
- [ ] An empty corpus renders a wallpaper and a prompt bar, with no gate and no
      hidden rail
- [ ] An admitted new-capability build lands one build-id-keyed provisional tile;
      evolution, reject, data query and pre-admission refusal land none
- [ ] Activation replaces the provisional tile with one registry-backed tile;
      stale, no-op, failure, cancellation and expiry remove it, leaving no orphan
- [ ] Clicking a tile opens that capability
- [ ] The capability toolbar, its rehydration and the sidebar are deleted from
      the codebase
- [ ] Each tile is a real `<button>` carrying the capability's live label
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

`bun run reset`, open the desk, and confirm a wallpaper and a prompt bar with
nothing else. Build three capabilities and watch a working tile land after each
new-capability resolution and settle into a placeholder logo. Cancel one build
and force one failure, confirming both provisional tiles disappear. Click an
activated tile and confirm it opens. Build
enough to pass the old ceiling of eleven and confirm they flow into a second and
third column rather than disappearing.

## Blocked by

- modules/05-the-desk/5.4-desk-wallpaper-logos-prompt-bar/issues/01-the-desk-ground-and-the-floating-prompt-bar.md
