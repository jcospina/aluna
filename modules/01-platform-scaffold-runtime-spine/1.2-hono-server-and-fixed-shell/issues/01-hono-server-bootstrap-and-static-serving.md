# Hono server bootstrap & static asset serving

Status: done

## Epic

Module 1 — Platform Scaffold & Runtime Spine · Epic 1.2 — Hono server + the fixed shell
(`docs/modules.md` §1.2, ARCH §4, §6.1)

## What to build

Stand up the Hono application on Bun. It responds on a root route and serves static assets from a known public directory. This is the server foundation every later route attaches to — the shell page, the SSE channel, and eventually the capability router.

Keep it minimal: Hono is ~14KB, runs on Bun directly, no framework ceremony (ARCH §4). **No shell markup, SSE, database, or capability logic yet** — just a running HTTP server that responds and can serve files.

## Acceptance criteria

- [x] Hono app created and served via Bun's HTTP server, started by `bun run dev`
- [x] `GET /` responds with HTTP 200
- [x] Static assets are served from a dedicated public directory (the CSS/JS the shell will later use)
- [x] The listening port is configurable via environment variable, with a sensible default
- [x] The server logs the URL it is listening on at startup

## Blocked by

- modules/01-platform-scaffold-runtime-spine/1.1-project-and-toolchain/issues/01-bun-typescript-project-scaffold.md

## Comments

**2026-06-01 — implemented (agent).** Stood up the minimal Hono app on Bun. Kept
strictly to scope — **no shell markup, SSE, database, or capability logic**;
just an HTTP server that responds and serves files. Those land in later epics.

Dependency: added `hono@^4.12.23` (the only runtime dep so far).

Files:
- `src/app.ts` — the platform's one route file (ARCH §4). Exports a `Hono`
  instance. `GET /` returns a plain `text/plain` 200 stub (`omni-crud platform —
  server up`); issue 02 replaces this with the shell HTML. Static assets are
  mounted with `serveStatic` from `hono/bun` under the **`/static/*`** prefix,
  rooted at `./public`, with `rewriteRequestPath` stripping the prefix so
  `/static/app.css` → `./public/app.css`. A dedicated prefix keeps the asset
  namespace clear of the root-level routes that arrive later
  (`/capability/:id/:action`, `/files/:key`, the SSE channel). Exporting `app`
  separately from the bootstrap keeps it `app.request()`-testable.
- `src/index.ts` — entrypoint (repurposed from the 1.1 boot-line stub). Reads
  the port from `PORT` (default **3030**), starts `Bun.serve({ port, fetch:
  app.fetch })`, and logs `http://localhost:<bound-port>`. `PORT` parsing:
  unset / empty / non-numeric → default; an explicit `"0"` → OS-assigned
  ephemeral port (handy for tests); the **actual bound** port is logged, so it
  reflects the ephemeral case too.
- `public/README.md` — tracked placeholder so the static dir exists in a fresh
  checkout. Unlike `capabilities/` / `storage/` / `data/` (runtime-generated,
  git-ignored), `public/` holds **authored** assets and stays in version
  control — no `.gitignore` change needed.

Verification:
- `bun run typecheck` → 0 errors; `bun run lint` (Biome) → clean.
- On a free port: startup logs `omni-crud listening on http://localhost:8723`;
  `GET /` → **200** `text/plain` (`omni-crud platform — server up`);
  `GET /static/README.md` → **200** (served from `public/`);
  `GET /static/missing.css` → **404** (graceful fall-through);
  path-traversal `GET /static/../package.json` → **404** (blocked by
  serveStatic's built-in `..` guard).
- Port config: a custom `PORT` binds that port; unset / empty / invalid `PORT`
  all target the **3030** default.
- `bun run build` bundles the server (47 modules, 56.7 KB) and `bun run start`
  serves the built artifact (`/` and `/static/*` both 200).
- `git status` after running shows only the intended changes (hono dep +
  `src/{app,index}.ts` + `public/README.md`) — no stray runtime artifacts.

Note: on this machine `bun run dev` with the default port currently fails
`EADDRINUSE` because an unrelated `node`/Next.js dev server already holds
:3030. That's a local environment conflict, not a defect — the default of 3000
is the conventional choice; set `PORT` to use another port (e.g.
`PORT=8723 bun run dev`). Changes left uncommitted pending the usual go-ahead.
