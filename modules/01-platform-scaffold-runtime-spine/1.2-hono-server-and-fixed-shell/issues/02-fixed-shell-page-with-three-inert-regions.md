# Fixed shell page with three inert regions

Status: ready-for-agent

## Epic

Module 1 — Platform Scaffold & Runtime Spine · Epic 1.2 — Hono server + the fixed shell
(`docs/modules.md` §1.2, ARCH §6.1)

## What to build

Create and serve the single static HTML page that is the platform's one fixed UI surface — the shell (ARCH §6.1). It loads HTMX and Alpine.js and lays out the three shell regions as **inert placeholders**:

- the always-on **prompt bar**,
- an empty **capability toolbar**,
- an empty **content area**.

Nothing is interactive yet — the prompt bar does not submit, the toolbar has no entries, the content area is empty. This is the skeleton later epics fill in (SSE streams into the content area; the registry rehydrates the toolbar). The shell is dumb on purpose (ARCH §6.1): it renders what the server sends and reports what the user does, nothing more. Load HTMX + Alpine now so later HTMX attributes and Alpine directives work with no build step (ARCH §4).

## Acceptance criteria

- [ ] `GET /` returns the shell HTML page (served by the Hono server)
- [ ] HTMX and Alpine.js are loaded on the page, pinned to fixed versions (vendored or version-locked, not floating)
- [ ] The three regions render as clearly delineated, inert placeholders: prompt bar, capability toolbar (empty), content area (empty)
- [ ] The page loads with no browser console errors
- [ ] No interactivity is wired (placeholders only) — prompt submission, toolbar entries, and content swapping belong to later epics

## Blocked by

- modules/01-platform-scaffold-runtime-spine/1.2-hono-server-and-fixed-shell/issues/01-hono-server-bootstrap-and-static-serving.md
