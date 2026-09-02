# Module 5 — The Desk — Plan

Status: issue conversion complete — dependency and cleanup contracts hardened for implementation

This refines [docs/modules.md](../../docs/modules.md) §Module 5 with the design
decisions that module ownership leaves open. It does not change Module 5's goal,
boundary, or exit criteria. Terms follow [CONTEXT.md](../../CONTEXT.md); the
surface itself is specified by the pages under [design/](../../design/), which are
the product requirement for the desk and are not restated here. The decisions
below were settled in the desktop design session of 2026-08-20, and this plan is
where they are recorded. None of them has reached the shipped app: where a
passage names a file, a function or a token under `public/` or `src/`, it names
work this module has to do, and where it names one under `design/`, the pages
already behave that way. Decision record:
[ADR-0007](../../docs/adr/0007-capability-logo-contract.md) (the logo's
delivery, storage, retry, safety and cost). The plan reuses
[ADR-0002](../../docs/adr/0002-sse-transport-conventions.md) (the `commit` and
`fragment` swap contract, whose stable target now lives in a region the client
creates and destroys),
[ADR-0004](../../docs/adr/0004-capability-artifact-contract-and-validation-isolation.md)
and
[ADR-0005](../../docs/adr/0005-opinionated-capability-ui-design-contract-and-gate.md)
(the artifact contract, the one item renderer, the presentation adapter and the
design Gate, whose closed value axes are re-derived here), and
[ADR-0006](../../docs/adr/0006-capability-evolution-versioning-and-diff-contract.md)
(evolution, the read gate, the deletion drain and the tombstone, whose
content-area sentences become window sentences).
[ADR-0001](../../docs/adr/0001-product-style-and-voice.md) is amended, not
retired: High Meadow supersedes its visual half — subtler neobrutalism on Paper &
Ink, the `--color-*` names, the radius and shadow ladders — while its warm
first-person product voice, the Aluna name and the pet's deferral survive
untouched. The styled wordmark does not survive. It went with the header row that
carried it, the desk puts none anywhere else, and only the name is left.

## Decisions locked for issue conversion

### The surface

1. **The desk replaces the shell's three regions, and the window is the content
   area.** A wallpaper, a logo layer and a prompt bar are what the page ships;
   everything a capability shows — its collection, one record in its form, a
   deletion confirmation, the narration of a build — happens inside the one
   window (D1, D2). Page assembly collapses with them. `src/web/fragments.ts`
   composes every full page today by replacing four literal strings in
   `public/index.html` — the toolbar-entries comment, the exact `intro__output`
   snippet, the modal mount and the literal `class="shell"` — and the desk page
   leaves two, the logo layer and the prompt bar's notice slot
   (`PAGE_ASSEMBLY_ANCHORS` — corrected 2026-09-02: this said "one anchor, the logo
   layer", written before decision 21 gave a load its own sentence to seed); the
   window is created client-side. The modal
   mount has nothing left to mount, because a record now opens through an ordinary
   view swap inside the window. `public/detail-modal.js`,
   `public/detail-modal-refresh.js` and `src/presentation/detail-modal.ts` are
   deletions rather than ports, and `showModal()`, the focus trap, the inert
   template clone, the page-wide inertness and the `mutationBusy` gate that
   silently swallowed a record click go with them. The toolbar and the sidebar go
   the same way.

   *Measured 2026-09-02, and it did not hold.* This ended "This module removes more
   code than it adds". The **shell surface** claim is true — the toolbar, the sidebar,
   the header row, the detail modal and its focus trap, `mutationBusy` and
   `hasCapabilities` are all gone with no live survivors — but the module as a whole is
   strongly additive: net +10,731 lines in non-test `src/`, +7,525 in `public/`, and
   +27,077 in tests. The window, the logo, the drawn line, the form vocabulary and the
   address scheme are all new surface, and they cost more than the old shell did. Kept
   as a decision rather than edited away, because the number is the honest record of
   what a "collapse" turned out to be.

2. **The shell may remember how things look to the user; it never decides what is
   true.** Architecture §6.1's blockquote is restated in exactly that form. Window
   geometry, maximised state and where the user likes things are presentation
   state and the shell's to keep; which records exist, what is valid, what a
   capability means and what an intent was are canonical state and the server's
   alone. One sentence carries the boundary, with no enumeration to maintain. It
   admits future desk furniture without another amendment while still standing
   between the browser and any re-implementation of capability logic.
   "A single static HTML page. It never changes after first load" is retired with
   it: the window is created and destroyed, and exactly two presentation records
   live in `localStorage` — one per allowed window, carrying its desktop box and
   flags (D9, D14).

3. **The logo layer takes the toolbar's jobs, and an empty desk needs no gate.**
   Listing what exists, navigating, announcing a new capability and carrying a
   rename all land on the logos without argument; the fifth job, deletion, is
   decision 19. `public/app.js` infers "this user is new" today by finding no
   `[data-capability-entry]` after a swap, and CSS hides the rail until one
   appears. That `hasCapabilities` gate goes. An empty desk is a wallpaper and a
   prompt bar, and it reads correctly with nothing gating it. An in-flight
   new-capability build may add a presentation-only tile only after resolution
   admits it, keyed by build id until activation supplies a real incarnation.
   Activation replaces it; every non-activating terminal removes it. Evolution
   reuses the existing capability tile, and reject/data-query/pre-admission
   refusal never create one.

4. **Logos fill down a column and wrap to the next, across as many columns as the
   desk holds.** `grid-template-columns: repeat(2, 96px)` was a mockup shortcut
   sitting inside a `.desk` that is `overflow: hidden`, so everything past about a
   dozen capabilities was cut off with no scroll and no affordance, and the
   developer tile took one of those slots. Icons flow the way every OS desktop
   flows them instead, using whatever the desk's height and width allow. A product
   whose premise is make as many tools as you want cannot have a ceiling of
   eleven. `design/styles/components/desk.css` already does it: the grid is
   bounded top and bottom and flows down a column, so `auto-fill` derives the row
   count from the desk's own height. Measured at a 660px desk, that is four rows
   to a column, and twenty capabilities stand in five columns with nothing
   clipped. The phone form resets to row flow explicitly, or the column flow leaks
   into it through the media query. The shipped shell still has none of this, so
   carrying the flow into it is this module's work.

5. **No window can be dragged or resized into the strip the prompt bar occupies.**
   Maximise already respects that clearance; dragging and resizing now respect it
   too, so the tail of a records list — which is exactly where a user scrolls — is
   never hidden under the bar and never unclickable. The stylesheet owns the
   number and JavaScript reads it back. `design/` already works that way:
   `--prompt-clearance: 4.875rem` lives in `tokens.css` after decision 46's
   conversion, the logo grid's bottom edge
   is `calc(1.25rem + var(--prompt-clearance))`, and `desk-geometry.js` reads the
   token at load rather than restating `78`, keeping the literal only as a
   fallback for a stylesheet that has not applied. The grid and every window stop
   on the same floor by construction. The shipped shell reserves no strip at all,
   so this module carries both the token and the floor into it.

6. **The address names the capability and nothing else.** `/capability/:id` says
   which capability is in the window, and that is the whole scheme (D14).
   Everything inside a capability — the search term, which record is open, a
   half-typed edit — lives only in the current DOM and dies with the tab. It does
   not enter the address, `localStorage`, or the Builder's data-free restoration
   descriptor. During a build the address keeps naming whatever the build
   displaced, so restoration never has to touch it; a reload returns to that
   capability's canonical collection and loses the search, record subview and
   draft, which is the accepted cost. Logo open/switch and put-away push canonical
   addresses; `popstate` renders without pushing, and focusing an already-open
   logo adds no duplicate, so Back/Forward cannot loop or desynchronise the frame.
   A v1 build pushes its new capability address only when activation puts that
   canonical collection in the window; evolution and non-activating terminals do
   not change the route.

### The visual system

7. **`design/styles/` is the source of truth for the visual system, token names
   included, and it ships rather than being copied.** It stops being a reference
   mockup and becomes the stylesheet the product loads, so there is one copy of
   every value and no second token layer to drift against. Paper & Ink is
   superseded and deleted. Three things follow. The Gate's approved-value list
   re-derives against High Meadow names (decision 10). `design-system.md`'s
   tie-breaker — "the CSS wins, and the CSS is `design/styles/tokens.css`" — repoints
   at `design/styles/tokens.css`. And ADR-0001's visual half is superseded while
   its voice half stands unchanged. The silent-rename hazard that would normally
   make a token swap dangerous does not arise, because nothing survives that
   speaks the old vocabulary: four shared `--type-*` names change value without
   changing name, five of six `--space-*` names roughly halve, and the shadow
   tokens change type so `box-shadow: var(--shadow-md)` has no valid value at all.
   Every one of those would have quietly resized, respaced or unshadowed a
   renderer already on disk, which is why the corpus goes with them (decision 8).

8. **The existing capability corpus is deleted, not regenerated.** The
   capabilities under `capabilities/` have no logo and never went through the
   build that ends in one, so they are removed rather than rebuilt against the new
   vocabulary. The same cut removes `ui_intent.detail.shows` from authored and
   registry schemas before any High Meadow capability is rebuilt; the temporary
   modal derives active form-field order until it is deleted. This is the same
   greenfield move Module 3 made for the M2→M3
   artifact shape and Module 4 made at each of its cutovers: change the system,
   `bun run reset`, rebuild fresh. No preservation cutover, no dual-serving, no
   contract marker. Placeholder capabilities built to prove 5.1–5.4 are
   deliberately reset once more in 5.5/01 before the required logo birth facts
   land; they have spent no logo credits. From that point onward the corpus is
   preserved through Module 5 and every capability is born with its final logo
   contract.

9. **The drawn line reaches the record cards, rows and tables a capability
   generates.** D11 applies everywhere it says it does: windows, prompt rail,
   buttons, inputs, and the records themselves. Records are what a user looks at
   longest, a straight-edged card on a drawn desk reads as unfinished, and the
   deleted weight ladder leaves no softer setting to fall back on. Both stated
   blockers are answered without
   touching the generation pipeline. A drawn card's hand is seeded from the
   record's own id, which is stable across view swaps and resizes and is not
   derived from where the element sits, as the rule forbids; the spec, the
   generator and the registry are asked for nothing, and generated code never
   learns the ink system exists. Cost is bounded by observing resize once per list
   container rather than once per card, since the children of a list resize
   together, which leaves a speed measurement on long lists rather than a design
   fork.

10. **The Gate keeps three closed axes and gains four bans.** ADR-0005's fourth
    closed axis, border weight, gets no successor list; border joins font family in
    the never-declared category, and corner radius and shadow join it there.

    | | Property | Rule |
    |---|---|---|
    | Pick from the list | colour | only `var(--<token>)` from the High Meadow palette |
    | | type size | only from the High Meadow size set |
    | | spacing | only from the High Meadow spacing set |
    | Never declared | font family | inherited from the surface it sits on |
    | | border | the ink system owns every boundary (decision 9) |
    | | border-radius | no radius tokens exist; a square corner is the absence of a declaration |
    | | box-shadow | nothing inside a window casts, and the shadow tokens are bare `<x> <y> <alpha>` numbers, so `box-shadow: var(--shadow-*)` produces an invalid value that fails silently |

    Radius and shadow are absences in High Meadow rather than shorter lists, so
    inventing token sets for them would contradict the design, and banning them is
    the only thing that catches the shadow case, which fails silently rather than
    visibly. The platform's grip tightens as a result: a generated screen can no
    longer express hierarchy through line weight, and hierarchy rides on the ink
    system's deviation — the frame, fine and close hands — instead.

11. **`design/design-system.md` is rewritten against High Meadow, moves into
    `design/`, and states no values.** The agent handbook survives, because it is
    what a coding agent reads before adding UI, but its scope narrows on the same
    move: it owns names and rules — which classes exist, which properties pick
    from a list, which are never declared, what is banned — and every number
    points at `design/styles/`. Values live once in CSS and names live once in the
    handbook, so the old tie-breaker has nothing left to arbitrate. Sections
    describing components that no longer exist are deletions rather than rewrites:
    the detail modal's 98 lines of focus trap, Escape handling, three close paths,
    delete confirmation and datetime mirror; the accessible item wrapper, since
    the design's record is a real `<button>` and needs no `role="button"`, no
    `aria-haspopup="dialog"` and no hand-written Enter and Space handling; the
    sidebar's four behaviours; and the wordmark. Three "don't" rules invert and
    are restated as rules of the new system — a frame around every region, a
    raised and framed prompt rail, and the logo label's blurred shadow.

12. **The layout kit ships as a real stylesheet under `design/styles/` keeping its
    current names, and `layout.css`'s own `.stack` is renamed.** `.stack`,
    `.cluster`, the flex and grid utilities, `.gap-*`, `.text-*`, `.truncate`,
    `.line-clamp-*` and `.media-frame` are the vocabulary every generated screen
    already speaks, and they return nothing under `design/styles/` today. The
    incidental `.stack` that does exist there is a 22px page column in a file
    whose header states it owns no product component; renaming that one is cheaper
    than renaming the one the AI writes, and leaving both would silently give a
    generated stack a page column's spacing with no error raised anywhere.
    Shipping the kit preserves ADR-0005's stated goal that common arrangement
    never needs inline `style`, which is what keeps the Gate's surface small.

### Window lifecycle and correctness

13. **Cleanup belongs to the content region, not to the window.** Whatever the
    content started — in-flight fetches, search controllers, server read tokens —
    is released when that content is replaced or removed. One rule covers both
    putting the window away and swapping views inside it (list → record → back),
    where a window-scoped hook would leak on every swap. `desk.js`'s `destroy()`
    grows from disconnecting a ResizeObserver to the full release. Today nothing
    is released at all: a fetch resolves against a detached node, and the
    server-side read token stays held until the handler timeout. Putting the
    window away is now the only way a region disappears, which makes this the
    single place that has to get it right.

14. **The drain deadline is raised above the longest a single handler may run.**
    `DEFAULT_READ_DRAIN_TIMEOUT_MS` in `src/read-gates/index.ts` is 5,000ms while
    `DEFAULT_CAPABILITY_HANDLER_TIMEOUT_MS` in `src/router/generated-code.ts` is
    10,000ms, so a well-behaved reader can currently cause a deletion to fail for
    reasons the user cannot see — and one window holds several concurrent read
    tokens whenever a canonical read, a debounced search and a post-mutation
    refresh overlap. Reads are not capped downward to close the gap: reads are what
    the user is doing, deletions are rare and deliberate, and killing a slow read
    to speed up a rare operation is the wrong trade. A deletion that still times
    out returns distinct typed outcome `deletion_drain_timeout` rather than a
    generic pre-commit failure, and now has a surface of its own (decision 23). The documented invariant
    stands untouched:
    never await a queued acquisition inside a read-token scope.

15. **Cross-capability staleness gets no machinery.** Verified against
    [`src/registry/spec.ts`](../../src/registry/spec.ts): `read_dependencies` are
    strictly reads, self-dependency is rejected, and no write-dependency concept
    exists anywhere. With one window only one capability is visible, every open is
    a fresh read, and builds and deletions both take the window. The sole remaining
    path to stale data is a second browser tab, which is an accepted known edge
    rather than a hole to build machinery for. No bus, no version stamp, no refresh
    lamp. `handOffRecordsRegionFromHtmx` and the hand-rebuilt restore path in
    `public/app.js` go with the toolbar, because the window has no refresh verb by
    design.

16. **The server keeps addressing a named target, and the client guarantees it
    exists.** ADR-0002's contract survives intact: `commit` and `fragment` keep
    addressing a stable id, and the client guarantees that id is present whenever a
    swap can be in flight. Decision 13 makes half of that promise keepable —
    content that goes away cancels what it started, so nothing can arrive at a
    destroyed region — and decision 17 makes the other half. The `class="shell"`
    swap that fails silently today at `src/web/fragments.ts:257` throws like the
    other three.

17. **Leaving the window while a build or an evolution is running warns first.**
    Put-away, another capability logo and Back/Forward all remove the live run, so
    they proceed only on confirmation, and the
    confirmation routes through the existing cancel path rather than a second
    teardown. The warning is markup the still-mounted run surface already carries,
    unhidden in place — never a content swap — so merely showing it cannot fire the
    cleanup that cancels the run.

    *Amended 2026-09-02, after 5.8 shipped.* This was written as "an inline row …
    not a content swap or modal". What the product owner asked for during 5.8, and
    what ships, is the question read **over the window it is about**: a dimming of
    the run's own window body with the question centred on it. That is a change to
    the treatment and not to the rule the treatment exists for — the whole of it is
    markup the run already carries, it is unhidden rather than swapped in, and it
    reaches no further than the window's own body: nothing opens over the desk,
    nothing outside the window is covered or made inert, focus is not trapped, and
    the two window lamps stay pressable. Aluna still has no modal (design D2, and
    design-system.md's "There is no modal anywhere in Aluna", which carries the same
    amendment). `src/presentation/leaving-a-run.test.ts` pins each half of that
    distinction. That one cancel teardown then performs the captured
    put-away/logo/history continuation without flashing restoration or duplicating
    history; ordinary Cancel still restores. This is an amendment to D3: close still means put away and
    still changes nothing in storage, but it is no longer silent when there is
    running work to cancel. It does not create draft persistence or dirty-form
    tracking: idle search/record/draft state remains deliberately DOM-only under
    decision 6 and is discarded when put away.

18. **Maximised is stored as a flag and recomputed against the current screen.**
    The capability-window record keeps one normal box, which is also the
    pre-maximise box, beside that flag; there is no extra storage key. Any stored
    box is clamped to the viewport on load and on resize — which means
    `design/scripts/` grows the `window` resize listener it currently lacks.
    Three symptoms close together: a maximised window on a wide
    screen writing width minus 36 into the persisted box and stranding it on a
    narrower one, a reload that keeps the size and forgets the state, and a resize
    that nothing reacts to. Malformed/partial storage and non-finite geometry
    fail soft to per-window defaults before clamping; presentation corruption can
    never prevent the addressed capability from loading.
    The design's Forget remembered boxes action removes the one layout storage
    entry and resets mounted geometry without replacing content, changing the
    address or cancelling work; the developer panel's next-load open preference
    returns to closed.

### Deletion and rename

19. **A short context menu opens on a capability's logo, carrying Rename and
    Delete.** Three ways in, one component: right-click for a mouse,
    press-and-hold for touch, and the menu key or Shift+F10 for the keyboard,
    which the logo already accepts because it is a real `<button>`. This settles
    the homeless trash icon and the rename doorway with the same menu, and it
    respects the design's constraint literally — the doorway is on the logo, not
    on the window chrome, so no lamp goes signal red and D3 stands. Choosing
    Rename turns the label under that logo into a real inline form with Save and
    Cancel; it neither opens a modal nor displaces the capability window, and it
    uses the capability-label validator and escaped text rendering. Long-press
    cancels on movement, scrolling or release and cannot fall through to the
    logo's click. Rename changes
    the capability's label and nothing else: not its id, not its address, not its
    artwork, which L7 forbids redrawing. A coordinator-owned short write records a
    nullable platform `display_label_override`, bound to the exact incarnation and
    version; the effective label is `override ?? spec.label`. Immutable authored
    snapshots remain truthful, the override survives evolution, and the resolver
    catalog binding changes so older resolved work that has not yet revalidated
    becomes stale, without jumping the coordinator's FIFO queue. There is no logo
    work, route change, version or build. Three
    alternatives were rejected: drag-to-trash solves only delete, costs a desk slot
    and is keyboard-hostile; the prompt bar puts the AI in charge of identifying
    the target on a path that is deliberately zero-AI; and a developer-panel manage
    list hides an ordinary action behind a developer surface while duplicating the
    ground.

20. **The confirmation fills the window as everything else does, in authored
    product voice, and the path stays zero-AI.** ADR-0006's deletion contract is
    unchanged underneath — advisory preflight, lease-held reverse-dependency
    revalidation, the drain, the tombstone — and only its content-area sentences
    become window sentences. On commit the tile vanishes. The window puts itself
    away when the deleted capability was previously open or the desk was bare;
    when the confirmation displaced a different open capability, that
    capability's current canonical collection returns. There is no terminal state
    for the deleted capability. Backing out with "Keep it" uses decision 25's same
    data-free restoration path.
    It may take the window only after confirming that no build or evolution owns
    the live content region; otherwise the desk action is refused on the prompt
    bar and the run remains mounted. That preflight is not authority: ordinary
    coordinator admission and lease-held revalidation still govern commit.

21. **A link to a deleted capability loads the bare desk with a brief notice.**
    That covers the second-tab, bookmark and reload cases without a window state of
    its own. The brief interval before the tombstone commits — an aborted read,
    then 409 `read_unavailable` on new reads, then 422 on pending writes — needs
    nothing new either: those are structured refusals, and decision 26 says where
    a structured refusal renders.

22. **Record deletion keeps the shape it has today.** The confirmation replaces
    the record's action row in place — "Delete this record? You won't be able to
    bring it back", with Cancel beside Delete record — exactly as
    `src/presentation/detail-modal.ts` renders it now. Only the container changes:
    the modal's action row becomes the form's action row inside the window.
    Deleting a record therefore starts by opening it, and the list carries no
    per-row delete.

### Failure and messages

23. **The window explains what happened in the window.** A build that fails, is
    refused as stale, or comes back a measured no-op adds a final line to the build
    narration in the same product voice and stops instead of committing. The build
    log is already an `aria-live` region and is already where the user is looking,
    so the desk needs no notice component of its own.

24. **The prompt bar explains what happened to the prompt.** Anything rejected
    before a build starts speaks there: a prompt the resolver refuses, or a build
    refused because another one holds the lease. The 400ms `is-refused` flash stays
    as the attention cue and stops being the whole message. `#prompt-notice`, which
    carries refusals today, finds its counterpart on the desk in the prompt bar
    itself. One replaceable `aria-live` slot holds the sentence without a timer or
    stack: refusal preserves prompt/focus, edit clears stale copy, and an admitted
    prompt keeps the existing clear-on-success lifecycle.

25. **Restoration waits when Aluna has something to tell you.** Fail, stale and
    no-op hold the window until dismissed, then restore the displaced capability's
    current canonical collection or the bare desk.
    Cancel restores immediately, because the user already has the information —
    they supplied it. The existing restoration descriptor keeps its shape and
    resolves against the then-current registry; it never stores search, record,
    edit, delete-confirm or draft data, and its modal-closing half has nothing left
    to close. The same terminal cleanup removes any build-id provisional tile;
    activation replaces that tile exactly once with the registry-backed one.

26. **A structured refusal renders on the surface it arrived from.** The 422 and
    409 responses that `HX-Retarget` routes into a per-capability error node today
    render in the window when the window is what asked, and on the prompt bar when
    the prompt bar is what asked. Per-field validation errors are a different
    matter and are settled by decision 30.

### Forms and fields

27. **The field vocabulary gains a choice type that carries its declared values.**
    `SCALAR_FIELD_TYPES` extends and `specFieldSchema` gains a `values` array of
    stable `{ value, label, ...metadata }` option objects,
    which forces the DDL mapper, both total switches in `field-renderer.ts` and the
    generator prompt to handle it — the union's own comment names this as the
    designed extension path. The design's full picker feature set comes with it:
    grouped options, per-option notes and per-option disabled states. A choice
    field declares its presentation per field in the spec — picker, radio group, or
    segmented control — rather than having it inferred from how many options it
    has. The base object shape lands before the richer metadata so 5.10/02 does
    not invalidate specs built by 5.10/01; each choice also emits an ordered empty
    `groups` declaration list that 5.10/02 can populate. Stored values are immutable and
    append-only through evolution; platform mutation validation rejects an
    undeclared or newly disabled value before generated code or canonical state
    sees it, through typed `invalid_choice`/`choice_disabled` 422 responses that
    name the field. Because no
    reset is acceptable after logo credits and records exist, older active rows
    parse absent new form collections as canonical empty while new candidates emit
    the complete shape; absence and empty compare equal and historical snapshots
    are not rewritten.
    The drawn picker ports the design's complete select-only combobox behavior —
    open/move/Home/End/typeahead/commit/Escape/click-away with focus kept on the
    button and active-descendant ARIA — rather than only its paint; disabled
    options are skipped. Radio uses native inputs and segmented remains an
    ordinary keyboard-operable exclusive button set.
    Group headings and option notes remain available to assistive technology,
    rather than becoming visual-only decoration.

28. **Long text is a key on `uiFormIntentSchema`, following the existing
    `form.list_inputs` precedent.** It needs a refinement beside
    `validateListInputs` and a generator clause. `createInputFor` returns
    `type="text"` for every string unconditionally today, which is why a field
    holding three sentences gets the same single-line input a title does; this
    fixes every notes, description, review and journal field.

29. **Two per-field additions carry the rest: `guidance` and `max_length`.**
    Ordered `ui_intent.form.guidance` entries carry a short hint under the field,
    and also carry the sentence
    announcing a default, so defaults need no key of their own. `max_length` is one
    positive-integer declaration on a scalar string field driving
    platform mutation validation, native `maxlength` and the character counter;
    crafted overflow is typed `max_length_exceeded` with the field marker before
    generated code or canonical mutation.
    Soft-hide preserves it exactly. Adding or lowering a limit is refused before
    activation when any committed physical value, active or inactive, already
    exceeds it, so evolution cannot strand an otherwise valid row.
    There is no placeholder key: guidance survives typing, which is exactly when a
    format hint matters. The optional marker (C8's inversion, which the spec
    already knows from `required`) and the disabled visual state used by platform
    form lifecycle are free renderer work; no model-authored per-field disabled
    key is added. Choice-option disabled state remains decision 27. Read-only is
    not a third: clicking a record opens it in edit
    mode, in the form, so nothing renders a record read-only and no field ever
    reaches that state. The muted em dash for an absent value goes the same way;
    an absent value is an empty input. `ui_intent.detail.shows` already went in
    the initial reset-bounded cut (decision 8), before any High Meadow capability
    was rebuilt; carrying it to this epic would have forced a late corpus reset or
    new choice handling in a branch immediately deleted.

30. **A validation error replaces that field's guidance, and the browser checks
    required fields before submitting.** An outline says that something is wrong
    and a sentence says what, so the sentence belongs in the field. This placement
    slice needs no additional schema or server change: `data-error-fields` is already emitted by
    `src/router/failure-responses.ts` and pinned as contract in `spec.ts`, and is
    read by nothing today. Client-side required checking recovers the native
    constraint validation the drawn picker gives up, since a hidden input is barred
    from it, and it recovers it in the same place and the same style with no server
    round-trip. The hidden-input mirror needs a real `<form>` ancestor; the datetime
    mirror already in the codebase is the working precedent, and the controls page
    has no `<form>` at all today. The invalid event suppresses the browser tooltip
    and places the one platform-authored required sentence in that field until it
    is corrected. The one marked product-voice sentence returned by
    a generated Handler remains authoritative and is relocated rather than
    rewritten; `behavioral_errors` fixes its semantic markers and affected fields,
    not its prose. Platform-owned structural errors keep one authored platform
    sentence and do not enter model-authored `behavioral_errors`. No second copy
    source is introduced.

31. **The button set drops `neutral`, renames `ghost` to `outline`, and adopts
    C9's size scale.** Buttons sit on `--surface`, the near-white window, not on the
    green ground, and the re-check pass that `design/index.html`'s status row
    records left the fills alone. What survives is primary, secondary, info,
    feature, warm, danger and outline, with outline as the only unfilled variant.
    They are expressive and they read correctly on the window surface. C9's three
    heights plus a full-width modifier land on a `--control-h` token, and
    `--focus-ring` and `--control-h` lose their PROPOSED labels — the first settled
    by decision 45, the second by this one.

32. **Three consequences settle themselves.** `.field__control` takes the design's
    meaning — the outer shell carrying the boundary, fill and states, with
    `.field__input` as the input — which is free because the corpus using the old
    naming is being deleted (decision 8). A `string[]` field gets a drawn control
    now: it is a shipped type with no picture in the design, which is a present gap
    rather than a future one. `comma_separated` remains one trim/drop-empty input;
    `repeatable` uses drawn rows that are dragged by a grip, and reordering is
    fully keyboard-operable with stable focus rather than drag-only. Both
    normalize to the same ordered array. File fields wait for Files, now Module 7;
    they do not exist yet.

    **Amended 2026-08-31, in 5.10/05.** The constraint stands and the mechanism
    changed. As written, the decision named per-row move-up/move-down buttons; in
    review those read as three controls on every row and as nothing anyone had
    learned elsewhere. A grip is what a reorderable row looks like, so the row is
    dragged by one — and because the grip is a `<button>` rather than a
    `draggable` div, it is in the tab order and space picks the row up for the
    arrow keys, with escape putting it back. What the decision was protecting —
    order is data, so changing it may not depend on a gesture a keyboard does not
    have — is unchanged; what it prescribed is not. Both paths spend one movement
    and one announcement, so they cannot drift.

33. **Field labels stay uppercase.** `.caps` keeps `text-transform: uppercase` on
    a form label. Small caps is one role marker across the whole surface — labels,
    counts and kickers all take it — and the form becoming the only place a record
    is read changes nothing about what the marker means.

### The logo

34. **Each capability incarnation serves its logo from its own route, declared
    `image/svg+xml` and marked immutable.** The route takes the
    `/capability/:id/:incarnation_id/logo.svg` shape and works unchanged in the CSS
    `background-image` the desk receives from platform rendering. The incarnation
    is load-bearing: delete-and-recreate may reuse a semantic id with different
    artwork, so an id-only immutable URL would return the old browser-cached
    picture. L7 makes the exact incarnation URL honest. Only a matching active
    incarnation in `present` state receives or emits the immutable URL;
    placeholder states do not probe it, and every non-present/missing response is
    `no-store`, so an early 404 cannot outlive a later successful attempt.

35. **The response is picture-only, and the stored bytes are never touched.**
    Headers make the file render as an image and stay inert if its address is
    opened directly as a document, which honours L8 literally — everything the
    shell adds sits outside the file. This is cheap insurance rather than an urgent
    hole: the exposure requires the vendor's output itself to carry a program, and
    all four shipped specimens under `design/assets/logos/` carry zero scripts,
    zero event handlers and no `javascript:` anywhere.

36. **The C2PA manifest is kept and the response is compressed.** Measured across
    the four specimens, the manifest is a flat 4,354 bytes and is not the bulk;
    `recipes.svg` is 220 vector paths and 111 kB. Gzip recovers 60 to 70% against
    4.4 kB for stripping, and it changes nothing on disk.

37. **The artwork is `capabilities/<id>/<incarnation_id>/logo.svg`, beside the
    immutable `vN/` snapshots and not a registry column.** A retry can therefore
    install it after activation without mutating an exact snapshot inventory.
    Deletion already removes the incarnation tree, so the artwork's lifetime ties
    to the capability's without a second cleanup path, and a registry read stops
    carrying a picture nobody asked for.

38. **One atomically claimed attempt path serves post-build follow-up and
    desk-load retry, with a hard cap of three.** Successful v1 activation commits
    `absent/0`; only after the presenter terminates and the long build lease
    releases does a best-effort follow-up offer the first claim. An `absent` tile
    triggers one no-store, incarnation-bound POST whose tile-scoped response can
    arrive after the build SSE closes; the paid mutation is never a GET. Attempt
    responses never re-arm their own load trigger, even when failure returns the
    state to `absent`, so one desk load cannot recursively spend the cap. Loading the desk
    uses that same POST to offer one claim to each still-faceless
    capability. The durable state carries status plus attempts, and
    `generating` prevents concurrent loads from spending the same attempt. Recovery
    reconciles an interrupted claim from the no-overwrite final file and the
    already-consumed count, removing any incarnation/attempt-scoped stale temp
    without touching an accepted final file. Provider/install work holds the exact incarnation read
    token and releases it before coordinator-owned finalization, so deletion can
    cancel the attempt without a late response resurrecting the artifact tree.
    Concurrent claim losers observe the winner for a bounded interval and return
    current tile markup without another provider call or an unbounded polling loop.
    Attempts are time-bounded; malformed provider output and every failed/cancelled
    install remove temporary bytes in `finally` and consume the durable claim.
    After the third failure the placeholder is permanent. A `present` row whose
    accepted file later disappears becomes `abandoned`; L7 forbids generating a
    replacement for artwork that had already been accepted.

39. **The model names two of the eight hue families: the capability's ground and
    its companion.**
    They were leaf, shade, teal, sky, sun, ochre, clay and violet; signal red is
    reserved and is not offered. This deletes the chroma-and-lightness validator
    entirely: in the palette, saturated, light enough for daylight, no near-blacks,
    no pastels and no greys are all satisfied by construction, because the eight
    anchors were chosen that way, so validation becomes a word-list check. L9 already permits two
    capabilities to look alike, so no uniqueness rule is owed either. A model
    choosing beats Aluna hashing because the colour stays apt: telescope on sky,
    recipes on ochre. **Amended 2026-08-25:** the request's second colour was
    derived rather than authored, from one closed symmetric lookup pairing
    leaf/shade, teal/sky, sun/ochre and clay/violet. That kept it from being a
    fourth authored fact, and it capped the whole product at four distinct pairs —
    two capabilities collide 25% of the time and five collide with certainty,
    which four hand-picked specimens could never show. The model now names the
    companion too; it is the colour the object is drawn in, it must differ from
    the ground, and the ground is still first, so the provider client still has no
    undocumented presentation choice. **Amended again 2026-08-25:** the eight
    anchors became eight *hue families* and the concrete shade became the
    platform's. Four consecutive live capabilities came out `sky`, `leaf`, `sky`,
    `sky`, and an earlier fix that balanced the prompt's worked examples did not
    touch it — five probe builds against the balanced prompt still answered with
    the same companion three times. A spec model collapses to a mode and every
    build is a stateless call that has never seen another capability, so 56
    reachable pairs were never the constraint. Two of the eight names also named
    things rather than hues (`sky`, `shade`) while the ground is defined as what
    sits behind the object; a house went on sky. The names are hues now, no worked
    example names a colour, and each family opens onto four shades that Aluna
    resolves from the incarnation seed — the only entropy in the path. This adds
    no uniqueness rule and no desk-awareness: L9 stands, two capabilities may name
    the same hue, and the ladder is what stops them coming out the same colour.

40. **Users do not steer presentation, and the logo is presentation.** The subject
    phrase is derived from intent, never from user-authored art direction, and a
    prompt attempting to direct the logo is refused by the intent classifier under
    the same general rule that refuses "move this 2px right" or "add more padding".
    No logo-specific defence and no logo-specific validator is added. The
    contract's existing requirement stands unchanged: the request wraps the
    injected subject phrase, because `controls.no_text: true` is recorded as not
    sufficient on its own.

41. **The prompt block may be edited freely and owes no versioning.** The worry
    that editing it breaks retry-determinism does not survive L7: a logo is made
    once and never remade, so a retry is always for a capability that has no
    picture at all, and there is nothing for it to be inconsistent with. Nothing
    requires two capabilities to look like they came from the same era either;
    L9 allows them to differ.

42. **The spec gains four model-authored keys and the registry gains two runtime
    values.** The spec carries `subject` (a short phrase), `ground` and `companion`
    (each one of the eight hue-family names, and they must differ) and `noun` (for
    the desk's empty-state copy). Subject, ground and companion are immutable birth
    facts; noun may evolve as a View-only fact. The
    registry carries the per-incarnation `seed` and a durable logo lifecycle value
    `{ status, attempts }`, with status absent, generating, present or abandoned.
    The seed carries a second job since 2026-08-25: it resolves each authored hue
    family to one of that family's four shades, which is why no shade column was
    added — the seed is already the durable record of what drew the artwork.
    The artwork itself is a file, per decision 37.

### Accessibility

43. **WCAG AA contrast for text and controls is a real commitment; the rest is
    best-effort.** [PRODUCT.md](../../PRODUCT.md)'s first accessibility sentence
    holds, and it is affordable because the palette and its allowed uses are
    closed: every declared foreground/background pairing is checked once and
    stays true. This does not claim every arbitrary palette pair passes. D8
    narrows to cover the remainder — keyboard
    navigation, semantic landmarks and reduced motion are honoured but are not
    release gates. C12 was the one measured
    failure and is resolved at the palette rather than accepted: the two greens
    change places, so primary is `--shade` at 5.18, dark enough to need a light
    label rather than to break the ink-unless-too-dark rule, and secondary is
    `--leaf` at 4.54 under ink like every other light anchor. Every pair a button
    uses now passes. Ochre was the alternative and was not taken: it is the only
    unused anchor that carries ink safely, at 5.01, but a gold beside a green
    primary reads as a different kind of action rather than a quieter version of
    the same one. One observation outlives the failure — ink on leaf loses its
    counters at 10.5px small caps — so the harder pairing sits on the second action
    rather than the first, and dropping small caps on a button stays available.

44. **Reduce Motion quiets travel, not life.** Motion is on by default for
    everyone and is part of the product's personality. When the OS setting is on,
    Aluna stops positional travel — windows flying open, content sliding,
    press-jumps — because that is what triggers nausea, while in-place character
    continues: the companion will keep breathing, blinking and reacting once it
    lands, and nothing else in place is flattened either. Mechanically
    this is neither the built blanket `!important` reset nor the design's
    per-component opt-in, which leaves press transforms jumping because only
    `transition` declarations sit inside `no-preference`. It is one authored axis:
    positional distance and duration consume the central travel scale, Reduce
    Motion sets it to zero, and a stylesheet check rejects raw travel that bypasses
    it. In-place life uses a separate path and is untouched; no hand-maintained
    selector list has to grow with every new component.

45. **A text input shows the focus ring on any focus; every other control shows it
    on keyboard focus only.** The design's ring is adopted as drawn — 3px violet on
    the enclosing shell, inner ring suppressed — and the split is the rule that
    resolves today's contradiction, where `public/css/fields.css` paints on `:focus`
    against the a11y layer's keyboard-only rule. A ring on a clicked text input
    tells you where typing will land, which is real information; a ring on a
    clicked button tells you nothing you did not just do. Four `var(--signal)`
    rings escaped the override — the prompt bar, the search rail, the segmented
    control, and the global default in `base.css`, which said `var(--signal)` too
    and painted violet only because a later file overrode its colour. All four are
    settled in `design/styles/` now. `--focus-ring` lives in
    `tokens.css`, `base.css` names it directly, the two-file override mechanism is
    gone, and no `outline` under `design/styles/` reaches for `--signal` any more.

### Viewport

46. **Layout and type go to rem; drawing constants stay in pixels.** Body size, the
    20px window title, 10.5px small caps, the 96px label measure, the 180px grid
    track, the 276×176 window minimum, gaps and paddings all become rem, so browser
    text scaling grows the box along with the text it holds — text scaling being the
    most-used accessibility setting there is. The ink line's 2px weight and its
    deviation, the logo tile's 32px box and 1.25px contour, and the 10% corner clip
    stay in pixels, because they describe a picture rather than a layout, and
    scaling them changes the artwork's character. This costs one pass re-deriving
    the design's numbers.

47. **Below the breakpoint the window is the screen, and the script is told so.**
    No drag, no resize, no maximise; icons stay on the ground. `desk--phone` is
    actually set rather than only read, and the drag and grip handlers do not bind
    at all rather than binding to hidden controls. Phone mode ignores without
    overwriting desktop geometry and maximise state; widening recomputes or clamps
    them. If the developer panel is also open, only the frontmost full-screen
    window is exposed on phone and both return to their desktop boxes when widened.
    Most of this is already painted in CSS; the missing piece is telling the
    script what the stylesheet already knows.

48. **The breakpoints are the design's 720px for the desk and 620px for forms.**
    The built app's 768 and 480 were derived for the sidebar-and-modal layout being
    deleted, so nothing is owed to them.

49. **Eight leftovers settle by consequence.**

    | Item | Resolution |
    |---|---|
    | Dark theme | None. The palette is daylight and does not invert; the built app's semantic-token insurance was for a future now declined |
    | Search | Server-side and debounced, as built. The design's client-side filter is a fixture shortcut for a mockup with no server |
    | Print styles | Out of scope. No `@media print` exists anywhere in the project, and a draggable desk is not a document |
    | Long icon labels | Two lines, then ellipsis. `logo.html` states the two-line wrap and sets no clamp — a stated rule missing its implementation |
    | Long window titles | Truncate with an ellipsis, the only behaviour a locked-height title bar has |
    | `controls.css` vs `form-controls.css` | Not merged; the dead rules go instead. Concatenated the two run 693 non-blank lines against the repo linter's 500-line ceiling, which applies to CSS, and deleting every dead rule still lands near 630, so a merge can only choose a new seam rather than produce one file. `controls.css` is no subset either: four of its blocks are page chrome (`.search`, `.pill`, `.segmented`, `.control`), and `.btn` draws half its declarations from each file, the later one overriding only `background` and `padding`. The defect is dead code — fifteen of `controls.css`'s twenty-four rules are dead or exact duplicates, including a `.btn--danger` whose hard-coded `#fff0f2` never paints because a later rule sets `color` |
    | `--focus-ring` and `--control-h` marked PROPOSED | Both labels drop: the ring is settled by decision 45, the control height by decision 31 |
    | `window-frame.js` hard-coding `fill="#FAFEF3"` | Becomes a token, per `index.css`'s own rule that nothing below the token layer hard-codes a colour |

## What this module does not do

Two surfaces are deferred rather than decided, and both belong to the companion —
a talking pet that will carry narration once it lands and that is not designed
yet. Where a disposable query answer appears belongs to Module 6, and where a
behavioural proposal appears belongs to Module 8. The desk narrows each question
without answering it, and neither answer is chosen here. Decision 23's build log
is the answer for the surface as it exists today, and it is expected to be
absorbed by the pet later rather than contradicted by it. The pet itself is not
built in this module.

Module 9's experimenter surface inherits D13's precedent: it lives in the
developer panel's window, which is furniture rather than a capability and already
sits outside the product voice, so metrics, latency and gate tuning belong beside
it. That is one exception to the one-window rule, not two — this module adds no
third window and no general window manager.

The module also declines: a dark theme, print styles, a client-side search
filter, a notice component on the desk, per-capability layout state, and any
invalidation channel for cross-capability reads (decision 15). It builds no
preservation path for the deleted corpus (decision 8) and no drawn control for
`file` fields, which wait for Module 7. It reopens no Module 1–4 contract beyond
the amendments named above: ADR-0002's swap target, ADR-0005's closed axes and
class vocabulary, ADR-0006's deletion prose, and ADR-0001's visual half.

## Module acceptance

### Living demo

Run `bun run reset`, start Aluna, and open the desk on an empty corpus.

1. The desk is a wallpaper, a prompt bar and the developer tile — no rail, no
   toolbar, nothing hidden behind a gate.
2. Type *"I want to keep track of my notes."* The window opens at submit and the
   narration streams into it; once resolution admits a new-capability build, a
   build-id provisional tile lands on the ground and brings that narration back
   into view. Activation replaces it with the registry tile, and the
   post-activation logo attempt fills the face. Cancel or force failure and confirm
   the provisional tile is removed.
3. Open the capability, add records, open one record and come back. Confirm the
   record view is a swap inside the same window, that the cards carry a drawn
   boundary whose hand does not change when the view swaps or the window resizes,
   and that no modal opens.
4. Drag the window to the bottom edge and confirm it stops above the prompt bar.
   Maximise it, reload, and confirm it comes back maximised. Reload on a narrower
   screen and confirm the stored box clamps to the viewport rather than reaching
   past it.
5. Start a build, then try to put the window away. Confirm the warning, confirm
   that cancelling the close leaves the build running, and confirm that confirming
   it cancels the build through the cancel path and restores what the build
   displaced.
6. Force a failure, a stale refusal and a no-op. Each ends the narration with a
   final product-voice line and holds the window until dismissed; a cancel restores
   immediately. Submit a prompt while a build lease is held and confirm the refusal
   speaks on the prompt bar rather than flashing wordlessly.
7. Right-click a logo, rename the capability, and confirm the effective label
   changes while the authored snapshot, address, artwork, id and version stay where
   they were, with no build and no logo work. Open the menu again with Shift+F10
   and delete: the confirmation fills the window, "Keep it" restores the canonical
   capability-or-desk state, and Confirm removes the tile. If another capability
   was open before confirmation, it returns; otherwise the window puts itself away.
8. Open `/capability/:id` for the deleted capability in a second tab and confirm
   the bare desk with its notice.
9. Grow a second capability with the network to the logo service unavailable.
   Confirm it is finished, usable and placeholdered; restore the network, reload
   the desk, and confirm the sweep fills the face. Fail it three times and confirm
   the fourth load stops asking.
10. Set the browser's text size to 150% and confirm the layout grows with it while
    the ink line and the logo tile keep their weight. Turn on Reduce Motion and
    confirm windows stop travelling while in-place life continues. Narrow the
    viewport past 720px and confirm the window fills the screen, the grip is gone,
    and no drag handler binds.

### Deterministic acceptance companion

Focused tests must additionally prove:

- content replacement and removal each release every fetch, search controller and
  read token the content acquired, including across a list → record → back swap;
- a `commit` or `fragment` arriving mid-teardown finds its named target or fails
  loudly, and the `class="shell"` swap throws rather than failing silently;
- the drain deadline exceeds the handler timeout, and a deletion blocked by a slow
  reader reports in the window rather than failing invisibly;
- the Gate rejects a raw value on each of the three closed axes and any
  declaration of font family, border, border-radius or box-shadow, including the
  silently-invalid `box-shadow: var(--shadow-md)`;
- a card's drawn hand is a function of the record id alone — equal across two
  renders of the same record in different positions, and stable across a resize;
- a spec declaring a choice field round-trips through the DDL mapper, both
  `field-renderer.ts` switches and the generator, and an unknown option group or a
  values/groups array on a non-choice field fails closed; undeclared or newly
  disabled submissions return their typed field-marked 422 without invoking the
  generated Handler;
- a field error renders in its own field from `data-error-fields`, a required
  field blocks submission client-side through the hidden-input mirror inside a real
  `<form>`, crafted max-length overflow returns its typed field-marked 422, and a
  generated form authoring its own copy for a declared business error is rejected;
- the incarnation-keyed logo route serves `image/svg+xml` with immutable caching
  and picture-only headers, gzipped and byte-identical to the stable
  incarnation-root file; delete-and-recreate gets a new URL and deletion removes
  the file;
- concurrent activation/load claims cannot exceed three total attempts, recovery
  reconciles an interrupted `generating` state, and the third failure records
  abandonment; a ground outside the eight hue families, or signal red, fails validation;
- a prompt attempting to direct a logo is refused by the intent classifier, on the
  same path as any other presentation-steering prompt;
- every declared product foreground/background pairing passes its applicable AA
  threshold, C12 included, and the inventory is exhaustive against shipped uses;
- Reduce Motion removes positional travel and leaves in-place animation running,
  with no per-component selector list;
- a text input paints the focus ring on a mouse click while a button does not;
- a stored window box larger than the viewport is clamped on load and on resize,
  and the maximised flag survives a reload without carrying a stale size.

## Exit criteria

Aluna is a desk. A capability opens in one window that drags, resizes, maximises
and puts away, its logo carries rename and delete, every message the product has
to give arrives in the window or on the prompt bar, and the window releases
everything it started the moment its content is replaced or removed. The visual
system ships once from `design/styles/`, the drawn line reaches the record cards a
capability generates, and the Gate holds three closed axes and four bans over the
whole surface. Every capability is born with the final logo contract; accepted
artwork is served immutable from its incarnation-keyed route, and a faceless
placeholder retries through one durable claim path until it arrives or three
attempts have failed.
Forms speak the controls the design
draws — choice, long text, guidance, limits, in-field errors — and the layout
answers text scaling, a phone, and a screen smaller than the one the window was
left on. The toolbar, the detail modal, the sidebar and the code behind them are
gone, and Modules 6 through 9 build against the surface they will ship on rather
than the one being deleted.

## Issue conversion

Done in the conversion session of 2026-08-20: **35 issues across 11 epics**, in
`modules/05-the-desk/5.1-…` through `5.11-…`. Epic numbers in this repo are build
order, so conversion numbered the epics in the order they will be built and cut
each one into independently actionable tracer-bullet issues that reach the living
demo as they land. Every issue is `ready-for-agent` and names its blocker by path.
5.1/01 starts the trunk. After 5.4/02, 5.5/01 performs the last permitted corpus
reset and becomes the fork point. The hosted-provider branch (5.5/02–04) and the
window/content branch (5.6 through 5.9) then proceed independently. They rejoin at
5.10/01, before the final form schema creates record-bearing capabilities that no
later issue may reset. Provider latency and human artwork sign-off therefore do
not block unrelated window work but cannot be skipped before the durable form
corpus begins.

Two things moved against the epic list `docs/modules.md` carried before the
conversion, and that list has been renumbered to match:

- **The old 5.5 split in two.** Its teardown half became **5.3** and its
  window-contents half became **5.7**. This is the ordering constraint stated
  above: decision 13's teardown lands before the window ships, because putting
  the window away becomes the only path that releases a region — and the old
  numbering had it landing after.
- **The logo epic moved from seventh to fifth.** Decisions 34 to 42 are the one
  item whose clock is set by somebody else's service, and the work blocks
  nothing, so landing it early de-risks the module's only outside dependency.

Two decisions are split across epics, forced by build order rather than by
preference, and each issue says so where it applies:

- **Decision 10.** The three closed axes and the font-family, `border-radius` and
  `box-shadow` bans land in 5.1, because the rung still demands the vocabulary
  5.1 deletes and nothing can be built until it is re-derived. The `border` ban
  waits for 5.2, because a generated card with neither a border nor a drawn
  boundary is invisible.
- **Decision 43.** The C12 green swap lands in 5.1, with the palette, so no known
  AA failure ever ships; 5.11 keeps the full-pair audit.

Two issues carry a human sign-off gate rather than merging on green: 5.5/02, the
logo generation call, which spends credits and needs an eye on the artwork, and
5.9/02, the deletion confirmation, which is the destructive path in authored
product voice.

One passage of this plan was already true when it was written: decision 11's
handbook rewrite. `design/design-system.md` exists, is written against High
Meadow and states no values. Only its inbound references were outstanding, and
they are folded into 5.1/01.
