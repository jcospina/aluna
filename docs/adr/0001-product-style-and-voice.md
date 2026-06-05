# 0001 — Product style & voice: subtler neobrutalism on Paper & Ink

Status: accepted

## Decision

Aluna's base visual style is **subtler neobrutalism on a Paper & Ink palette**,
typeset in **Outfit** (vendored locally), expressed through semantic CSS
custom-property tokens in a single `public/app.css` with **one `:root` and no
theming machinery** (light theme only). The product speaks in a **warm,
first-person product voice** that never exposes internals (ARCH §9.7). The
**Aluna** wordmark is introduced as the user-facing brand. **The pet** (the
anthropomorphic spark of Aluna) is **specified but deferred** — zero
implementation now.

## Context / why

- **Derived from [`momo`](https://github.com/jcospina/momo): The token source is momo's **Paper & Ink
  theme** (`themes.config.ts`, the `paper` entry) — *not* the loud Sunbeam
  default. Paper & Ink is already quiet: warm cream page, warm near-black ink,
  terracotta primary. Its full role set (text/surface/background, primary,
  secondary, info, feature, warm) is carried over, re-homed under `--color-*`
  names; some roles are reserved for capabilities to use later.
- **"Subtler" is achieved through shadows and borders, not color** — a quieter,
  PostHog-like register. We turn momo's dial *down*: 1px softened-ink borders on
  structural surfaces only (momo uses 2–4px), two-step **down-right** hard shadows
  `2px/4px` (momo uses left-down `-2/-6/-12/-16px`), gentle 1–2px press (momo
  moves 3–6px), 10px radius retained.
- **Single `:root`, no theming machinery.** The owner is locking Paper & Ink, so
  no `data-schema`, theme registry, or dark stylesheet. Using *semantic* tokens
  still leaves a dark theme as a purely additive future override — we satisfy the
  "structured for dark later" requirement without building any switching
  machinery.
- **Outfit, vendored locally.** Typography is the highest-leverage warmth lever
  and "look how friendly" is part of the thesis (ARCH §2, §9.7). Vendoring the
  OFL-licensed variable woff2 keeps it build-free and offline (no CDN). momo's
  Bungee Shade logo face is **not** carried over — the wordmark is typographic in
  Outfit, no separate display face.
- **Product voice** = warm / encouraging / gently curious, first person, zero
  internals jargon (ARCH §9.7). Authored as durable guidance (in `CONTEXT.md`)
  because it steers every future coding agent's copy.
- **Pet deferred.** The thesis is the self-building app; the pet is a delight
  layer to build *after* the spine works. It is fully specified (concept,
  placement, state vocabulary, rendering constraints, reduced-motion) in the
  originating issue so a future issue can implement it cold. Its name stays TBD
  pending verification of an authentic Kogi word — no fabrication.

## Consequences

- A dark theme, status/tone color tokens (error/success), and the pet are all
  **additive** future work — none require reworking what ships here.
- Coding agents must consult `docs/design-system.md` (the practical reference) and
  `CONTEXT.md` (language + voice) before adding UI; the CSS in `public/app.css` is
  the source of truth for token *values*.
