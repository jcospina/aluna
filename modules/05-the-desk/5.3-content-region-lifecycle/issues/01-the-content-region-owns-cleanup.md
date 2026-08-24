# The content region releases everything it started, on replace and on remove

Status: done

## Epic

Module 5 — The Desk · Epic 5.3 — Content-region lifecycle and loud swap targets
(PLAN decision 13: `modules/05-the-desk/PLAN.md`)

## What to build

Cleanup belongs to the content region, not to the window. Whatever the content
started — in-flight fetches, search controllers, server read tokens — is released
when that content is **replaced or removed**. One rule covers both putting a
window away and swapping views inside it, where a window-scoped hook would leak
on every swap.

Today nothing is released at all. A fetch resolves against a detached node, and
the server-side read token stays held until the handler timeout — which is a live
defect on the shipped shell, not only a hazard for the window that has not been
built yet.

- A content region acquires a release scope. Anything the region starts registers
  with that scope: fetches and their abort signals, search controllers,
  observers, timers.
- Replacing the region's content runs the scope. Removing the region runs the
  scope. There is no third path.
- Aborting an in-flight request is what releases the server read token, so the
  client-side release and the server-side release are the same act rather than
  two mechanisms that have to agree.
- The invariant Module 4 documented stands untouched: never await a queued
  acquisition inside a read-token scope.

This lands **before** the window ships, because once the window exists, putting it
away becomes the only path by which a region disappears — which makes this the
single place that has to get it right. Wiring it to the shell's current content
area first proves the rule against a surface that already exists.

## Acceptance criteria

- [x] Replacing a region's content releases every fetch, search controller and
      read token that content acquired
- [x] Removing a region releases the same set
- [x] The release covers a list → record → back swap, where the region's content
      is replaced twice without the region itself going away
- [x] An aborted request releases its server read token promptly rather than at
      the handler timeout
- [x] No fetch resolves against a detached node
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Start a search or a slow read on a capability, then navigate away before it
settles. A developer preview shows the region's live scope emptying and the
server's tracked reader count returning to zero immediately rather than after the
handler timeout.

## Blocked by

- modules/05-the-desk/5.2-drawn-line-and-border-ban/issues/02-drawn-records-seeded-from-the-record-id-and-the-border-ban.md

## Implementation notes

**The rule is one rule.** `public/region-scope.js` holds every content region's
release scope in one registry. A release is registered against the *node that
started the work* — its anchor — and it runs when that anchor leaves the document.
Replacing the region's content and removing the region are the same fact seen from
the DOM, which is why there is no third path and no window-scoped hook: putting a
window away (5.6) will be a `releaseRegionContent(region)` call and nothing else.

Two moments report that fact and they cannot disagree, because an entry runs at
most once:

- `htmx:beforeCleanupElement` — the pre-detach announcement. This is the *only*
  moment an htmx request can still be aborted: htmx's abort listener sits on
  `body` and reads the event as it bubbles from a connected node, so a
  post-detach abort would silently do nothing.
- A `MutationObserver` sweep — the guarantee behind it. Any anchor no longer in
  the document is released whether or not anyone announced it.

`public/app.js` is a classic script and cannot import the module, so it dispatches
`aluna:release-region` on the content area before each of its two wholesale
replacements (terminal build promotion, severed-deletion recheck). A test pins that
both sides spell the event the same way.

**What registers.** `recordsRegionRequestCoordinator(region)` now registers each
claim for exactly as long as that request is in flight, so search, the canonical
read and the post-mutation refresh are all covered by one registration point.
`search-chrome.js` registers the debounced controller against its form — before
this, swapping a capability away left its debounce timer to fire ~300 ms later and
fetch into a detached region.

**The server half is the same act.** A read is now abandoned on
`c.req.raw.signal`, which Bun aborts when the client disconnects, so the route's
`finally` hands back its read tokens at the abort rather than at the 10 s handler
deadline. `withHandlerDeadline` grew an `abandonOn` parameter and a
`CapabilityReadAbandonedError`; the route answers 499 to nobody. **Mutations pass
`undefined` deliberately** — a write whose author walked away still has to finish
or roll back on its own terms, and releasing read ownership under it would fail it
closed midway. A test pins both halves.

**Marked regions.** `data-content-region="content area"` on `#spec-build-output`
and `data-content-region="records"` on every capability's records region.
`renderCapabilityShell` now finds the content target by its id rather than by an
exact opening tag, so presentation attributes can be added to the shell without
that assembly silently failing to find it.

**New domain terms** in `CONTEXT.md`: **Content region** and **Release scope**.

### Demo-vs-real boundary

The rule ships in the product, not only in a demo: the shipped shell marks both
regions, the search controller and every records request register, htmx reads are
aborted pre-detach, and the router abandons a read whose client is gone. What the
product cannot *show* is the timing — a real handler answers in milliseconds, so
the token is back before anyone could watch it come back. That is the only reason
`/demo/region-lifecycle` exists: it drives the real client module and a real
`ReadGateCoordinator` against a deliberately slow read. Its read gate is a preview
coordinator over a synthetic incarnation, so it never touches the registry. It
comes down when the window ships the same rule on a real capability.

## Verification

```
bun run test
bun run typecheck
bun run lint
```

New coverage:

- `src/presentation/region-scope.test.ts` — the release rule against a DOM-free
  test double: replace, remove, list → record → back, the double-report guard,
  deregistration, the not-yet-inserted anchor, the live-scope report, and the
  claim abort. Plus the `app.js` ↔ module vocabulary pin and the shell markers.
- `src/router/router.read-abandonment.test.ts` — the read token comes back at the
  abort rather than at the deadline (and a deletion drain then succeeds), and a
  write is never abandoned.
- `src/app/app.region-lifecycle.test.ts` — the shipped shell's markers and module,
  the served module, and the preview's reader count returning to zero mid-read.

A full `bun run test` on a loaded host timed out two provider-free but
TypeScript-compilation-heavy tests
(`app.spec-build-failures`, `app.spec-build-behavioral-repair-metrics`) against the
runner's 30 s hang guard. Both reproduce identically with this branch stashed, on
unmodified `main` — the runner's own comment names this failure mode: two shards
oversubscribed turns the hang guard into a load-dependent performance assertion.
Every test file this change touches is green:
`bun run test src/presentation src/router src/web src/app/app.region-lifecycle.test.ts src/app/app.test.ts`
→ 400 passed, 0 failed.

Live-checked against the dev server on :3030: the preview's scope and the server's
tracked readers both empty on the same act; a list → record swap mid-read leaves
exactly one reader (not two); and on the real shell, typing in a capability's
search rail registers `content area · search controller`, which the next capability
swap releases.

### Adversarial findings, fixed

- **htmx cleans up elements it keeps.** `htmx:beforeCleanupElement` is not only a
  removal announcement: htmx also fires it, without removing anything, when it
  processes an element inside an `hx-disable` subtree (`initNode`'s
  `disableSelector` branch — four of the ten call sites in the vendored build).
  Releasing there would have aborted a request whose region was still on screen.
  The listener now skips any element inside `htmx.config.disableSelector`.
- **The sweep ran on every mutation batch carrying a removal**, which on this page
  means every ink redraw. It now returns immediately when nothing is registered.
- **`renderCapabilityShell` interpreted `$` sequences in the capability surface.**
  The old exact-string `.replace(string, string)` gave `$&`/`$'` in generated
  markup replacement-pattern meaning. Matching by id with a replacer function
  removes that as a side effect of making the assembly attribute-tolerant.

## HITL test instructions

1. `bun run dev` (or use the server already on `http://localhost:3030`).
2. Open `http://localhost:3030/demo/region-lifecycle`.
   - Click **Show the list**. Within a moment the left readout shows
     `preview window · records read` and the right one shows `1 reader(s)`.
   - Before the 8 s read settles, click **Open a record**. The left readout still
     shows exactly **one** entry and the right still shows **1** — the list read
     was released as the record read began, not stacked on top of it.
   - Before that settles, click **Put the region away**. Both readouts drop to
     **empty** / **0 reader(s)** *immediately*. The handler deadline is 120 s, so
     an immediate zero can only come from the abort.
   - Click **Bring the region back**, then **Show the list**, and let it finish:
     the answer renders and both readouts return to empty on their own.
3. Open `http://localhost:3030/` and click a capability logo.
   - Type a word in its search rail, then click the *other* capability before the
     results land. The list swaps cleanly and nothing overwrites it a moment
     later. In the console, `(await import("/static/region-scope.js")).regionScopeReport()`
     returns `[]` after the swap, and returns
     `[{ region: "content area", label: "search controller" }]` while a search is
     pending.
4. Nothing in the browser console should log an error at any point.
