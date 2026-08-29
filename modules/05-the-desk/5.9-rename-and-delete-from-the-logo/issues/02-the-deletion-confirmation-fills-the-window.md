# Delete's confirmation fills the window in product voice, and commit puts the window away

Status: done

Type: HITL — this is the destructive path and the confirmation copy is authored
product voice. Implementation is fully specified and agent-ready; a human reads
the words and exercises the path before sign-off.

## Epic

Module 5 — The Desk · Epic 5.9 — Rename and delete from the logo
(PLAN decision 20; ADR-0006: `modules/05-the-desk/PLAN.md`)

## What to build

The confirmation fills the window as everything else does, in authored product
voice, and **the path stays zero-AI**.

**ADR-0006's deletion contract is unchanged underneath** — advisory preflight,
lease-held reverse-dependency revalidation, the drain, the tombstone. Only its
content-area sentences become window sentences.

- **On commit the tile vanishes.** If the deleted capability was the one open
  before confirmation (or the desk was bare), the window puts itself away. If a
  different capability was open, its current canonical collection is restored;
  deletion must not close an unrelated capability. There is no terminal state for
  the deleted capability.
- **Backing out with "Keep it" restores through 5.8/02's data-free restoration
  path** — the displaced capability's current canonical collection or the bare
  desk, not a captured record payload or half-typed draft, and not a second
  restoration mechanism.
- A deletion blocked past the drain deadline reports **in the window** rather than
  failing invisibly, which is what 5.8/01 raised the deadline to make rare and
  what 5.8/02 gave a surface.

Every sentence on this path is authored. No model writes any of it.

The confirmation may take the window only after a desk-action preflight proves no
build or evolution is currently using that live content region. If one is, the
Delete request is refused on the prompt bar under 5.8/03's desk-furniture rule and
the run stays mounted; the confirmation must not become a second way to cancel a
run. Once admitted, deletion joins the coordinator in ordinary FIFO order and the
existing lease-held revalidation remains authoritative.

## Already standing after 5.6/01

The window puts itself away when a deletion leaves it holding nothing. That is not a
deletion rule but the window's own invariant — a window that holds nothing does not
exist — and it arrived with the window because the CSS that used to hide the shell's
empty content area went with that content area. It fires for every deletion whose
restoration is neutral: committed, already gone, refused, failed before commit, and
**Keep it** with nothing behind it. What this issue still owes is the confirmation's
*shape* in the window and what the window says while it happens.

## Acceptance criteria

- [x] Choosing Delete fills the window with the confirmation, in authored product
      voice, with no model involved anywhere on the path
- [x] Window takeover focuses the confirmation heading; the surface is an
      ordinary in-window section with no dialog role, inertness or focus trap
- [x] Delete cannot replace a running build/evolution surface; that preflight
      refusal speaks on the prompt bar and leaves the run untouched
- [x] The advisory preflight, lease-held reverse-dependency revalidation, drain
      and tombstone are unchanged; only their prose moved
- [x] A refusal on reverse dependencies renders in the window and names what
      depends on the capability
- [x] "Keep it" restores through the canonical capability-or-desk contract,
      without capturing a record payload, search term or draft
- [x] Commit removes the tile; it puts the window away only when the deleted
      capability was previously open or the desk was bare, and otherwise restores
      the unrelated capability that the confirmation displaced
- [x] A deletion blocked past the drain deadline reports in the window
- [x] The drain case consumes 5.8/01's `deletion_drain_timeout` outcome and does
      not reuse a generic pre-commit sentence
- [x] Every pre-commit refusal, timeout or failure reopens the read gate, holds
      the authored message until dismissal, and then takes the same restoration
      path; no success-like terminal is left in the window
- [x] Keep it, dismissal and commit each restore focus to the next meaningful
      surviving control rather than the deleted or displaced menu item
- [ ] **Sign-off gate:** the human has read every sentence on the path and
      exercised the confirm, the back-out and the blocked case
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Open a logo's menu and choose Delete. The confirmation fills the window. Press
"Keep it" and confirm the window gives back what it displaced. Open the menu again
and confirm: the window puts itself away and the tile vanishes from the desk.
Then keep capability A open while deleting capability B from its logo and confirm
A returns after B's tile vanishes. Finally try to delete a capability something
else depends on and read the refusal in the window.

## Blocked by

- modules/05-the-desk/5.9-rename-and-delete-from-the-logo/issues/01-a-context-menu-on-the-logo-carrying-rename.md

## What landed

**A deletion that did not happen now says so where the question was asked.** Every
pre-commit outcome — busy, stale, blocked on reverse dependencies,
`deletion_drain_timeout` and pre-commit failure — replaces the confirmation in the
window with `renderCapabilityDeletionEnding`: one authored sentence and one control.
The window holds there until **Continue**, and the press is what runs the restoration.
Only the prose moved: `front-half.ts` and `two-phase-destruction.ts` are untouched, and
`http.ts`'s change is confined to presentation.

**One sentence and one control, with no heading over them**, the way a run's ending is
one line and its control. A heading was written first and taken out: it could only say
again what the sentence says, and for the stale refusal it had to assert the capability
was unchanged in the same breath as the sentence saying it changed. The sentence is what
the window is for, so the sentence carries `tabindex="-1"`, the focus mark and the
section's accessible name, and is what a screen reader is given on arrival.

**Backing out and dismissing an ending are one path.** The ending's control carries the
same data-free `/capability-deletion-restoration` URL **Keep it** does — evidence only,
re-resolved against the then-current registry at the press — so a held ending can never
give back a capability that has gone in the meantime. Nothing is placed and no address
moves until the press: a held ending carries no `HX-Replace-Url`, because the
restoration route answers for the address itself.

**Commit is unchanged and needed no terminal.** The tile goes out of band, the displaced
capability comes back or the region is left empty, and the window's own invariant puts
it away. The sentence rides `#prompt-notice`, which now keeps two deletion callers
rather than four.

**Three ways out, one answer for the keyboard.** `data-capability-deletion-exit` marks
**Keep it**, **Continue** and the commit, and the shell hands the keyboard back to the
prompt bar. That is the floor, not the last word: a press that empties the region puts
the window away and the window gives focus back to the logo that opened it, and a press
answered with an ending gives it to the sentence.

**`.btn--outline` finished the job `.btn--neutral` was doing.** The design system says
outright that neither `neutral` nor `ghost` is a name in it. Both are gone from
`public/css/components.css`, the record view's and the create form's Cancels moved with
them, and the bridge sheet now states the one rule that was missing — `.btn--outline`
carries no fill, which its own `.btn` had been overriding.

## Findings from adversarial review, all fixed

Two reviewers, one on the mechanism and one on spec conformance.

1. *The doorway and the desk's refusal asked different questions.* `isNarrating` used
   `buildJobIdIn` while the refusal used "a run is using the window", and they disagree
   over a run that has activated but not closed its stream — the doorway renamed the
   window over the run's own content for a press that was then refused. `runIsUsingWindow`
   is now the one question both ask.
2. *An "already gone" answer closed an unrelated capability.* `alreadyGoneResponse`
   ignored the restoration entirely and always answered with the bare desk, which is the
   one thing this issue says a deletion may never do. The form is now read before the
   target is looked for, so even a target that vanished gives back what the question
   displaced.
3. *The ending's heading was redundant in all five outcomes and self-contradictory in
   one.* Removed; see above.
4. *`docs/architecture.md` §8 still said pre-commit failure restores at once.* Corrected.
5. *An interrupted confirm ended in silence.* Putting the window away — or opening
   anything else into it — releases the region's scope, and that **aborts** the request
   inside it. Read off a live desk: an aborted confirm fires no `beforeSwap` and no
   `beforeOnLoad`, so nothing on this path heard about it, while the server went on and
   could cross the point of no return. The severed-deletion recovery already existed for
   exactly this and was listening for `htmx:sendError` and `htmx:timeout` only;
   `htmx:sendAbort` joins them. A first attempt watched for a swap that never comes — it
   was deleted once the abort was measured.
6. *The recovery's own swap passed no `eventInfo`*, so the two desk rules that read
   `detail.target` — where a swapped panel puts focus, and whether the region was left
   empty — both silently declined.
7. *The ending was retired on the press.* A dismissal whose request never lands swaps
   nothing, so the sentence was spent on a reply that never came. It is retired at
   `htmx:beforeSwap` now, when the answer is known to be about to land.
8. *The rescue walked ancestors for every node of every removed subtree.* htmx reaches
   the panel before it recurses into its children, so one `matches` is the whole of it.
9. *The two rescues on one desk disagreed about the bar's refusal cue.* The deletion
   ending now carries its line the way `rescueHeldEnding` does — without the cue, because
   it already had the window and the keyboard.
10. *Three module exports had no consumers*, and `renderCapabilityDeletionEnding` was
    exported for nobody. All are private again.
11. *The only new CSS was a no-op* — `gap` on a one-child flex row — with a comment
    reasoning about a gap that never renders. Replaced by the rule the sentence actually
    needed.
12. *`.capability-deletion__dismiss` was a class nothing styled or read.* Gone.
13. *`public/css/deletion.css`'s header still described a checkpoint standing beside the
    user's context*, which the window covers.
14. *"The read gate is reopened before any of them is said" was wrong for two of the
    five*: `busy` and `stale` never close a gate. Corrected in both documents.
15. *A read-gate assertion could pass vacuously* — `every` over an empty snapshot.
16. *`public/desk-doorway.js` had no tests at all.* It has eight.
17. *The zero-AI sweep did not cover the route a dismissal presses.* It does now.
18. *`expect(notice.ownText).toBe("")` could not fail*: the bar writes its sentence as a
    child element, so `ownText` is empty either way. Every new assertion was then checked
    by inverting the behaviour it claims to prove — retire, rescue, the abort recovery,
    the focus handoff and the ending's own focus each fail at least one test when removed.
19. *The test fixture drifted from the markup in the same session*, standing a heading
    beside the sentence after the server stopped writing one. The fixture is now pinned
    against the real render.
20. *`configureCapabilityDeletionRestoration` and `focusCapabilityDeletion` could only be
    proved in a browser* (`instanceof Element`). Both ask the node instead, the way this
    desk's other client rules do.
21. *CONTEXT.md's **Put away** entry still called Dismiss "a run's held ending"*, and one
    paragraph was left mis-wrapped.

## Verification

- `bun run test` green — **1999 passed, 0 failed**, 2 shards, ~80s. `bun run typecheck`
  and `bun run lint` clean.
- **In a real browser** against the dev server on :3030, with no console errors: the
  confirmation fills the window titled after its own capability; a stale refusal replaces
  the question with its sentence and **Continue**, the address unmoved and the prompt bar
  silent; **Continue** gives back the displaced capability's collection and retitles the
  window; **Keep it** does the same from the question; putting the window away over an
  unread ending carries the sentence to the prompt bar; and an interrupted confirm now
  says "Something interrupted that. Let me check what happened…" and then reports what it
  found instead of ending in silence.
- The commit path was exercised end to end by accident and behaved exactly as specified:
  the tile vanished, the window put itself away, the address went to `/`, the prompt bar
  said "I deleted Notes permanently.", and focus landed on the prompt field.
- The ending's own focus was confirmed live while the browser pane was visible, and is
  pinned by a test that fails when the rule is removed. It cannot be re-observed once the
  pane is hidden, because `requestAnimationFrame` does not run in a hidden tab.

## What this left for someone else

`public/capability-deletion.js`'s recovery relays the server's "That's already gone, so I
didn't delete anything." after an interrupted **confirm** that actually went through —
the opposite of what happened. That sentence is 5.9/01's, written for a doorway press on
a capability that vanished, and correcting it is filed separately rather than folded in
here.

