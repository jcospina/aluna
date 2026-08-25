# The logo layer replaces the capability toolbar, and an admitted build gets a provisional tile

Status: done

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

- [x] Logos flow down a column and wrap to the next; twenty capabilities stand
      unclipped on a desk of the design's height, with no scroll trap and no
      fixed ceiling
- [x] Below the phone breakpoint the layer resets to row flow explicitly
- [x] A capability with no artwork shows the designed placeholder tile and is
      fully usable
- [x] An empty corpus renders a wallpaper and a prompt bar, with no gate and no
      hidden rail
- [x] An admitted new-capability build lands one build-id-keyed provisional tile;
      evolution, reject, data query and pre-admission refusal land none
- [x] Activation replaces the provisional tile with one registry-backed tile;
      stale, no-op, failure, cancellation and expiry remove it, leaving no orphan
- [x] Clicking a tile opens that capability
- [x] The capability toolbar, its rehydration and the sidebar are deleted from
      the codebase
- [x] Each tile is a real `<button>` carrying the capability's live label
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

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

## What was built

**The logo layer is one anchor in the shipped page and one renderer behind it.**
`public/index.html` carries `<div class="desk__logos" id="capability-logos">` inside
`.content-column` — the one positioned box on the page, which is also what the
prompt bar is anchored against, so the logos keep to the ground the user can see.
`src/web/fragments.ts` fills it: `renderCapabilityLogo` is the single source of a
capability's standing entry, used by on-load rehydration, direct
`/capability/:id` navigation and the commit-time out-of-band sidecar alike, so the
three paths cannot drift. Each logo is a real `<button>` carrying
`id="capability-logo-<id>"`, the capability's live label, and the same
`hx-get`/`hx-push-url` the toolbar entry carried.

**No layout number was copied.** `design/styles/components/desk.css` and
`logo-contract.css` already ship with the page (PLAN decision 7), so the column
flow, the cell sizes, the 64px tile, the 10% corner, the shadow, the label
treatment and the phone reset are read from there and restated nowhere in
`public/css/`. The only design change was to unscope one selector:
`logo-contract.css` stacked the tile and the name under `.desk .logo`, and the
shipped shell is `.shell` until 5.6 renames it. `desk.css` already styles `.logo`
unscoped and `.logo` names one thing in Aluna, so the ancestor bought nothing and
cost the product its stack.

**The tile rides `fragment`, and it is sent from the one place that knows.**
`runNewCapabilityIntent` (`src/pipeline/build/prompt-pipeline.ts`) sends it
immediately before handing the resolved request to the Core Builder — the moment
resolution admitted a *new* capability, which an evolution and a deflection never
reach. ADR-0002 fixes the product vocabulary at four event names and says this tile
adds no fifth, so the payload rides `fragment`: a non-terminal fragment placed into
a targeted region, carrying nothing but its out-of-band sidecar, so the region it
nominally lands in receives nothing. `fragment` therefore no longer means "the
restoration" on its own — the restoration is the one carrying
`data-build-restoration`, and three existing tests were sharpened to say so.

**Taking it down is the client's, in `public/desk-logos.js`.** A module of its own
beside `region-scope.js` and `swap-target.js`, which is what makes it testable
against a small fake DOM rather than only as strings in `app.js`. It does two
things: a press brings the in-flight narration back into view, and every ending of
the build's stream takes the tile down.

**Deletions.** `public/css/toolbar.css`, the `<nav class="toolbar">` and its toggle,
the `hasCapabilities` Alpine state with its `[data-capability-entry]` inference and
`syncCapabilityPresentationState`, the `has-capabilities` class and the
`SHELL_ROOT_ANCHOR` that flipped it, the mobile drawer auto-close, and the
`.shell.has-capabilities .cold-start` rule. Page assembly went from four literal
anchors to three: the shell root was in that list only to be flipped. The word
"toolbar" and the word "sidebar" are gone from the codebase, including from two
live model prompts (`spec-gen.ts`, `registry/spec.ts`) that were still describing
the surface to the model, and the shared `.sidebar-toggle` class is now
`.panel-toggle`.

### Deliberately not done here

- **Deletion has no doorway on the desk** between this issue and 5.9/02, which is
  where the logo's context menu lands. The route and its whole flow are untouched
  and reachable by address; `renderLogoRemoval` already targets
  `#capability-logo-<id>`, so the logo disappears the moment a deletion commits.
- **An evolution's existing logo does not animate** while its build runs. The
  acceptance criteria ask only that no *second* tile appear, and driving
  `logo-tile--working` onto a registry-backed logo needs a second out-of-band
  channel and a second teardown. Worth doing, and worth doing on purpose.

### Demo-vs-real boundary

None. Everything here ships in the page a user loads at `/`.

## Verification

```
bun run test
bun run typecheck
bun run lint
```

`bun run test` → 1347 passed, 0 failed (2 shards, 68s). Typecheck and lint clean.

New coverage:

- `src/presentation/desk-logo-layer.test.ts` — the column flow derives its row
  count from the layer's own bounded height rather than a written-down number; the
  box is bounded top and bottom and its floor is `--prompt-clearance`; the phone
  rule is located *inside* the 720px query rather than by being last in the file,
  and resets flow, rows, columns and positioning explicitly; the layer takes no
  press of its own and the logo takes its own; the tile's size, corner, shadow and
  label are declared once by the contract and restated nowhere in `public/css/`;
  the tile's shadow does not read any of the three names `ink.css` registers as
  non-inheriting; the placeholder is a real designed state and only animates behind
  the reduced-motion guard; the shipped page inherits the layout (it loads the
  manifest, and the layer sits inside the one positioned box) rather than
  reimplementing it; no shipped file brings back `hasCapabilities`,
  `has-capabilities` or `data-capability-entry`; `toolbar.css` is gone.
- `src/presentation/desk-logos.test.ts` — one build's tile comes down and no other
  is touched; a build that never stood one up removes nothing; removal is
  idempotent; a build id is matched as a value rather than assembled into a
  selector; all three `detail.type` values htmx closes a stream with take the tile
  down; a close belonging to another build leaves this one standing; activation
  leaves exactly one registry-backed logo and no gap; the build is still readable
  off a subscriber the terminal presentation already detached; the press reaches
  the build's own subscriber, falls back to the narration region when it has gone,
  and does nothing when the press lands elsewhere; the module ships with the shell
  and starts itself; and the three strings the classic script and the server
  renderer share are pinned against each other.
- `src/pipeline/build/provisional-logo.test.ts` — a separate capability wears the
  name its identity was bound to; the resolver's line is used only when it came
  back as a name; a warm sentence never ends up written on the desk.
- `src/web/fragments.test.ts` — rewritten for the logo: the commit sidecar wraps
  one canonical logo for `beforeend` insertion and carries no delete control; an
  evolution replaces a changed label and emits nothing when it did not change; the
  provisional tile is keyed by the build id, carries no capability identity and no
  route, and escapes both the label and the id; an empty registry stands no logos
  but keeps the layer and the modal; rows render one logo each with nothing gated;
  and `PAGE_ASSEMBLY_ANCHORS` is three.

Live-checked against the dev server on `:3030`, building four real capabilities
through the prompt bar:

- Logos stand on the ground at the top left, 96px cells, 5 rows to a 682px layer,
  flowing down a column. Twenty-four logos at 1280×800 stand in six columns,
  `scrollWidth === clientWidth` — nothing clipped and no scrollbar.
- The phone form (375×812) resets to row flow: three tiles across the top,
  `position: static`, labels legible against the meadow.
- A press on empty layer space hit-tests to the content behind it; a press on a
  tile hit-tests to the tile.
- Pressing an activated logo opens that capability and pushes `/capability/:id`.
- A new-capability build stands a working, build-id-keyed tile on the ground the
  moment resolution admits it, and pressing that tile focuses the in-flight
  narration.
- Cancelling a build takes its tile down and leaves exactly the registry-backed
  logos. So does activation: the committed capability's logo lands out of band with
  the commit and the provisional one comes down on the close.

### Adversarial findings, fixed

- **A tile could be stranded on the ground for the rest of the session, by an
  ordinary gesture.** The takedown only fired on `htmx:sseClose` with
  `detail.type === "message"` — the server-sent `done`. htmx's SSE extension also
  closes a stream whose subscriber left the document, and says so with
  `nodeReplaced` or `nodeMissing`; because it closes the `EventSource`
  programmatically, no `error` event fires either, so nothing caught those. Pressing
  another capability's logo while a build runs swaps `#spec-build-output`, which is
  where the subscriber lives — reproduced live, tile left standing. Every ending
  now takes the tile down: removal is idempotent and keyed by the build id, so
  there was nothing to gain by being selective and an orphan to lose. Re-verified
  live on the same gesture. The test that should have caught this was asserting a
  `detail.type` the extension never emits; it now runs all three real ones.
- **A fifth SSE event name, against ADR-0002.** The tile was sent as
  `provisional-logo` with a hidden listener of its own, and ADR-0002 says of this
  exact tile: "This adds no app-level SSE event name." It rides `fragment` now and
  the extra listener is deleted. The ADR records the shipped shape.
- **The logo layer was an invisible dead strip down the left of every capability.**
  `.desk__logos` is as tall as the desk holding one logo or twenty, and it is
  painted over the content region — so a ~96px column of every records list was
  unclickable and did not chain scroll either. `.desk__windows` in the same
  stylesheet already solves this; the layer now does the same
  (`pointer-events: none`, with `pointer-events: auto` on the logo). Verified live:
  a press on empty layer space reaches the content.
- **The tile cast no shadow at all.** `logo-contract.css` asks for
  `box-shadow: 3px 4px 0 var(--ink-shadow)`, and `ink.css` registers `--ink-shadow`
  as a non-inheriting `@property` so a drawn boundary's shadow cannot reach what it
  encloses. Below `:root` the name resolves to nothing, which makes the whole
  declaration invalid — the tile was flat. It mixes the same 24% from `--ink` now,
  the way `--shadow-desk-label` does, and a test fails if the tile's shadow ever
  reads one of those three names again. The tile is the first thing in the product
  to consume that rule, which is why nothing had caught it.
- **The word survived the deletion.** "toolbar" and "sidebar" were still in the
  shipped page's own comments, in `cached-view.ts`'s doc comments, and — the part
  that mattered — in two live model prompts telling the model a label is "shown in
  the toolbar". All swept, and `.sidebar-toggle` renamed to `.panel-toggle`.
- **New comments reintroduced banned words.** "drawer" and "right sidebar" for the
  developer panel, eight times. `public/css/devbar.css` also carried a half-finished
  sentence from the sweep. Fixed.
- **Duplication the review was right about.** `capability-logo-<id>` was assembled
  independently in the renderer and in the deletion presenter, and is now one
  exported helper; the selector-escaping helper in `desk-logos.js` is gone in favour
  of reading the attribute back; the same three-paragraph explanation was written
  out in four files and is now written once where the markup is.
- **Tests that would have passed with the feature deleted.** The stylesheet rung
  pinned only `design/`, which this change does not touch — it now also pins that
  the shipped page inherits it. A tautological assertion and a pass-through
  re-assertion were cut, and `activation.test.ts` was checking for a marker that no
  longer exists anywhere.

Accepted rather than fixed, and recorded here:

- **The layer is drawn over the open capability, not just laid beside it.** With
  twelve or more capabilities the third column onward paints over the records. This
  is cosmetic — presses pass through — and 5.7 moves capability content into the
  window, which is where the two layers get a real stacking order.
- **The provisional tile almost always reads "Something new".** The issue says it
  "uses the resolver's friendly label", and the resolver has no such field: its
  `user_facing_label` is prompted as *one warm sentence*, which the registry's own
  label guard rejects on the full stop, and `proposed_identity` is non-null only for
  a `namespace` split. So the two real name sources are tried in turn and anything
  sentence-shaped falls back. It is honest and it is not good: the narration
  streaming beside the tile says "I'll create a dedicated Houseplant tracker" while
  the tile says "Something new". Closing that needs a decision — a short name field
  on the resolver, or relabelling the tile when the spec's authored label lands —
  and it is a product decision rather than an implementation one.

## HITL — how to check this

The dev server on `:3030` (start it with `bun run dev` if it is down).

1. **The empty desk needs no gate.** `bun run reset`, then open
   <http://localhost:3030/>. You should see the wallpaper and the floating prompt
   bar and nothing else — no rail, no sliver of one on the left, no empty panel.
2. **A build announces itself on the ground.** Type *"I want to keep track of my
   houseplants"* and press **Make it**. A striped tile appears at the top left
   within a second or two, animating, labelled and reading "— being made" to a
   screen reader. Press that tile: the narration comes back into view.
3. **Activation replaces it.** Wait for the build to finish. The striped working
   tile is replaced by the capability's own logo, at rest, with its name under it —
   one tile, not two, and no gap in between. Press it: the capability opens and the
   address becomes `/capability/<id>`.
4. **Cancelling leaves nothing behind.** Start another build and press **Cancel**
   while it runs. The tile disappears and only real capabilities are left standing.
5. **So does walking away from one.** Start a build and, while it runs, press an
   already-built capability's logo. The build is dropped and its tile comes down
   with it — nothing is left claiming to be under construction.
6. **The desk has no ceiling.** Build past a dozen capabilities (or just narrow the
   window): logos fill down a column and wrap into a second and third, and nothing
   is cut off or scrolls sideways.
7. **The phone.** Narrow the browser under 720px. The logos reset to rows across
   the top, like a phone home screen, and the prompt bar keeps its own strip.
8. **Nothing is stolen from the content.** With a capability open, click in the
   empty space under the logos, over its records. The click reaches the records,
   not the invisible layer.
