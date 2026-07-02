# Closed-value class vocabulary + token-consuming CSS

Status: done

> **HITL — human visual sign-off required.** This authors the design vocabulary
> the whole contract enforces; a human must eyeball the rendered primitives on a
> running preview before it is done. An agent may draft, but visual correctness
> is not delegated to tests alone.

## Epic

Module 3 — Opinionated Capability UI · Epic 3.1 — Closed-value design contract +
primitive vocabulary (`docs/modules.md` §3.1, ADR-0005 §4, PLAN decision 4:
`modules/03-opinionated-ui-design-contract/PLAN.md`; seeds `docs/design-system.md`)

## What to build

Author the closed allow-list of semantic/primitive classes that generated **item
renderer** markup reaches for first, the CSS that implements them by consuming
the existing design tokens, and the **token-discipline rules for the inline
`style` escape hatch** (ADR-0005 §4 as amended 2026-07-01). This is the *value
vocabulary* half of the closed-value design contract — *closed values, open
composition*: the closed thing is the design-**value** space (the tokens), never
how an item arranges one record's own fields. The classes are sensible defaults,
not an exhaustive prediction of every need — this is **not** an all-purpose CSS
framework and rebuilding Tailwind is a non-goal; the escape hatch absorbs the
long tail.

- Author the class categories ADR-0005 §4 opens: **truncation**, **media frame**,
  **intra-item** stack/grid (for arranging one record's *own* fields — distinct
  from the collection layout the platform container owns), Tailwind-style
  **layout utilities** (flex, grid, alignment, gap — gaps consume the spacing
  tokens), and any others the
  module needs. The names are this module's to choose (ADR-0005 leaves them open).
- Each class's CSS consumes tokens from the existing token layer — no raw
  color/spacing/size literals baked into the primitives.
- Author the **thin / regular / thick border-weight tokens** into the token
  layer (the shell's `--border-width: 1px` becomes the thin/regular end of that
  scale; exact names and values are this issue's to choose) and seed them into
  design-system.md alongside the classes.
- Author the **inline-style escape hatch** alongside the classes: when the
  vocabulary doesn't suffice, item markup may carry `style` under **token
  discipline** — the five platform-owned axes are never redeclared raw: color
  only via `var(--color-*)`, font family never declared (Outfit is the default
  and inherits), font size only via the t-shirt scale `var(--type-*)`, spacing
  only via `var(--space-*)`, border weight only via the thin/regular/thick
  border tokens. Properties outside those axes are free;
  radius/shadow/motion tokens are preferred where they fit.
- Seed the vocabulary and the contract into `docs/design-system.md` as the single
  source the runtime enforcer (3.1/02), the injection gallery (3.5), and the
  design-lint rung (3.6) all reference. The contract states what is allowed (the
  classes; token-disciplined `style`) and what is forbidden absolutely:
  off-token values on the five owned axes, fabricated/unknown classes,
  interactive descendants, scripts/event handlers, unsafe field interpolation —
  and inside styles, `url(...)`, position values that escape the item, and field
  values interpolated into a `style` attribute.

## Acceptance criteria

- [x] A named, closed set of semantic/primitive classes is authored, covering at
      least truncation, media frame, intra-item stack/grid, and the layout
      utilities (flex, grid, alignment, gap), each documented
      with its intent
- [x] Every class's CSS consumes design tokens; no raw color/spacing/size literals
      appear in the primitive CSS
- [x] The thin/regular/thick border-weight tokens exist in the token layer and
      the primitives/contract reference them
- [x] `docs/design-system.md` gains the vocabulary + the closed-value contract
      (allowed classes; the token-discipline rules for the inline-`style` escape
      hatch; forbidden constructs enumerated)
- [x] The escape-hatch rules name the five token-owned axes (color, font family,
      type scale, spacing, border weight) with their tokens, and the style-level
      bans (`url(...)`, item-escaping position, field interpolation into `style`)
- [x] A sample item composed only from these classes renders on-brand against the
      tokens (dev preview or static example)
- [x] Human visually signs off that the primitives read as a coherent, on-brand
      product on the running preview before this issue is done

## Blocked by

None - can start immediately

## Implementation notes

Done 2026-07-01. Decisions confirmed with the user: border scale **1 / 2 / 3 px**;
vocabulary naming **Tailwind-style utilities + semantic primitives**; button
variants activate the **full palette**.

- **Border-weight tokens** (`public/css/tokens.css`): `--border-thin:1px ·
  --border-regular:2px · --border-thick:3px`, turned down from the heavier 2/4px
  typical of neobrutalism;
  `--border-width` aliased to `--border-thin` so authored chrome is unchanged.
- **Primitive vocabulary** (`public/css/primitives.css`, imported late in
  `public/app.css` before `a11y.css`): `.stack`/`.cluster`; layout utilities
  (`.flex`/`.grid`/`.flex-col`/`.flex-wrap`/`.items-*`/`.justify-*`/`.gap-*`→
  `--space-*`/`.grid-cols-{2,3}`/`.grow`/`.w-full`); type scale
  (`.text-{xs,sm,lg,xl,bold,muted,subtle}`); truncation
  (`.truncate`/`.line-clamp-{2,3}`); media frame (`.media-frame{,--square,--wide}`).
  Every class consumes tokens; the only literals are arrangement/structure.
- **Closed-value contract** seeded into `docs/design-system.md`: the allow-list
  table, the inline-`style` escape-hatch axis table (the five owned axes + their
  tokens), and the absolute bans. This is the single source the runtime enforcer
  (3.1/02) and the design-lint rung (3.6) key on.
- **Button variants** (added on reviewer feedback — the preview "lacked color"):
  `public/css/components.css` — `.btn` + primary/secondary/info/feature/warm/
  neutral/ghost, activating the palette's accent roles (un-reserved in tokens.css
  and design-system.md). **Platform chrome, not item vocabulary** — the contract
  forbids interactive descendants inside generated items. Text color per fill is
  WCAG-AA verified: ink on the light fills (terracotta 5.0, info 8.8, feature
  10.8, warm 10.6, neutral 17.8), near-white `--color-text-on-secondary` on the
  deep-blue (8.7).
- **Demo wiring**: `public/primitives-preview.html` served at
  `/static/primitives-preview.html` — border swatches, the seven button variants,
  three vocabulary-only sample items, and a token-disciplined escape-hatch item.
  Dev preview for the sign-off; the platform item wrapper (3.2) and generated item
  renderer (3.4) supersede the wrapper stand-in later.

## Verification

- `bunx biome check public/css/*.css public/*.html docs/design-system.md` — clean.
- `bun run dev`, then `curl -sf` on `/static/app.css`, `/static/css/primitives.css`,
  `/static/css/components.css`, `/static/primitives-preview.html` — all `200`;
  `app.css` imports both new layers.
- Contrast ratios computed OKLCH→linear-sRGB→WCAG; all button text ≥ 4.5:1.

## HITL test instructions

- Start: `bun run dev`
- Open: `http://localhost:3030/static/primitives-preview.html`
- Confirms: warm Paper & Ink; border swatches step 1→2→3px; the seven button
  variants render with legible text and press down-right on hover (accent focus
  ring on keyboard tab); the three sample items read on-brand (title truncation,
  URL ellipsis, 2-line clamp, two-up stat grid); the escape-hatch item shows a
  terracotta accent stripe sourced from tokens.

## Comments

- 2026-07-01 — Human visual sign-off given on the running preview (Firefox +
  inline render). Palette activated via `.btn` variants on reviewer feedback.
  Issue done.
