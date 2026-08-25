# 0002 — SSE transport conventions (seeded by the 1.3 demo)

Status: accepted

## Decision

Server→client streaming uses **SSE** (ARCH §4). The protocol *shape* — what 1.3
settled and what it deliberately left open — is recorded here so it survives the
deletion of the throwaway demo that established it.

**Settled now:**

- **Event-typed SSE.** Messages carry a named `event:` rather than riding a
  single default stream, so the client tells one kind of message from another
  without parsing the payload. The 1.3 demo seeded three names:
  - `narration` — a product-voice token/chunk to append (the "watch it build"
    text, ARCH §6.2).
  - `fragment` — a chunk of HTML to place into the content area.
  - `done` — terminal signal; the server closes the stream so the browser
    `EventSource` treats the end as final and does not auto-reconnect.
- **Monotonic `id`** on each app-level message.
- **Transport heartbeat.** Long-running SSE routes send id-less `heartbeat`
  events at an interval below the server idle timeout. Clients ignore them; they
  exist to keep the TCP/SSE connection active while a builder stage generates or
  checks without producing user-visible output.
- **Route namespacing.** `/demo/*` is throwaway and freely removable. The
  production SSE channel, the capability router `/capability/:id/:action`, and
  `/files/:key` are reserved real routes (see `src/app/app.ts`). The demo must
  never colonize a reserved path.

**Historical questions from the Module 1 seed (all resolved by the updates below):**

- **The production event vocabulary.** The three names above are a *seed*, not a
  contract. Module 2's narration (§2.5/§2.6) and Module 4's foreground evolution
  flow are the real consumers and own finalizing the names. Module 4 later chose
  one complete terminal `commit` View swap rather than per-unit DOM patches.
- **The client consumption mechanism.** The demo proved raw `EventSource` plus
  manual DOM writes. The product instead drives the UI through HTMX swaps
  (`hx-swap-oob` for content+toolbar in one response, targeted `hx-swap` for
  fragments — ARCH §6.1, §6.2). At this point in the chronology the HTMX SSE
  extension was not yet vendored; Epic 2.6a later proved and finalized the path.
- **Channel topology.** The demo modeled a *per-request ephemeral* stream, opened
  on a click and closed on `done`. The implicit loop needs the server to push
  proposals *unprompted* (ARCH §8), which implies a *persistent shell channel*.
  Which topology — or both — is deferred to whichever module first needs
  server-initiated push (M2 narration / M7 proposals).

## Context / why

Module 1's whole job is to prove the wiring with zero domain logic (modules.md
§1, §1.3), and 1.3's code is intentionally disposable. This ADR is the one
durable artifact of an otherwise throwaway epic: it keeps the *design decisions*
the demo embodied from vanishing when the demo is deleted.

Events are typed rather than sent down one undifferentiated stream so that
narration, HTML fragments, and lifecycle signals are separable on the client by
event name alone. That keeps targeted non-terminal fragments available where they
are useful while allowing M4 to finish evolution with one complete terminal
`commit` View swap.

The server closes the stream on `done`, which avoids `EventSource`'s default
auto-reconnect and gives each stream a clean end with no console error.

The heartbeat is transport, not product state. A build stage may be silent for
longer than the server's idle timeout while a provider generates a large unit or
while a gate runs. The heartbeat is deliberately not part of the product event
vocabulary and carries no app event id, so it does not disturb application
ordering.

## Consequences

- M2/M4 may rename or extend the event vocabulary; when they do, they update or
  supersede this ADR. The names here are a starting convention, not a frozen
  contract.
- Deleting the 1.3 demo (`/demo/stream` in `src/app/app.ts`; `initSseDemo`/`sseData`
  in `public/app.js`; the demo trigger/output in `public/index.html`; the
  `.sse-demo` block in `public/app.css`) removes no decision recorded here.
- At the Module 1 seed point, the HTMX-driven client path and the channel
  topology remained open. The Module 2 updates below close both; this historical
  paragraph does not reopen them.

## Update (Module 2 planning — channel topology settled)

The **channel topology** question above is now decided for the explicit loop
(settled in the M2 grilling session, 2026-06-12; implementation lands with epic
2.6).

Streams are per-build and ephemeral — a phone call, not an intercom. `POST
/prompt` creates a build job and immediately returns a small HTML fragment
containing the SSE subscriber for that job's stream (`GET /build/:id/stream`).
All narration, fragments, the commit swap, and the terminal `done` ride that
per-build stream, which the server closes: the same ephemeral lifecycle the
1.3/1.5 streams proved, now keyed by job. Intent resolution runs inside the job
and is narrated over the stream, so the POST never blocks on an AI call and the
prompt bar gets instant feedback.

The persistent shell channel is deliberately not built in M2. Unprompted server
push is exactly the implicit loop's need, and its UX is still open design work
(modules.md §7.1), so M7 adds its own persistent proposal channel *alongside* the
ephemeral build streams if its design wants one. The two topologies coexist;
nothing in M2 is throwaway.

The **client consumption mechanism** question is affirmed, not yet proven: the
htmx SSE extension + `hx-swap-oob` is the chosen path, to be vendored and proven
by epic 2.6 as flagged. The production **event vocabulary** remains M2 work and
will be recorded here when finalized.

## Update (Epic 2.6a — event vocabulary finalized; htmx swap path proven)

> **Flagged for owner review.** This update closes the last open question in
> ADR-0002 and locks the production event vocabulary, the one durable decision
> in epic 2.6 (the disposable proving scaffold that established it is already
> marked for deletion). The only new name is `commit`, plus a sharpened client
> contract for `done`. Please review the vocabulary table and the
> `sse-close` finding below before 2.6c builds on them. Issue:
> `modules/02-explicit-loop-i-build-your-first-capability/2.6-shell-render-and-commit-swap/issues/01-htmx-sse-extension-and-event-vocabulary.md`.

The **client consumption mechanism** question is now resolved. The htmx SSE
extension (`htmx-ext-sse` 2.2.4, the htmx-2.x line; peer `htmx.org ^2.0.2`) is
vendored verbatim at `public/vendor/htmx-ext-sse.min.js` (npm tarball integrity
verified) and loaded by the shell right after `htmx.min.js`. A disposable proving
scaffold (`/demo/swap-proof/*`, a `.swap-proof` shell `<section>`) demonstrated in
a real browser the exact mechanism the commit swap relies on: one named SSE event
drives a targeted `sse-swap` into the content region, and an `hx-swap-oob` sidecar
updates the capability toolbar out of band from the same response. The scaffold
has since been removed, following the 1.3 pattern in which the decision record
outlives the demo.

### Finalized production event vocabulary

Named, app-level SSE events carry a monotonic `id` (transport invariant, above).
Starting from the 1.3 seed plus what the commit swap needs:

| Event | Role | Client wire |
|---|---|---|
| `narration` | Product-voice text chunk to append (the "watch it build" copy). | `sse-swap="narration"`, `hx-swap="beforeend"` on the narration region. *(seed, kept)* |
| `fragment` | A non-terminal HTML fragment placed into a targeted region. M1's invitation and any future incremental surface may use it. M4 does not patch per-unit DOM, but it uses `fragment` to restore the then-current canonical committed View + `read` state (or neutral surface) after `no_change`, stale/collision, cancellation, or failure; restoration clears search/modal/edit state and has no toolbar sidecar. | `sse-swap="fragment"` (or a dedicated region) with that region's `hx-swap`. *(seed, kept)* |
| **`commit`** | **New.** The terminal *success* swap: one event carrying the committed capability's complete View. A newly committed separate capability includes an append OOB toolbar sidecar; evolution includes a replacement sidecar only when its label changed; otherwise there is no toolbar sidecar. | `sse-swap="commit"`, `hx-swap="innerHTML"` on the View region; any conditional `hx-swap-oob` sidecar targets `#capability-toolbar`. |
| `done` | Terminal lifecycle signal; the server sends it (data is a short outcome: `ok` / `error` / `missing`), then closes the stream. | The subscriber element carries **`sse-close="done"`** (see finding below). *(seed; client contract sharpened)* |
| `heartbeat` | Transport keepalive — id-less, ignored by clients. **Not** product vocabulary. | none *(transport, unchanged)* |

Failures get no dedicated event: a build that fails streams a warm,
product-voice apology over `narration` and ends with `done` (data `error`) — the
existing `build-jobs.ts` pattern. This keeps the product vocabulary to the four
names above, `commit` being the single addition this epic.

### Finding — `sse-close` is mandatory for clean termination

`htmx-ext-sse` wraps a native `EventSource`, which auto-reconnects with backoff
whenever the server closes the stream (`onerror` → `ensureEventSource`). So a
server-closed `done` is not enough under htmx: without intervention the browser
reconnects and the per-build stream re-runs. The extension's
`sse-close="<event>"` attribute closes the source on a named event, so wiring
`sse-close="done"` on the subscriber is the htmx analogue of the raw-EventSource
path's `source.close()` on `done`. `renderBuildSubscriber` (`src/app/app.ts`) now
sets it. This sharpens rather than contradicts the original "server-closed
`done` avoids auto-reconnect" note above, which silently assumed a raw-EventSource
client that closes its own source; the htmx client must be told to.

### Consequences of this update

- The two open questions flagged at the top of this ADR (HTMX-driven client path,
  channel topology) are now both closed for the explicit loop: topology by the
  M2-planning update above, client mechanism here.
- The vocabulary is now a contract, not a seed: `commit` and the
  `done`/`sse-close` pairing are what 2.6c and M4 build on. M4 reuses `commit`
  only for a complete newly activated capability View. It uses `fragment` for
  non-activating restoration, never per-unit DOM patches. A future rename still
  follows this ADR's own rule: update or supersede.
- **Transport delivery is not activation.** M4's SQLite pointer +
  `success/activated` commit is the point of no return before the presenter emits
  `commit`. A disconnect, render failure, timeout, or lost `done` afterward cannot
  roll back or relabel the build; terminal presenter work is bounded, ownership
  releases in `finally`, and normal shell/toolbar registry rehydration recovers the
  activated View.
- The proving scaffold (`/demo/swap-proof/*`, `renderSwapProof*` in `src/app/app.ts`,
  the `.swap-proof` block in `public/app.css`, the shell `<section>`, and its
  tests) was disposable and has been removed now that the wire is proven and the
  vocabulary recorded here. Its removal took no decision with it (the 1.3
  pattern). What stays in the codebase from 2.6a is durable: the vendored
  extension + its `<script>`, and `sse-close="done"` on `renderBuildSubscriber`.

## Update (Epic 4.8 — the Module 1 `/stream` liveness route removed)

The provider-backed `/stream` greeting route described in the Epic 1.5 paragraph
below (`src/app/app.ts`, `src/app/greeting.ts`, the `.intro__invitation` rule in
`public/css/demo.css`, and its tests) has been removed. Epic 2.6 replaced the
shell's `Meet Aluna` trigger with the prompt bar, leaving the route with no entry
point in the product; the streamed-partial + schema-validated round-trip it existed
to prove is now proved by what the product actually does — a real prompt drives
`partialStream` through the Builder's spec generation and the validated result
through every generated unit, over `POST /prompt` → `GET /build/:id/stream`.

Its removal took no decision with it (the 1.3 pattern, as with `/demo/swap-proof/*`
above). The event vocabulary this ADR fixes is unchanged: `/stream` was a consumer
of `narration`/`fragment`/`done`, never a source of them. Live provider
verification is now a real build typed into the prompt bar on the running app —
no test calls the real API, so that manual build is the only place the configured
provider is exercised for real. The missing-key product-voice guarantee (a warm,
jargon-free apology, no internals in the copy) is asserted on the production
`/prompt` path in `src/app/app.resolver-pipeline.test.ts`.

## Update (2026-08-20 — the swap target outlives a region that comes and goes)

The desk replaces the always-present content area with a window the client
creates and destroys (`modules/05-the-desk/PLAN.md`, decisions 13 and 16). Nothing in the
vocabulary above changes. `commit` and `fragment` keep addressing a **stable
id**, and the server still knows nothing about whether a window is open. What
moves is the obligation: **the client guarantees that id exists whenever a swap
can be in flight**. That is a client-side invariant rather than a protocol
change, so a build that has been streaming since before the user reached for the
close control still has somewhere to land.

Two decisions make the promise keepable. **Teardown is tied to content
replacement rather than to the window.** Whatever a content region started —
in-flight fetches, search controllers, server read tokens — is released when that
content is replaced or removed, so a view swap inside the window (list → record →
back) releases exactly as putting the window away does. A window-scoped hook
would have leaked on every swap and left the same hole open. And **a window
cannot be closed out from under work in progress**: putting it away while a build
or an evolution is running warns first, and proceeds only on confirmation, which
routes through the existing cancel path. The run therefore ends the way this
vocabulary already describes, rather than by losing its target mid-flight.

`#capability-toolbar` is now **the logo layer**. The toolbar is deleted with the
rest of the old shell, and a capability's standing entry on the desk is its logo
(ADR-0007). The `commit` sidecar keeps its shape and its out-of-band delivery and
changes only what it targets: a newly committed capability appends a logo, and an
evolution that changed the label replaces the name written under one. Page
assembly collapses to that single anchor, because the window is created
client-side and the shell holds no placeholder for it; the one anchor swap that
fails silently today (`class="shell"`, `src/web/fragments.ts`) throws like the
others.

Before activation, an admitted new-capability job may own a provisional
build-id-keyed tile. It is presentation state, not a registry entry: `commit`
replaces it exactly once with the registry-backed tile, while every
non-activating terminal removes it. Evolution and resolver outcomes that never
admit a new capability create none. This adds no app-level SSE event name.

Shipped in 5.4/02 exactly so. The layer's id is `#capability-logos` and the tile
rides `fragment` — a non-terminal fragment placed into a targeted region, which is
what that name is for — carrying nothing but its out-of-band sidecar, so the
region it nominally lands in receives nothing. Taking it down is the client's, and
it is not conditional on *how* the stream ended: `done` is one ending, and htmx
closing a stream whose subscriber left the document (`nodeReplaced`,
`nodeMissing`) is another. Both mean the sink is gone, which the server already
reads as cancellation, so both take the tile down.

## Historical update (Epic 1.5 — predates Module 2 finalization)

This paragraph records the state at the end of Module 1. Its open-question
language is superseded by the Module 2 planning and Epic 2.6a updates above.

The throwaway `/demo/stream` was replaced, not merely deleted, by the real
provider-backed `/stream` (`src/app/app.ts`): the shell's `Meet Aluna` trigger
streams a live AI-provider greeting into the content area (`narration` for the
greeting, `fragment` for the invitation, `done` to close). It reused the seed
vocabulary and kept the raw `EventSource` + manual DOM client path; at that
historical point it did not settle the HTMX path or topology. Epic 2.6 later did
so. The route is user-initiated, never hit on load, and carries zero domain
logic — it proves the spine end-to-end, nothing more.
