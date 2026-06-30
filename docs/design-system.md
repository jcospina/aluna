# Aluna Design System

The practical reference coding agents consult before adding UI. Decisions and
their *why* live in [docs/adr/0001](adr/0001-product-style-and-voice.md);
language and product voice live in [CONTEXT.md](../CONTEXT.md). **The source of
truth for token values is `public/app.css`** — this table mirrors it; if they
ever disagree, the CSS wins.

This file currently describes the authored shell. Module 3 promotes the same
tokens into the closed generated-presentation contract from
[ADR-0005](adr/0005-opinionated-capability-ui-design-contract-and-gate.md):
generated item markup may use only allow-listed semantic/primitive classes,
whose implementations consume these tokens. The platform modal, list container
(with its closed `feed | grid` collection-layout modes, selected per capability
via `ui_intent.collection.layout`), form, field renderers, and accessible item
wrapper are added here when Module 3 is implemented; their exact interfaces are
intentionally left to that Plan.

The style is **subtler neobrutalism on a Paper & Ink palette**, derived from
[`momo`](https://github.com/jcospina/momo) and turned *down* for a quieter, PostHog-like register.

## Tokens

### Color — Paper & Ink

| Token | Value | Role |
| --- | --- | --- |
| `--color-bg` | `oklch(95% 0.025 85)` | warm cream page; the field everything sits on |
| `--color-surface` | `oklch(98% 0.012 85)` | warm near-white; sidebar, fields, controls |
| `--color-text` | `oklch(18% 0.02 60)` | warm near-black ink; text, borders, shadows |
| `--color-text-muted` | `mix(text, surface 25%)` | secondary text |
| `--color-text-subtle` | `mix(text, surface 45%)` | placeholders, faint detail |
| `--color-border` | `mix(text, surface 25%)` | 1px softened-ink borders |
| `--color-shadow` | `mix(text, transparent 82%)` | low-contrast hard-shadow ink |
| `--color-accent` | `oklch(63% 0.16 38)` | terracotta primary — focus rings, wordmark dot |
| `--color-accent-secondary` | `oklch(40% 0.06 250)` | deep blue — *reserved* for capabilities |
| `--color-text-on-secondary` | `oklch(98% 0.012 85)` | ink-on-secondary — *reserved* |
| `--color-info` | `oklch(75% 0.1 195)` | *reserved* |
| `--color-feature` | `oklch(82% 0.13 90)` | *reserved* |
| `--color-warm` | `oklch(82% 0.12 75)` | *reserved* |

Status tones (error/success) are intentionally **omitted** — the inert shell
surfaces no errors yet. Add them additively when a capability needs them. The
same goes for a dark theme: because these are *semantic* tokens, dark is a future
additive `:root` override — no switching machinery exists or is needed.

### Typography — Outfit (vendored)

Outfit is vendored as one variable woff2 (`public/fonts/outfit-variable.woff2`,
OFL-licensed, wght axis) via a single `@font-face` with `font-display: swap`.
Fallback stack: `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue",
Arial, sans-serif`.

| Token | Value |
| --- | --- |
| `--font-sans` | `"Outfit", system-ui, …` |
| `--type-xs … --type-xxl` | `0.75 / 0.875 / 1 / 1.25 / 1.5 / 2 rem` |
| `--weight-regular / --weight-bold` | `400 / 700` (300/800/900 also on the axis) |
| `--body`, `--body-emph` | `400/700 1rem/1.5` |
| `--h1 / --h2 / --h3` | `2 / 1.5 / 1.25 rem`, bold |
| `--meta` | `0.875rem/1.4`, regular |
| `--type-wordmark` | `clamp(1.5rem, 1.1rem + 1.6vw, 2.25rem)` — wordmark only |

`clamp()` is reserved for the wordmark (and later the emphatic pet copy) — body
type uses the fixed scale.

### Spacing, radius, shadow, motion

| Group | Tokens |
| --- | --- |
| Spacing (8px base) | `--space-0_5:4 --space-1:8 --space-2:16 --space-3:24 --space-4:32 --space-6:48 --space-8:64` |
| Border / radius | `--border-width:1px`; `--radius-sm:5px --radius-md:10px --radius-pill:999px` |
| Shadow | `--shadow-sm:2px 2px 0` · `--shadow-md:4px 4px 0` · `--shadow-none:none` (down-right, low-contrast) |
| Motion | `--ease-pop:cubic-bezier(.2,.8,.2,1)`; durations `120 / 160 / 200 / 300ms` |

## The neobrutalism dial (turned down from momo)

| Aspect | momo (loud) | Aluna (subtler) |
| --- | --- | --- |
| Borders | 2–4px ink, on every control/panel | **1px** softened-ink, **structural surfaces only** |
| Shadow offset | left-down `-2 / -6 / -12 / -16px` | **down-right** `2px / 4px`, low-contrast, **used sparingly** |
| Press travel | 3–6px | **gentle 1–2px** |
| Radius | 10px | 10px (kept) |
| Display face | Bungee Shade logo | **none** — wordmark is typographic Outfit |

## Clean, not boxed

Borders appear **only where they earn it** — the prompt field, form controls —
**never a frame around every region**. Regions separate by **background tone +
spacing**. The sole structural divider is the sidebar's `border-right` (one
functional separator between two distinct regions, like Claude/ChatGPT).

The **prompt composer is borderless and sits directly on the page background**
(`--color-bg`) — unlike momo's chat, which sits on a white surface panel. Only the
field inside it carries treatment (`--color-surface` fill, 1px border, 10px
radius, accent focus ring) so it lifts off the page and reads as a composer placed
inside the content area.

## Component treatments

- **Wordmark.** Typographic Outfit, heavier weight, ink-colored (always
  AA-legible) with a single terracotta accent dot. Two homes: content-area top at
  cold-start, sidebar top once the sidebar is present.
- **Prompt field.** `--color-surface` fill, 1px `--color-border`, `--radius-md`,
  `--body` type, comfortable padding, constrained max-width and centered. Hover =
  quiet 1px lift + `--shadow-sm`. Focus = accent border + accent ring, **no
  translate** (the field stays put while typing).
- **Buttons (e.g. the sidebar toggle).** `--color-surface` fill, 1px border,
  `--radius-sm`. Gentle press: `:hover` nudges `translate(1px,1px)` + `--shadow-sm`;
  `:active` presses to `translate(2px,2px)` and flattens the shadow.
- **Sidebar.** `--color-surface`, the one `border-right` divider. Hidden entirely
  at cold-start (no capabilities). Desktop: collapsible to full-width-reclaiming
  zero. Mobile: off-canvas drawer + dismissable backdrop. This is **shell chrome**,
  not deferred product interactivity.

## Do / Don't (adapted from momo's DESIGN.md, quieter dial)

**Do**
- Target semantic tokens (`--color-*`, `--space-*`, …), never raw values.
- Keep borders where they earn their place; let tone + spacing do the separating.
- Use the down-right hard-shadow vocabulary (`--shadow-sm/-md`) sparingly.
- Honor `prefers-reduced-motion`: no press translate, instant collapse/drawer.
- Keep ink-on-paper at AA; if terracotta is used for text, verify contrast or
  restrict it to borders / fills / rings.

**Don't**
- Don't frame every region — no box around the content area or the prompt.
- Don't use momo's 4px borders or its `-8/-12/-16px` shadows (too loud here).
- Don't use soft/blur shadows, glassmorphism, gradient text, or glow.
- Don't use pure black or pure white — use `--color-text` / `--color-surface`.
- Don't surface engineering jargon anywhere (ARCH §9.7); see CONTEXT.md voice.
