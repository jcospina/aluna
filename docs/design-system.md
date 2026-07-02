# Aluna Design System

The practical reference coding agents consult before adding UI. Decisions and
their *why* live in [docs/adr/0001](adr/0001-product-style-and-voice.md);
language and product voice live in [CONTEXT.md](../CONTEXT.md). **The source of
truth for token values is `public/app.css`** — this table mirrors it; if they
ever disagree, the CSS wins.

This file currently describes the authored shell. Module 3 promotes the same
tokens into the closed generated-presentation contract from
[ADR-0005](adr/0005-opinionated-capability-ui-design-contract-and-gate.md) (as
amended 2026-07-01): generated item markup reaches first for allow-listed
semantic/primitive classes whose implementations consume these tokens —
including Tailwind-style **layout utilities** (flex, grid, alignment, gap) so
common arrangement needs no `style` at all. The vocabulary is sensible
defaults, **not an all-purpose CSS framework**; when it
doesn't suffice, inline `style` is a **token-disciplined escape
hatch** — color only via `--color-*`, font family never declared (Outfit
inherits), font size only via the t-shirt scale `--type-*`, spacing only via
`--space-*`, border weight only via the thin/regular/thick border scale;
properties outside those five axes are free, and executable markup
stays forbidden. The platform modal, list container
(with its closed `feed | grid` collection-layout modes, selected per capability
via `ui_intent.collection.layout`), form, field renderers, and accessible item
wrapper are added here when Module 3 is implemented; their exact interfaces are
intentionally left to that Plan.

The style is **subtler neobrutalism on a Paper & Ink palette** — loud
neobrutalism turned *down* for a quieter, PostHog-like register.

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
| `--color-accent` | `oklch(63% 0.16 38)` | terracotta primary — focus rings, wordmark dot, `.btn--primary` |
| `--color-accent-secondary` | `oklch(40% 0.06 250)` | deep blue — `.btn--secondary` |
| `--color-text-on-secondary` | `oklch(98% 0.012 85)` | near-white ink-on-secondary (AA on the deep-blue fill) |
| `--color-info` | `oklch(75% 0.1 195)` | `.btn--info` |
| `--color-feature` | `oklch(82% 0.13 90)` | `.btn--feature` |
| `--color-warm` | `oklch(82% 0.12 75)` | `.btn--warm` |

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
| Border / radius | Weight scale `--border-thin:1px · --border-regular:2px · --border-thick:3px` (turned down from the heavier 2/4px weights typical of neobrutalism; `--border-width` aliases `--border-thin` so authored chrome is unchanged); `--radius-sm:5px --radius-md:10px --radius-pill:999px` |
| Shadow | `--shadow-sm:2px 2px 0` · `--shadow-md:4px 4px 0` · `--shadow-none:none` (down-right, low-contrast) |
| Motion | `--ease-pop:cubic-bezier(.2,.8,.2,1)`; durations `120 / 160 / 200 / 300ms` |

## The neobrutalism dial (turned down)

| Aspect | Loud neobrutalism | Aluna (subtler) |
| --- | --- | --- |
| Borders | 2–4px ink, on every control/panel | **1px** softened-ink, **structural surfaces only** |
| Shadow offset | left-down `-2 / -6 / -12 / -16px` | **down-right** `2px / 4px`, low-contrast, **used sparingly** |
| Press travel | 3–6px | **gentle 1–2px** |
| Radius | 10px | 10px (kept) |
| Display face | Decorative shaded logo | **none** — wordmark is typographic Outfit |

## Clean, not boxed

Borders appear **only where they earn it** — the prompt field, form controls —
**never a frame around every region**. Regions separate by **background tone +
spacing**. The sole structural divider is the sidebar's `border-right` (one
functional separator between two distinct regions, like Claude/ChatGPT).

The **prompt composer is borderless and sits directly on the page background**
(`--color-bg`) — not raised on a white surface panel. Only the
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
- **Button variants (`.btn`, [`public/css/components.css`](../public/css/components.css)).**
  The palette's accent roles, activated as a platform button component with the
  same gentle press. Variants: `.btn--primary` (terracotta `--color-accent`),
  `.btn--secondary` (deep blue `--color-accent-secondary`), `.btn--info`,
  `.btn--feature`, `.btn--warm`, `.btn--neutral` (surface-weight default), and
  `.btn--ghost` (no fill until hover). Text color per fill is **WCAG-AA verified**
  — ink on the light fills (terracotta 5.0, info 8.8, feature 10.8, warm 10.6),
  the near-white `--color-text-on-secondary` on the dark deep-blue (8.7); each
  filled variant carries a darker edge of its own hue. These are **platform
  chrome** (the "New X" / Save / Delete affordances of epics 3.2 / M4), **never**
  emitted inside generated item markup — the closed-value contract forbids
  interactive descendants there.
- **Sidebar.** `--color-surface`, the one `border-right` divider. Hidden entirely
  at cold-start (no capabilities). Desktop: collapsible to full-width-reclaiming
  zero. Mobile: off-canvas drawer + dismissable backdrop. This is **shell chrome**,
  not deferred product interactivity.

## Do / Don't (quieter dial)

**Do**
- Target semantic tokens (`--color-*`, `--space-*`, …), never raw values.
- Keep borders where they earn their place; let tone + spacing do the separating.
- Use the down-right hard-shadow vocabulary (`--shadow-sm/-md`) sparingly.
- Honor `prefers-reduced-motion`: no press translate, instant collapse/drawer.
- Keep ink-on-paper at AA; if terracotta is used for text, verify contrast or
  restrict it to borders / fills / rings.

**Don't**
- Don't frame every region — no box around the content area or the prompt.
- Don't use heavy 4px borders or big `-8/-12/-16px` shadows (too loud here).
- Don't use soft/blur shadows, glassmorphism, gradient text, or glow.
- Don't use pure black or pure white — use `--color-text` / `--color-surface`.
- Don't surface engineering jargon anywhere (ARCH §9.7); see CONTEXT.md voice.

## Capability primitive vocabulary + closed-value contract (Module 3 · epic 3.1)

The closed-value design contract for **generated item-renderer markup** (ADR-0005
§4, amended 2026-07-01; PLAN decision 4). *Closed values, open composition* — the
closed thing is the design-**value** space (the tokens) and the executable
surface, **never** how an item arranges one record's own fields. This is the
single source of truth: the CSS lives in [`public/css/primitives.css`](../public/css/primitives.css),
the runtime **allow-list enforcer** (3.1/02) and the fail-closed **design-lint
gate rung** (3.6) both key on the vocabulary below. It is **sensible defaults, not
an all-purpose CSS framework** — rebuilding Tailwind is a non-goal; the escape
hatch absorbs the long tail. Eyeball it on the running app at
[`/static/primitives-preview.html`](../public/primitives-preview.html).

### The allow-list (classes)

Every class consumes tokens — no raw color/spacing/size lives in the primitives.
Arrangement values (`flex`, `grid`, `1fr` tracks, `100%`) are structure, not
design values, so they are literal.

| Category | Classes | Intent |
| --- | --- | --- |
| **Intra-item composition** | `.stack` · `.cluster` | Arrange one record's own fields — `.stack` flows top-to-bottom, `.cluster` rows-and-wraps; both carry an on-token default gap (`--space-1`). Distinct from the platform's `feed \| grid` *collection* layout. |
| **Layout — display/direction** | `.flex` · `.grid` · `.flex-col` · `.flex-wrap` | Tailwind-style low-level knobs for the long tail of arrangement. |
| **Layout — alignment** | `.items-{start,center,end,baseline}` · `.justify-{start,center,between,end}` | Cross- and main-axis alignment. |
| **Layout — gap** | `.gap-{0_5,1,2,3}` | Maps 1:1 onto the spacing tokens (`.gap-2` → `--space-2`). |
| **Layout — grid tracks / sizing** | `.grid-cols-{2,3}` · `.grow` · `.w-full` | Equal intra-item columns (`minmax(0,1fr)`), flexible fill, full width. |
| **Type scale + emphasis** | `.text-{xs,sm,lg,xl}` · `.text-bold` · `.text-muted` · `.text-subtle` | Set type/weight/secondary color on-token instead of reaching for `style`. Body (`--type-md`) is the inherited default, so it needs no class. |
| **Truncation** | `.truncate` · `.line-clamp-2` · `.line-clamp-3` | Keep long field values from breaking layout — one ellipsised line, or an N-line clamp. |
| **Media frame** | `.media-frame` · `.media-frame--square` · `.media-frame--wide` | Ratio-locked, clipped box for an image/video field (default 4:3, plus 1:1 and 16:9), with an on-token placeholder tint; the direct-child media covers. |

### The inline-`style` escape hatch (token discipline)

When the vocabulary doesn't suffice, item markup may carry inline `style` — but the
**five platform-owned axes are never redeclared with raw values**:

| Owned axis | Allowed only via |
| --- | --- |
| Color | `var(--color-*)` |
| Font family | **never declared** — Outfit is the default and inherits from the shell |
| Type scale | `var(--type-*)` (the t-shirt tokens) |
| Spacing | `var(--space-*)` |
| Border weight | `var(--border-thin \| --border-regular \| --border-thick)` |

Properties **outside** those axes (arrangement, alignment, aspect-ratio, width, …)
are free; the `--radius-*`, `--shadow-*`, and motion (`--ease-*`, `--duration-*`)
tokens exist and are **preferred** where they fit.

### Forbidden absolutely

Unrelaxed by the 2026-07-01 amendment (the escape hatch relaxed only *off-token
style*, never the executable surface):

- **Off-token values on the five owned axes** — a raw hex/rgb color, a px/rem font
  size or spacing, a raw border width.
- **Fabricated or unknown classes** — anything outside the allow-list above.
- **Interactive descendants** (the platform owns the accessible trigger and modal),
  **scripts / event handlers** (`<script>`, `on*=`), and **unsafe interpolation of
  user fields** into markup.
- **Inside `style`:** `url(...)` values, `position` values that escape the item's
  bounds, and any **field value interpolated into a `style` attribute** (styles are
  literal in the renderer source).

Enforced twice: at **build time** by the design-lint gate rung (3.6, rendering
synthetic + hostile values within the declared collection layout) and at **render
time** by the allow-list enforcer the presentation adapter applies to every record
(3.1/02) — so a dynamic field value can never become executable markup even after
build-time validation passes.
