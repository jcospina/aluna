# Client SSE wiring: swap/append into content area

Status: ready-for-agent

## Epic

Module 1 — Platform Scaffold & Runtime Spine · Epic 1.3 — SSE streaming primitive
(`docs/modules.md` §1.3, ARCH §4, §6.2)

## What to build

Wire the shell to consume the SSE demo stream and swap/append the streamed HTML into the content area (ARCH §4, §6.2). Use HTMX's SSE handling (or a small Alpine / `EventSource` glue) so streamed chunks appear live in the content region — the visible "watch it stream in" behavior.

This is demo wiring that proves the client half of the primitive; later epics replace the demo trigger with real builds and the demo content with build narration.

## Acceptance criteria

- [ ] A trigger in the shell opens the SSE stream from issue 01
- [ ] Streamed chunks swap/append into the content area as they arrive (visibly incremental)
- [ ] The connection closes cleanly when the stream ends
- [ ] No browser console errors during streaming
- [ ] Works with the shell's already-loaded HTMX/Alpine, no build step

## Blocked by

- modules/01-platform-scaffold-runtime-spine/1.3-sse-streaming-primitive/issues/01-server-side-sse-endpoint-and-demo-stream.md
- modules/01-platform-scaffold-runtime-spine/1.2-hono-server-and-fixed-shell/issues/02-fixed-shell-page-with-three-inert-regions.md
