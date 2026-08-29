# A link to a deleted capability loads the bare desk with a brief notice

Status: done

## Epic

Module 5 — The Desk · Epic 5.9 — Rename and delete from the logo
(PLAN decisions 21, 26: `modules/05-the-desk/PLAN.md`)

## What to build

Opening `/capability/:id` for a capability that no longer exists loads the bare
desk and speaks a brief notice through the prompt bar's existing message region.
That covers the second-tab, bookmark and reload cases **without a window state or
a third notice component** — there is nothing to design inside a window for a
capability that is gone.

The brief interval before the tombstone commits needs nothing new either. Three
things can happen in that window, and all three are already structured refusals:

- an aborted read,
- `409 read_unavailable` on new reads,
- `422` on pending writes.

5.8/03 already says where a structured refusal renders — on the surface it arrived
from — so this issue adds no routing and no new component.

## Acceptance criteria

- [x] `/capability/:id` for a deleted capability loads the bare desk, speaks the
      brief notice on the prompt bar, and opens no window
- [x] The notice is authored product voice and does not persist past the next
      action
- [x] In a second tab, an in-flight read cancelled by deletion releases its region
      scope without inventing a response; the next read or write renders the 409
      or 422 on its existing structured-refusal surface
- [x] No window state and no notice component is added for this case
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Delete a capability, then open its old address in a second tab and confirm the
bare desk with its notice. Before deleting, open the capability in a second tab,
delete it in the first, and confirm the second tab's in-flight read and next
action are refused on the surface each arrived from.

## Blocked by

- modules/05-the-desk/5.9-rename-and-delete-from-the-logo/issues/02-the-deletion-confirmation-fills-the-window.md

## What landed

**An address that outlived its capability now lands somewhere.** `/capability/:id` for a
row that is not there stops answering with a bare `<p>` and serves the whole desk, with one
sentence in the prompt bar's own slot. Nothing else was needed: the client already answers
an address naming a capability that is not on the ground with the bare desk
(`addressAsks`), and its comment had been waiting for the server to say so.

**Still a 404.** The status is about the capability the address names, which really is
absent; the desk in the body is what the person gets *instead*, not a claim the address was
good. Recorded in `docs/architecture.md` §8 so it is not "fixed" to a 200 later.

**A page load is the one path `renderPromptNotice` cannot serve.** An out-of-band
`#prompt-notice` div in a document the browser is *loading* is inert markup, not an htmx
swap, so page assembly seeds the text instead — taking the element's open tag from the
shell rather than restating it, matched by id the way `METRICS_SEED_TARGET` is. The
element, its `aria-live` and every attribute it carries stay the shell's own, which is what
makes this a sentence rather than a component. The slot is now a page-assembly anchor and
is required on every page whether or not that page has anything to say: an anchor checked
only when a notice is passed would fail loudly only for the one load that carries one.

**One sentence, two carriers.** `NOT_FOUND_NOTICE` is seeded into the page a link loads and
wrapped by `NOT_FOUND_FRAGMENT` for the press that a stale tile makes — both of which reach
the same prompt bar, so two sentences there would have been one voice saying the same thing
two ways. It is brief and it stops where the truth stops: a finished deletion takes its
registry row with it, so a bookmark to something deleted an hour ago and a mistyped address
mostly arrive indistinguishable, and copy claiming the capability *used to* be there would
be guessing.

**A seeded sentence is an answer, never a refusal**, so it carries no
`data-prompt-refusal`. The 400ms cue fires on `htmx:oobAfterSwap`, which a page load never
dispatches, and a marker whose cue can never run would be a claim the bar could not honour.

**The brief interval before the tombstone commits needed no code, only tests.** An aborted
read, `409 read_unavailable` on new reads and `422` on pending writes were already what the
read gate and 5.8/03's routing produce; `app.deleted-capability-address.test.ts` is what
pins that a second tab is never handed a comfortable lie in their place.

## Findings from adversarial review, all fixed

Two reviewers, one on the mechanism and one on spec conformance.

1. *The `HX-Request` 404 reached no screen.* `NOT_FOUND_FRAGMENT` carried no
   `data-error-code`, and htmx drops an unmarked 4xx — the exact defect
   `failure-responses.ts`'s own header names. So a second tab pressing a tile still standing
   for a deleted capability mounted a window, got nothing, and took the window back down
   without a word. It is marked `not_found` now and the shell's rescue lifts it onto the
   prompt bar.
2. *`NOT_FOUND_FRAGMENT`'s second clause was false on the case that now reaches it most.*
   "It might be something I haven't made yet" was written when this only answered a name
   Aluna had never heard of. Gone with the sharing.
3. *Its apostrophe was ASCII beside the new sentence's curly one* — the same class of drift
   5.8/03 already paid to fix once. Both are the one sentence now, so neither can drift.
4. *`aria-live` announces what changes, never what was already standing when the document
   was parsed.* The seeded sentence was therefore read by eye and by nobody else, on the one
   path this issue exists for. `sayAgainWhatThePageArrivedWith` puts the same words back in
   the same slot once the document is up, which is the change the region needs; a browser
   that never reaches `DOMContentLoaded` is exactly as well off as before.
5. *The anchor was an exact tag copy of a live, styled, scripted element*, so a single added
   attribute on `#prompt-notice` would have 500'd `GET /` — the mistake `METRICS_SEED_TARGET`
   documents eleven lines away. Matched by id now, with a test that adds an attribute.
6. *`/capability/notes/` fell past every route to a bare-text 404*, with no shell and nothing
   to go back to, whether or not the capability existed — while `capabilityIdFromAddress` has
   always read the id straight through a trailing slash. The view route answers both
   spellings now, and so does the desk-load logo recovery.
7. *`if (!id)` answered differently from its own sibling two lines down.* It is unreachable —
   Hono routes no empty segment onto `:id` — but an unreachable guard that disagrees with the
   path beside it is still a wrong answer waiting. Both go to the bare desk.
8. *The address was left naming a capability nobody can open*, which `correctUnfilledAddress`
   itself calls the worse of two costs, and which `renderAddress`'s own comment claimed was
   "corrected in place". It is corrected now. `correctUnfilledAddress` moved to
   `desk-address.js` with it: it reaches for nothing but that module's own exports, and
   `desk-window.js` was at its line ceiling.
9. *Nine assertions could not fail.* `capability-surface`, `data-active-capability-id` and
   `hx-swap-oob` are structurally impossible on any full-shell assembly, so asserting their
   absence proved nothing. Removed, and the claim they were pretending to make — that a cold
   load opens no window — is proved where it lives, by an `addressAsks` case with nothing in
   the window, which had no test at all.
10. *A failed assertion in the second-tab tests took the process with it.* The parked handler
    was left suspended, two requests unawaited, and `afterEach` then closed the database under
    them. A `finally` releases the handler and settles both.
11. *The sentence narrated the mechanism.* "Here's your desk instead" spent half of a notice
    the issue calls brief three times on what the viewport already says — and introduced the
    product's own name for its surface, a word the user has never been taught. Cut.
12. *The justification for the sentence was overbroad*: a tombstone does outlive the registry
    row while its cleanup is outstanding, so the two cases are not *always* indistinguishable.
    The comment says what is actually true.
13. *"Does not persist past the next action" was checked off on inspection.* It is a test now,
    against the shipped module.
14. *`presentation.ts` still said an "already gone" answer strands the user on a URL that
    "404s the moment they reload".* Corrected — it is a floor under the mistake, not a reason
    to make it.
15. *The fix for finding 1 was itself unguarded.* Taking `"not_found"` back out of the
    shell's rescue list broke no test, so the silence could have returned without anyone
    noticing. The code the server marks a refusal with and the codes the shell claims are two
    halves of one contract, and they are pinned together now by a test that fires the
    router's own fragment at the shipped rescue: removing either half fails it.

**One finding recorded rather than fixed, with reasoning.** The mechanism reviewer flagged
that a 404 under `/capability/*` now costs ~21 KB, a `readFileSync` and three registry reads
on an unbounded keyspace. Every one of those costs is what `/` has always paid, on an equally
unauthenticated address, in a single-user local desk with no exposure and no scanner; and the
cheap alternative is precisely the broken page this issue exists to remove. The address
correction (finding 8) also stops the same dead address paying it twice.

## Verification

- `bun run test` green — **2016 passed, 0 failed**, 2 shards. `bun run typecheck` and
  `bun run lint` clean.
- Every new behavior was checked by inverting it, one at a time: removing the router branch,
  the seeding, the escaping, the unconditional anchor, the re-say on load, the address
  correction, the server's `not_found` marking or the shell's rescue entry for it each fails
  at least one test. Finding 15 is what that pass found.
- **In a real browser** against the dev server on :3030: `/capability/gone_forever` loads the
  whole desk with every surviving logo, no window, one `#prompt-notice` holding the sentence,
  and the address corrected to `/`; typing one character retires it; opening a real
  capability from there works and Back puts its window away; `/capability/<existing>/` now
  serves the desk, opens that capability's window and normalises the address; and a press
  aimed at a capability that is not there speaks on the prompt bar with the refusal cue
  instead of flickering a window.
- The two window cases were read off a desk with real edges (an emulated 1200×800 viewport).
  A hidden browser pane measures 0×0, and an addressed open correctly waits for a desk it
  can measure — so "no window opened" proves nothing there, for any address.
- The destructive half of the living demo — deleting a real capability and then opening its
  old address — was left for the human. It is covered end to end against the real deletion
  route in `app.deleted-capability-address.test.ts`; deleting one of the capabilities
  standing on the user's own desk is theirs to do.
