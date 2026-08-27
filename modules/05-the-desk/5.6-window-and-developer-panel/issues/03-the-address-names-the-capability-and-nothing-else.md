# `/capability/:id` names the capability and nothing else

Status: done

## Epic

Module 5 — The Desk · Epic 5.6 — The window, and the developer panel's second one
(PLAN decision 6; design D14: `modules/05-the-desk/PLAN.md`)

## What to build

The address says which capability is in the window, and that is the whole scheme.

- `/capability/:id` opens the desk with that capability in the window. Putting the
  window away returns to `/`.
- **Everything below capability identity lives only in the current DOM and dies
  with the tab** — the search term, which record is open, a half-typed edit. None
  of it enters the address, `localStorage`, or the Builder's restoration
  descriptor. A reload returns to the capability's canonical collection and
  loses the search, record subview and draft; that is the accepted cost of a
  scheme with nothing to keep in sync.
- **During a build the address keeps naming whatever the build displaced**, so
  restoration never has to touch it and a reload lands the user back where they
  were. A v1 activation then pushes the newly activated capability address when
  its canonical collection takes the window; evolution leaves the already-targeted
  address alone, and every non-activating terminal leaves the displaced address
  untouched.
- Direct navigation to `/capability/:id` renders the whole desk around that
  window, not a bare fragment.
- Logo opens/switches and putting away push their canonical addresses into browser
  history. `popstate` renders the addressed capability or bare desk without
  pushing again; Back/Forward therefore replay window identity instead of looping
  or desynchronizing it. Pressing the already-open logo only focuses the existing
  window and creates no duplicate history entry.

A link to a capability that no longer exists is 5.9/03's concern.

## Already standing after 5.6/01

Two of the criteria below are met before this issue starts, and not by accident:
deleting the content-target anchor left page assembly with no hole to compose a
capability into, so `/capability/:id` had to start rendering the whole desk and the
client had to start opening the window over the logo the address names.
`capabilityIdFromAddress` and the load-time opener in `public/desk-window.js` are
that work. What remains here is the whole of the *history* contract — pushing on
open, switch and put-away, `popstate` replaying without pushing again, the build
keeping the displaced address, and activation pushing exactly once — plus the rule
that nothing below capability identity ever enters the address.

## Acceptance criteria

- [x] `/capability/:id` opens the desk with that capability in the window;
      putting the window away returns to `/`
- [x] No search term, open record or draft edit appears in the address
- [x] A build does not change the address; it keeps naming what the build
      displaced
- [x] Successful v1 activation pushes the new capability address exactly when its
      canonical collection takes over; evolution/non-activation add no route entry
      — see the one deliberate divergence in the notes below
- [x] Reloading during a build lands on the displaced capability's canonical
      collection (or the bare desk), never a stale record subview or draft
- [x] Direct navigation renders the full desk, not a fragment
- [x] Back/Forward replay `/` and capability-window identity without adding
      entries; refocusing the already-open capability does not duplicate history
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Open a capability, copy the address, reload — the same capability is in the
window. Put the window away and confirm the address returns to `/`. Start a build
from a capability's window, confirm the address still names that capability, and
reload mid-build to land back where you were. Use Back and Forward across two logo
opens and a put-away and confirm the window follows the address exactly once.

## Blocked by

- modules/05-the-desk/5.6-window-and-developer-panel/issues/02-geometry-persistence-and-the-phone-form.md

## Implementation notes

**The desk owns the address; htmx owns none of it.** `hx-push-url` came off the
capability logo and off the deletion panel's **Keep it** (where a response header
had always won over it anyway), so no element in the repo carries one.
`public/desk-window.js` gained an address section — `DESK_ADDRESS`,
`capabilityAddress`, `isAnotherPlace`, `pushAddress`, `replaceAddress`,
`addressAsks`, `capabilityInWindow` — and the browser's bar is handed to the two
verbs the way `localStore` is handed to `savePresentation`, so the history
contract is run in tests rather than read off the source.

**Back and Forward.** `ownHistory` takes `window.onpopstate` twice: once when the
module runs and once after `DOMContentLoaded`. That is load-bearing. htmx installs
its handler on `DOMContentLoaded` and *chains* whatever it finds, so taking the
property only before that moment would have left htmx wrapping the desk's and
still restoring a body snapshot for its own entries. `renderAddress` answers both
Back and the load-time open, so a frame and an address cannot drift.

**Nothing below identity leaves the DOM.** The shell now carries
`hx-history="false"`. htmx snapshots the whole body into `sessionStorage` before
it touches history — and it touches history on every `HX-Replace-Url` a deletion
route answers with — which would have put the search term, the open record and a
half-typed edit somewhere they outlive the tab. A correction also strips a query
string and a trailing slash, since neither is ever written here and both are below
capability identity.

**One deliberate divergence from the criteria.** "Evolution/non-activation add no
route entry" holds for every non-activating terminal and for an evolution of the
capability the address already names. A *cross-capability* evolution — a prompt
that targets Recipes while Notes is in the window — ends with Recipes' collection
in the window, and the address follows it with one entry. Leaving the address on
Notes there would be the frame/address desync design D14 exists to rule out, and
decision 6 already says a switch pushes. Flagging it rather than quietly reading
the criterion loosely.

**Pressing the open logo opens nothing.** The criterion's "only focuses the existing
window" is a statement about the fetch as well as about history. Leaving htmx's
`hx-get` to fire on a re-press swapped the collection out and straight back in, and
the window visibly flickered to arrive where it already was. `pressWouldOpen`
answers the question once and both halves of a press honour it: the capture
listener opens nothing, and an `htmx:beforeRequest` listener cancels the fetch —
the only thing that stops it, since htmx resolves the press from a listener on the
logo itself and never consults `defaultPrevented`. It matches the logo rather than
`closest`-ing to it, because a faceless tile's one-attempt POST fires from a span
*inside* the logo and must not be cancelled with it. A build narrating in the window
makes the window hold nothing for this question, so a press still takes the window
back off a run it displaced.

**Also fixed in passing.** The logo's `hx-get` was `/capability/${escapeHtml(id)}`,
which would have fetched an unencoded path for any id needing encoding; it is
`encodeURIComponent` now, and the address the press pushes is the same string. The
press's stand-down listener no longer uses `{ once: true }`, which any unrelated
htmx request could consume before the press's own answered.

**Left to their owners.** A Back out of a running build still cancels it silently,
and a Back onto another capability orphans it — the same asymmetry a logo press
has always had. 5.8/04 owns both (PLAN decision 17). A link to a capability that
no longer exists stays 5.9/03's.

## Verification

- `bun run test` (sharded, 1729 tests, 0 failed), `bun run typecheck` and
  `bun run lint` all clean.
- New `src/presentation/desk-window-address.test.ts` runs the history contract
  against a recording bar double, and covers `isAnotherPlace`, `addressAsks`,
  `capabilityInWindow`, `capabilityAddress` and the logo's rendered `hx-get`.
- Live on the running dev server: pressing the open logo fires no swap and leaves
  the collection as the identical DOM node (no flicker), while pressing it during a
  build still takes the window back off the run; a press pushes one entry; a press on the
  already-open logo pushes none; a switch pushes one; the clay lamp returns to `/`
  with one; Back, Back and Forward replay window identity and add none, with the
  body intact and htmx's snapshot cache empty; direct navigation to
  `/capability/:id?q=my+private+search` renders the whole desk, opens the window
  and strips the query; a typed search term and an open record leave the address
  at `/capability/:id`.

## Human-in-the-loop test

With the dev server running (`bun run dev`, port 3030):

1. Open `http://localhost:3030/`, press a capability logo. The address becomes
   `/capability/<id>`. Press the same logo again — nothing happens at all: no
   flicker, no re-fetch, no history entry.
2. Copy the address, reload. The same capability is back in the window.
3. Press another logo, then the clay lamp (the left one). The address returns to
   `/`, and the window is gone.
4. Press Back three times, then Forward twice. The window follows the address
   exactly, opening, switching and disappearing, and never loops.
5. Type in the capability's search box and open a record. The address stays
   `/capability/<id>` — no query, no record segment. Reload: the collection comes
   back, the search and the record do not.
6. Start a build from the prompt bar with a capability open. The address keeps
   naming that capability for the whole run. Reload mid-build — you land back on
   that capability's collection. When the build activates a new capability, the
   address becomes the new one, with exactly one Back between them.
