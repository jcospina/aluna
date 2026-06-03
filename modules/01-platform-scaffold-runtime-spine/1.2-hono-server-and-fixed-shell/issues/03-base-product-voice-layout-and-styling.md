# Base product-voice layout & styling

Status: ready-for-agent

## Epic

Module 1 — Platform Scaffold & Runtime Spine · Epic 1.2 — Hono server + the fixed shell
(`docs/modules.md` §1.2, ARCH §6.1, §9.7)

## What to build

Give the shell its layout and a warm, product-voice visual style (ARCH §6.1, §9.7). Realize the semantic skeleton from issue 02 as the **shell**: a **collapsible left sidebar** (the capability toolbar) beside a **content column** whose **prompt bar is pinned to the bottom** and whose **content area fills the rest** — the Claude/ChatGPT layout. Apply base styling that reads as a friendly consumer product, not an engineering tool.

This is the visual foundation everything generated later renders inside of, so keep it neutral and unopinionated about any specific capability. Per ARCH §9.7, no internals language ever surfaces in the UI ("handler", "migration", "spec", etc.) — and note that even the project's own name **"omni-crud" is an engineering name** (it contains "CRUD") and must not appear as user-facing branding.

Key pieces:

- **Layout:** collapsible left sidebar + content column with a bottom-pinned prompt bar; the content area fills the remaining space.
- **Typography:** the **Outfit** typeface, **vendored locally** (`public/fonts/`, `@font-face`, `font-display: swap`, system-stack fallback) — no build step, no CDN.
- **Theme:** **light only**, expressed through **semantic CSS custom-property tokens** (`--color-bg`, `--color-surface`, `--color-text`, `--color-accent`, …) in a single `public/app.css`, structured so a dark theme is later a purely additive override.
- **Sidebar collapse — shell chrome:** desktop full-collapse to reclaim content width; mobile off-canvas drawer + backdrop. This is presentation chrome (an Alpine `open` state on the root from issue 02), **not** the product interactivity the epic defers — state that explicitly so it isn't flagged as scope creep. Persisting collapse state across reloads is optional.
- **Cold start (zero capabilities):** the sidebar is hidden, the prompt bar shows a friendly product-voice `placeholder`, and the content area shows an **animated orb** — a colorful circle with fluid, nebula-like interior motion (in the spirit of the ElevenLabs voice orb / ChatGPT voice mode).
- **The orb is a named, reusable shell component** with double duty: the cold-start hero here, and the **"something is being built" indicator** that M2's narration drives. Build it once, reuse it there. Its **rendering technique is deliberately open** (pure-CSS layered-gradient nebula is the zero-JS default; canvas or a small vanilla-WebGL shader if we want true fluid motion — decided when built).
- **Accessibility:** all animation honors `prefers-reduced-motion` with a calm/static fallback.

No functional onboarding/welcome flow here — that depends on the prompt actually working and belongs to Module 2. Keep the cold-start content deliberately minimal (orb + inviting prompt placeholder) so "empty" feels intentional and friendly, not built-out.

## Acceptance criteria

- [ ] The three regions are laid out as the shell: collapsible left sidebar (capability toolbar) + content column with the prompt bar pinned to the bottom and the content area filling the rest
- [ ] **Outfit** is vendored locally (`public/fonts/`, `@font-face`, `font-display: swap`, system fallback); no CDN, no build step
- [ ] Base styling applied via **semantic CSS custom-property tokens** in a single `public/app.css` — **light theme only**, structured so dark is a later additive override
- [ ] **Sidebar collapse/expand** works as shell chrome: desktop full-collapse for content width; mobile off-canvas drawer + backdrop (explicitly classified as chrome, not the deferred product interactivity)
- [ ] **Cold start** (no capabilities): sidebar hidden, inert prompt bar with a friendly product-voice `placeholder`, animated **orb** in the content area
- [ ] The orb is a **named, reusable component** (cold-start hero now; reused as M2's build indicator); rendering technique left open
- [ ] All animation honors **`prefers-reduced-motion`** with a calm/static fallback
- [ ] **No engineering/internal jargon** visible anywhere (ARCH §9.7), and **no product wordmark/branding** this epic (the repo name "omni-crud" is not user-facing)
- [ ] Styles, fonts, and the orb ship static from `/static/…` with **no build step**
- [ ] Layout holds up at common desktop and mobile viewport widths

## Blocked by

- modules/01-platform-scaffold-runtime-spine/1.2-hono-server-and-fixed-shell/issues/02-fixed-shell-page-with-three-inert-regions.md

## Comments

**2026-06-02 — design decisions (grilling session).** Resolved the open design tree for this issue. Highlights and rationale:

- **Layout = sidebar shell.** Left sidebar for the capability toolbar (it's the thing that *grows*, so give it a home that scales), content column with bottom-pinned prompt. Chosen over a top toolbar strip precisely because the toolbar grows; empty-state hiding and mobile collapse are both trivial and didn't drive the choice. A collapsible sidebar also buys content width on demand.
- **Prompt bar pinned to the bottom of the content column** — proximity reinforces the context-scoping (ARCH §6.1: the prompt scopes to the active capability), gives the conversational "type below / watch the build above" gestalt, and is thumb-friendly on mobile.
- **Outfit, vendored locally.** Typography is the highest-leverage warmth lever and "look how friendly" is part of the thesis (ARCH §2, §9.7); vendoring keeps it build-free and offline.
- **Light theme only**, via semantic tokens, with dark deferred as an additive override (consistent with the project's additive-only ethos). Palette values decided by the owner/implementer.
- **Sidebar collapse classified as shell chrome** (not the deferred product interactivity): no server round-trip, no capability logic; it's the honest way to satisfy "holds up at mobile widths." Desktop full-collapse (no icon rail — entries are text labels with no icons yet); mobile drawer + backdrop. State persistence optional.
- **Cold-start orb** (see What to build): reusable component, double-duty as M2's build indicator, rendering technique open, respects reduced motion.
- **No branding this epic.** "omni-crud" is an engineering name (contains "CRUD") and would violate §9.7; defer a wordmark until there's a friendly user-facing product name, then home it atop the sidebar.

Cross-cutting defaults (apply here and in issue 02): icons are **inline SVG** (no icon font/library); vendored libraries under `public/vendor/`, Outfit under `public/fonts/`, authored styles in `public/app.css`, authored shell JS (Alpine glue / the orb) in `public/app.js` (or a dedicated `public/orb.js`); everything served from `/static/…`.

**Open / deferred sub-trees:** orb rendering technique (CSS vs canvas vs WebGL); dark theme; product name + wordmark; collapse-state persistence.
