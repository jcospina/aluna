# 0002 — SSE transport conventions (seeded by the 1.3 demo)

Status: accepted

## Decision

Server→client streaming uses **SSE** (ARCH §4). The protocol *shape* — what 1.3
settled and what it deliberately left open — is recorded here so it survives the
deletion of the throwaway demo that established it.

**Settled now:**

- **Event-typed SSE.** Messages carry a named `event:` (not a single default
  stream), so the client distinguishes kinds of message without parsing the
  payload. The 1.3 demo seeded three names:
  - `narration` — a product-voice token/chunk to append (the "watch it build"
    text, ARCH §6.2).
  - `fragment` — a chunk of HTML to place into the content area.
  - `done` — terminal signal; the server closes the stream so the browser
    `EventSource` treats the end as final and does **not** auto-reconnect.
- **Monotonic `id`** on each app-level message.
- **Transport heartbeat.** Long-running SSE routes send id-less `heartbeat`
  events below the server idle timeout. Clients ignore them; they exist to keep
  the TCP/SSE connection active while a builder stage is generating or checking
  without producing user-visible output.
- **Route namespacing.** `/demo/*` is throwaway and freely removable. The
  **production SSE channel**, the capability router `/capability/:id/:action`,
  and `/files/:key` are reserved real routes (see `src/app.ts`). The demo must
  never colonize a reserved path.

**Historical questions from the Module 1 seed (all resolved by the updates below):**

- **The production event vocabulary.** The three names above are a *seed*, not a
  contract. Module 2's narration (§2.5/§2.6) and Module 4's foreground evolution
  flow are the real consumers and own finalizing the names. Module 4 later chose
  one complete terminal `commit` View swap rather than per-unit DOM patches.
- **The client consumption mechanism.** The demo proved raw `EventSource` +
  manual DOM writes. The product instead drives the UI via **HTMX swaps**
  (`hx-swap-oob` for content+toolbar in one response, targeted `hx-swap` for
  fragments — ARCH §6.1, §6.2). At this point in the chronology the HTMX SSE
  extension was not yet vendored; Epic 2.6a later proved and finalized the path.
- **Channel topology.** The demo modeled a *per-request ephemeral* stream
  (opened on a click, closed on `done`). The implicit loop needs the server to
  push proposals *unprompted* (ARCH §8), which implies a *persistent shell
  channel*. Which topology — or both — is deferred to whichever module first
  needs server-initiated push (M2 narration / M7 proposals).

## Context / why

- Module 1's whole job is to prove the wiring with **zero domain logic**
  (modules.md §1, §1.3); 1.3's code is intentionally disposable. This ADR is the
  one durable artifact of an otherwise throwaway epic — it keeps the *design
  decisions* the demo embodied from vanishing when the demo is deleted.
- **Event-typed over a single stream** so narration, HTML fragments, and
  lifecycle signals are separable on the client by event name alone. This keeps
  targeted non-terminal fragments available where useful while allowing M4 to
  finish evolution with one complete terminal `commit` View swap.
- **Server-closed `done`** avoids `EventSource`'s default auto-reconnect, giving
  a clean, no-console-error end to each stream.
- **Heartbeat as transport, not product state.** A build stage may be silent for
  longer than the server's idle timeout while a provider generates a large unit
  or while a gate runs. The heartbeat is deliberately not part of the product
  event vocabulary and carries no app event id, so it does not disturb
  application ordering.

## Consequences

- M2/M4 may rename or extend the event vocabulary; when they do, **update or
  supersede this ADR**. The names here are a starting convention, not a frozen
  contract.
- Deleting the 1.3 demo (`/demo/stream` in `src/app.ts`; `initSseDemo`/`sseData`
  in `public/app.js`; the demo trigger/output in `public/index.html`; the
  `.sse-demo` block in `public/app.css`) removes **no** decision recorded here.
- At the Module 1 seed point, the **HTMX-driven client path** and **channel
  topology** remained open. The Module 2 updates below close both; this historical
  paragraph does not reopen them.

## Update (Module 2 planning — channel topology settled)

The **channel topology** question above is now decided for the explicit loop
(settled in the M2 grilling session, 2026-06-12; implementation lands with epic
2.6):

- **Per-build ephemeral streams** ("phone call", not "intercom"). `POST /prompt`
  creates a build job and immediately returns a small HTML fragment containing
  the SSE subscriber for that job's stream (`GET /build/:id/stream`). All
  narration, fragments, the commit swap, and the terminal `done` ride that
  per-build stream, which the server closes — the same ephemeral lifecycle the
  1.3/1.5 streams proved, now keyed by job.
- **Intent resolution runs inside the job**, narrated over the stream — the
  POST never blocks on an AI call, so the prompt bar gets instant feedback.
- **The persistent shell channel is deliberately not built in M2.** Unprompted
  server push is exactly the implicit loop's need, and its UX is still open
  design work (modules.md §7.1) — M7 adds its own persistent proposal channel
  *alongside* the ephemeral build streams if its design wants one. The two
  topologies coexist; nothing in M2 is throwaway.

The **client consumption mechanism** question is affirmed, not yet proven: the
htmx SSE extension + `hx-swap-oob` is the chosen path, to be vendored and proven
by epic 2.6 as flagged. The production **event vocabulary** remains M2 work and
will be recorded here when finalized.

## Update (Epic 2.6a — event vocabulary finalized; htmx swap path proven)

> **⚠️ Flagged for owner review.** This update closes the last open question in
> ADR-0002 and locks the production event vocabulary — the one durable decision
> in epic 2.6 (the disposable proving scaffold that established it is already
> marked for deletion). The only *new* name is **`commit`**, plus a sharpened
> client contract for **`done`**. Please review the vocabulary table and the
> `sse-close` finding below before 2.6c builds on them. Issue:
> `modules/02-explicit-loop-i-build-your-first-capability/2.6-shell-render-and-commit-swap/issues/01-htmx-sse-extension-and-event-vocabulary.md`.

The **client consumption mechanism** question is now **resolved**. The htmx SSE
extension (`htmx-ext-sse` 2.2.4, the htmx-2.x line; peer `htmx.org ^2.0.2`) is
vendored verbatim at `public/vendor/htmx-ext-sse.min.js` (npm tarball integrity
verified) and loaded by the shell right after `htmx.min.js`. A disposable proving
scaffold (`/demo/swap-proof/*`, a `.swap-proof` shell `<section>`) demonstrated —
in a real browser — the exact mechanism the commit swap relies on: **one named SSE
event drives a targeted `sse-swap` into the content region and an `hx-swap-oob`
sidecar updates the capability toolbar out of band, from the same response.** The
scaffold has since been removed (the 1.3 pattern: the decision record outlives the
demo); what it proved is recorded below.

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

Failures do **not** get a dedicated event: a build that fails streams a warm,
product-voice apology over `narration` and ends with `done` (data `error`) — the
existing `build-jobs.ts` pattern. This keeps the product vocabulary to the four
names above (`commit` being the single addition this epic).

### Finding — `sse-close` is mandatory for clean termination

`htmx-ext-sse` wraps a **native `EventSource`**, which auto-reconnects with
backoff whenever the server closes the stream (`onerror` → `ensureEventSource`).
So a server-closed `done` is **not** enough under htmx: without intervention the
browser reconnects and the per-build stream re-runs. The extension's
`sse-close="<event>"` attribute closes the source on a named event; wiring
`sse-close="done"` on the subscriber is the htmx analogue of the raw-EventSource
path's `source.close()` on `done`. `renderBuildSubscriber` (`src/app.ts`) now
sets it. This *sharpens* — does not contradict — the original "server-closed
`done` avoids auto-reconnect" note above, which silently assumed the raw-
EventSource client that closes its own source; the htmx client must be told to.

### Consequences of this update

- The **two open questions** flagged at the top of this ADR (HTMX-driven client
  path, channel topology) are now both closed for the explicit loop: topology by
  the M2-planning update above, client mechanism here.
- The vocabulary is now a **contract**, not a seed: `commit` and the
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
- The proving scaffold (`/demo/swap-proof/*`, `renderSwapProof*` in `src/app.ts`,
  the `.swap-proof` block in `public/app.css`, the shell `<section>`, and its
  tests) was **disposable** and has been **removed** now that the wire is proven
  and the vocabulary recorded here. Its removal took no decision with it (the 1.3
  pattern). What stays in the codebase from 2.6a is durable: the vendored
  extension + its `<script>`, and `sse-close="done"` on `renderBuildSubscriber`.

## Historical update (Epic 1.5 — predates Module 2 finalization)

This paragraph records the state at the end of Module 1. Its open-question
language is superseded by the Module 2 planning and Epic 2.6a updates above.

The throwaway `/demo/stream` was **replaced, not just deleted**, by the real
provider-backed `/stream` (`src/app.ts`): the shell's `Meet Aluna` trigger streams a
live AI-provider greeting into the content area (`narration` for the greeting,
`fragment` for the invitation, `done` to close). It reused the seed vocabulary and
kept the **raw `EventSource` + manual DOM** client path; at that historical point
it did not settle the HTMX path or topology. Epic 2.6 later did so. The route is user-
initiated (never hit on load) and carries zero domain logic — it proves the spine
end-to-end, nothing more.
