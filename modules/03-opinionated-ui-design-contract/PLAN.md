# Module 3 — Opinionated Capability UI — Plan

Status: agreed (Module 3 grilling session 2026-06-26; collection-layout amendment
2026-06-30; inline-style token-discipline amendment 2026-07-01) — ready to
convert into issues

This refines [docs/modules.md](../../docs/modules.md) §Module 3 with the design
decisions that module ownership left open. It does not change Module 3's goal,
boundary, or exit criteria. Decision record:
[ADR-0005](../../docs/adr/0005-opinionated-capability-ui-design-contract-and-gate.md)
(platform presentation, one item renderer, the design gate, and — per the
2026-06-30 amendment — the closed collection-layout intent), which **amends**
[ADR-0004](../../docs/adr/0004-capability-artifact-contract-and-validation-isolation.md)
(artifact contract + validation isolation) and **reuses**
[ADR-0002](../../docs/adr/0002-sse-transport-conventions.md) (per-build SSE) and
[ADR-0003](../../docs/adr/0003-ai-provider-spine-and-coding-harness.md) (bounded
fix loop). Terms per [CONTEXT.md](../../CONTEXT.md) ("Engineering language"):
*item renderer*, *View*, *Gate*, *Handler*, *Action*.

## Decisions locked in the grilling session

1. **Thick shell, thin generation — the platform owns the structural chrome.**
   (ADR-0005 §1) The **modal** (open/close/prefill/focus), the **list
   scaffolding** (container + its closed `feed | grid` layout modes, empty state,
   "New X" button), the accessible **item wrapper**, and the **create/detail
   field rendering** become fixed platform modules. They implement no capability
   rule and hold no canonical state, so they are covered by **deterministic
   platform tests, not gate rungs**. Field rendering is centralized and
   exhaustive over the M2 pantry so M4's list types and M6's file types extend
   **one** place. Consequently `list.html` and `create.html` **cease to be
   generated units**, and a toolbar click renders the platform list scaffolding
   live from the spec (deterministic, no AI) with records still arriving through
   the `read` action — the "never-stale cache" property of ADR-0004 is preserved
   because data never enters the platform-rendered chrome.

2. **One generated creative surface: the item renderer.** (ADR-0005 §2) Each
   capability has one versioned generated unit that turns **one record** into the
   capability-specific inner markup. `create.ts` and `read.ts` (and `search.ts`
   in M4) receive it through a **capability-scoped presentation adapter** in the
   injected toolbox; handlers never import it or carry their own row markup. This
   replaces M2's four generated units (`handler:create`, `handler:read`,
   `view:list`, `view:create`) with **`handler:create` + `handler:read` + one
   `item-renderer`**, and kills create/read drift by construction.

3. **The platform owns item mechanics.** (ADR-0005 §3) The adapter wraps
   generated markup in the standardized accessible trigger, embeds the full
   record as an **escaped `data-item` payload** (`file` fields as references,
   never bytes), attaches click-to-open, and **enforces the allowed
   HTML/class/style surface at runtime on every rendered record** — so a dynamic
   field value cannot become executable markup even after build-time validation. The model
   owns *composition only*; not serialization, escaping, accessibility, safe
   insertion, or modal wiring. The modal opens **prefilled** even when the item
   visually truncates, so no read-single route is added (deferred behind the
   adapter as the documented escape hatch).

4. **A closed-value design contract.** (ADR-0005 §4, amended 2026-07-01)
   Generated item markup reaches first for an allow-list of semantic/primitive
   classes (categories: truncation, media frame, **intra-item** stack/grid for
   arranging one record's own fields, Tailwind-style **layout utilities** —
   flex, grid, alignment, gap — so common arrangement never needs `style`, …)
   whose CSS consumes the existing tokens
   ([design-system.md](../../docs/design-system.md)) — the sensible defaults,
   deliberately **not** an all-purpose CSS framework (rebuilding Tailwind is a
   non-goal; the escape hatch absorbs the long tail).
   When the vocabulary doesn't suffice, inline `style` is a **token-disciplined
   escape hatch**: the five platform-owned design axes are never redeclared with
   raw values — color (`var(--color-*)` only), font family (never declared;
   Outfit inherits), type scale (the t-shirt tokens `var(--type-*)` only),
   spacing (`var(--space-*)` only), border weight (the thin | regular | thick
   border tokens only); properties outside those axes are free.
   Forbidden absolutely: fabricated/unknown classes, interactive descendants,
   scripts/event handlers, unsafe field interpolation — and inside styles,
   `url(...)`, position values that escape the item, field values interpolated
   into `style`. *Closed values, open composition* — the contract closes the
   design-**value** space (the tokens) and the executable surface, never the
   arrangement. The exact class list and the escape-hatch rules are **authored
   in 3.1 and seeded into design-system.md** (ADR-0005 leaves names to this
   module).

5. **Collection layout is a closed `feed | grid` intent the platform container
   reads.** (ADR-0005 §6, amended 2026-06-30) `ui_intent.collection.layout` is a
   closed enum the platform list container maps to a token-consuming layout
   class. `table` and `masonry` are **deferred** — a true table dissolves the
   per-record creative surface (the platform would render aligned cells from
   fields, bypassing the item renderer) and overlaps M5's `data_query`
   auto-table. Default is `feed`; the AI authors `grid` for visually-dominant
   data. The item renderer is generated **knowing** the chosen layout, so item
   composition and collection arrangement are co-designed. An unknown value
   **fails the build closed**, symmetric with an unknown field type. This is the
   single new axis added beyond the 2026-06-26 grill.

6. **Design steered by injection, enforced by a new gate rung.** (ADR-0005 §5,
   §4) Guidance reaches the model by **injection** — the contract plus a curated,
   **repo-only** few-shot gallery of 2–3 deliberately different exemplars, each
   pairing an item composition with the collection layout it suits, framed
   *"vary, don't copy"*, **LLM-facing only, never rendered to the user**. No
   runtime "read the design system" tool (it fights ADR-0003's
   deterministic-across-units discipline and adds measured latency). A new
   **fail-closed design-lint rung** renders the item with synthetic **and
   hostile** field values *within the declared collection layout* and rejects
   off-token styling (raw values on the token-owned
   color/font/type/spacing/border axes, forbidden style constructs), unknown
   classes, executable markup, and
   unsafe interpolation —
   violations feed the **same bounded fix loop** as M2's type-check rung (the
   existing `DEFAULT_UNIT_FIX_ATTEMPTS` knob, default 2; reused, not new).
   Platform payload/wrapper/modal invariants are deterministic platform tests,
   not rungs the model can fail.

7. **`ui_intent` reshape + read-only detail modal.** (ADR-0005 §6) M2's
   `ui_intent.views: ["list", "create"]` retires. The new `ui_intent` records
   exactly the capability-specific choices that survive: `item` (free-text design
   direction), `collection.layout` (closed enum, decision 5), and
   `detail.shows` (the fields/order the detail surface shows). `modal: true` is
   **not** stored — the shared modal is a platform invariant, not model-authored
   state. The spec Zod schema in [`src/registry/spec.ts`](../../src/registry/spec.ts)
   changes shape accordingly; the M2 field-type pantry
   (`string | number | boolean | datetime`, each `required`) is **untouched**
   (`file` stays M6). Clicking the item wrapper opens the modal **prefilled and
   read-only** from the escaped payload; M4 adds the Save button to the same
   platform module.

8. **The artifact *shape* changes; preservation is deferred (greenfield).**
   (ADR-0005 §7, amended 2026-06-30) M3 re-cuts what a capability's generated
   artifacts are — platform-rendered views + one item renderer replace the four
   M2 units. Because the project is greenfield and under development, the M2→M3
   transition is the simplest possible: change the generators, **`bun run reset`,
   and rebuild capabilities fresh**. M3 builds **no** preservation cutover, **no**
   dual-serving of old/new artifacts, and **no** persisted `artifact_contract`
   marker. The migrate-without-reset path (and any contract marker M8 later
   wants) is deferred until the platform is feature-complete; the architecture
   still describes it as the end state (ARCH §2, §9.1). Until then, backwards
   compatibility does not drive design.

## The end-to-end flow (happy path)

Type *"save links with a title and a url"* →

1. **Unchanged M2 front.** `POST /prompt` → job → subscriber fragment swapped in
   → shell opens `GET /build/:id/stream`; prompt bar shows its courtesy busy
   state. The resolver classifies `new_capability` (M2 behavior, unchanged).
2. **Spec generation now authors the reshaped `ui_intent`** — `item` direction,
   `collection.layout` (`feed | grid`), `detail.shows` — alongside `schema` +
   `behavior`, Zod-validated to the new shape. Narration streams (product voice).
3. **Migration** derived deterministically and applied additively in a
   transaction (unchanged).
4. **Unit generation:** the **item renderer** (one unit) generated against the
   injected contract + few-shot gallery + the chosen `collection.layout`, through
   the bounded type-check fix loop; plus `create` + `read` handlers to the
   ADR-0004 skeleton that **call the presentation adapter** instead of emitting
   their own markup.
5. **Gate, fail-closed, in order:** structural (type-check handlers **and** the
   item renderer; assert exports) → smoke (scratch-db `create` → `read`
   round-trip, handlers render through the practice adapter) → behavioral (tier
   ON, from `behavior`, independent of handlers) → **design-lint** (render the
   item with synthetic + hostile values *within the declared collection layout*;
   reject off-token styling / unknown classes / executable markup / unsafe
   interpolation; failures re-enter the bounded fix loop). Platform
   wrapper/payload/modal invariants are platform tests, already green — not
   re-gated per build.
6. **Commit = one pointer flip:** write `capabilities/<id>/v<n>/` (item renderer
   + handlers), insert/point the registry row, render the committed View by
   composing the platform list scaffolding **in the chosen layout** with the item
   renderer, and swap content + toolbar (oob) in one SSE response. `done`.
7. **Metrics row:** presentation-gen now measures **item-renderer** generation
   (the semantic successor to M2's html-gen), per-rung outcomes **including
   design-lint**, and fix-loop attempts. (No `artifact_contract` marker in M3 —
   see decision 8.)

On any failure: roll back the migration transaction, leave the previous version
live, orphan new files for GC, stream a warm product-voice apology, and write the
metrics row (failure is data). A failed build never bumps a version or flips a
pointer. The M2→M3 shape change itself is a `bun run reset` + rebuild, not a
migration (decision 8). Each epic wires into the living `/demo/spec-build` surface
as it lands (CLAUDE.md "Living demo and HITL").

## Proposed issue slicing (atomic, per epic)

Suggested cut — `/to-issues` finalizes:

- **3.1 Closed-value contract + primitives** — (a) author the closed
  semantic/primitive class vocabulary (incl. the layout utilities) +
  token-consuming CSS, the thin/regular/thick border-weight tokens, **and the
  inline-style token-discipline rules (the escape hatch)**, seeded into
  design-system.md; (b) the runtime **allow-list enforcer** the presentation
  adapter applies to every rendered item (the §3 safety surface), with
  hostile-value tests.
- **3.2 Platform presentation modules** — (a) list scaffolding (container with
  `feed | grid` layout modes, empty state, "New X") + accessible item wrapper
  (trigger, escaped `data-item` payload, click-to-open); (b) the shared modal
  (open/prefill/focus), read-only content in M3; (c) the centralized, exhaustive
  create/detail field renderer (the one place M4/M6 extend); (d) retire
  `list.html`/`create.html` from generation and re-point `GET /capability/:id`
  (and the rehydration path in `src/web/cached-view.ts`) to render the platform
  list scaffolding from the spec. Platform-owned; deterministic platform tests.
- **3.3 Presentation intent + read-only detail modal** — (a) reshape `ui_intent`
  in [`src/registry/spec.ts`](../../src/registry/spec.ts) (retire `views`; add
  `item`, `collection.layout` closed enum, `detail.shows`) and update spec
  generation to author it; (b) wire the item wrapper's click-to-open to the
  prefilled **read-only** modal from the escaped payload.
- **3.4 One item renderer + presentation adapter** — (a) re-cut unit generation
  ([`src/builder/units.ts`](../../src/builder/units.ts)): replace the four M2
  units with one item-renderer unit through the bounded fix loop, plus
  `create`/`read` handlers that receive the adapter; (b) the capability-scoped
  presentation adapter in the router's injected toolbox (record → safe wrapped
  item HTML); handlers call it, never import. Amends ADR-0004's artifact
  contract.
- **3.5 Few-shot design gallery** — curate 2–3 repo-only exemplars, each pairing
  an item composition with its collection layout and obeying the contract; the
  injection harness that feeds contract + gallery + the capability's chosen
  `collection.layout` into the item-renderer prompt with *"vary, don't copy"*
  framing. LLM-facing only.
- **3.6 Design-lint gate rung** — add the fail-closed rung to
  [`src/builder/gate.ts`](../../src/builder/gate.ts): render the item with
  synthetic + hostile values within the declared collection layout; detect
  off-token styling / fabricated classes / executable markup / unsafe
  interpolation; feed
  violations through the existing bounded fix loop; capture the per-rung outcome
  for metrics.
- **3.7 Switch to the new artifact shape (reset, not migrate)** — make the M3
  shape (platform-rendered views + one item renderer) the only one the build
  pipeline produces and the registry/router serve; retire the M2
  `list.html`/`create.html` paths. The M2→M3 transition is **`bun run reset` +
  rebuild fresh** — no preservation cutover, no dual-serving, no persisted
  `artifact_contract` marker (deferred post-M8, ADR-0005 §7). This epic is also
  the end-to-end acceptance: a reset + rebuild yields styled, varied capabilities
  (the module demo).

The epics are **numbered in build order** — build them 3.1 → 3.7 top to bottom.
It is a tracer bullet: the contract (3.1) and platform modules (3.2) come first,
so a **hand-written** item renderer can round-trip through the wrapper into the
container (visible in the demo) before any AI; the `ui_intent` reshape (3.3)
gives the generator its spec shape; 3.4 makes the item renderer generated; the
gallery (3.5) raises quality and the design-lint rung (3.6) is the safety net;
3.7 lands last, retiring the M2 shape and proving a reset + rebuild yields the
styled result end to end. Precise blocked-by dependencies get pinned when
`/to-issues` slices these. The module's acceptance demo stays modules.md's
"Verify by running it" word for word.
