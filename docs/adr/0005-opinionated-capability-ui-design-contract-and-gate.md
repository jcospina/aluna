# 0005 — Opinionated capability UI: platform presentation, one item renderer & the design gate (amends 0004, seeds Module 3)

Status: accepted

Amends [ADR-0004](0004-capability-artifact-contract-and-validation-isolation.md).
Settled in the Module 3 grilling session (2026-06-26). Exact class names, token
names, module interfaces, and the exemplar set remain implementation detail, decided
inside Module 3.

**Amended 2026-06-30.** Two changes: (a) collection layout is added as a
closed `ui_intent.collection.layout` value (`feed | grid`) the platform list
container reads (§2, §6). (b) §7's preservation cutover is deferred. The
project is greenfield and under development, so the M2→M3 artifact-*shape* change
is handled by `bun run reset` + rebuild; M3 introduces no persisted
`artifact_contract` marker and no migrate-without-reset machinery. The
preservation path is deferred until the platform is feature-complete (post-M8) —
it remains the architecture's end-state vision (ARCH §2, §9.1). Backwards
compatibility does not drive design while the project is under development.

**Amended 2026-07-01.** §4's blanket inline-style ban is relaxed. A closed class
list cannot anticipate every composition a capability needs — the vocabulary is
sensible defaults, not an all-purpose CSS framework (even Tailwind doesn't cover
every case with ease; rebuilding it is a non-goal) — so inline `style` becomes a
token-disciplined escape hatch: allowed when the primitive vocabulary doesn't
suffice, but the five design axes the platform already owns — **color** (theme
tokens), **font family** (Outfit is the default and is never declared), **type
scale** (the t-shirt-size tokens), **spacing** (the base spacing unit's tokens),
and **border weight** (the thin | regular | thick scale) — are never redeclared
with raw values. The executable-markup bans are untouched. *Closed values, open
composition* now reads literally: the closed thing is the design-*value* space
(the tokens), not the CSS property space.

**Amended 2026-07-06.** The field-type pantry gains a **`date`** type (a calendar
day) alongside `datetime` (an instant), so a "due date" asks for a day rather than a
timestamp. It is an additive extension applied through the centralized field renderer
(epic 3.2/01) and its compile-enforced consumers — the spec enum, the DDL mapper
(`date` → `TEXT`), the data tool, and the gate's sample generator — and supersedes the
"pantry untouched" note in §Consequences below. `file` still remains M6.

**Amended 2026-07-10 for Module 4.** §3's "full record" means the complete
canonical row remains available to platform code on the server; it does not
mean inactive fields or `extra` are serialized into the client payload. From M4,
record-producing queries return target ids and the platform rehydrates canonical
rows, then projects only the record target, active detail/edit fields, and the
closed platform presentation field `created_at` into modal/client state. The item
renderer still receives only `ui_intent.item.shows`. Hidden values are preserved
by the mutation interface's server-side merge, never by round-tripping them through
the DOM.

**Amended 2026-07-15 for Module 4 list input modes.** §1's centralized
create/edit field renderer now consumes one additional capability-specific
`ui_intent` fact for every active `string[]`: `comma_separated | repeatable`.
The former is a semantic promise that list elements are comma-free atomic values;
the latter preserves arbitrary element text including commas. The model chooses
inside this closed set, while platform modules own both controls, accessibility,
raw-form normalization, submitted-field presence, and the canonical ordered-array
Handler value. This remains closed structural presentation, not generated form
markup or a user-facing form builder.

**Amended 2026-08-20 for the desktop design system.** §4's five closed axes
become **three plus four bans** (`modules/05-the-desk/PLAN.md`, decision 10),
re-derived
against High Meadow in `design/styles/`, which supersedes Paper & Ink as the
token layer and takes the token *names* with it (ADR-0001's 2026-08-20
amendment). Colour, type size and spacing stay pick-from-a-list against High
Meadow names: the type and spacing families keep their `--type-*` and `--space-*`
shapes with new values, while the colour family loses its `--color-*` prefix
entirely and generated markup picks from the palette's own names. Font family,
**border**, **border-radius** and **box-shadow** are never declared, and the
border-weight axis gets no successor list.

Each ban has its own reason. Font family still inherits from the surface an item
sits on. **Border** goes because the ink system owns every boundary, and the
drawn line now reaches all the way into the record cards, rows and tables a
capability generates (§6b); a drawn card's hand is seeded from the record's own
id, so the generation pipeline never learns the ink system exists.
**Border-radius** goes because High Meadow has no radius tokens to pick from —
every corner is mitred, and a square corner is the absence of a declaration
rather than a value. **Box-shadow** goes because nothing inside a window casts,
and because the shadow tokens are bare `<x> <y> <alpha>` numbers describing a
path's displacement rather than a box, so `box-shadow: var(--shadow-window)`
produces an invalid value that fails silently. A ban is the only thing that
catches that last one: a value lint would have to know it was looking at a
non-value.

The **border-weight** ladder is gone rather than shortened. Every boundary is
2px, and hierarchy rides on the ink system's deviation — frame, fine and close
hands — instead of on line weight. The platform's grip tightens by exactly that
much, which is the intended trade. Radius and shadow are likewise absences in
High Meadow rather than shorter lists, so §4's "radius/shadow/motion tokens exist
and are preferred where they fit" survives for motion alone (`--dur-*`,
`--ease-*`). The executable-markup bans are untouched, as they were by the
2026-07-01 amendment.

**The class allow-list keeps its names.** `.stack`, `.cluster`, the flex and grid
utilities, `.gap-*`, `.text-*`, `.truncate`, `.line-clamp-*` and `.media-frame`
are reimplemented as a real stylesheet under `design/styles/`, under exactly the
names generated code already speaks (§7b). Keeping the kit preserves §4's goal
that common arrangement never needs inline `style`, which is what keeps the
gate's surface small. One collision is settled the cheap way: `layout.css`'s own
`.stack`, a 22px page column, is renamed rather than the vocabulary one, and
leaving both would have given a generated stack a page column's spacing with no
error anywhere.

**`design/design-system.md` moves into `design/` and stops stating values** (§7a).
It owns names and rules — which classes exist, which properties are
pick-from-a-list, which are never declared, what is banned — and every number in
it points at `design/styles/`. Values live once, in CSS, so the tie-breaker it
used to carry ("where the doc and the CSS disagree, the CSS wins") has nothing
left to arbitrate. This supersedes the last bullet under Consequences below.

**Amended 2026-08-20 for the desk's one record surface.**
`ui_intent.detail.shows` is deleted in Module 5's initial reset-bounded cut
(`modules/05-the-desk/PLAN.md`, decisions 8 and 29).
§6's third recorded fact — the fields and order a detail surface shows — named a
read-only surface that no longer exists. The desk has no modal and no read mode:
clicking a record opens it in edit mode, in the form, and the form ignores the
key. A key with no reader goes. The model still says how a record looks, and it
says it by building that form; §6's other facts — item direction and
dependencies, collection layout, and the per-`string[]` list input mode — are
untouched. Removing the key touches `uiIntentSchema`, its validation in
`spec.ts`, `detailFieldOrder`, the detail branch of `field-renderer.ts`, and the
generator prompt. This supersedes §6's detail clause and the "detail
fields/order" half of the spec-schema bullet under Consequences; §6's closing
"Module 3 ships detail read-only" stands only as a record of what M3 shipped.

**Amended 2026-08-20 for the Module 5 form contract.** The centralized form
renderer gains `choice`, long text, guidance, `max_length`, and drawn controls for
both existing `string[]` modes. A choice stores one stable string value from an
ordered array of option objects; values are append-only through evolution, while
labels, grouping, notes, disabled state and the closed picker/radio/segmented
presentation may change. Platform normalization and mutation validation reject
undeclared choice values and over-limit scalar strings before generated Handlers
or canonical state see them. A newly disabled value cannot be selected, but an
already-stored disabled value remains renderable and survives unrelated edits.
Soft-hide preserves `max_length`, and adding or lowering it is refused before
activation if any committed physical value, active or inactive, already exceeds
it. These structural validation facts enter canonical equality,
the total Diff matrix and behavioral total-input digests; generated code does not
become a second validator.

The one marked product-voice sentence returned by a Handler for a declared
business error remains authoritative. Platform presentation uses the existing
`data-error-fields` marker to relocate it into the affected field without
rewriting it or inventing a second copy source; `behavioral_errors` fixes semantic
markers and fields, not prose. Required/max-length platform failures keep their
one authored platform sentence. Older active rows may omit the new form-intent
collections; omission canonicalizes to empty, new candidates emit the complete
shape, and immutable historical snapshots are not rewritten.

## Problem

A capability is born usable but ugly. The unit-generation prompts hand the model
a *structural* contract (routes, data-free views, no scripts) and the spec, but no
design guidance: no tokens, no primitives, no example. With nothing to imitate,
the model reproduces the same bare *[title][empty state][form]* scaffold every
build. Aluna is a self-evolving platform, so generation is hidden from the user,
one-shot, and re-run on every version bump, with no developer reviewing the output
before it ships. Consistency therefore cannot be hoped for per build; it has to be
structural.

The field has converged on a three-legged answer (v0/shadcn, the
design-system-for-LLM writeups, and the *impeccable* design skill's detector
rules): a closed token and primitive vocabulary, spec and example context fed to
the model, and automated auditing that rejects violations. Aluna already owns two
of those legs — a closed-ish token layer (`design/styles/tokens.css`,
`design/design-system.md`) and a layered, fail-closed gate. This ADR puts all three
to work.

## Decision

Seven interlocking choices. The governing line, inherited from ADR-0004 and ARCH §1,
is unchanged: the platform may own *presentation*, never *business logic*. ARCH
§7's platform-owned `data_query` auto-table is the standing precedent that
presentational platform code is allowed.

1. **Thick shell, thin generation: structural chrome is platform-owned and
   presentational.** The modal (open/close/prefill/focus), the list scaffolding
   (container, empty state, the "New X" button), the accessible item wrapper, and
   the create/edit/detail fields (rendered deterministically from the spec, with
   HTMX wiring and close-on-success) become fixed platform modules. They implement
   no capability rule and persist no canonical state. Consequently `list.html` and
   `create.html` cease to be generated units. Field rendering is centralized and
   exhaustive so Module 4's list types and Module 6's file types extend one
   platform module. For active `string[]` fields, that module also interprets the
   closed authored list input mode and normalizes both controls to the same
   ordered-array Handler contract.

2. **The item renderer is the single generated creative surface.** Each
   capability has one versioned generated item-renderer unit. It produces the
   capability-specific inner markup for **one record** and is free — and
   encouraged — to vary *that record's* composition (cards, compact rows, media
   tiles, text-forward) to fit the data. How records are arranged as a
   *collection* (feed vs. grid) is a separate, closed-value choice the platform
   list container reads from `ui_intent.collection.layout` (§6) — not something a
   per-record renderer can or should emit. The renderer is generated knowing the
   chosen collection layout, so item composition and collection arrangement are
   co-designed.
   `create.ts`, `read.ts`, `update.ts`, and `search.ts` all receive the same
   renderer through a capability-scoped presentation adapter in their injected
   toolbox; delete success refreshes through the platform's current read/search
   path rather than inventing a second renderer.
   Generated handlers still import nothing (ADR-0004), while create and read can
   no longer carry duplicated row helpers that drift.

3. **The platform owns item mechanics (no new route).** The presentation adapter
   wraps generated item markup in the standardized accessible trigger, embeds an
   escaped client projection containing the record target plus active detail/edit
   values and the closed `created_at` platform field (`file` user fields are
   references, never bytes — ARCH §7), and attaches click-to-open behavior.
   `extra` remain server-only. The model owns composition, not serialization,
   payload escaping, accessibility mechanics, safe insertion of record content, or
   modal wiring. The adapter enforces the allowed HTML/class/style surface on every
   rendered item, sanitizing style declarations along with elements and classes, so
   dynamic record values cannot turn into executable markup even after build-time
   validation. The modal opens prefilled with untruncated values from the allowed
   active detail/edit projection even when the item visually truncates; inactive
   fields and `extra` remain server-only, while the record target and closed
   `created_at` descriptor accompany the projection only under the platform
   contract. The fixed `create + read` route convention is unchanged. If large-text
   capabilities make materializing the list expensive, prefill can move behind the
   same adapter to read-single-on-open after M4 adds the per-item action; the item
   payload shrinks to an id without changing committed item composition.

4. **A closed-value design contract, enforced by a new gate rung.** (Amended
   2026-07-01.) Generated item markup reaches first for an allow-list of
   semantic/primitive classes whose implementations consume the design tokens —
   the sensible defaults, including Tailwind-style layout utilities (flex, grid,
   alignment, gap) so common arrangement never needs `style` at all. That
   vocabulary is deliberately not an all-purpose CSS framework, so when it does not
   suffice, inline `style` is allowed as a token-disciplined escape hatch: the five
   design axes the platform owns are never redeclared with raw values — **color**
   (only `var(--color-*)`), **font family** (never declared; Outfit inherits from
   the shell), **type scale** (only the t-shirt tokens `var(--type-*)`),
   **spacing** (only `var(--space-*)`), and **border weight** (only the
   thin | regular | thick border tokens). Properties outside those axes
   (arrangement, alignment, aspect ratio, …) are free; radius/shadow/motion
   tokens exist and are preferred where they fit. The security bans are
   absolute and unrelaxed: fabricated or unknown classes, interactive
   descendants, scripts/event handlers, unsafe interpolation of user fields —
   and, inside styles, `url(...)` values, position values that escape the
   item's bounds, and field values interpolated into a `style` attribute
   (styles are literal in the renderer source). A new fail-closed design-lint rung
   renders hostile synthetic values, within the capability's declared collection
   layout, and feeds violations through the same bounded fix loop as the existing
   checks. Platform-owned payload, wrapper, and modal invariants are ordinary
   platform tests; they are not requirements the model can get wrong. *Closed
   values, open composition*: the contract closes the design-*value* space (the
   tokens) and the executable surface, never the arrangement.

5. **The builder is steered by injection, not a runtime tool.** Unit generation is
   one-shot structured output — agentic only *within* a unit's write→check→fix
   loop, never a roaming agent (ADR-0003). So design guidance reaches the model by
   injection (the contract plus a curated, repo-only few-shot gallery of 2–3
   deliberately different exemplars, with *"vary, don't copy"* framing) and is
   enforced by the gate rung (§4). No live "read the design system" tool is
   added; that would fight the deterministic-across-units discipline and add
   measured build latency (a thesis metric). The exemplars are LLM-facing only and
   are never rendered to the user.

6. **`ui_intent` records only capability-specific presentation intent.** M2's
   `views: ["list", "create"]` describes generated scaffolding that disappears in
   M3. Its replacement records (a) the item design direction, (b) the collection
   layout — a closed enum (`feed | grid`) the platform list
   container reads to arrange items, (c) the fields/order the detail surface
   shows, and, from Module 4, (d) exactly one closed list input mode for every
   active `string[]`. `comma_separated` is limited to comma-free atomic values
   such as tags/genres/categories; `repeatable` serves free-form values such as
   quotes/addresses/citations where commas may be data. Collection layout and
   list input mode are the same *kind* of structural presentation fact the
   platform already interprets (field type, required state, detail order):
   one closed value mapped to a platform container class, not a model-emitted
   view tree (fully declarative SDUI stays rejected, below). An unknown value
   fails the build closed, exactly as an unknown field type does. `table` and
   `masonry` are deliberately out of M3's set — a true table dissolves the
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
   give way to one item renderer, §1–§2). Because the project is greenfield and
   under development, that shape change is applied the simplest way: change the
   generators, `bun run reset`, and rebuild capabilities fresh under the new
   shape. M3 introduces no persisted `artifact_contract` marker, no dual-serving
   of old and new artifacts, and no atomic migrate-without-reset cutover. The
   original preservation design — keeping committed capabilities live and
   re-deriving them across a contract change without a reset — is deferred until
   the platform is feature-complete (post-M8), when real user data exists to
   preserve; it remains the platform artifact-contract upgrade the architecture
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
- **The Diff Engine (M4) sees one generated presentation unit.** It drops
  `list.html`/`create.html`; item direction/dependency or collection-layout
  changes may regenerate the item renderer, while a list input mode change
  selects only platform form/View normalization and no generated unit.
- **The spec schema changes shape.** `ui_intent.views` retires in favor of item
  intent + detail fields/order, and Module 4 adds strict per-active-`string[]`
  form list-input intent. The field-type pantry gains a `date` type (2026-07-06
  amendment, above) but is otherwise unchanged; `file` remains M6.
- **Metrics retain semantic continuity.** Item-renderer generation replaces M2
  view generation as the presentation-generation stage, so M8 compares the
  presentation-gen stage across module versions rather than assuming generated
  `.html`. M3 records no `artifact_contract` marker. If M8 needs to distinguish
  historical shapes, it adds a metrics-only dimension; the registry/serving
  upgrade marker remains deferred post-M8 (§7).
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
