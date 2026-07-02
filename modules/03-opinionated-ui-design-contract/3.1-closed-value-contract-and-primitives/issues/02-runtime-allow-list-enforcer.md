# Runtime allow-list enforcer

Status: done

## Epic

Module 3 — Opinionated Capability UI · Epic 3.1 — Closed-value design contract +
primitive vocabulary (`docs/modules.md` §3.1, ADR-0005 §3 & §4, PLAN decision 3:
`modules/03-opinionated-ui-design-contract/PLAN.md`)

## What to build

The runtime enforcer the presentation adapter applies to **every rendered
record**, so a dynamic field value can never become executable markup even after
build-time validation passes (ADR-0005 §3 — "enforces the allowed
HTML/class/style surface at runtime on every rendered record"). This is the
*safety* half of the closed-value contract: the design-lint **Gate** rung (3.6)
catches violations at build time; the enforcer is the last line at render time.

- Given generated inner markup for one record, accept only the allow-listed
  classes/elements from the 3.1/01 vocabulary; reject or neutralize
  fabricated/unknown classes, interactive descendants, scripts/event handlers,
  and unsafe field interpolation.
- **Sanitize inline `style` to the 3.1/01 token discipline** rather than
  stripping it wholesale: drop declarations that set a token-owned axis
  (color/font/type/spacing/border) with an off-token value, and drop forbidden
  constructs (`url(...)`, item-escaping position values); pass conforming
  declarations through. A hostile field value smuggled into a `style` attribute
  must come out inert.
- Deterministic and dependency-free enough to run on every record render inside
  the adapter (3.4/01) without a measurable latency cost.

## Acceptance criteria

- [x] The enforcer passes markup composed of allow-listed classes/elements —
      including token-disciplined inline `style` — through unchanged
- [x] Fabricated/unknown classes, off-token declarations on the token-owned axes
      (color/font/type/spacing/border), forbidden style constructs (`url(...)`,
      item-escaping position), interactive descendants, scripts/event handlers,
      and unsafe interpolation are rejected or neutralized
- [x] Hostile synthetic field values (script tags, `on*=` handlers, style
      injection, class smuggling) cannot produce executable markup through the
      enforcer
- [x] Tests cover the accept path and each hostile category; no external
      dependency is required at render time
- [x] Not independently demo-relevant — the enforcer has no visual surface of its
      own and is exercised once records render through the adapter (3.4/01); noted
      here per the living-demo rule

## Blocked by

- modules/03-opinionated-ui-design-contract/3.1-closed-value-contract-and-primitives/issues/01-closed-value-class-vocabulary-and-css.md

## Implementation notes

Done 2026-07-02. Landed as a new `src/presentation/` module (Module 3's platform
presentation concern; the item wrapper, modal, and adapter of 3.2/3.4 join it
later). Public entry: `enforceItemMarkup(innerHtml: string): string` — pure,
synchronous, dependency-free.

- **Parser: Bun's native `HTMLRewriter`** (`src/presentation/enforcer.ts`) — Rust
  `lol-html`, deterministic, no npm dependency at render time, and `transform(string)`
  returns a `string` synchronously. It parses the *final rendered* markup the way a
  browser would, so a field value that broke out of its interpolation is seen as the
  elements it really forms and neutralized — a regex/parser that disagreed with the
  browser could be smuggled past. The enforcer **neutralizes, never throws**: a record
  that slipped past the build gate must still render inertly, not crash a live view.
- **Element policy** (`src/presentation/vocabulary.ts`): a closed `ALLOWED_ELEMENTS`
  set of presentational, non-interactive, same-namespace tags is kept (attributes
  cleaned); `REMOVED_ELEMENTS` (script/style/`svg`/`math`/`template`/iframe/raw-text —
  code, foreign content, mXSS vectors) are removed **with their content**; everything
  else — interactive controls, `<html>/<body>` framing, unknown/custom elements — is
  **unwrapped** (`removeAndKeepContent`), so the record's inner text survives while the
  tag and its handlers do not. Children of an unwrapped parent are still visited and
  cleaned (verified), so a `<script>` nested in an `<a>` still dies.
- **Attribute policy — default-deny.** On kept elements, only a per-element allow-list
  (plus globals + `aria-*`, and the special-cased `class`/`style`) survives. That single
  rule is what strips every `on*=` handler, `href`, `srcdoc`, `is=`, `data-*`, and
  **`id`/`name`** (the last to close DOM-clobbering of platform JS). URL attributes
  (`src`/`srcset`/`poster`/`cite`) are scheme-checked (`isDangerousUrl`): `javascript:`,
  `vbscript:`, and non-image `data:` are dropped (control chars/whitespace stripped
  first so `java\tscript:` can't slip through); inline `data:image/*` stays.
- **`class` filter:** keeps only the closed vocabulary; a fully-conforming attribute is
  left byte-identical, an all-fabricated one is removed.
- **`style` token discipline** (`src/presentation/style-discipline.ts`): per-declaration.
  A **security layer** (property-agnostic) drops `url(...)`/`image-set(...)`/
  `expression(...)`/`-moz-binding`, CSS comments, `<`/`>`/`\`/`@`, `javascript:`, **any
  raw hex or color-function**, and **inline `--custom-property` definitions** (they'd
  launder off-token values through indirection). A **discipline layer** then requires
  on-token values on the five owned axes — color → `var(--color-*)`, font-family →
  never declared, type scale → `var(--type-*)`, spacing → `var(--space-*)` (plus
  structural `0`/`auto`), border weight → `var(--border-thin|regular|thick)` — with the
  border/outline shorthands tokenized (width | line-style | color). `position` is
  narrowed to `static|relative` (item-escaping `fixed|absolute|sticky` dropped).
  Everything outside the owned axes (arrangement, radius/shadow/motion tokens) is free.
  A conforming value returns byte-identical; a partly-hostile one returns only its
  surviving declarations; a fully-hostile one collapses the attribute away.
- **Source-of-truth tie:** `ALLOWED_CLASSES` is hard-coded (render stays dependency-free)
  but `vocabulary.test.ts` cross-checks it against `public/css/primitives.css`, so the
  allow-list and the CSS can never silently drift.
- **Reuse for 3.6:** the barrel re-exports the vocabulary, and `enforceItemMarkup(x) !== x`
  is a ready detector the design-lint rung can build its *rejection* on (this issue is
  the render-time *neutralizer*; 3.6 is the build-time *rejecter*).
- **Not demo-relevant (per living-demo rule):** the enforcer has no visual surface of
  its own — it is exercised once records render through the presentation adapter
  (3.4/01), which does not exist yet. Confirmed by tests instead; no `/demo/*` wiring.
- **Known residual (documented, non-security):** a *named* CSS color inside a mixed
  shorthand (`background: white`, a named-color gradient) is inert and passes the
  runtime enforcer; it is caught at build time by the design-lint gate rung (3.6).
  Raw hex/color-function forms are dropped everywhere; the strict color properties
  reject named colors.

## Verification

- `bun test src/presentation/` — 66 pass (accept path + each hostile category:
  fabricated classes, off-token style on all five axes, forbidden constructs,
  scripts/handlers, interactive descendants, hostile field-value smuggling,
  determinism; plus the primitives.css cross-check).
- `bun test` — 235 pass across 23 files (no regression).
- `bun run typecheck` — clean (`tsc` strict, both configs).
- `bunx biome check .` — clean (107 files).

## HITL test instructions

Pure safety logic with no visual surface (exercised via the adapter in 3.4), so the
check is the focused test run rather than a route:

- Run: `bun test src/presentation/` → expect **66 pass, 0 fail**.
- Confirms: allow-listed classes/elements + token-disciplined `style` pass through
  unchanged; fabricated classes, off-token color/font/type/spacing/border, `url(...)`,
  item-escaping `position`, interactive descendants, `<script>`/`on*=`, and broken-out
  hostile field values all come out inert.
- Eyeball a hostile round-trip (developer-only):
  `bun -e 'import("./src/presentation/enforcer.ts").then(({enforceItemMarkup:e})=>console.log(e(`<a href="javascript:steal()" onclick="x()"><script>evil()</script><b style="color:red;padding:var(--space-2)">Hi</b></a>`)))'`
  → prints `<b style="padding:var(--space-2)">Hi</b>` — link/handler/script gone, the
  off-token `color:red` dropped, the on-token `padding` kept.
