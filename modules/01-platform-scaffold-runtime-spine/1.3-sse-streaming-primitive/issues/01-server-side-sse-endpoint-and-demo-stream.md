# Server-side SSE endpoint & demo token stream

Status: ready-for-agent

## Epic

Module 1 — Platform Scaffold & Runtime Spine · Epic 1.3 — SSE streaming primitive
(`docs/modules.md` §1.3, ARCH §4, §6.2)

## What to build

Add the Server-Sent Events channel from server to client (ARCH §4, §6.2) — the transport that later powers "watch the UI build itself." Provide an SSE endpoint on the Hono server that streams a demo sequence of tokens / HTML chunks over time, standing in for future build narration.

This issue proves the streaming primitive on the server side; the client consumption is the next issue. **No real generation or capability logic** — the stream content is a demo.

## Acceptance criteria

- [ ] An SSE route streams `text/event-stream` with the correct headers
- [ ] A demo stream emits a sequence of chunks over time (incrementally, not all at once)
- [ ] The stream terminates cleanly and the connection closes
- [ ] Verifiable with `curl` (or equivalent) showing events arriving incrementally
- [ ] No domain or generation logic — demo content only

## Blocked by

- modules/01-platform-scaffold-runtime-spine/1.2-hono-server-and-fixed-shell/issues/01-hono-server-bootstrap-and-static-serving.md
