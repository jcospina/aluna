# Base product-voice layout & styling

Status: ready-for-agent

## Epic

Module 1 — Platform Scaffold & Runtime Spine · Epic 1.2 — Hono server + the fixed shell
(`docs/modules.md` §1.2, ARCH §6.1, §9.7)

## What to build

Give the shell its base layout and a friendly, product-voice visual style (ARCH §6.1, §9.7). Lay the three regions out into a coherent page — prompt bar placement, the toolbar as the navigation strip, the content area as the main surface — and apply base styling that reads as a warm consumer product, not an engineering tool.

This is the visual foundation everything generated later renders inside of, so keep it neutral and unopinionated about any specific capability. Per ARCH §9.7, no internals language ever surfaces in the UI ("handler", "migration", "spec", etc.).

## Acceptance criteria

- [ ] The three regions are laid out into a coherent page (prompt bar, toolbar strip, content surface)
- [ ] Base styling applied — typography, spacing, color — that reads as a friendly product, not a dev tool
- [ ] No engineering/internal jargon visible anywhere in the UI (ARCH §9.7 product-voice rule)
- [ ] Styles ship from the served static assets with no build step required
- [ ] Layout holds up at common desktop and mobile viewport widths

## Blocked by

- modules/01-platform-scaffold-runtime-spine/1.2-hono-server-and-fixed-shell/issues/02-fixed-shell-page-with-three-inert-regions.md
