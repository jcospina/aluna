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
- **Monotonic `id`** on each message.
- **Route namespacing.** `/demo/*` is throwaway and freely removable. The
  **production SSE channel**, the capability router `/capability/:id/:action`,
  and `/files/:key` are reserved real routes (see `src/app.ts`). The demo must
  never colonize a reserved path.

**Deliberately open — owned by the module that first needs it, not locked here:**

- **The production event vocabulary.** The three names above are a *seed*, not a
  contract. Module 2's narration (§2.5/§2.6) and Module 3's diff engine (§3.3,
  "stream only changed fragments with targeted `hx-swap`") are the real
  consumers and own finalizing the names.
- **The client consumption mechanism.** The demo proved raw `EventSource` +
  manual DOM writes. The product instead drives the UI via **HTMX swaps**
  (`hx-swap-oob` for content+toolbar in one response, targeted `hx-swap` for
  fragments — ARCH §6.1, §6.2). The htmx SSE extension is **not yet vendored**;
  proving that path is Module 2 work (flagged in `docs/modules.md`, epic 2.6).
- **Channel topology.** The demo modeled a *per-request ephemeral* stream
  (opened on a click, closed on `done`). The implicit loop needs the server to
  push proposals *unprompted* (ARCH §8), which implies a *persistent shell
  channel*. Which topology — or both — is deferred to whichever module first
  needs server-initiated push (M2 narration / M6 proposals).

## Context / why

- Module 1's whole job is to prove the wiring with **zero domain logic**
  (modules.md §1, §1.3); 1.3's code is intentionally disposable. This ADR is the
  one durable artifact of an otherwise throwaway epic — it keeps the *design
  decisions* the demo embodied from vanishing when the demo is deleted.
- **Event-typed over a single stream** so narration, HTML fragments, and
  lifecycle signals are separable on the client by event name alone — directly
  enabling M3's "stream only the changed fragments with targeted `hx-swap`."
- **Server-closed `done`** avoids `EventSource`'s default auto-reconnect, giving
  a clean, no-console-error end to each stream.

## Consequences

- M2/M3 may rename or extend the event vocabulary; when they do, **update or
  supersede this ADR**. The names here are a starting convention, not a frozen
  contract.
- Deleting the 1.3 demo (`/demo/stream` in `src/app.ts`; `initSseDemo`/`sseData`
  in `public/app.js`; the demo trigger/output in `public/index.html`; the
  `.sse-demo` block in `public/app.css`) removes **no** decision recorded here.
- Two questions remain explicitly open — the **HTMX-driven client path** and the
  **channel topology** — and must be settled by the consuming module, not
  assumed from the demo.

## Update (Epic 1.5 — Module 1 finalized)

The throwaway `/demo/stream` was **replaced, not just deleted**, by the real
provider-backed `/stream` (`src/app.ts`): the shell's `Meet Aluna` trigger streams a
live AI-provider greeting into the content area (`narration` for the greeting,
`fragment` for the invitation, `done` to close). This **reuses the seed vocabulary
above unchanged** and keeps the **raw `EventSource` + manual DOM** client path — it
does **not** settle either open question. The HTMX-driven swap path (`hx-swap-oob`)
and the channel topology remain Module 2's to prove and finalize (epic 2.6); the
event names here are still a seed M2 may rename or extend. The route is user-
initiated (never hit on load) and carries zero domain logic — it proves the spine
end-to-end, nothing more.
