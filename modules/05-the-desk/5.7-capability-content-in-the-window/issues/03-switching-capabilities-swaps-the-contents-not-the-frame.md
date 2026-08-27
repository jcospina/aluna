# Opening another capability swaps the contents without the frame moving, and cross-capability staleness gets no machinery

Status: done

## Epic

Module 5 — The Desk · Epic 5.7 — Everything a capability shows lands in the window
(PLAN decision 15; design D2: `modules/05-the-desk/PLAN.md`)

## What to build

Opening a second capability replaces what is inside the window. The frame does
not move and does not redraw.

**Cross-capability staleness gets no machinery.** Verified against the registry's
spec module: read dependencies are strictly reads, self-dependency is rejected,
and no write-dependency concept exists anywhere. With one window only one
capability is visible, every open is a fresh read, and builds and deletions both
take the window. The sole remaining path to stale data is a second browser tab,
which is an **accepted known edge** rather than a hole to build machinery for.

- No invalidation bus.
- No version stamp.
- No refresh lamp — the window has no refresh verb by design.

The toolbar-era rehydration code goes with it: the hand-off of the records region
from the swap layer and the hand-rebuilt restore path are deleted, because they
existed to keep a toolbar's worth of parallel state alive and there is no toolbar.

## Acceptance criteria

- [x] Opening a second capability replaces the window's contents; the frame keeps
      its position, its size and its drawn hand
- [x] The outgoing capability's fetches, search controller and read tokens are
      released on the swap
- [x] Every open is a fresh read; no cached collection is shown
- [x] No invalidation bus, version stamp or refresh control exists anywhere
- [x] The records-region hand-off and the hand-rebuilt restore path are deleted
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Open one capability, move and resize its window, then click a second capability's
logo. The contents change and the frame stays exactly where it was, with the same
drawn hand. Add a record in one capability, switch away and back, and confirm the
fresh read shows it without any refresh control being involved.

## Blocked by

- modules/05-the-desk/5.7-capability-content-in-the-window/issues/02-record-deletion-keeps-its-shape-in-the-forms-action-row.md

## What landed

**The swap already worked; what was missing was the proof and the deletions.**
Pressing a second capability's logo has always reused the standing window —
`openWindow` mounted at most one. That rule is now `windowForOpening` in
`public/desk-window.js`: a standing window is retitled and handed back, and
nothing in the opening path reaches the box, the maximised flag or the seed the
frame's hand was rolled from. It takes `mount` as a thunk so the rule runs in Bun
against a window whose geometry and hand **throw if written**, the way
`tearDownWindow` is testable.

**The records-region hand-off is deleted.** `handOffRecordsRegionFromHtmx` and
`handOffRecordsRegionToSearch` are gone. Search and the post-mutation re-read now
take the region through the one region rule (`releaseRegionContent`), whose abort
is the same act that frees the server's read token. The refresh **claims the
region after taking it**, because the release runs over everything the region
holds and a claim made first would be the first thing it aborted. Nothing
hand-strips the View's `hx-trigger="load"` any more and nothing has to: htmx arms
a `load` trigger only where `firstInitCompleted` is unset, and that is the one
internal key `deInitNode` keeps, so the trigger arms once per element lifetime.
The vendored guard is pinned by a test.

**The hand-rebuilt restore path is deleted.** `reloadRestoredRecords` — an abort,
an attribute strip and a hand-built `htmx.ajax` — is gone.
`promoteTerminalPresentation` now moves the run's ending out of the subscriber
*first* and releases only what that displaces, node by node, so the release can
never reach the content that is arriving. It then processes the promoted content
through htmx, which is how anything the shell inserts is wired up, and the View's
own `load` is the one canonical read.

**Two defects found by doing it, both fixed.**

1. *The restored collection came back empty.* Live, a deflection restored the
   Medication tracker with no records and **no read at all**. Reproduced without
   the model: htmx runs its settle 20ms after a swap lands and that settle is what
   fires `load`; a run writes its ending and closes the stream back to back, so the
   promotion carries the View out of the subscriber before the settle looks for it
   and the settle then passes it by. The hand-rebuilt read was not papering over an
   abort — it was the only thing that ever read. `processPromotedContent` is what
   replaces it, and it is load-bearing rather than belt-and-braces.
2. *Processing a subtree that is already reading orphans the read.* An adversarial
   review predicted it and the real htmx confirmed it: `htmx.process` over an
   element with a request in flight de-initialises it, and htmx's abort is a lookup
   of a request it no longer has — so a read would survive every release that could
   stop it, land on a region the user has since searched or swapped away from, and
   hold its read token to the end. `processPromotedContent` therefore skips a
   subtree carrying `htmx-request`, which is htmx's own mark for exactly that and
   also means it has been processed already. Both orderings now issue one read and
   stay abortable, proved against the real htmx in the browser.

**A release that is deliberately narrower than the one it replaced.**
`releaseDisplacedContent` walks what is leaving instead of releasing the region.
The region is the anchor for work that should outlive every swap it holds
(`region-scope.js`), so releasing at the region on a content swap would take that
work away; the old `releaseRegionContent(output)` was over-broad.

**No machinery was added for staleness**, and a suite now says so where it can be
checked rather than remembered: no channel, no worker, no storage listener, no
poll in any script that reads; nothing that names staleness; no version compared
to another version to decide a re-read; no refresh control in any rendered
surface and no "refresh" in any stylesheet either project ships; and
architecture §8's own sentence, pinned.

**Adversarial findings, all fixed.** Two hostile reviews (runtime correctness;
spec and standards) produced 21 findings, including the orphaned-read defect
above. The rest: the tests that could not fail are now mutation-verified — five
mutations (claim before release, `cancelExternalRead` neutered, the release
dropped, the in-flight guard dropped, processing before releasing) each fail at
least one test; the `records-refresh` ordering is executed rather than read, with
the three browser globals the module reaches for shimmed and put back; the
`activated: false` and `activeCapabilityVersion` occurrence counts are replaced by
assertions about meaning; the exact-whitespace source pins are flattened so the
formatter cannot break them; the comment stripper the negative assertions rest on
no longer truncates a line holding a `https://`, and it and the release rule's node
double are now one shared, tested helper each rather than one per suite; the
duplicated docblock between `windowForOpening` and `openWindow`, and three
restatements of the read-token sentence, are trimmed; and `app.js`'s header, which
claimed the file does three things, says what it does.

**On the one grep that remains.** The promote-then-release ordering is pinned by
matching `app.js`'s whole normalised function bodies, not by keyword. It is a
source pin because `app.js` is a classic script — it runs before Alpine starts, so
it can import nothing and export nothing, and every rule it owns is pinned this way
(`region-scope.test.ts` pins the release vocabulary the same way). Making it
executable means moving terminal promotion into a module of its own, which is a
larger change than this issue asked for; it is worth doing when something else
opens that file.

## Verification

- `bun run test` (1787), `bun run typecheck`, `bun run lint` clean.
- Mutation-verified: the five mutations above each fail at least one test, and the
  working tree was restored byte-identically afterwards.
- Live, on the running dev server, with the window moved and resized first:
  switching Coffee tasting diary → Hypomnemata → Medication tracker kept the
  **same** window element, the same box (`x 323, y 167, 647×355`), the same
  `data-seed`, the same frame path data and the same content-region node, while
  the surface, the title and the address all changed.
- The outgoing capability's work released, proved live: a `search` read held open
  by a stubbed `fetch`, then a second capability's logo pressed — the held read
  reported `aborted: true`, which is what frees the server's read token, and the
  search rail came back empty.
- Every open a fresh read: each switch issued exactly `GET /capability/:id` then
  `GET /capability/:id/read`. Added a record to Medication tracker, switched away
  and back, and the fresh read showed it with no refresh control involved.
- The restoration path, live through a real build: a deflection while Medication
  tracker stood in the window restored the collection **with its record**, its
  create control bound, on exactly one `/prompt` and one `/read`, with the frame
  and the address unchanged.
- The orphaned-read defect and its fix, both proved against the real vendored
  htmx: processing an in-flight subtree left `htmx:abort` inert and the response
  landed anyway; with the guard, both orderings issue one read and both abort.
- No console errors on any of it.

## HITL

1. Start the dev server (`bun run dev`) and open `http://localhost:3030`.
2. Click a capability's logo. Drag the window somewhere by its title bar and
   resize it by the corner grip.
3. Click a **second** capability's logo. The contents change and the title
   changes; the frame stays exactly where you put it, at exactly the size you
   gave it, with the same drawn hand. No second window appears.
4. Type into the first capability's search field and, before the results settle,
   press another capability's logo. The second capability opens, unfiltered, with
   an empty search rail — the outgoing read is aborted rather than landing late.
5. Add a record in one capability, switch to another, then switch back. The new
   record is there. Note there is nothing to press to make that happen: the window
   has no refresh control, and there is none to find anywhere on the desk.
6. With a capability standing in the window, type something that is not a thing to
   keep track of into the prompt bar (for example "what is the capital of
   France?") and press **Make it**. The run narrates in the window, then the
   capability comes back **with its records** and the prompt bar carries Aluna's
   explanation. The window has not moved.
