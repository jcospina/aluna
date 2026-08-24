# Generated records carry a drawn boundary seeded from the record id, and the rung bans `border`

Status: done

## Epic

Module 5 — The Desk · Epic 5.2 — The drawn line, and the border ban
(PLAN decisions 9 (generated half), 10 (the fourth ban):
`modules/05-the-desk/PLAN.md`)

## What to build

The drawn line reaches the record cards, rows and tables a capability generates.
D11 applies everywhere it says it does — windows, prompt rail, buttons, inputs,
**and the records themselves**. Records are what a user looks at longest, a
straight-edged card on a drawn desk reads as unfinished, and the deleted weight
ladder leaves no softer setting to fall back on.

Both stated blockers are answered without touching the generation pipeline:

- **The hand is seeded from the record's own id.** The id is stable across view
  swaps and resizes, and it is not derived from where the element sits, which the
  rule forbids. Two renders of the same record in different positions get the
  same hand.
- **The spec, the generator and the registry are asked for nothing.** Generated
  code never learns the ink system exists — the platform's presentation layer
  applies the boundary to the containers it already owns.
- **Cost is bounded** by observing resize once per list container rather than
  once per card, since the children of a list resize together. What remains is a
  speed measurement on long lists rather than a design fork; measure it and
  record the number.

With generated boundaries drawn, ADR-0005's fourth closed axis loses its
successor list and `border` joins font family, `border-radius` and `box-shadow`
in the never-declared category. The ink system owns every boundary. This is the
ban that could not land in 5.1/02, because a generated card with neither a border
nor a drawn boundary is invisible.

## Acceptance criteria

- [x] A card's drawn hand is a function of the record id alone — equal across two
      renders of the same record in different positions, and stable across a
      resize
- [x] Record cards, rows and tables all carry a drawn boundary; nothing in the
      generated markup, the spec, the generator prompt or the registry references
      the ink system — with one note below on what "tables" means in this codebase
- [x] One resize observer per list container, not one per card, with the measured
      cost on a long list recorded in the issue notes
- [x] The design-lint rung rejects any `border` declaration in generated markup
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Build a capability, add several records, and confirm every card carries a drawn
boundary rather than a CSS border. Resize the window and confirm each card keeps
its own hand. Reorder or filter the list and confirm a record's hand travels with
it.

## Blocked by

- modules/05-the-desk/5.2-drawn-line-and-border-ban/issues/01-the-ink-system-ships-in-the-product.md

## What landed

Two halves that had to arrive together, because either one alone is worse than
neither: a record with a drawn boundary and a legal CSS one would carry two lines,
and a record with the ban and no drawn boundary would be invisible.

### The hand comes from the record's id

`src/presentation/ink-seed.ts` is the whole of it. `recordInkSeed(id)` calls the
design system's own `seedFrom` — the FNV-1a fold `design/scripts/prompt-bar.js`
already seeds with — rather than restating the algorithm server-side, so one
function decides every hand on the surface. `renderItemWrapper` writes the result
as `data-ink-seed` on the `<article class="capability-item">` it already emits,
and `mountInk` reads it back at mount in place of its own mount-order counter.

The id is what the design system's rule leaves available. A seed may never come
from where an element sits, and the id is the one thing about a record that
survives a reorder, a filter, a view swap and a resize.

The import is `#design/lib/random.js`, the subpath the server uses to reach a
browser module — see "One cost inherited, since closed" below for how that
resolves, and for the hand-written declaration this issue first reached for
instead. Nothing is copied either way; `design/scripts/` ships, the way
`design/styles/` does.

### The card is drawn

`.capability-item` joins `SHELL_INK` in `public/ink.js`, beside the search rail
and the create panel it shares a stylesheet with. It keeps its declared
`border: var(--line) solid var(--ink)` as the room the drawn line needs, and
`.is-ink` takes the colour off it. Default hand — fine — which is right: the card
sits inside a region that holds it, and the frame hand belongs to the region.

One rule had to go with it. `.capability-item:focus-visible` set
`border-color: var(--focus-ring)` from two class-worth of specificity, which
outranks `.is-ink` and would have painted a true edge back beside the drawn one on
every keyboard focus — the exact defect 5.1/02 recorded and `ink-seam.test.ts`
exists to catch. The 3px outline was already the whole signal; the border-colour
line is deleted, and `capability-item` comes off that test's `RULED_ON_PURPOSE`
list.

Nothing else changed. The spec has no key for a hand, the registry stores none,
and neither generator prompt names the ink system, the seed attribute or the
classes the runtime writes — a test asserts all three files stay clean of every
one of those terms.

### On "cards, rows and tables"

`COLLECTION_LAYOUTS` is closed to `feed` and `grid`, and the source says why:
"a true table dissolves the per-record creative surface". So rows and cards are
the same wrapper under two layouts, and both are drawn — verified in the browser
at both. There is no table layout to reach, and this issue did not invent one.

### The fourth ban

`border` moves from a pick-from-a-list axis to the never-declared set, and
`LINE_WEIGHT_TOKENS` is retired rather than re-derived — "no successor list" read
literally. `design-tokens.ts` says so where the set used to be: `--line` survives
in `tokens.css` as the room a platform component reserves, and is not a value a
record names.

`isBoundaryProp` replaced the two enumerated property sets with a prefix test,
because a list can only ever name the longhands someone thought of. It catches the
shorthand, four physical and six logical sides, and the width, style and colour
sub-property of each — plus `border-image*`, which paints the same edge.

**`outline` and `column-rule` went with it, and that was a judgment call worth
naming.** They sat in the old weight axis by association; they are here on their
own reasoning. The focus ring is `--focus-ring`, painted by the platform on the
enclosing shell, and a record holds no interactive descendant to ring; a column
rule is a CSS edge inside a record like any other. Keeping either would also have
kept `LINE_WEIGHT_TOKENS` alive to feed it, which is the thing decision 10 says
does not survive. If that reads as one ban too many, it is one predicate to
narrow.

Two exclusions are deliberate. `border-radius` is caught earlier and keeps its own
reason — there are no radius tokens — rather than being absorbed. `border-spacing`
and `border-collapse` draw nothing: the first stays on the spacing axis and the
second stays free, exactly as before.

The prompt moved with the rung, or the model would be taught the thing the gate
now refuses: `buildItemRendererDesignInjection` names four bans instead of three,
every few-shot exemplar dropped its `border: var(--line) solid …`, and one new
sentence says what replaces it — "Without a border, separation comes from the
palette and the spacing: a filled block, a change of size or weight, or a gap."
`design/design-system.md`'s "three of the four bans are enforced today" paragraph
is now the record that all four are.

### Three ways round the ban, closed after adversarial review

A ban keyed on a property name is only as good as the list of ways to draw a line.
An adversarial pass found three that spelled no `border` at all, and each of them
is a line a generated record would have been pushed toward precisely *because*
`border` is gone. All three are closed, with the two surfaces agreeing on each.

- **`<hr>` needed no declaration to be a boundary.** It was on
  `ALLOWED_ELEMENTS`, and every user agent draws it as an inset 1px rule, so a
  property-keyed ban structurally could not see it — a record could have emitted
  as many straight rules as it liked inside a drawn card. It is off the list. It
  has no content, so unwrapping leaves nothing behind, and a record separates with
  a fill, a size or a gap instead. This was harmless before the ban, because a
  record that wanted a line could simply declare one.
- **An `--ink` block wrapped round a `--surface` one is a frame** at whatever
  thickness the padding says, drawn *beside* the hand-drawn line rather than
  instead of it. The handbook has always said `--ink` fills nothing — "it is never
  a background and never a fill" — and leaving that unenforced cost nothing until
  now. `--ink`, `--ink-2` and `--ink-3` are refused on `background`,
  `background-color`, `background-image` and `fill`; they still set type and still
  stroke a path. It is a check of its own rather than a closed axis, because as an
  axis it would have answered for every off-token fill and refused
  `background: white` in the ink rule's words when white's problem is simply that
  it is not in the palette.
- **`-webkit-text-stroke: 2px` outlined every glyph** on a property no axis owned,
  and `text-decoration-thickness: 6px` ruled above and below a text run. Retiring
  the weight axis is what settles these: there is no thickness token left anywhere
  on the surface, so a property whose value *is* a thickness has no value it may
  take. `text-stroke`, `text-stroke-width`, `text-decoration-thickness` and
  `text-underline-offset` say that rather than letting a raw length through.
  `text-decoration: underline` is untouched.

Both new refusals are taught in the prompt as well as enforced, or the model
would spend a fix attempt discovering them.

Two further residuals were found and deliberately **not** closed here, because
neither is this ban's: `clip-path: inset(0 round 12px)` defeats the *radius* ban
that landed in 5.1/02, and a named colour inside a shorthand this file leaves free
is the documented residual the build-time rung catches. Both are recorded rather
than fixed under a boundary issue.

### Four places still taught the retired axis

Invalidated by the retirement and corrected: the header of
`gate-design-lint.ts` (the file that implements the ban still described "the
interim border weight" and "the three never-declared properties"),
`layout-kit.css`'s "the token-owned axes are color/type/spacing/border",
`docs/modules.md`'s historical mention of the weight ladder, and — the one that
mattered — `public/primitives-preview.html`, a *served* developer surface whose
escape-hatch demonstration was `border-inline-start: var(--line) solid var(--shade)`
captioned "border weight and color both come from tokens". That exact declaration
is now refused. It demonstrates a fill instead.

### Two guards that read stronger than they were

Both found by adversarial review of the drawn-card half, and both were gaps in the
*guards* rather than in the feature — the behaviour was already correct.

- **The three DOM tests call `drawAlso` themselves**, so they proved the runtime
  honours a pre-assigned seed without proving the shipped card ever reaches the
  drawn set: reverting `.capability-item` out of `SHELL_INK` left all three
  passing. `ink-seam.test.ts` did catch it, from a different file and with a
  message about a reserved line. Membership is now asserted where it reads as
  though it is — in `drawn-record.test.ts`, against `public/ink.js` itself.
- **`ink-seam.test.ts` read only `public/`**, and the gallery preview page is the
  one other surface that renders real record wrappers: it is built from a
  TypeScript template, loads the shell bridge and the ink runtime, and carries an
  inline stylesheet that lands after the seam. The guard now reads its inline
  styles too, and immediately found two boundaries it could not account for — the
  page's layout chip and its code readouts. Both stay ruled on purpose, for the
  same reason the sibling preview page's furniture does, and the readouts were
  given a class so the exception could be *named* rather than the guard loosened
  to ignore bare-element selectors.

Four other reverts were tried against the tests and all bite: the focus-ring
border colour, the seed attribute, `mountInk` ignoring `data-ink-seed`, and the
container being the element instead of its parent — that last one failing the
observation test *and* taking 34s instead of 0.03s, which is the cost argument
stated as a runtime.

### One cost inherited, since closed

This issue added `design/scripts/lib/random.d.ts` so the server's TypeScript could see a
browser module, the way `design/scripts/ink.d.ts` already did for the ink runtime — and
wrote down the cost that came with it. TypeScript prefers a `.d.ts` over the `.js` beside
it in *every* project, so those hand-written signatures, not the JSDoc in the
implementation, became what `prompt-bar.js` and `window.js` were checked against: a
parameter added to `seedFrom` and not mirrored no longer failed at its call sites. Both
files had already drifted — `random.d.ts` said `phases: number[]` where the JSDoc said
`readonly number[]`, and `public/search-chrome.d.ts` renamed the implementation's
`SearchState` to `CapabilitySearchState`.

That hole is now closed, and for all six pairs rather than these two. The declarations are
no longer hand-written and no longer sit beside the `.js`: `tsc -p tsconfig.browser.json`
emits them from the JSDoc into `.types/`, and `src` reaches a browser module through the
`#design/…` and `#shell/…` subpath imports in `package.json`, whose `types` condition
points at the mirror while Bun's `default` condition still loads the real `.js` at run
time. Browser callers resolve `./lib/random.js` to `random.js` again, so they are checked
against the implementation; the check and the published types are one compile, so they
cannot skew. The pinned `seedFrom` outputs stay, because they cover what types never
could: a change in what the function *computes*.

## The measured cost

The criterion the design left open.

**The ink runtime, at real engine speed** (Bun/JSC over the fake DOM in
`ink.test-support.ts` — real path building, real mount, real container watch; no
SVG parse or paint, which only a browser does):

| list | mount | container resize → full redraw | resize observations |
|---|---|---|---|
| 20 feed cards (640×96) | 6 ms | 6 ms | **1** |
| 50 feed cards | 14 ms | 17 ms | **1** |
| 200 feed cards | 48 ms | 54 ms | **1** |
| 200 grid cards (300×200) | 32 ms | 39 ms | **1** |

Cost is linear in card count and in perimeter — 0.24 ms of path math for a 640×96
feed card at `SPEC.step: 4`, 0.14 ms for a 300×200 grid tile. **The observation
count is 1 in every row**, which is what the criterion asks: the region is watched,
never a card, so two hundred cards cost one observation and not two hundred.

So the answer to the question the design deferred is that there is no fork to make.
Two hundred records — more than `read` is likely to return before pagination exists
— cost about 50 ms of drawing when the list arrives, and about the same again on a
window resize. A few dozen is single-digit milliseconds.

**Two corrections to how this was measured**, both worth stating because the first
version of this table was wrong by 6×.

- Every number above was first taken while two heavy review agents shared the
  machine, which inflated them to 291 ms for the 200-card mount and led to a
  conclusion — "a few hundred milliseconds of main thread", worth knowing before a
  capability has thousands of records — that the real numbers do not support. Same
  machine, same script, nothing else running: 48 ms. The lesson is the ordinary one:
  a benchmark taken beside your own background work measures your background work.
- **The browser-side number is not measured here, and cannot be.** The built-in
  preview pane reports `document.hidden`, and an identical busy loop runs there
  ~38× slower than in Bun, so its 1276 ms for 200 cards says nothing about real
  hardware. What is missing from the table is therefore the SVG parse and paint,
  which is browser-only. HITL step 7 below is a one-line console snippet that gets
  the true full-stack figure on a real machine; it is the one measurement this
  issue leaves to a human rather than claiming.

## Verification

- `bun run test` — 1263 tests, all passing, in 76s.

  Worth recording, because it was nearly written down as a defect: three earlier
  runs each showed one failure, always a `TimeoutError` and never the same test
  twice — `gate.behavioral.test.ts`'s "rejects missing Action coverage…" once,
  `app.spec-build-behavioral-repair-metrics.test.ts`'s "counts the successful
  repair provider call exactly once" on an independent run. The first was
  reproduced in isolation on a *stashed clean tree* at 24s against a 15s budget,
  which looked like proof of a slow test that predated this change.

  It was not. Those runs were sharing the machine with two heavy adversarial review
  agents. Unloaded, the same test passes in 1.67s and the same suite runs in 76s
  rather than 457s. The stashed-tree check was sound as far as it went — it ruled
  this change out — but it could not distinguish "slow test" from "loaded machine",
  because the load was present for both halves of the comparison.
- `bun run typecheck`, `bun run lint` — clean.
- New: `src/presentation/drawn-record.test.ts` (6 tests — parity with `seedFrom`
  and against fixed values, the same record in two positions, the idless fallback,
  the card's membership of the drawn set, and the three files that may not name the
  ink system) and three tests appended to `ink-system.test.ts` under the shipped
  `.capability-records`/`.capability-item` shape. The DOM half lives there rather
  than in its own file because the fake DOM is process-wide and the ink runtime
  binds to whichever copy was installed when it was imported; two files installing
  their own left the second one's observations invisible.
- Live on the dev server, six records in the reading log:
  - Every card `is-ink`, border computed `rgba(0,0,0,0)` with its 2px still
    reserved, two layers, six distinct hands, every stroke `stroke-width="2"`.
  - Zero CSS borders anywhere inside a card — the rating and date chips read as
    fills now.
  - Both layouts: feed at 764px wide and grid at 376px, all six drawn in both.
  - The hand travels: "The Dispossessed" is `data-ink-seed="69828"` at position 2
    of the full list and position 1 of the `le guin` filter; "Dune" keeps `98223`
    alone or fifth.
  - Five successive htmx swaps of the records region leave exactly two layers per
    card, no stray layers, and the document-wide layer count returning to the same
    value — no observer or layer accumulation.
  - Forced `redrawInk` at a new width redraws every card with its seed unchanged.
    The pane cannot verify the *automatic* resize path: `requestAnimationFrame`
    does not fire there (`document.hidden`), which is the same limitation 5.2/01
    recorded. The fake-DOM test covers that path, and step 3 below is the real check.
- `sanitizeStyle` and `describeStyleViolation` agree on every boundary form probed:
  the shorthand, `BORDER:` uppercase, `-webkit-border-before`, `border-image`,
  `border-image-slice`, a logical side colour, `border-style`, `outline-style`,
  `outline-offset`, `column-rule-style`, `border-block`, a logical radius, and
  `border: 0` — all refused; `border-spacing` and `border-collapse` kept.

## The round trip, on a real build

The one link the tests cannot close: whether the *model*, given the rewritten
prompt, actually writes a border-free renderer that the rung accepts. One build
was run from the prompt bar to find out — "Track the houseplants I own, with the
plant name, which room it lives in, how many days between waterings, and the date
I last watered it."

```
gateRungs:      structural passed · smoke passed · behavioral FAILED · design-lint passed (5.65s)
unitAttempts:   item-renderer  attempts: 1
```

Both halves of what this issue changed came back clean. **The design-lint rung
passed**, so the renderer the model produced declared no boundary; and it took
**one attempt**, so the new contract did not cost a fix-loop round — the prompt
teaches the ban well enough that the model does not have to be corrected into it.

The build failed on the **behavioral** rung, for a reason that has nothing to do
with this change: the generated `read` handler did not order records the way the
model's own generated test required ("reads plants ordered by oldest last-watered
date"). Evidence that it is not the ban: design-lint passed on that same build,
and `generation_lifecycle_metrics` shows this same prompt already failing the gate
once before, against an empty catalog fingerprint — a build from well before this
work. Nothing was committed to `capabilities/`.

Worth noting as observed rather than assumed: the failure behaved as Module 5
specifies. The window held the narration, the prompt bar spoke the outcome
("Hmm, that didn't work. Mind trying again?"), the displaced Reading log
collection came back on dismissal, and no capability tile was left behind.

## The corpus, and one consequence worth naming

`capabilities/reading_log` and `capabilities/medication_tracker` still have
`border: var(--line) solid var(--ink)` in their `item.ts` on disk. They render
correctly — the runtime enforcer drops the declaration and the platform draws the
card — but `findDesignViolation` now refuses those bytes, which has one
consequence beyond "they are stale".

**Evolving either capability would silently reclassify its item renderer.**
`evolution-assembly.ts` runs the Gate over the assembled renderer whether `item.ts`
was byte-copied or regenerated, so design-lint would now trip on a correctly-copied
unit, force a model regeneration, mark `item` as regenerated with fresh provenance,
and falsify that file's own comment that a correctly-copied unit stays byte-identical
to the committed snapshot. Without a provider it fails closed.

That is the expected greenfield state rather than a defect: PLAN decision 8 makes
both capabilities placeholders, reset once more in 5.5/01 before the logo birth
facts land, and no preservation cutover is owed. They were deliberately not
regenerated here — regenerating placeholders that 5.5/01 discards would spend
provider budget twice. It is written down because *evolution* is the path where the
staleness stops being invisible, and 5.5/01 is where it goes away.

## HITL

1. `bun run dev`, open `http://localhost:3030/`, click **Reading log**.
   Every record card has a **hand-drawn boundary, and each card's is different** —
   look along the top edges of two adjacent cards and they should wander
   differently. No card has a straight CSS edge.
2. The rating chip and the "Finished …" chip inside a card are **filled blocks
   with no outline**. That is the ban: a generated record no longer draws lines.
3. **Resize the browser window.** Every card redraws at the new width and **keeps
   its own hand** — the lines re-wander, but card 1 stays card 1's line. Nothing
   flickers back to a straight edge. (This is the check the built-in browser pane
   cannot make.)
4. Type `le guin` in the search rail. The list filters and **a surviving record's
   line is the same line it had** in the full list — compare "The Dispossessed"
   before and after. Clear the search; it comes back unchanged.
5. **Tab to a card** with the keyboard. It gets the accent focus ring and **no
   second straight border appears** beside the drawn one.
6. Click a card. The record opens in the drawn modal; close it and the card behind
   is unchanged.
7. For the real speed number on your hardware, paste this in the browser console
   with the reading log open:
   ```js
   const ink = await import("/design/scripts/ink.js");
   const list = document.querySelector(".capability-records");
   const t = performance.now(); ink.redrawInk(list);
   console.log(list.querySelectorAll(".capability-item").length, "cards:", (performance.now() - t).toFixed(1), "ms");
   ```
8. Build something new from the prompt bar. Its records should be drawn from the
   first one, and the generated renderer should contain no `border` at all.
