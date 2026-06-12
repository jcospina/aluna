# Build job, single-flight queue & busy refusal

Status: ready-for-agent

## Epic

Module 2 — Explicit Loop I: Build Your First Capability · Epic 2.5 — Capability
builder + global serial build queue (`docs/modules.md` §2.5, ARCH §8 "Concurrency",
ADR-0002 update "per-build ephemeral streams", PLAN decisions 4 & 7:
`modules/02-explicit-loop-i-build-your-first-capability/PLAN.md`)

## What to build

The build-job lifecycle and the concurrency rules — the skeleton every other 2.5
issue plugs a real stage into. The pipeline itself starts as a stub (narrate a
placeholder, then `done`); later issues replace stages one at a time, so the wire
is live from day one.

- **Job creation.** `POST /prompt` creates a build job and immediately returns a
  small HTML fragment containing the SSE subscriber for that job's stream. The
  POST never blocks on an AI call — intent resolution and everything after run
  *inside* the job (ADR-0002 update).
- **The per-build ephemeral stream** ("phone call"). All job output — narration,
  fragments, the commit swap, the terminal `done` — rides
  `GET /build/:id/stream`, event-typed with monotonic ids per ADR-0002, and the
  server closes it on `done`. The persistent shell channel is deliberately
  **not** built — that is M6's, designed with its UX.
- **Single-flight, enforced server-side.** One build at a time, system-wide
  (ARCH §8). While a job is active, `POST /prompt` returns a friendly
  product-voice "one moment" notice (no AI call, no job created) targeted at a
  transient notice spot — never the content area, so the running build's
  narration stays intact (PLAN decision 7). True queueing is deliberately
  deferred to M6's pending proposals.
- **Clean edges.** Unknown or already-finished job ids end the stream cleanly —
  no hang, no reconnect loop (server-closed `done` semantics, ADR-0002).

## Acceptance criteria

- [ ] `POST /prompt` returns the subscriber fragment immediately; no AI call
      happens during the POST
- [ ] The job's events ride `GET /build/:id/stream` with event types + monotonic
      ids, and the server closes the stream on `done`
- [ ] A second POST while a job is active gets the friendly busy notice aimed at
      the transient notice spot; no job is created, no AI is called, the running
      stream is unaffected
- [ ] After `done`, a new POST starts a new job — single-flight, not single-use
- [ ] Stream requests for unknown or completed jobs end cleanly
- [ ] Tests drive the whole lifecycle against the stub pipeline with no real
      provider calls

## Blocked by

None - can start immediately
