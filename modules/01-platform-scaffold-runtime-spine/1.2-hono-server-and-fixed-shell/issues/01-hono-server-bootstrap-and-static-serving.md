# Hono server bootstrap & static asset serving

Status: ready-for-agent

## Epic

Module 1 — Platform Scaffold & Runtime Spine · Epic 1.2 — Hono server + the fixed shell
(`docs/modules.md` §1.2, ARCH §4, §6.1)

## What to build

Stand up the Hono application on Bun. It responds on a root route and serves static assets from a known public directory. This is the server foundation every later route attaches to — the shell page, the SSE channel, and eventually the capability router.

Keep it minimal: Hono is ~14KB, runs on Bun directly, no framework ceremony (ARCH §4). **No shell markup, SSE, database, or capability logic yet** — just a running HTTP server that responds and can serve files.

## Acceptance criteria

- [ ] Hono app created and served via Bun's HTTP server, started by `bun run dev`
- [ ] `GET /` responds with HTTP 200
- [ ] Static assets are served from a dedicated public directory (the CSS/JS the shell will later use)
- [ ] The listening port is configurable via environment variable, with a sensible default
- [ ] The server logs the URL it is listening on at startup

## Blocked by

- modules/01-platform-scaffold-runtime-spine/1.1-project-and-toolchain/issues/01-bun-typescript-project-scaffold.md
