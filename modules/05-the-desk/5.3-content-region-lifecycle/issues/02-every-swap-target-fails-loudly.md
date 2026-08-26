# Every swap target fails loudly, and the client guarantees the named target exists

Status: done

> **Superseded in part by 5.4/02 (`7e27172`).** This issue shipped four
> page-assembly anchors. The fourth — the `class="shell"` swap — existed only to be
> flipped into a `has-capabilities` state, and an empty desk needs no gate, so it
> left the list with the capability rail. Three anchors remain and each still throws.
> The narrative below describes what this issue built; the criteria, the Living demo
> and the HITL steps have been corrected to the current count.

## Epic

Module 5 — The Desk · Epic 5.3 — Content-region lifecycle and loud swap targets
(PLAN decision 16; ADR-0002: `modules/05-the-desk/PLAN.md`)

## What to build

ADR-0002's transport contract survives intact: `commit` and `fragment` keep
addressing a stable id, and the client guarantees that id is present whenever a
swap can be in flight. What changes is that a missing target stops being silent.

- Page assembly composes every full page by replacing literal strings in the
  shipped HTML. Three of those replacements throw when their anchor is missing.
  The fourth — the `class="shell"` swap — fails silently, leaving a page that
  looks assembled and is not. It throws like the other three.
- A `commit` or `fragment` arriving mid-teardown either finds its named target or
  fails loudly. Silence is the one outcome that is not allowed, because a swap
  that lands nowhere is indistinguishable from a build that produced nothing.
- 5.3/01 supplies the other half of the promise: content that goes away cancels
  what it started, so nothing can arrive at a destroyed region in the first
  place. This issue makes the residual case audible rather than assuming it away.

## Acceptance criteria

- [x] The `class="shell"` swap throws on a missing anchor, like the other three
      replacements. *(Superseded by 5.4/02, commit `7e27172`: the shell-root anchor
      was there only to be flipped into a `has-capabilities` state, and an empty desk
      needs no gate, so it left the list with the rail. Three anchors remain — the
      logo-layer placeholder, the detail-modal placeholder and the content target —
      (superseded by 5.6/01: the window is created client-side, so the content
      target left page assembly with the shell's content area. Two anchors throw
      here now, and the client's own missing-layer failure is the third.)
      and each still throws.)*
- [x] A `commit` or `fragment` arriving mid-teardown finds its named target or
      raises; neither path can complete silently
- [x] Each page-assembly anchor has a test that removes it and asserts the throw
      (four at the time of writing, three since 5.4/02 retired the shell root)
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Not user-visible on its own. A developer preview forces each missing-anchor case
and shows the raised error rather than a half-assembled page, which is what the
window's teardown path will rely on from 5.6 onward.

## Blocked by

- modules/05-the-desk/5.3-content-region-lifecycle/issues/01-the-content-region-owns-cleanup.md

## Implementation notes

**The fourth anchor.** `injectToolbarEntries` (`src/web/fragments.ts`) ended in a
bare `.replace('class="shell"', …)` whose no-op was indistinguishable from a
success. It now throws `The shell root anchor is missing.`, so all four
page-assembly anchors — toolbar placeholder, detail-modal placeholder, content
target, shell root — fail the same way. Checking is now separate from applying
(`requireToolbarAnchors`, `requireContentTarget`), which is what lets **every**
full-page assembly hold the shell to all four, including the cold-start page that
inserts nothing. The anchor literals are exported once as `PAGE_ASSEMBLY_ANCHORS`,
each paired with what a shell missing it looks like, so the tests and the preview
force the same four cases instead of keeping copies that would drift from what the
assembly matches.

**The client half is a guard, not a protocol change.** `public/swap-target.js`
registers on `htmx:sseOpen`. Each `commit` and `fragment` that arrives must
resolve where it lands, for *every* listener the connection registered — the
connection element itself when it carries `sse-swap`, and every descendant that
does — and a target that has left the document is no target at all. Missing, it
announces `aluna:missing-swap-target` and throws a `MissingSwapTargetError`.

That guard exists because of one line in the vendored extension: a message whose
listener node is no longer in the body has its listener quietly removed and the
message dropped. That is precisely the mid-teardown case, and precisely the
outcome the issue forbids. 5.3/01 is why it should never be reached — teardown
closes the stream — and this is why reaching it is audible rather than invisible.

**Where a swap lands is asked of htmx, never reproduced.** Defining a no-op
extension is how htmx hands out its internal API, so the guard holds the same
`getTarget` the SSE extension swaps through. Reimplementing it would mean
reimplementing `hx-target`'s inheritance from ancestors and htmx's extended
selector syntax (`closest`, `find`, `next`, `previous`, `this`, …), and any drift
between the two shows up as exactly one of two things: an alarm on a healthy swap,
or silence on a broken one. Both are worse than not guarding at all. The resolver
is borrowed per connection, not at startup, so the guard never depends on script
load order; `startSwapTargetGuard` takes it as a parameter, which is also what
lets the wiring be tested without a browser.

`sse-swap` takes a comma-separated list, so a listener answers only for a name in
that list: `commit` is never answered by the developer panel's `commit-preview`.

**New domain term** in `CONTEXT.md`: **Swap target**.

### Demo-vs-real boundary

Both halves ship in the product. The anchors are the real ones the served
shell is assembled from, and `public/index.html` loads the real guard beside the
release scope it completes. `/demo/swap-targets` adds no behavior — it only makes
two failures reachable on purpose, because a server-side throw is a 500 nobody
reads and the client-side raise needs a region a page is willing to destroy. It
comes down when the window ships and the same rule is exercised there.

## Verification

```
bun run test
bun run typecheck
bun run lint
```

`bun run test` → 1305 passed, 0 failed (2 shards, 76s). Typecheck and lint clean.

New coverage:

- `src/presentation/swap-target.test.ts` — the rule against a DOM-free test
  double: the target found on screen, `hx-target` inherited from an ancestor,
  exact-name matching against `commit-preview`, comma lists, the connection
  element as a listener in its own right, the listener gone mid-teardown, no
  listener at all, and both guarded events reported once the region has gone.
  Plus the wiring: the event it listens for, the source it reads off the detail,
  reconnect de-duplication, and that what it installs is the real guard.
- `src/web/fragments.test.ts` — every anchor, each removed from an otherwise
  whole shell via `PAGE_ASSEMBLY_ANCHORS` and asserted to throw its own error, and
  the cold-start page held to the same four.
- `src/app/app.swap-targets.test.ts` — the shipped shell loads the guard, the
  module is served, and the preview forces every anchor and drives the shipped
  guard rather than a copy of it.

Live-checked against the dev server on :3030:

- `/demo/swap-targets` shows the intact shell assembling and one raised error per
  anchor (four when this shipped, three since 5.4/02).
- On the preview, a `commit` with the region on screen finds its target; putting
  the region away and delivering the same event raises, both as the announcement
  and as an uncaught `MissingSwapTargetError` in the console.
- On the **real shell**, with `htmx.createEventSource` swapped for a fake source so
  no provider call was made: the real extension and the real guard registered in
  the real order, `commit` and `fragment` both swapped into the live region with
  the guard silent, `commit-preview` did not disturb it, and after replacing
  `#spec-build-output` the same two events raised. The three cases the adversarial
  pass found were re-run there and all behave: `hx-target="next .sink"` swaps with
  no alarm, `sse-swap` on the connection element swaps with no alarm, and an
  `hx-target` inherited from an ancestor whose target was removed now raises.

### Adversarial findings, fixed

- **The guard reproduced htmx's target resolution, and got it wrong in both
  directions.** It read `hx-target` with a plain `getAttribute` and resolved it
  with `document.querySelector`. htmx does neither: it inherits `hx-target` from
  the nearest ancestor carrying it, and it resolves an extended syntax
  (`closest`, `find`, `next`, `previous`, `this`, …). Those extended forms are
  valid CSS, so `querySelector` returned `null` rather than throwing — a permanent
  console alarm on every `commit` of a perfectly healthy build. And an inherited
  `hx-target` was missed entirely, so a window put away while its build streamed
  went **silent**, which is the case this issue exists for. Both verified in the
  browser. The guard now borrows htmx's own `getTarget`, so the two cannot drift.
- **A connection that carries `sse-swap` itself was invisible to the guard.**
  `querySelectorAll` is descendants-only, but the extension registers the
  connection element too — the likely shape once page assembly collapses to one
  anchor. Verified: htmx swapped correctly and the guard alarmed anyway. It now
  finds every listener, connection included, and requires all of their targets.
- **The half with real htmx coupling had no tests.** The pure tree logic was
  covered; the wiring — the `htmx:sseOpen` name, `detail.source`, `event.target`,
  the reconnect de-duplication — was not, so an htmx upgrade that moved `source`
  could have disabled the whole guard under a green suite. `startSwapTargetGuard`
  now takes its resolver as a parameter and has its own suite.
- **The test double claimed a guarantee the browser does not make.** It let a
  listener's throw escape `dispatchEvent`; a real `EventTarget` *reports* the
  exception instead. The double now reports, and the tests assert what actually
  happens — the raise is loud, and it aborts nothing.
- **Only one of the anchors was checked on the page a fresh user loads.**
  `renderRehydratedShell` returned early on an empty registry, so a lost
  `class="shell"` or toolbar placeholder rendered fine on a fresh install and
  started failing at the first commit. Cold start now holds the shell to all four.
- **The documented reason for the registration order was false on reconnect.** The
  extension fires `htmx:sseOpen` *before* re-registering its listeners when a
  stream reconnects, so "htmx has already had its chance" only held on a first
  connect. Harmless — the check reads the DOM and swaps nothing — but the comment
  said something untrue, and now says why the order does not matter instead.
- **`PAGE_ASSEMBLY_ANCHORS` was deep-imported past the `src/web` barrel** and had
  no test of its own; it is now exported through `src/web/index.ts` and pinned by
  the four-anchor suite rather than only by the demo route.

## HITL test instructions

1. `bun run dev` (or use the server already on `http://localhost:3030`).
2. Open `http://localhost:3030/demo/swap-targets`.
   - The first table row reads **Assembled** with a character count: the real
     shell still composes.
   - The rows under it each show a raised error — one per anchor (two since
     5.6/01 retired the content target, which itself followed 5.4/02 retiring the
     shell root). No row is blank, and no row reports a page that assembled anyway.
3. On the same page, scroll to *A commit or a fragment arriving mid-teardown*.
   - Click **Deliver a commit**. The readout says it *found its named target*.
   - Click **Put the region away**, then **Deliver a commit** and **Deliver a
     fragment**. Each now reports `RAISED`, and each also appears as an uncaught
     `MissingSwapTargetError` in the browser console — the throw is real, not a
     logged string.
   - Click **Bring the region back**, then deliver again: it finds its target.
4. Open `http://localhost:3030/` and build or open a capability as usual. The
   build streams and commits exactly as before, and nothing logs an error at any
   point — the guard is silent on every path that works.
