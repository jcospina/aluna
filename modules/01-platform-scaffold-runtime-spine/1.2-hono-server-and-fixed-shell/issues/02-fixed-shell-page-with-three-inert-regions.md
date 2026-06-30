# Fixed shell page with three inert regions

Status: done

## Epic

Module 1 — Platform Scaffold & Runtime Spine · Epic 1.2 — Hono server + the fixed shell
(`docs/modules.md` §1.2, ARCH §6.1)

## What to build

Create and serve the single static HTML page that is the platform's one fixed UI surface — the shell (ARCH §6.1). It is authored as a real static file, `public/index.html`, and served at `GET /` by an explicit route in `src/app.ts` that returns the file via `Bun.file` (replacing the plain-text stub issue 01 left at the root route).

The page loads HTMX and Alpine.js — both **vendored locally** (committed files under `public/vendor/`, exact versions pinned, served from `/static/vendor/…`; no CDN, no build step, ARCH §4) — and lays out the three shell regions as **inert, semantic placeholders**:

- the always-on **prompt bar** — a real `<form>`, but inert (no `hx-post` yet),
- the **capability toolbar** — a `<nav>` landmark laid out as the left sidebar (its *visual* styling is issue 03), empty,
- the **content area** — a `<main>` landmark, empty.

Use real landmark elements (`<form>`, `<nav>`, `<main>`), not anonymous `<div>`s — it costs nothing now and pays off in accessibility and HTMX targeting later. Wrap the shell in an **empty Alpine `x-data` root** so later epics extend the shell rather than restructure it.

Nothing is interactive yet — the prompt bar does not submit, the toolbar has no entries, the content area is empty. This is the skeleton later epics fill in (SSE streams into the content area; the registry rehydrates the toolbar). The shell is dumb on purpose (ARCH §6.1): it renders what the server sends and reports what the user does, nothing more. Load HTMX + Alpine now so later HTMX attributes and Alpine directives work with no build step (ARCH §4).

This issue owns **structure, the static shell layout, and asset plumbing.** Build the actual layout now — the Claude/ChatGPT shell shape: the toolbar as a **left sidebar**, the **prompt bar pinned to the bottom**, and the **content area filling the rest**. What belongs to issue 03 is the *visual styling* of that shell (colors, fonts, theme, spacing polish), its **collapse/responsive behavior**, and the cold-start orb. Keep styling here to the bare minimum the layout needs — structural rules plus placeholder delineation. Do not add colors or any opinionated styling you think looks good. It is barebones and minimal, **only layout**.

> **Note on "three regions."** ARCH §6.1 decomposes the shell into three *functional parts* — prompt bar, toolbar, and **Event Tracker** — with the content area as the implicit surface the toolbar swaps into. This issue uses the *visual-region* lens instead — prompt bar, toolbar, content area — under which the **Event Tracker drops out**: it is an invisible dumb recorder with no UI and does not arrive until Module 7. Both decompositions are consistent; don't go looking for a fourth region.

## Acceptance criteria

- [x] `GET /` returns the shell HTML page, served by an explicit `app.get("/")` in `src/app.ts` that returns `public/index.html` via `Bun.file` (the issue-01 text stub is replaced)
- [x] HTMX (2.x) and Alpine.js (3.x) are **vendored under `public/vendor/`** — committed, exact patch versions pinned (not floating, not CDN) — and loaded on the page from `/static/vendor/…`
- [x] The three regions render as clearly delineated, inert **semantic landmarks**: prompt bar (`<form>`), capability toolbar (`<nav>`, empty), content area (`<main>`, empty)
- [x] The regions are arranged in the **static shell layout** — left sidebar (toolbar) + content column with the prompt bar pinned to the bottom and the content area filling the rest (structural only; visual styling, collapse, and responsive behavior are issue 03)
- [x] An empty Alpine `x-data` root wraps the shell (no directives/state yet) so later epics extend rather than restructure
- [ ] The page loads with **no browser console errors** (verified by a manual browser load — this repo has no browser test harness) — _preconditions verified programmatically (valid HTML, all assets 200 with correct MIME, intact pinned libs, empty `x-data`, favicon 404 suppressed); awaiting the final manual browser load (no browser is connected to this agent)_
- [x] No product interactivity is wired (placeholders only) — prompt submission, toolbar entries, and content swapping belong to later epics

## Blocked by

- modules/01-platform-scaffold-runtime-spine/1.2-hono-server-and-fixed-shell/issues/01-hono-server-bootstrap-and-static-serving.md

## Comments

**2026-06-02 — design decisions (grilling session).** Resolved the open design tree for this issue (and its sibling 03). Decisions owned here:

- **Shell HTML lives as a static file** `public/index.html`, served via an explicit `app.get("/")` returning `Bun.file("./public/index.html")` (per-request read — Bun file I/O is microsecond-fast and stays live under `--watch`). Chosen over an inline TS template literal (keeps the "single static HTML page" truth of ARCH §4, stays plain-HTML authorable, keeps `/` a greppable route later epics evolve) and over a bare `serveStatic` fall-through (keeps `/` an explicit, `app.request()`-testable route).
- **HTMX + Alpine are vendored, not CDN-pinned.** Single-user, local-first, BYO-key PoC whose whole pitch is "watch it build itself" — a CDN dependency at page load is pure downside (offline demos; console errors on a blocked/slow CDN). Vendoring makes the version *literally the committed file* (strongest possible lock) and serves everything from our own `/static/`. Pin exact patch versions; keep third-party blobs in `public/vendor/` so they stay separate from authored assets.
- **Real landmark elements + an empty Alpine root**, so structure and accessibility are right from the start and later epics extend rather than restructure.
- **02/03 seam:** this issue is structure + asset plumbing and a binary, verifiable milestone (serves, libs load, no console errors, landmarks exist); all layout/visual design is issue 03.

Deferred to issue 03: the sidebar layout, the bottom-pinned prompt, collapse behavior, fonts, theme/palette, the cold-start orb, and all product-voice copy.

**2026-06-02 — implemented (agent).** Built the fixed shell page, its **static layout**, and the asset plumbing. Styling stays barebones (structural rules + 1px placeholder borders, no colors/fonts/theme); collapse, responsive behavior, the orb, and product copy remain issue 03. _(Correction: an earlier pass shipped this with no layout, on a too-literal reading of "structure only." Per the issue's "only layout" direction and owner confirmation, the static shell layout belongs here — this supersedes the grilling note's "Deferred to issue 03: the sidebar layout, the bottom-pinned prompt.")_

Files:
- `public/index.html` — the fixed shell, laid out in the **Claude/ChatGPT shape**. An empty Alpine `x-data` root (`div.shell`, `display:flex`, `height:100vh`) holds the `<nav class="toolbar">` as a fixed-width **left sidebar** and a `.content-column` (flex column) that stacks `<main class="content">` (fills the remaining height) over the **bottom-pinned** `<form class="prompt">`. All three regions are empty/inert: the form has no `hx-post` and `onsubmit="return false"` (no reload, no orchestrator call); the toolbar and content area are empty. The inline `<style>` is **structural layout only** (flex/sizing) plus 1px borders for delineation — no colors, fonts, theme, or collapse/responsive behavior; issue 03 replaces the whole block with `public/app.css`. An empty `<link rel="icon" href="data:,">` suppresses the automatic favicon 404. `<title>` is a neutral placeholder (no branding — "omni-crud" is an engineering name, ARCH §9.7).
- `public/vendor/htmx.min.js` — **HTMX 2.0.10**, the upstream prebuilt minified `dist/htmx.min.js` (exact patch version, committed).
- `public/vendor/alpine.min.js` — **Alpine.js 3.15.12**, the upstream `dist/cdn.min.js` auto-initializing build (exact patch version, committed).
- `src/app.ts` — `app.get("/")` now returns `public/index.html` via `Bun.file` (per-request read; stays live under `--watch`), replacing the issue-01 text stub. `Content-Type: text/html; charset=utf-8` is set **explicitly** — Bun infers it from the file, but that lazily-computed header is dropped when the Response passes through Hono's router (confirmed: `app.request("/")` returned a `null` content-type without it).
- `biome.json` — excludes `public/vendor` so the third-party minified blobs aren't linted/formatted (also keeps the lint-staged commit hook off them).

Verification (`PORT=8731`):
- `bun run typecheck` → 0 errors; `bun run lint` (Biome, incl. the HTML) → clean. (Also collapsed a stray multi-line ternary in `src/index.ts` that Biome flagged — a pre-existing formatting nit from the uncommitted 3000→3030 port edit, not from this issue.)
- `app.request("/")` → **200**, `text/html; charset=utf-8`; body contains `<nav>`/`<main>`/`<form>`, the empty `x-data` root, both `/static/vendor/…` script refs, no CDN URLs, and no leftover stub text.
- **Layout structure** (asserted against the served markup): `.shell` is a flex row at `100vh`; `<nav class="toolbar">` is the fixed-width (`16rem`) left sidebar; the `.content-column` is a flex column with `<main class="content">` (`flex:1 1 auto`, fills) above the bottom-pinned `<form class="prompt">` (`flex:0 0 auto`); DOM order is nav → content-column(main → form); the form has no `hx-post` attribute and is inert via `onsubmit="return false"`.
- `app.request("/static/vendor/htmx.min.js")` → **200**, body is HTMX **2.0.10**; `…/alpine.min.js` → **200**, body is Alpine **3.15.12**.
- Over real HTTP (`curl`): `/` → 200 `text/html` (4093-byte page); both vendored assets → 200 with `text/javascript` (51238 / 46346 bytes).

Remaining: the **visual/console** check is a manual browser load (this repo has no browser test harness; the agent couldn't get a browser session — no Chrome extension connected, and the screen-access dialog timed out). The layout is verified structurally above; to confirm visually, run `PORT=8731 bun run dev` and open `http://localhost:8731/` — you should see the empty left sidebar, the empty content area filling the rest, and the prompt input pinned across the bottom of the content column, with a clean DevTools console. Changes left uncommitted pending the usual go-ahead.
