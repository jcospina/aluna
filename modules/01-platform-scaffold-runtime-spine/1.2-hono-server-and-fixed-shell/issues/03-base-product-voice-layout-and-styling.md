# Base product-voice layout & styling

Status: done

## Epic

Module 1 — Platform Scaffold & Runtime Spine · Epic 1.2 — Hono server + the fixed shell
(`docs/modules.md` §1.2, ARCH §6.1, §9.7)

## What to build

Give the shell its layout and a warm, product-voice visual style (ARCH §6.1, §9.7). Realize the semantic skeleton from issue 02 as the **shell**: a **collapsible left sidebar** (the capability toolbar) beside a **content column** whose **prompt bar is pinned to the bottom** and whose **content area fills the rest** — the Claude/ChatGPT layout. Apply a base style that reads as a friendly consumer product, not an engineering tool.

The visual language is **subtler neobrutalism on a Paper & Ink palette**, derived from the `momo` design system (`~/personal/momo`) — specifically its **Paper & Ink theme** (`src/lib/theme/themes.config.ts`), turned *down*: thinner borders, small hard shadows, gentle press. This is the visual foundation everything generated later renders inside of, so keep it neutral and unopinionated about any specific capability.

The product is named **Aluna** (a Kogi word for the realm of thought/spirit from which the material world is born — a precise metaphor for a platform where stated intent becomes a working app). The repo name **"omni-crud" remains an engineering name** (it contains "CRUD") and must never appear as user-facing branding (ARCH §9.7); the **Aluna** wordmark is the user-facing brand and is introduced this issue.

Per ARCH §9.7, no internals language ever surfaces in the UI ("handler", "migration", "spec", "compile", etc.).

### Scope

**In scope — implemented this issue:**

- **Layout:** collapsible left sidebar + content column with a bottom-pinned prompt bar; content area fills the remaining space.
- **Typography:** the **Outfit** typeface, **vendored locally** (`public/fonts/`, `@font-face`, `font-display: swap`, system-stack fallback) — no build step, no CDN.
- **Token system + base style:** subtler-neobrutalism on Paper & Ink, expressed through **semantic CSS custom-property tokens** in a single `public/app.css`. **Light theme only**, **single `:root`, no theming machinery** (no `data-schema`, no theme registry, no dark stylesheet) — but using semantic tokens, so a dark theme remains a purely additive future override for free.
- **Sidebar collapse — shell chrome:** desktop full-collapse to reclaim content width; mobile off-canvas drawer + backdrop. This is presentation chrome (an Alpine `open` state on the root from issue 02), **not** the product interactivity the epic defers. Persisting collapse state is optional.
- **Aluna wordmark:** introduced this issue. Two homes for two states — content-area top at cold-start (sidebar hidden), sidebar top once the sidebar is present. Typographic in Outfit (heavier weight); no separate display face, no logo mark yet.
- **Cold start (zero capabilities):** sidebar hidden; content area shows the **Aluna wordmark on top + a neutral centered placeholder**; the inert prompt bar carries a **friendly product-voice `placeholder`** (the one bit of voice copy that ships).
- **Accessibility:** all animation honors `prefers-reduced-motion` with a calm/static fallback.

**In scope — defined as durable guidance (authored, not "built"):**

- **Product voice** — persona, do/don'ts, examples (see *Product voice* below). It guides every future coding agent's copy and design, so it lives in a durable doc, not buried here.
- **The pet** — fully specified below, so a future issue implements it cold.

**Defined but NOT implemented (deferred):**

- **The pet** (replaces the old "animated orb"). An anthropomorphic *spark of Aluna* that walks and talks at the prompt bar. Its concept, placement, states, rendering constraints, and reduced-motion behaviour are written down (see *The pet* below) — but **zero implementation effort this issue**. The thesis is the self-building app; the pet is a delight layer to build *after* the spine works. Its name is intentionally **TBD** (must be an authentic Kogi word related to Aluna — do not fabricate one).
- **No greeting copy, no cold-start hero animation, no reserved pet DOM slot.** When the pet lands, the cold-start layout switches then.

No functional onboarding/welcome flow here — that depends on the prompt actually working and belongs to Module 2. Keep cold-start deliberately minimal so "empty" feels intentional and friendly, not built-out.

## Acceptance criteria

- [x] The three regions are laid out as the shell: collapsible left sidebar (capability toolbar) + content column with the prompt bar pinned to the bottom and the content area filling the rest
- [x] **Outfit** is vendored locally (`public/fonts/`, `@font-face`, `font-display: swap`, system fallback); no CDN, no build step
- [x] Base style applied via **semantic CSS custom-property tokens** in a single `public/app.css` — **light theme only, single `:root`, no theming machinery**, structured (semantic tokens) so dark is a later additive override
- [x] The style reads as **subtler neobrutalism on Paper & Ink** (Paper & Ink palette; 1px softened-ink borders on structural surfaces only; two-step hard shadows `2px/4px` down-right, low-contrast; gentle 1–2px press; 10px radius)
- [x] **Sidebar collapse/expand** works as shell chrome: desktop full-collapse for content width; mobile off-canvas drawer + backdrop (explicitly classified as chrome, not deferred product interactivity)
- [x] **Aluna wordmark** present: content-area top at cold-start, sidebar top when the sidebar is shown; typographic in Outfit
- [x] **Cold start** (no capabilities): sidebar hidden, Aluna wordmark + neutral centered placeholder in the content area, inert prompt bar with a friendly product-voice `placeholder`
- [x] All animation honors **`prefers-reduced-motion`** with a calm/static fallback
- [x] **No engineering/internal jargon** visible anywhere (ARCH §9.7); "omni-crud" never user-facing
- [x] Styles, fonts, and assets ship static from `/static/…` with **no build step**
- [x] Layout holds up at common desktop and mobile viewport widths
- [x] **Durable docs created:** `CONTEXT.md`, `docs/adr/0001-product-style-and-voice.md`, `docs/design-system.md` (see plan)
- [x] **The pet is fully documented as a deferred component** (concept, placement, states, rendering constraints, reduced-motion) — and *not* implemented

## Implementation plan

Order is deliberate: write the durable references first (so the build follows them), then tokens/fonts, then layout, then interactions, then cold-start/responsive, then a11y. All output is static and build-free; assets are served by Hono's `/static/*` → `public/*` mapping (`src/app.ts`).

### Phase 0 — Durable docs (the references future agents consult)

Create three files. The repo currently has none of these; `docs/agents/domain.md` expects them to be created lazily exactly at this kind of decision point.

**0.1 `CONTEXT.md`** (repo root) — the single-context domain doc.
- **Glossary** (use these terms verbatim everywhere after): *Aluna* (the product; Kogi = realm of thought from which the material world is born), *shell*, *capability*, *capability toolbar / sidebar*, *prompt bar*, *content area*, *the pet* (a spark of Aluna; see issue), *product voice*.
- **Product framing** (2–3 sentences): a platform where stated intent becomes a working app; the UI must always read as a friendly consumer product, never an engineering tool (ARCH §9.7).
- **Product voice guide** — paste the *Product voice* section below (persona, do/don'ts, examples).

**0.2 `docs/adr/0001-product-style-and-voice.md`** — the decision record.
- Decision: subtler-neobrutalism on **Paper & Ink**, **Outfit**, **single `:root` / no theming**, product-voice persona, **pet deferred**, **Aluna wordmark introduced**.
- Context/why: derived from `momo` (`~/personal/momo`, `DESIGN.md` + `src/lib/theme/themes.config.ts` **Paper & Ink theme**), turned down for a quieter PostHog-like register; light-only because the owner is locking Paper & Ink; pet deferred because the thesis is the self-building app.
- Cite the referenced momo Paper & Ink palette as the token source.

**0.3 `docs/design-system.md`** — the practical reference coding agents consult.
- Token table (mirrors `public/app.css`; values' source of truth is the CSS).
- The neobrutalism dial: 1px softened-ink borders (structural surfaces only), two-step `2px/4px` down-right hard shadows (low-contrast, used sparingly), gentle 1–2px press, 10px radius.
- **Clean, not boxed:** borders only where they earn it (the prompt field, form controls), never a frame around every region; regions separate by background tone + spacing. The prompt composer is borderless and sits directly on the page background (`--color-bg`) — unlike momo's chat, which sits on a white surface panel.
- Component treatments + do/don'ts (adapt momo's `DESIGN.md` rules to the *quieter* dial; drop momo's 4px borders and `-8/-12/-16` shadows).

### Phase 1 — Tokens & fonts (`public/app.css`, `public/fonts/`)

**1.1 Vendor Outfit.** Commit the Outfit **variable** woff2 (wght axis; OFL-licensed) to `public/fonts/`. One `@font-face`:

```css
@font-face {
  font-family: "Outfit";
  src: url("/static/fonts/outfit-variable.woff2") format("woff2-variations");
  font-weight: 100 900;
  font-display: swap;
}
```

System fallback stack: `"Outfit", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.

**1.2 Token `:root`** — the actual tokens (Paper & Ink re-homed under `--color-*`; non-color tokens keep momo-style names). Exact OKLCH values remain owner-tunable.

```css
:root {
  /* ── Color — Paper & Ink (momo themes.config.ts) ───────────────── */
  --color-bg:               oklch(95% 0.025 85);   /* warm cream page    */
  --color-surface:          oklch(98% 0.012 85);   /* warm near-white    */
  --color-text:             oklch(18% 0.02 60);    /* warm near-black ink*/
  --color-text-muted:       color-mix(in oklch, var(--color-text), var(--color-surface) 25%);
  --color-text-subtle:      color-mix(in oklch, var(--color-text), var(--color-surface) 45%);
  --color-border:           color-mix(in oklch, var(--color-text), var(--color-surface) 25%);
  --color-shadow:           color-mix(in oklch, var(--color-text), transparent 82%);
  --color-accent:           oklch(63% 0.16 38);    /* terracotta (primary) — EXERCISED: focus, wordmark accent */
  /* Reserved roles (defined now; capabilities use them later — additive) */
  --color-accent-secondary: oklch(40% 0.06 250);   /* deep blue          */
  --color-text-on-secondary:oklch(98% 0.012 85);
  --color-info:             oklch(75% 0.1 195);
  --color-feature:          oklch(82% 0.13 90);
  --color-warm:             oklch(82% 0.12 75);
  /* Status tones (error/success) intentionally omitted — the inert shell
     surfaces no errors yet; add additively when a capability needs them. */

  /* ── Typography ────────────────────────────────────────────────── */
  --font-sans: "Outfit", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --type-xs: 0.75rem; --type-sm: 0.875rem; --type-md: 1rem;
  --type-lg: 1.25rem; --type-xl: 1.5rem;  --type-xxl: 2rem;
  --weight-regular: 400; --weight-bold: 700;       /* 300/800/900 available on the var font */
  --body:      var(--weight-regular) var(--type-md)/1.5  var(--font-sans);
  --body-emph: var(--weight-bold)    var(--type-md)/1.5  var(--font-sans);
  --h1: var(--weight-bold) var(--type-xxl)/1.2 var(--font-sans);
  --h2: var(--weight-bold) var(--type-xl)/1.3  var(--font-sans);
  --h3: var(--weight-bold) var(--type-lg)/1.35 var(--font-sans);
  --meta: var(--weight-regular) var(--type-sm)/1.4 var(--font-sans);
  /* clamp() reserved for the wordmark (and later the emphatic pet copy) only */
  --type-wordmark: clamp(1.5rem, 1.1rem + 1.6vw, 2.25rem);

  /* ── Spacing (8px base) ────────────────────────────────────────── */
  --space-1: 8px;  --space-0_5: 4px; --space-2: 16px;
  --space-3: 24px; --space-4: 32px;  --space-6: 48px; --space-8: 64px;

  /* ── Borders / radius ──────────────────────────────────────────── */
  --border-width: 1px;
  --radius-sm: 5px; --radius-md: 10px; --radius-pill: 999px;

  /* ── Hard shadows — quiet, down-right, two steps ───────────────── */
  --shadow-sm: 2px 2px 0 var(--color-shadow);
  --shadow-md: 4px 4px 0 var(--color-shadow);
  --shadow-none: none;

  /* ── Motion ────────────────────────────────────────────────────── */
  --ease-pop: cubic-bezier(0.2, 0.8, 0.2, 1);
  --duration-fast: 120ms; --duration-base: 160ms;
  --duration-slow: 200ms; --duration-toggle: 300ms;
}
```

**1.3 Base/reset:** `* { box-sizing: border-box }`, `html,body{height:100%}`, `body{ margin:0; background:var(--color-bg); color:var(--color-text); font:var(--body); }`, use `100dvh` for full-height so mobile browser chrome doesn't clip the prompt bar.

### Phase 2 — Layout & shell styling (`public/index.html` + `public/app.css`)

Extend issue 02's markup — do **not** restructure it. Replace the inline `<style>` block with `<link rel="stylesheet" href="/static/app.css">`; add `<script defer src="/static/app.js"></script>`; set `<title>Aluna</title>`.

**Clean, not boxed.** Issue 02's 1px borders on every region are rough placeholder delineation — the real UI must read cleaner. Borders appear only where they *earn* their place (the prompt field, form controls), never as a frame around each region; regions separate by **background tone and spacing**. The sole structural divider kept is the sidebar's `border-right` (one functional separator between two distinct regions, like Claude/ChatGPT); the prompt section has **no** border and no surface fill.

- **`.shell`** — flex row, `height: 100dvh`.
- **`.toolbar`** (sidebar) — `flex: 0 0 16rem`, `background: var(--color-surface)`, `border-right: var(--border-width) solid var(--color-border)`, scrolls independently. Hosts the Aluna wordmark at its top (rendered when the sidebar is shown). Hidden at cold-start (no capabilities).
- **`.content-column`** — `flex: 1 1 auto; min-width:0; display:flex; flex-direction:column`.
- **`.content`** — `flex: 1 1 auto; overflow:auto`. **Background is the page color `var(--color-bg)`** — not a surface panel. Cold-start composition lives here (Phase 4).
- **`.prompt`** — `flex: 0 0 auto`, **no border, no surface fill**; background is `var(--color-bg)` (or transparent) so the section is visually continuous with the content area and the composer reads as *neatly placed inside it* — the ChatGPT/Claude composer, and the way momo's chat input sits in its conversation. The similarity ends there: momo's chat sits on a white **surface panel**, whereas here it sits **directly on the theme background**. Padded with `--space-3` for breathing room. Only the **field** carries treatment: the `<input>` gets `--radius-md`, a 1px softened-ink border, `--color-surface` fill (so the field lifts off the page bg), `--body` type, comfortable padding, and an accent focus ring; consider a constrained max-width, centered like a composer.

### Phase 3 — Basic interactions

**Browser JS is `.js`, not `.ts` — by design.** `public/app.js` is served verbatim as a static asset (`serveStatic`, `src/app.ts`) and executed by the *browser*, which runs JavaScript, not TypeScript — `serveStatic` does no transpilation. Authoring it in TS would require a transpile/bundle step and break the **no-build-step** rule. TypeScript stays on the server, where Bun is the executor (`bun --watch src/index.ts`). To keep type safety without a build, author `public/app.js` as plain JS with `// @ts-check` at the top + **JSDoc** type annotations; the existing `typecheck` script (`tsc --noEmit`, `package.json`) then checks it with no runtime change. (Same applies to the future `public/pet.js`.)

**3.1 Sidebar collapse (chrome) — `public/app.js` (Alpine).** Put an `open` boolean on the existing `x-data` root.
- **Desktop (≥ ~768px):** toggling `open=false` **fully collapses** the sidebar (width → 0 / removed from flow) to reclaim content width. No icon rail — entries are text labels with no icons yet. A visible toggle control lives in the content column.
- **Mobile (< ~768px):** the sidebar is `position: fixed` off-canvas; `open=true` slides it in over the content with a **backdrop**; tapping the backdrop (or a close affordance) sets `open=false`.
- Transition uses `--duration-toggle` / `--ease-pop`. State persistence is **optional** (deferred).
- A11y: toggle button has `aria-expanded` + `aria-controls`; sidebar keeps its `aria-label="Capabilities"`; backdrop is click-dismissable; focus stays managed.

**3.2 Gentle press (CSS).** Interactive elements (sidebar toggle, prompt input on focus, future buttons): on `:hover` translate `1px,1px` + `box-shadow: var(--shadow-sm)`; on `:active`/focus translate `2px,2px` + reduce shadow — tactile but quiet. Prompt input focus also shows an accent ring (`--color-accent`).

### Phase 4 — Cold-start & responsive

**4.1 Cold-start (zero capabilities):** sidebar hidden; in `.content`, the **Aluna wordmark on top** (`--type-wordmark`, `--weight-bold`) and a **neutral centered placeholder** below it (a muted, deliberately-blank empty-state block; minimal/no copy). The prompt bar's `<input>` gets a product-voice `placeholder` — proposed: **"What would you like to keep track of?"** (owner-approvable; warm, jargon-free, on-thesis). Keep the form inert (`onsubmit="return false"`, no `hx-post`).

**4.2 Responsive:** verify at common desktop (≥1280) and mobile (~375–414) widths. Desktop = sidebar inline + collapsible; mobile = sidebar off-canvas drawer. Prompt bar stays pinned and thumb-reachable; content scrolls under it.

### Phase 5 — Accessibility & polish

- `@media (prefers-reduced-motion: reduce)`: disable the press translate, make sidebar collapse/drawer instant (no slide), no decorative motion.
- `:focus-visible` rings (accent) on all interactive elements.
- Contrast: ink-on-paper passes AA; if terracotta `--color-accent` is ever used for text, verify contrast or restrict it to borders/fills/rings.

## The pet — defined, deferred (NOT built this issue)

Replaces the original "animated orb." A future issue under this epic (or a later module) implements it; this section is its spec.

- **Concept:** an **anthropomorphic spark of Aluna** — a small luminous companion with eyes/face that feels alive. Related to Aluna (the realm of thought made visible) but **is not Aluna herself**. It is a first-class delight feature even though it carries **no business logic**.
- **Placement:** lives **on/above the prompt bar** — it walks along the bar and **talks from there**; its messages render into the content area, **bottom-placed and emphatic** (not centered). Persistent-companion model.
- **Inherits the orb's old double-duty:** cold-start presence + the **"something is being built"** indicator that M2's narration drives. It does **not** shrink into a corner spinner — it stays itself.
- **State vocabulary** (named now; M2 wires the live ones):
  - `idle` — resting + alive (breathe, blink, occasional glance; walks the prompt bar). *Default.*
  - `thinking` — "something is being built" (M2, via SSE).
  - `speaking` — delivering a message (a modifier over `idle`/`thinking`, not standalone) (M2).
  - `done` — brief success reaction (M2).
  - `trouble` — "something went sideways", product-voice, never technical (M2).
- **Rendering technique: deliberately open, decided when built.** Inline SVG, committed spritesheet (APNG / CSS `steps()`), or a vendored real-time tool (e.g. Rive: runtime under `public/vendor/`, a static `.riv` asset) are all candidates. Hard constraints: **no build step**, assets committed and served from `/static`, anthropomorphic with eyes, supports walking + talking + the state vocabulary.
- **Reduced motion:** a single calm static pose (eyes open, no walk/float).
- **Voice:** speaks in the product voice below.
- **Name:** **TBD** — must be an authentic Kogi word related to Aluna (a spark / little one / messenger / seed-of-thought). **Do not invent one**; verify against a real source before committing.

## Product voice

Authored into `CONTEXT.md` (Phase 0.1). Guides all UI copy and every future coding agent.

- **Persona:** warm, encouraging, gently curious. Speaks in **first person**, addresses the user directly ("you"). Plainspoken and concise, with a quiet thread of wonder. Friendly and clear — not cutesy, not cryptic.
- **Hard rule (ARCH §9.7):** never expose internals — no "handler", "spec", "migration", "compile", "build artifact", "schema". Ever.
- **Do / Don't:**
  - Do: "Got it — putting that together now." · Don't: "Generating handler and running migration."
  - Do: "All set. Want to add anything else?" · Don't: "Build committed; v1 artifacts written."
  - Do: "Hmm, that didn't work — mind trying again?" · Don't: "Smoke test failed; build aborted."

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

Cross-cutting defaults (apply here and in issue 02): icons are **inline SVG** (no icon font/library); vendored libraries under `public/vendor/`, Outfit under `public/fonts/`, authored styles in `public/app.css`, authored shell JS (Alpine glue / the pet later) in `public/app.js`; everything served from `/static/…`.

**2026-06-04 — design + implementation plan (grilling session).** Revisited and extended the above. Key changes and rationale:

- **Visual language pinned: subtler neobrutalism on Paper & Ink.** Source corrected — the reference is momo's **Paper & Ink theme** (`themes.config.ts`), *not* the loud Sunbeam default. Paper & Ink is already quiet (warm cream page, warm ink, terracotta primary), so "subtler / PostHog-like" is achieved through **shadows and borders**, not color: 1px softened-ink borders on structural surfaces only; two-step `2px/4px` **down-right** hard shadows (departing from momo's left-down offset), low-contrast, used sparingly; gentle 1–2px press; 10px radius. Full Paper & Ink role set carried over (some roles reserved for later capabilities). Tokens adopted from momo (Outfit scale, 8px spacing, motion), re-homed under the issue's `--color-*` naming.
- **No theming machinery.** Owner is locking Paper & Ink. Single `:root`, no `data-schema`/registry/dark stylesheet — semantic tokens still leave dark as a free additive override, satisfying the AC without building anything.
- **Name resolved → Aluna**, a Kogi word (realm of thought from which the material world is born — a precise metaphor for the product). This lifts the prior wordmark deferral. Wordmark introduced this issue, content-area-top at cold-start + sidebar-top when present, typographic in Outfit.
- **Orb → pet, and pet DEFERRED.** The orb is replaced by an **anthropomorphic spark of Aluna** that walks/talks at the prompt bar (persistent companion; inherits the build-indicator duty; never shrinks to a spinner). Deliberately **defined-but-not-implemented** this issue — the thesis is the self-building app, and the pet is a delight layer to build afterward. State vocabulary, placement, rendering constraints, and voice are specced; name left **TBD** pending verification of an authentic Kogi word (no fabrication).
- **Cold-start re-scoped.** With the pet deferred and the greeting (delight) dropped: sidebar hidden, **Aluna wordmark on top + a neutral centered placeholder**, inert prompt with a product-voice `placeholder`. No reserved pet DOM slot — the layout switches when the pet lands.
- **Product voice = warm/encouraging/gently curious**, first person, direct address, zero internals jargon (§9.7). Authored as durable guidance because it steers all future coding agents.
- **Durable docs added to scope:** `CONTEXT.md` (glossary + framing + voice guide), `docs/adr/0001-product-style-and-voice.md` (decision record citing momo Paper & Ink), `docs/design-system.md` (token table + the dial + do/don'ts). These are the lazy-created domain docs `docs/agents/domain.md` expects.

**Open / deferred sub-trees:** the pet (whole implementation — rendering technique, walking/talking animation, live narration wiring in M2, mood/care/persistence mechanics, click interaction); the pet's Kogi name (needs source verification); dark theme; status/tone color tokens (add when a capability surfaces errors); collapse-state persistence.

**2026-06-05 — implemented (agent).** Built the base layout, Paper & Ink style, durable docs, and the deferred-pet spec. All ACs met; verified clean.

Durable docs (Phase 0):
- `CONTEXT.md` — glossary (Aluna, shell, capability, capability toolbar/sidebar, prompt bar, content area, the pet, product voice) with `_Avoid_` lists, product framing, and the full product-voice guide (persona, hard rule, do/don't table).
- `docs/adr/0001-product-style-and-voice.md` — the decision record (subtler neobrutalism on Paper & Ink, Outfit, single `:root`/no theming, product voice, pet deferred, Aluna wordmark), citing momo's `themes.config.ts` `paper` theme as the token source and the dial it's turned down from.
- `docs/design-system.md` — token table (mirrors `public/app.css`), the neobrutalism dial vs momo, "clean not boxed", component treatments, do/don'ts.
- `docs/pet.md` — **new**, beyond the three planned docs: the deferred pet gets a durable, findable home (concept, placement, state vocabulary, rendering constraints, reduced-motion, voice, TBD-name) so a future issue implements it cold rather than spelunking this closed issue. Linked from the CONTEXT.md glossary.

Build (Phases 1–5):
- `public/fonts/outfit-variable.woff2` — Outfit **variable** woff2 (wght 100–900, OFL), vendored from fontsource; `public/fonts/OFL.txt` ships the license alongside it. One `@font-face`, `font-display: swap`, system fallback stack.
- `public/app.css` — semantic `--color-*`/type/space/shadow/motion tokens in one `:root` (light only, no theming machinery); the shell layout (`100dvh` flex row; surface sidebar with the one `border-right` divider; borderless prompt section on `--color-bg` with only the field treated, constrained + centered); cold-start composition; gentle 1–2px press; desktop full-collapse + mobile drawer/backdrop; `prefers-reduced-motion` reset; `:focus-visible` accent rings.
- `public/index.html` — extended (not restructured): `<title>Aluna</title>`, `<link>` app.css, scripts reordered to **htmx → app.js → alpine** (app.js must register the `shell` Alpine component on `alpine:init` *before* alpine's cdn build auto-starts via `queueMicrotask`). Added the Aluna wordmark (two homes), the cold-start placeholder, the sidebar toggle (inline-SVG panel icon, `aria-expanded`/`aria-controls`), the drawer backdrop, and the product-voice prompt `placeholder` "What would you like to keep track of?". Presentation state is class-driven (`has-capabilities`, `sidebar-open`) so the no-JS default renders correct cold-start (no FOUC). The literal engineering name never appears, even in source/comments.
- `public/app.js` — the `shell` Alpine component (`open`, `hasCapabilities`, responsive `init`), authored as `// @ts-check` + JSDoc plain JS (no build).
- `tsconfig.browser.json` + `package.json` — the existing typecheck didn't actually cover `public/*.js` (server tsconfig is `src`-only, no DOM lib). Added a browser tsconfig (DOM lib, `checkJs`, vendor excluded) and made `typecheck` run both, so app.js's types are genuinely checked with no runtime change.

Verification:
- `bun run typecheck` (server + browser) → 0 errors; `bun run lint` (Biome incl. HTML/CSS) → clean (the canonical reduced-motion `!important` reset carries a documented `biome-ignore`).
- 23-check route smoke (`app.request`): `/` 200 `text/html` with `<title>Aluna</title>`, app.js-before-alpine ordering, `x-data="shell"`, cold-start wordmark, product-voice placeholder, inert form, no `omni-crud` in source, all three landmarks; `app.css`/`app.js`/woff2/vendored libs all 200 with correct MIME. Confirmed again over real HTTP (font → `font/woff2`).
- **Visual** (headless Chrome via CDP, true viewports, deviceScaleFactor 2): cold-start at 1280 and 390 render correctly; **console errors: none**. Drove Alpine to the sidebar-present state (sample entries injected, not shipped) and confirmed desktop expanded, desktop **full-collapse** (rail → 0, divider gone, content reclaims width), and the mobile **off-canvas drawer + dimming backdrop** all work. (Earlier a 390 screenshot looked clipped — traced to headless `--window-size` rendering at a 500px viewport, not a layout bug: measured `scrollWidth === innerWidth`, zero overflowers.)

Pet remains **specified-not-built** (`docs/pet.md`), and no capability-creation path exists yet, so the running shell is always cold-start; the collapse chrome activates the moment a later epic flips `hasCapabilities`. Changes left uncommitted pending the usual go-ahead.
