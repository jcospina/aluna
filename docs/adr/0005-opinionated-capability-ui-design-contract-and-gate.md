# 0005 — Opinionated capability UI: platform presentation, one item renderer & the design gate (amends 0004, seeds Module 3)

Status: accepted

Amends [ADR-0004](0004-capability-artifact-contract-and-validation-isolation.md).
Settled in the Module 3 grilling session (2026-06-26). Exact class names, token
names, module interfaces, and the exemplar set remain implementation detail, decided
inside Module 3.

**Amended 2026-06-30.** Two changes: (a) **collection layout** is added as a
closed `ui_intent.collection.layout` value (`feed | grid`) the platform list
container reads (§2, §6). (b) **§7's preservation cutover is deferred.** The
project is greenfield and under development, so the M2→M3 artifact-*shape* change
is handled by `bun run reset` + rebuild; M3 introduces no persisted
`artifact_contract` marker and no migrate-without-reset machinery. The
preservation path is deferred until the platform is feature-complete (post-M8) —
it remains the architecture's end-state vision (ARCH §2, §9.1). Backwards
compatibility does not drive design while the project is under development.

**Amended 2026-07-01.** §4's blanket inline-style ban is relaxed. A closed class
list cannot anticipate every composition a capability needs — the vocabulary is
**sensible defaults, not an all-purpose CSS framework** (even Tailwind doesn't
cover every case with ease; rebuilding it is a non-goal) — so inline `style`
becomes a **token-disciplined escape hatch**: allowed when the primitive
vocabulary doesn't suffice, but the five design axes the platform already owns —
**color** (theme tokens), **font family** (Outfit is the default and is never
declared), **type scale** (the t-shirt-size tokens), **spacing** (the base
spacing unit's tokens), and **border weight** (the thin | regular | thick
scale) — are never redeclared with raw values. The
executable-markup bans are untouched. *Closed values, open composition* now
reads literally: the closed thing is the design-**value** space (the tokens),
not the CSS property space.

## Problem

A capability is born usable but **ugly**. The unit-generation prompts hand the
model a *structural* contract (routes, data-free views, no scripts) and the spec,
but **no design guidance** — no tokens, no primitives, no example. With nothing to
imitate, the model reproduces the same bare *[title][empty state][form]* scaffold
every build. Aluna is a self-evolving platform: generation is **hidden from the
user, one-shot, and re-run on every version bump**, with no developer reviewing
the output before it ships. So consistency cannot be hoped for per build — it must
be **structural**.

The field has converged on a three-legged answer (v0/shadcn, the
design-system-for-LLM writeups, and the *impeccable* design skill's detector
rules): a **closed token + primitive vocabulary**, **spec/example context** fed to
the model, and **automated auditing that rejects violations**. Aluna already owns
two of the three legs — a closed-ish token layer (`public/css/tokens.css`,
`docs/design-system.md`) and a layered, fail-closed gate. This ADR puts all three
to work.

## Decision

Seven interlocking choices. The governing line, inherited from ADR-0004 and ARCH §1,
is unchanged: **the platform may own *presentation*, never *business logic*.** ARCH
§7's platform-owned `data_query` auto-table is the standing precedent that
presentational platform code is allowed.

1. **Thick shell, thin generation: structural chrome is platform-owned and
   presentational.** The **modal** (open/close/prefill/focus), the **list
   scaffolding** (container, empty state, the "New X" button), the accessible
   **item wrapper**, and the **create/edit/detail fields** (rendered
   deterministically from the spec, with HTMX wiring and close-on-success) become
   fixed platform modules. They implement no capability rule and persist no
   canonical state. Consequently `list.html` and `create.html` **cease to be
   generated units**. Field rendering is centralized and exhaustive so Module 4's
   list types and Module 6's file types extend one platform module.

2. **The item renderer is the single generated creative surface.** Each
   capability has one versioned generated item-renderer unit. It produces the
   capability-specific inner markup for **one record** and is free — and
   encouraged — to vary *that record's* composition (cards, compact rows, media
   tiles, text-forward) to fit the data. How records are arranged as a
   *collection* (feed vs. grid) is a separate, closed-value choice the platform
   list container reads from `ui_intent.collection.layout` (§6) — not something a
   per-record renderer can or should emit. The renderer is generated **knowing**
   the chosen collection layout, so item composition and collection arrangement
   are co-designed.
   `create.ts`, `read.ts`, and later `search.ts` all receive the same renderer
   through a capability-scoped presentation adapter in their injected toolbox.
   Generated handlers still import nothing (ADR-0004), while create and read can
   no longer carry duplicated row helpers that drift.

3. **The platform owns item mechanics (no new route).** The presentation adapter
   wraps generated item markup in the standardized accessible trigger, embeds the
   full record as an escaped `data-item` payload (`file` fields as references,
   never bytes — ARCH §7), and attaches the click-to-open behavior. The model
   owns composition, not serialization, escaping the payload, accessibility
   mechanics, safe insertion of record content, or modal wiring. The adapter
   enforces the allowed HTML/class/style surface on every rendered item —
   sanitizing style declarations along with elements and classes — so dynamic
   record values cannot turn into executable markup even after build-time
   validation. The modal opens **prefilled** with full content even when the item
   visually truncates, so the fixed `create + read` route convention is
   unchanged. If large-text capabilities make materializing the list expensive,
   prefill can move behind the same adapter to read-single-on-open after M4 adds
   the per-item action; the item payload shrinks to an id without changing
   committed item composition.

4. **A closed-value design contract, enforced by a new gate rung.** (Amended
   2026-07-01.) Generated item markup reaches first for an allow-list of
   semantic/primitive classes whose implementations consume the design tokens —
   the sensible defaults, including Tailwind-style **layout utilities** (flex,
   grid, alignment, gap) so common arrangement never needs `style` at all. The
   vocabulary is deliberately **not** an all-purpose CSS framework. When it
   doesn't suffice, inline `style`
   is allowed as a **token-disciplined escape hatch**: the five design axes the
   platform owns are never redeclared with raw values — **color** (only
   `var(--color-*)`), **font family** (never declared; Outfit inherits from the
   shell), **type scale** (only the t-shirt tokens `var(--type-*)`),
   **spacing** (only `var(--space-*)`), and **border weight** (only the
   thin | regular | thick border tokens). Properties outside those axes
   (arrangement, alignment, aspect ratio, …) are free; radius/shadow/motion
   tokens exist and are preferred where they fit. The security bans are
   absolute and unrelaxed: fabricated or unknown classes, interactive
   descendants, scripts/event handlers, unsafe interpolation of user fields —
   and, inside styles, `url(...)` values, position values that escape the
   item's bounds, and field values interpolated into a `style` attribute
   (styles are literal in the renderer source). A new **fail-closed
   design-lint rung** renders hostile synthetic values — within the
   capability's declared collection layout — and feeds violations through the
   same bounded fix loop as the existing checks.
   Platform-owned payload, wrapper, and modal invariants are ordinary platform
   tests; they are not requirements the model can get wrong. *Closed values,
   open composition*: the contract closes the design-**value** space (the
   tokens) and the executable surface, never the arrangement.

5. **The builder is steered by injection, not a runtime tool.** Unit generation is
   one-shot structured output — agentic only *within* a unit's write→check→fix
   loop, never a roaming agent (ADR-0003). So design guidance reaches the model by
   **injection** (the contract plus a curated, **repo-only** few-shot gallery of
   2–3 deliberately different exemplars, with *"vary, don't copy"* framing) and is
   **enforced** by the gate rung (§4). No live "read the design system" tool is
   added; that would fight the deterministic-across-units discipline and add
   measured build latency (a thesis metric). The exemplars are LLM-facing only —
   **never rendered to the user**.

6. **`ui_intent` records only capability-specific presentation intent.** M2's
   `views: ["list", "create"]` describes generated scaffolding that disappears in
   M3. Its replacement records (a) the item design direction, (b) the
   **collection layout** — a closed enum (`feed | grid`) the platform list
   container reads to arrange items, and (c) the fields/order the detail surface
   shows. Collection layout is the same *kind* of structural presentation fact
   the platform already interprets (field type, required state, detail order):
   one closed value mapped to a platform container class, **not** a model-emitted
   view tree (fully declarative SDUI stays rejected, below). An unknown value
   fails the build closed, exactly as an unknown field type does. `table` and
   `masonry` are deliberately **out of M3's set** — a true table dissolves the
   per-record creative surface (the platform would render aligned cells from
   fields, bypassing the item renderer) and overlaps M5's `data_query`
   auto-table; either can be added additively later as a platform-rendered
   layout. The single generated creative surface stays the item renderer;
   collection layout is a closed authored value, reinforcing *closed values, open
   composition*. `modal: true` is not stored: the shared modal is a fixed
   platform invariant, not a choice for the model to make. Module 3 ships detail
   read-only; M4's `update` adds editing to the same platform module.

7. **The artifact *shape* changes; preservation of existing capabilities is
   deferred.** M3 re-cuts what a capability's generated artifacts *are* (views
   give way to one item renderer, §1–§2). Because the project is **greenfield and
   under development**, that shape change is applied the simplest way: change the
   generators, `bun run reset`, and rebuild capabilities fresh under the new
   shape. M3 introduces **no** persisted `artifact_contract` marker, **no**
   dual-serving of old and new artifacts, and **no** atomic migrate-without-reset
   cutover. The original preservation design — keeping committed capabilities live
   and re-deriving them across a contract change without a reset — is **deferred
   until the platform is feature-complete (post-M8)**, when real user data exists
   to preserve; it remains the platform artifact-contract upgrade the architecture
   still describes as the end state (ARCH §2, §9.1). Until then, backwards
   compatibility does not drive design.

## Consequences

- **ADR-0004 §1 is amended.** "Views are data-free scaffolding, *generated*"
  becomes "the scaffolding is *platform-rendered*; the data-free principle holds —
  platform Views carry no cached user data, and live record data rides in handler
  output exactly as before." ADR-0004 §2 is extended with the capability-scoped
  presentation adapter; handlers still return HTML and import nothing. ADR-0004
  §3 (gate runs on a scratch db) is unchanged.
- **The gate gains a rung and the unit checks shift.** The `list`/`create` *view*
  checks (`checkListView`/`checkCreateView`) retire with those generated units.
  One item renderer clears structural/design checks; the platform item wrapper
  has deterministic platform tests.
- **The Diff Engine (M4) sees one presentation unit.** It drops
  `list.html`/`create.html`; a presentation-only intent change regenerates the
  item renderer without rewriting unrelated handlers.
- **The spec schema changes shape.** `ui_intent.views` retires in favor of item
  intent + detail fields/order. The M2 field-type pantry is untouched (`file`
  remains M6).
- **Metrics retain semantic continuity.** Item-renderer generation replaces M2
  view generation as the presentation-generation stage, so M8 compares the
  presentation-gen stage across module versions rather than assuming generated
  `.html`. M3 records no `artifact_contract` marker; if M8 needs to distinguish
  contract versions it introduces that marker when it gets there (§7).
- **No in-place upgrade path in M3 (by choice).** During development the
  artifact-shape change is a `bun run reset` + rebuild, not a preserving
  migration; no dual contract or migration machinery is built now. The
  preservation cutover is deferred post-M8 (§7).
- **`design-system.md` gains a section** for the platform modules, the primitive
  vocabulary, and the closed-value contract — including the inline-style
  token-discipline rules — authored during Module 3.

## Rejected, with reasons

- **Better prompt only, fully model-generated UI (no platform presentation).**
  Re-rolls consistency on every build *and* every version bump; fights the
  shared-modal requirement; offers no structural guarantee — the exact failure mode
  for a hidden, unreviewed, self-evolving generator.
- **A single gold example.** LLMs anchor hard on one example and reproduce its
  layout, trading "sameness from no guidance" for "sameness from one sample." A
  small *diverse* gallery teaches the contract's range, not a single shape.
- **A tight, fixed primitive menu (close the composition too).** Maximal
  consistency, but every capability converges on the same layout — the boredom the
  module exists to kill. Hence *closed values, open composition*.
- **A blanket inline-style ban (§4 as originally accepted).** Relaxed by the
  2026-07-01 amendment: no closed class list can anticipate every per-capability
  composition need — we are not building an alternative to Tailwind — so a hard
  ban forces either endless vocabulary bloat or
  bland output. Token discipline on the platform-owned axes (color, font, type
  scale, spacing, border weight) keeps the consistency the ban was buying; the
  executable-surface bans were never the part being relaxed.
- **Duplicate an identical row helper into every handler.** It asks independent
  generated units to maintain one presentation contract and makes M4's Diff
  Engine coordinate copies. One injected item renderer gives handlers the same
  output by construction.
- **A runtime "read the design system" tool / agentic design loop.** Fights
  ADR-0003's deterministic-across-units discipline and adds latency the experiment
  measures; injection + gate achieves the same result deterministically.
- **A read-single route for prefill, up front.** Expands the fixed `create + read`
  route contract and adds a generated handler to feed a modal that is *read-only*
  until M4 — premature for single-user PoC list sizes. Deferred behind the modal
  abstraction as the documented escape hatch (§3).
- **Fully declarative SDUI (model emits JSON, platform renders the view).** Already
  rejected in ADR-0004 as platform business logic; that line is **kept**. The
  platform owns presentation mechanics; the model still authors the item renderer
  and handlers.
