# Omni-CRUD: Phased Development Plan

> The build plan derived from [architecture.md](architecture.md), not a list of tickets.
> It defines the modules — the high-level phases. Each module contains epics, and each epic later breaks down into individual issues.
>
> Read [architecture.md](architecture.md) first: it explains what each piece is. This one explains in what order we build them and why.

## Scope — what this plan locks in, and what it doesn't

This plan locks in three things: the general architecture, the intended behavior, and the module boundaries. Nothing else.

It does not specify implementation — types, classes, function signatures, file layouts, templates, libraries, colors, or copy. The module that owns each of those decides it when the real constraints are known. Constraints surface, tools evolve, and better approaches appear mid-build, so read every epic below as intent and boundary, not as a finished spec.

Two things are left undefined on purpose:

- **Where a behavioural proposal appears (Module 8).** Deferred, not decided. It belongs to the pet — a talking companion that will carry Aluna's narration and is not designed yet ([Module 5's plan](../modules/05-the-desk/PLAN.md)). Everything around it is fixed: event capture, the gate, async inference, confirmation and hand-off to the build pipeline. One commitment holds regardless: nothing is built without an explicit confirmation. *(Module 6's answer surface was the other half of this and is now settled without the pet — the answer opens in its own window; see ADR-0008. Module 8 is free to settle its own surface the same way rather than waiting.)*
- **Every piece's internals.** Each module's implementation is its own to decide. The "verify by running it" demos describe observable behavior, not the code that produces it.

## How this plan is sliced

Every module is a vertical slice you can run and verify, not a horizontal layer.
There is no "types" module, no "registry" module, no "intent resolver" module,
because those pieces are useless on their own. Shared infrastructure — the
capability registry, data-access seam, router, orchestrator, AI call and the
surface capabilities appear on — enters inside the first feature that needs it,
and everything after either reuses it or deliberately deepens it.

Four rules govern the ordering:

1. **Scaffolding first.** Module 1 stands up the repo and wires every dependency together with zero domain logic.
2. **Explicit prompting before implicit prompting.** Modules 2–7 build the entire explicit loop end to end. Implicit (Module 8) reuses that work.
3. **Each module is progressive and self-contained.** Each builds on the one before it and is, on its own, a complete, demonstrable, testable piece of the product. Stop after any module and you still have a thing that runs.
4. **The demo stays alive.** Relevant runtime work reaches the current homepage
   demo as soon as it can be exercised. The demo may be ugly and
   developer-facing while it is temporary; it is the integration surface that
   keeps the pieces from drifting apart before the final end-to-end flow
   replaces it.

### The shared grounding vs. the implicit-only pieces

Both intent loops stand on one foundation: the capability registry, storage
layer, split mutation/query ports, router, orchestrator (intent resolver,
presenter-independent capability builder, diff engine), AI provider, mutation
coordinator, and desk. Modules 2–7 build all of it during the explicit phase,
because the explicit loop exercises every piece.

The implicit loop adds two things the explicit loop never needs: the event
tracker, which captures behavior at full fidelity in the shell, and the
classifier path that turns behavior into a proposal, which is the server-side
gate plus async intent resolution. That is why implicit is a single later
module — a thin layer on top of an already-complete explicit system, not a
parallel rebuild.

## Module map at a glance

| # | Module | What you can do at the end | Adds | Reuses |
|---|--------|----------------------------|------|--------|
| 1 | **Platform Scaffold & Runtime Spine** | Boot an empty platform: shell loads, server streams, AI answers, DB opens | Bun · Hono · HTMX · Alpine · SSE · dual SQLite connections · AI provider interface | — |
| 2 | **Explicit Loop I — Build Your First Capability** | Type a prompt → watch a working capability build itself → add & see records | Registry · data tool · router · builder · build queue · metrics writing · SSE swap | M1 |
| 3 | **Opinionated Capability UI** | The capabilities the app builds look and feel like a coherent product — styled lists, a shared modal, a prefilled detail view — not a 1990s form dump *(Module 5 replaced the modal with the one window; see §Module 3)* | Platform UI modules · single generated item renderer · closed-value primitive vocabulary · few-shot design gallery · design-lint gate rung · `ui_intent` (item/collection/detail) · new artifact shape (reset, no cutover) | M1–M2 |
| 4 | **Explicit Loop II — Full CRUD & Evolution** | Edit/delete/search records; extend or permanently delete a capability without breaking data/readers | `string[]` + model-authored list input modes · split data ports · mutation coordinator · total diff engine · immutable incarnated snapshots · recoverable activation/deletion · full resolver | M1–M3 |
| 5 | **The Desk** | Open a capability from its logo into the one window, put it away, rename or delete it from the desk; every capability carries a picture of its own | Wallpaper · logo layer · one window · drawn line everywhere · High Meadow tokens · capability logos · choice + long-text fields | M1–M4 |
| 6 | **Reads Set Free — Ad-hoc Data Queries** | Ask questions across your data; Aluna answers out loud; nothing is built | Bounded read-only query loop in a worker · spoken answers · a third window for answers · record counts | M4's physically read-only query seam |
| 7 | **Files — Upload, Store & Serve** | Create capabilities that hold files; upload, view, and delete them | S3-shaped object store · `file` field type · upload (write) · serve (read) · lifecycle | M1–M6 |
| 8 | **Implicit Loop — Behavior → Proposal → Build** | The app notices a pattern in how you work and offers to build for you | Event tracker · event log · server-side gate · async resolution · proposals | M1–M7 |
| 9 | **Experiment Harness — Metrics, Latency & Tuning** | Read the PoC's conclusions; tune the implicit gate against real data | Metrics querying · outcome/overlap analysis · experimenter surface · gate tuning | M1–M8 |

The explicit loop is complete at the end of Module 7. Module 8 turns on the second loop; Module 9 makes the experiment legible.

## Module 1 — Platform Scaffold & Runtime Spine

**Goal:** a running platform with every wire connected and zero domain logic. Nothing builds capabilities yet, but the shell renders, the server streams, the AI provider answers, and the database opens — the "no-dependency-tax" stack from ARCHITECTURE §4, stood up and proven.

**Why first:** everything downstream assumes these wires exist. We prove the stack works before we put any thinking on top of it.

### Epics

- **1.1 — Project & toolchain.** Bun project, TypeScript config, directory layout (`capabilities/`, `storage/`, db location), dev/build scripts, lint/format. (ARCH §4)
- **1.2 — Hono server + the fixed shell.** Serve the shell page with HTMX + Alpine. Base product-voice layout and styling. Renders the three shell regions as inert placeholders: prompt bar, empty capability toolbar, empty content area. (ARCH §6.1) *Module 5 retires all three: the toolbar becomes the logo layer (5.4), the content area becomes the window the client creates and destroys (5.6), and the page stops being one that never changes after first load.*
- **1.3 — SSE streaming primitive.** Server→client Server-Sent Events channel. A demo stream that pushes tokens; client wiring that swaps/appends streamed HTML into the content area. (ARCH §4, §6.2)
- **1.4 — SQLite foundation.** Open a read-write connection and a separate read-only connection (`SQLITE_OPEN_READONLY`). A migrations runner for platform-owned schema. No domain tables yet: the modules that need them create them. (ARCH §4, §6.3, §7)
- **1.5 — Pluggable AI provider.** A thin `generate(prompt, schema)` streaming contract realized by the Vercel AI SDK (in-process, Bun, BYO-key) behind a `baseURL`-keyed provider registry, with a single configured global model. The SDK targets the Anthropic- and OpenAI-compatible wire shapes, so one config change swaps the global model across Claude, GPT, Gemini, and the open Chinese coding models (Qwen, GLM, Kimi, MiniMax, DeepSeek). One round-trip proves a structured response streams back, shown live in the shell where the real provider answers a user-initiated trigger, not in a paid unit test. (ARCH §4 "Model strategy"; see [ADR-0003](adr/0003-ai-provider-spine-and-coding-harness.md))
  > **Note (forward-pointer to M2–M4):** 1.5 stands up the provider contract and nothing else — the streamed structured round-trip and the one-line model swap — which keeps Module 1 on its "zero domain logic" line. The code-writing harness is a bounded tool-loop scoped to a single build unit (write → type-check → fix), and it lands with the Capability Builder in epic 2.5, tightened with behavioral repair in 4.7. We deliberately adopt no roaming autonomous agent, no hosted agent API and no execution sandbox; the harness discipline — pipeline, diff, gate, migrations — stays ours. ADR-0003 carries the full rationale and the rejected alternatives.

### Verify by running it
`bun run dev` → open the browser → the shell renders with an empty toolbar and a prompt bar → click *Meet Aluna* and the real AI provider streams a product-voice greeting into the content area (a structured round-trip, end to end) → the SQLite file exists with the migrations table.

> **No longer runnable as written (records Module 1's exit state).** Epic 2.6 replaced the *Meet Aluna* button with the prompt bar, and Epic 4.8 removed the `/stream` route behind it. To exercise the same structured round-trip now, type a prompt into the prompt bar and watch the spec stream in — still the only place the configured provider runs for real, since no test calls the API.

### Exit criteria
The app boots and stays up. Shell, SSE, AI provider, and both DB connections are independently proven. No capability logic exists anywhere.

## Module 2 — Explicit Loop I: Build Your First Capability

**Goal:** prove the thesis. A user types a prompt, watches the app build a capability for that prompt, and immediately uses it. Scope is deliberately the smallest complete vertical slice: one new capability with the create + read subset of CRUD. This module stands up the entire shared backbone the rest of the project reuses.

**Why second:** this is the moment the premise becomes real — *the app writes
itself*. Everything here (registry, data-access seam, router, builder, queue,
metrics, SSE swap) is reused and deepened by Modules 3–8.

### Epics

- **2.1 — Capability Registry (source of truth).** The store for spec rows: `id, label, version, schema, ui_intent, behavior, behavioral_errors, tools, artifacts_path, prompt_context`. Read/write access. Toolbar rehydrates from it on load. (ARCH §6.3 "Capability Registry")
- **2.2 — Constrained data tool + additive DDL.** Generate a `CREATE TABLE` migration from a spec; expose row-level `insert` + `select` keyed by capability; a JSON escape-hatch column. Writes go through the tool only; reads use the read-only connection. (ARCH §3, §6.3 "Data Tables", §7 "Writes")
- **2.3 — Deterministic router.** The fixed `/capability/:id/:action` convention; load and run the matching generated handler file. Routing is never an AI concern. (ARCH §6.2 router)
- **2.4 — Minimal intent resolver (`new_capability` only).** Prompt + registry context → a structured intent that seeds a new capability spec, plus the `user_facing_label`. Only the new-capability path for now. (ARCH §6.2 "Intent Resolver")
- **2.5 — Capability builder (new path) + global serial build queue.** The atomic pipeline: spec → additive migration → generate `create` + `read` handler `.ts` → generate `list` + `create` HTML → validate through a layered, fail-closed gate (typecheck + assert action signatures; smoke insert; and, when the behavioral tier is on, execute tests generated from the spec's `behavior` + stable `behavioral_errors`, independently of the handlers) → commit (write `v1/` artifacts, registry row, pointer flip). The behavioral rung is a global toggle, so its added latency stays measurable against the no-test baseline; it lifts "validated" from *compiles and runs* to *behaves as specified*. Single-flight build queue. Product-voice narration over SSE throughout. (ARCH §6.2 "Capability Builder", §8 "Concurrency", §9.1, §9.5)
- **2.6 — Shell render + commit swap.** Stream narration as it builds; on commit, swap the content area and update the toolbar out-of-band (`hx-swap-oob`) in one SSE response. Clicking a toolbar entry loads that capability's cached HTML. (ARCH §6.1, §6.2 Diff Engine basics)
  > **Historical closure:** Module 2 vendored the HTMX SSE extension and proved
  > the per-build ephemeral `sse-connect`/`sse-close="done"` path plus OOB toolbar
  > swap. Module 4 reuses that explicit presenter but keeps SSE/DOM ownership out
  > of the core Builder so Module 8 may choose another presenter. See ADR-0002.
- **2.7 — Metrics writing.** One metrics record per generation: timing breakdown (incl. test-gen and test-run when the behavioral tier is on), per-rung gate outcomes and any retries, model, tokens, outcome. The test-tier columns are what let M9 quantify behavioral verification's cost against the no-test baseline. (ARCH §6.3 "Generation Metrics", §6.2)

### Verify by running it
Type *"I want to keep track of my notes."* → watch the friendly narration build it → a *Notes* tab appears in the toolbar → the content area shows a list and an "add note" form → add a note → it persists → refresh the page → the toolbar rehydrates and the note is still there. A metrics row was written for the build.

### Exit criteria
A typed prompt produces a real, persisted, usable capability with create + read,
committed atomically and validated before going live. The first backbone
(registry, data-access seam, router, builder, queue, metrics, SSE swap) exists and
is evolved rather than bypassed from here on.

## Module 3 — Opinionated Capability UI

**Goal:** make the capabilities the app builds look and feel like a coherent product, without a developer hand-crafting each one. Today a freshly built capability is born usable but ugly: the builder gets no design guidance, so it reproduces the same bare *[title][empty state][form]* scaffold every time. This module moves the structural mechanics into the platform — a shared modal, list scaffolding, accessible item wrapper, and spec-rendered fields — and hands the builder one generated item renderer, governed by a closed-value design contract, a few-shot exemplar gallery, and a design-lint gate rung. Every capability comes out consistent and on-brand while item composition still varies to fit the data.

**Why third:** Module 2 proves a capability can be born; it is born ugly. We fix how capabilities present before making them fully evolvable (M4), because every later surface — edit forms, search results, file thumbnails — inherits this presentation contract. Doing it now means Full CRUD builds on the contract instead of retrofitting it later. It reuses the M2 backbone (builder, gate, registry, SSE swap) and adds no new loop.

### Epics

- **3.1 — Closed-value design contract + primitive vocabulary.** Promote the token layer into a closed contract: generated item markup may use only allow-listed semantic/primitive classes (truncation, media frame, intra-item stack/grid for arranging *one record's own* fields — distinct from the collection layout, which the platform container owns — and Tailwind-style layout utilities: flex, grid, alignment, gap), whose CSS consumes the design tokens. The token layer owns the design values — theme colors, the default Outfit font, the t-shirt type scale, the base spacing unit, the thin/regular/thick border weights (retired in epic 5.2, which hands every boundary to the ink system and never declares one) — and generated markup never redeclares them raw. When the class vocabulary doesn't suffice, inline `style` is allowed as a token-disciplined escape hatch, free in any property outside the token-owned axes. The vocabulary is sensible defaults, not an all-purpose CSS framework; the escape hatch absorbs the long tail. Fabricated classes and executable markup stay forbidden absolutely. (CONTEXT.md voice; [design-system.md](../design/design-system.md))
- **3.2 — Platform presentation modules (the thick shell).** Build the shared, platform-owned presentational modules every capability uses: modal (open/close/prefill/focus), list scaffolding (container with its closed `feed | grid` layout modes, empty state, "New X"), accessible item wrapper, safe composition of generated item output, and create/detail field rendering from the spec. Keep field-type dispatch exhaustive and centralized so M4 list types, M5 choice and long-text types, and M7 file types extend one place. Presentation only, no business logic — the same line ARCH §7 draws for `data_query`. So `list.html` and `create.html` stop being generated artifacts. (ARCH §6.1, §7; [ADR-0005](adr/0005-opinionated-capability-ui-design-contract-and-gate.md))
- **3.3 — Presentation intent + detail modal (read-only).** Replace M2's generated-view list in `ui_intent` with the capability-specific choices that remain: item design direction, the collection layout (a closed `feed | grid` value the platform container reads), and detail fields/order. The modal itself is a fixed platform invariant, so `modal: true` is not model-authored state. Clicking the standardized item wrapper opens it **prefilled** from the escaped record payload. Read-only in M3; M4 adds editing to the same module. (ARCH §6.3 "Capability Registry")

  > **Superseded by Module 5 (5.7).** There is no modal anywhere in Aluna any more.
  > A record opens as an ordinary view swap *inside the one window* — the collection
  > goes, the record's form takes its place, and Back brings the collection back as a
  > fresh read. `showModal()`, the focus trap, the inert template clone
  > and the page-wide inertness were deleted rather than ported. Everything else in
  > this epic stands: `ui_intent` still carries the item direction, the closed
  > `feed | grid` layout, and the fields a record shows.
- **3.4 — One item renderer, shared by every action.** Re-cut the artifact contract: each capability gets one generated item-renderer unit. The router extends the injected toolbox with a capability-scoped presentation adapter that supplies it to `create.ts`, `read.ts`, and later `search.ts`; handlers never import it or duplicate markup. The platform wrapper owns the escaped `data-item` payload, accessible trigger, and click-to-open behavior. Amends [ADR-0004](adr/0004-capability-artifact-contract-and-validation-isolation.md); see [ADR-0005](adr/0005-opinionated-capability-ui-design-contract-and-gate.md).
- **3.5 — Few-shot design gallery.** A curated, repo-only set of 2–3 deliberately different item-renderer exemplars, each pairing an item composition with the collection layout it suits (text-forward cards in a `feed`, media tiles in a `grid`, compact metadata rows in a `feed`) and obeying the same contract while composing differently. They enter the unit prompt alongside the capability's chosen `collection.layout` with explicit *"vary, don't copy"* framing. LLM-facing only, never rendered to the user. (ADR-0005)
- **3.6 — Design-lint gate rung.** A new fail-closed rung in the existing layered gate: render hostile synthetic field values and reject off-token styling (raw values on the token-owned color/font/type/spacing/border axes, forbidden style constructs), fabricated/unknown classes, executable markup, and unsafe field interpolation — fed back through the same bounded fix loop as the type-check rung. Item payload, accessibility and modal invariants are platform-owned and covered by deterministic platform tests, never delegated to the model. (ARCH §6.2 gate; ADR-0005)
- **3.7 — Switch to the new artifact shape (reset, not migrate).** Make the M3 shape (platform-rendered views + one item renderer) the only one the build pipeline produces and the registry/router serve; retire the M2 `list.html`/`create.html` paths. Because the project is greenfield, the M2→M3 transition is `bun run reset` plus a fresh rebuild: Module 3 builds no preservation cutover, no dual-serving, and no persisted `artifact_contract` marker. That preservation path and its registry/serving marker wait until the platform is feature-complete (ADR-0005 §7); M9 may add only a metrics classification for historical shape comparison. (ADR-0005)

### Verify by running it
Run `bun run reset`, then build *"I want to keep track of my notes"* fresh → the styled list truncates long text and exposes a *New note* button → the shared modal opens with an on-brand form → a created note appears through the same item renderer used by the read path → clicking its platform-owned wrapper opens the same modal prefilled and read-only. Build *"save links with a title and a url"* and confirm its item composition differs from Notes while reusing the same modal and primitives; build something visual (e.g. *"a place for my photos"*) and confirm it comes out as a `grid` collection while Notes stays a `feed`. Finally, make an item renderer emit an unknown class or unsafe field value and confirm the design gate fails with friendly narration and no pointer flip.

> **No longer runnable as written (records Module 3's exit state).** Module 5 (5.6, 5.7)
> replaced the shared modal with the one window and an in-window view swap, so every step
> above that says "modal" now happens inside the window: open a capability from its logo,
> press *New note* in the collection, and press a record to swap the collection out for
> that record's form. Everything the steps actually check — the truncation, the differing
> item compositions, the `feed`/`grid` choice, and the design gate's fail-closed refusal —
> is unchanged and still worth running.

### Exit criteria
All capabilities present through platform-owned modal/list/form/item-wrapper modules. One generated item renderer is the builder's creative surface and is shared by every action through the presentation adapter. The closed-value contract is fail-closed; the collection layout is a closed `feed | grid` choice the platform container honors; clicking an item opens a prefilled read-only modal; future field types extend one centralized renderer. The M2 `list.html`/`create.html` artifact shape is fully retired; the platform produces and serves only the M3 shape.

## Module 4 — Explicit Loop II: Full CRUD, Evolution & Minimal-Diff Rebuilds

**Goal:** make capabilities fully usable and evolvable. Add update/delete/search,
complete intent handling, a total positive-proof Diff Engine, immutable
incarnation/version snapshots, recoverable cross-store activation/deletion, and
the reusable resolved-request Builder seam the later implicit loop needs.

**Why fourth:** Module 2 proves a capability can be born and Module 3 makes it
presentable. This proves it can grow or be permanently deleted without corrupting
records, breaking surviving readers, reusing stale generated modules, or claiming
filesystem/SQLite atomicity that does not exist.

### Epics

Epics 4.1–4.3 keep intermediate mainline runnable without lying about artifacts:
4.1 resets and cuts loader/cache identity to incarnation-keyed paths while the
prompt Builder still emits the exact M3 `create | read` set; 4.2–4.3 use one
complete hand-written five-Action reference capability. Epic 4.4 resets once more,
removes the transitional two-Action allowance and development-only hand-written
reference fixture, and makes that exact five-Action shape the sole generated/live
M4 contract. This is bounded development sequencing, not persisted dual-serving.

- **4.1 — Incarnation-keyed, evolution-ready field & input contract.** Reset, add
  capability incarnation, and immediately cut artifacts/loaders to
  `<id>/<incarnation_id>/v<n>`. Add labels/lifecycle, nullable storage + logical
  requiredness, `string[]`, the model-authored `comma_separated | repeatable`
  list input modes, reserved presence/target parsing, and the closed `created_at`
  descriptor. The real-route `create | read` tracer stays honest about its exact
  files while proving both input modes, canonical ordered arrays, and inactive
  preservation.
  (ADR-0004, ADR-0006; ARCH §2, §6.3)
- **4.2 — Mutation coordinator, split tools & complete routing Actions.** One
  ownership-checked coordinator admits every shared-connection write. Split
  capability-bound `insert/update/delete` from physically read-only per-Action
  declared SQL; make update a target-separated merge patch; lock submitted-field
  presence, the GET/POST Action matrix, target-bound update/delete, and target-id→
  platform-internal canonical-row rehydration with Action-safe Handler projections.
  Prove cross-capability mutation is unavailable through the supplied interface, a
  declared join succeeds, scratch adapters expose only synthetic data, and a direct
  record write cannot join a paused build transaction. Generated execution remains
  in-process; structural/static checks protect against known accidental bypasses,
  not adversarial code. Exercise it through the complete hand-written reference capability.
  (ARCH §3, §7, §8; ADR-0004)
- **4.3 — Full CRUD platform presentation.** Keep item activation read-only; add an explicit edit mode to the shared detail modal whose Save invokes `update`. Put record Delete only in the read modal, with inline Confirm/Cancel platform chrome and no second dialog. Add the platform-owned debounced search field above the collection, including clear/loading/no-matches behavior; create/update/delete success reruns the current search/read and refreshes the collection through the shared item renderer. (ADR-0005; ARCH §6.1, §9.3)

  > **Superseded in placement by Module 5 (5.7).** Every rule here still holds and the
  > surface it holds on is the window, not a modal: a record opens as an in-window view
  > swap, the modal's action row became the form's action row, and Delete's inline
  > Confirm/Cancel is where it always was — inside the record, with no second dialog.
  > Aluna has no read view of a record any more either: the form *is* where a record is
  > read as well as changed. The search field, its states and the post-mutation refresh
  > are unchanged.
- **4.4 — Final M4 cutover; generate & Gate full-CRUD v1 capabilities.** Reset,
  remove the transition/reference fixture, then generate five Handlers plus
  `item.ts` from Action-projected contexts. Whole-snapshot structural validation
  and full CRUD/search smoke are always on. The adversarial search fixture proves
  scalar/list inclusion, exclusions, AND/literal semantics, platform
  compatibility decomposition plus Latin-script accent folding and
  locale-independent lowercase normalization, canonical rows, and stable order.
  The behavioral tier covers all Actions and errors independently.
- **4.5 — Immutable snapshots, publication, metrics & atomic activation.** Start
  with one greenfield reset/rebuild so the surviving five-Action v1 is born in
  unique staging under the new contract rather than recutting 4.4's final path.
  Write an exact `spec.json` and a non-routing `snapshot.json` carrying
  inventory, digests and tier state plus audit-only per-unit
  dependency-generation provenance; publish no-overwrite under
  `<id>/<incarnation_id>/v<n>`; registry-CAS and `success/activated` metrics
  activate together at the point of no return. Before 4.6 lands candidate
  generation and the Diff, use one hand-authored v2 and a temporary
  regenerate-all tracer, then remove that seam. A post-activation presenter or
  transport failure cannot undo success, and the UI recovers from the registry.
  Boot and pre-build reconciliation handle abandoned staging, never-activated
  `v>N` candidates, and interrupted metrics without reclaiming committed
  `v1..vN` history. (ADR-0006; ARCH §2, §6.2)
- **4.6 — Additive evolution & total Diff Engine.** The complete lifecycle-aware
  candidate emits typed change facts through one normative monotone matrix. Fact
  effects union; copy requires positive proof; free-text behavior regenerates all
  Handlers; malformed Action ownership and unknown facts fail closed. Old
  Handler/item source enters model context only after deterministic checks prove it
  fits that unit's candidate generation contract; otherwise regeneration starts
  without it. Byte-copy remains separately governed by positive Diff proof. Full
  candidate smoke remains mandatory.
- **4.7 — Evolution Gate & frozen-intent repair.** Test generation follows
  behavior/errors, target active-schema validation shape, and per-Action dependency
  identities; execution follows Handler impact. Tier-off snapshots have no tests;
  off→on generates from current intent on the next spec-changing build (not a
  semantic no-op); copied frozen tests rerun after covered code changes, with
  full-suite fallback only for non-total valid-test coverage/failure attribution.
  Changed Action suites author with bounded concurrency, settle in canonical
  order before Handler work, and stream per-Action liveness. Repair never edits
  tests.
- **4.8 — Resolver, explicit presenter, active context & overlap.** Act on
  `new_capability | extend_capability | ui_change`; keep `reject`/`data_query` out
  of the Builder; resolve meaningful separate capabilities. Separate the resolved
  build request/core lifecycle from the explicit foreground SSE presenter so M8
  can reuse it without reclassification or forced foreground UX. Bind
  `expected_absent` or exact id/incarnation/version plus the resolver-visible
  catalog revision/fingerprint, and refuse either mismatch as stale after lease
  acquisition before freezing the separate dependency-generation catalog.
- **4.9 — Dependency-safe permanent capability deletion.** Zero-AI confirmation
  atomically acquires mutation ownership, revalidates/refuses declared dependents, closes the
  target to new reads, collects resources before table drop, commits a non-routable
  tombstone, then idempotently cleans artifacts/resources/Event Log payloads.
  Multi-incarnation reads acquire their full token set atomically. Event ownership
  is server-derived, M7 deletion absorbs committed/pending/cleanup file states, and
  the UI restores the canonical View before tombstone, then removes the target
  route/toolbar entry at commit; active-target deletion goes neutral while an
  unrelated active View remains. Cleanup retries cannot resurrect it, and
  recovery reserves the identity until cleanup completes. Late Event Log batches
  cannot resurrect payloads, a same-id rebuild gets a new incarnation, and
  content-free incarnation-keyed metrics remain. (ADR-0006; ARCH §8, §9.3)

### Verify by running it
Run `bun run reset`, build Notes with tier on, add scalar/list/non-text/hidden test
data, and evolve due date/item presentation. Confirm affected generation, copied
units, rerun frozen tests where code changed, complete incarnation/v2 snapshot,
atomic metrics+pointer activation, preserved records, and one View commit. Exercise
partial update preservation and the complete adversarial search baseline. Prove a
declared dependent blocks Notes deletion; remove it, fault/recover cleanup, then
recreate Notes with a new incarnation and new v1 code (no stale import cache).

> **Still runnable, on a different surface (records Module 4's exit state).** Module 5
> replaced the shell's three regions with the desk, so "open Notes" is now "press the
> Notes logo", the View arrives inside the one window, and a record opens by swapping the
> collection out rather than by opening a modal. Deletion moved with it: it is on the
> logo's own context menu (5.9), and its confirmation fills the window. Everything this
> step actually checks — the diff, the frozen tests, the snapshot, the atomic activation,
> the preserved records, the dependent block and the clean recreation — is unchanged.

### Exit criteria
Full CRUD uses scoped mutations plus declared free reads; update/search contracts
are deterministic; complete candidates flow through total diffs, tier-honest frozen
tests, immutable self-describing snapshots, recoverable publication, measured
activation, and a presenter-independent Builder. Dependency-safe zero-AI deletion
removes product state/resources/payloads with recoverable cleanup while retaining
only content-free incarnation-keyed metrics. The explicit build/extend engine is
ready for later loops.

## Module 5 — The Desk

**Goal:** give Aluna the surface the design settled. A wallpaper, the logo of
every capability the user has, a floating prompt bar, and one window holding
everything a capability shows — its collection, one record, a confirmation, and
the narration of a build. Every boundary on that surface is drawn rather than
ruled, and every capability is born into a bounded logo lifecycle that yields
immutable artwork or an honest permanent placeholder. The form gains the choice
type plus long-text and guidance controls real records have been missing. The decisions and the epic
breakdown are in [modules/05-the-desk/PLAN.md](../modules/05-the-desk/PLAN.md),
and the surface they describe is running in [design/](../design/index.html).

**Why fifth:** the desk changes the shape of all four modules ahead of it. Reads
needs the window to answer into. Files present in a record view that is now an
ordinary view swap rather than a modal. The implicit loop's proposal needs a
surface only the desk defines. The harness inherits its second-window precedent
from the developer panel. Building any of them against the shell being deleted is
work done twice. This module also removes as much as it adds: the capability
toolbar, the header row, the sidebar, and the detail modal with its focus trap,
including `public/detail-modal.js`, `detail-modal-refresh.js` and
`src/presentation/detail-modal.ts`.

### Epics

Epic numbers preserve the main build order. 5.1 → 5.4 is the shared trunk and
5.5/01 performs the last reset. From there, hosted-provider work in 5.5/02–04 may
proceed independently of the window/content path in 5.6 → 5.9. They rejoin at
5.10/01, before the final record-bearing form corpus makes any further reset
unacceptable; 5.10 → 5.11 then closes the module. Each epic's issues live under
`modules/05-the-desk/<epic-slug>/issues/`, numbered from `01` in the order they
are taken.

- **5.1 — The token layer, and the corpus it invalidates.** `design/styles/`
  becomes the shipped stylesheet rather than a reference mockup, token names
  included, so one copy of every value exists and no second layer can drift
  against it. ADR-0001's *visual* half is superseded by it; the warm
  first-person product voice, the Aluna name and the pet's deferral that same
  ADR carries survive untouched, while the styled wordmark goes with the
  header row that carried it and is placed nowhere else. The 13 capabilities
  under `capabilities/` are deleted rather than rebuilt against the new
  vocabulary: they have no logo and never went through the current logo contract,
  so nothing survives that speaks the old token names. The reset-bounded cut also
  removes `ui_intent.detail.shows` before any High Meadow capability is rebuilt;
  the temporary modal derives active form fields until 5.7 deletes it. The design-lint
  rung re-derives in the same breath, because it still demands the vocabulary
  this epic deletes and nothing can be built until it does: its approved-value
  list narrows to three properties picked from a list — colour, type size,
  spacing — plus three never declared at all, font family, `border-radius` and
  `box-shadow`. Radius and shadow are absences in this design rather than
  shorter lists, and the shadow ban is the only thing that catches a silent
  failure, because the shadow tokens are now bare `<x> <y> <alpha>` numbers and
  `box-shadow: var(--shadow-*)` produces an invalid value. The fourth ban,
  `border`, waits for 5.2. C12's measured contrast failure is resolved here too,
  while the palette is being laid down, so no known AA failure ever ships: the
  two greens change places. The layout kit — `.stack`, `.cluster`, the flex and
  grid utilities, `.gap-*`, `.text-*`, `.truncate`, `.line-clamp-*`,
  `.media-frame` — ships as a real stylesheet under its current names, and
  `layout.css`'s own incidental `.stack` is renamed to free the name every
  generated screen already speaks. `controls.css` and `form-controls.css` stay
  two files and lose their dead rules instead: concatenated they run 693
  non-blank lines against a 500-line ceiling, `controls.css` is no subset of the
  other, and fifteen of its twenty-four rules are dead or exact duplicates.
  Layout and type go to rem so browser text scaling grows the box along with the
  text, while the ink line's weight and deviation, the logo tile's 32px box and
  1.25px contour, and the 10% corner stay in pixels, because they describe a
  picture rather than a layout.
  (M5 plan 7, 8, 10 (three axes, three bans), 11, 12, 43 (the C12 swap), 46, 49)
- **5.2 — The drawn line, and the border ban.** Every visible
  boundary deviates from true, is inked twice and is mitred, at one 2px weight
  with the hierarchy in the amplitude. It reaches into generated content: the
  record cards, rows and tables a capability produces are drawn too, seeded from
  the record's own id so the hand survives a view swap and a resize without the
  spec, the generator or the registry learning the ink system exists, and resize
  is observed once per list container rather than once per card. With generated
  boundaries drawn, ADR-0005's fourth closed axis loses its successor list and
  `border` joins the three properties 5.1 already banned — the ink system owns
  every boundary. That ban could not land earlier: a generated card with neither
  a border nor a drawn boundary is invisible. A generated screen can no longer
  express hierarchy through line weight; it rides on the three hands instead.
  (M5 plan 9, 10 (the fourth ban); design D10, D11)
- **5.3 — Content-region lifecycle and loud swap targets.** Cleanup ties to the
  content region rather than to the window, so whatever the content started —
  in-flight fetches, search controllers, server read tokens — is released when
  that content is replaced or removed, which covers a view swap as well as
  putting the window away. This is the one ordering constraint the plan fixes:
  it lands **before** the window ships, because once the window exists, putting
  it away becomes the only path by which a region disappears. It is also a live
  defect today — a fetch resolves against a detached node and the server-side
  read token stays held until the handler timeout — so it is proven against the
  shell's current content area first. `commit` and `fragment` keep addressing a
  stable id and the client guarantees that id is present whenever a swap can be
  in flight; the `class="shell"` swap that fails silently today throws like the
  rest. (M5 plan 13, 16; ADR-0002)
- **5.4 — The desk: wallpaper, logo layer, prompt bar.** Capabilities live on
  the ground as logos and there is no taskbar, so the logos are the only
  standing list of what exists. They fill down a column and wrap to the next,
  taking as many columns as the desk's height and width allow, in place of the
  two fixed tracks that used to sit inside an `overflow: hidden` box and cut
  off everything past about a dozen — a product whose premise is *make as many
  tools as you want* cannot have a ceiling of eleven. The prompt bar floats
  clear of all four edges, never full width, and its clearance, read from the
  stylesheet that owns the geometry rather than restated in JavaScript,
  becomes a floor no window may be dragged or resized into. `design/` already
  does both: the logo grid is bounded top and bottom and flows down a column,
  so `auto-fill` derives four rows from a 660px desk and twenty capabilities
  stand in five columns unclipped, while `--prompt-clearance` lives in
  `tokens.css` and `desk-geometry.js` reads it back. The shipped shell has
  neither, which is what this epic carries over. Every tile is the designed
  placeholder until 5.5 gives it a face. The `hasCapabilities` check
  goes: an empty desk is a wallpaper and a prompt bar and reads correctly with
  nothing hidden. The capability toolbar, its rehydration, the header row and
  the sidebar are deleted here. An admitted new-capability build owns a
  build-id-keyed provisional tile; activation replaces it, every non-activating
  terminal removes it, and non-build resolver outcomes never create one. (design D4, D5; M5 plan 1 (the three layers),
  3, 4, 5)
- **5.5 — The capability logo.** A successful v1 commits `absent/0`; after its
  presenter terminates and the long build lease releases, a follow-up offers the
  first atomic claim. No refused or never-activated build pays for artwork, and
  provider failure cannot relabel success. Its first issue performs the last reset
  and becomes the fork point; the provider-backed remainder does not block the
  independent window/content path through 5.9, so landing it early de-risks the
  module's one outside dependency. It rejoins before 5.10 because that reset must precede the final
  record-bearing form corpus. The model names a `subject`
  phrase, a `ground` and a `companion` — each one of eight hue families, signal red
  reserved, and the two must differ — plus a `noun` for the desk's
  empty-state copy; because every shade in the ladder those families open onto is
  saturated and light by construction, validation is a word-list check and the
  chroma-and-lightness validator is deleted outright. Which of a family's four
  shades a capability wears is resolved from its incarnation seed, not authored:
  the model collapses to one modal colour per neighbourhood of prompts, and the
  seed is the only entropy in the path. The request carries the ground first and the
  companion second, so the ordering is fixed in one place and no caller choice is
  hidden in the provider. The companion was derived from the ground by a closed
  four-pair lookup until 2026-08-25, when that cap — four pairs for the whole
  product, and a certain collision on a desk of five — retired it.
  The registry gains the
  per-incarnation seed and durable `{ status, attempts }` lifecycle, including an
  atomic `generating` claim. Artwork lives once at the incarnation root beside,
  never inside, immutable `vN` snapshots. Delivery is an
  incarnation-keyed route declared `image/svg+xml` and marked immutable — safe
  across delete-and-recreate precisely because the URL and bytes bind the exact
  incarnation. Only `present` emits it; placeholder/missing responses are
  `no-store`, so absence cannot be cached past a later successful attempt. Headers
  make the file picture-only and compression rather than stripping, so the C2PA
  manifest survives at a third of the bytes. Loading the desk retries every
  faceless capability through the same claim, to a hard cap of three total
  attempts even across concurrent loads, after which the placeholder is permanent.
  One no-store, incarnation-bound, load-triggered POST per absent tile performs
  the claim and returns tile-scoped markup, so initial desk rendering and the
  already-ended build stream do not wait on provider I/O; paid work is never GET.
  Recovery reconciles interrupted claims and removes their attempt-scoped stale
  temp without touching an accepted final file. A prompt trying to direct a logo is refused by the
  intent classifier, under the same rule that refuses "move this 2px right".
  ([ADR-0007](adr/0007-capability-logo-contract.md); M5 plan 34–42)
- **5.6 — The window, and the developer panel's second one.** One window, dragged
  by its title bar and resized from the bottom-right corner, with two lamps —
  leaf maximises, clay puts it away — and no minimise, because with no taskbar a
  minimised window hides exactly as thoroughly as a closed one and both come back
  by the same click on the same logo. The window is created and destroyed by the
  client. The toolbar/content anchors go here; the modal anchor stays functional
  until its replacement lands in 5.7, which then collapses page assembly to the
  logo layer alone. The shell may remember how things look to the user; it
  never decides what is true — geometry and maximised state are presentation and
  the shell's to keep, while which records exist and what an intent was stay the
  server's alone. Maximised is stored as a flag and recomputed
  against the current screen, the normal box doubles as the pre-maximise box, and any
  stored box is clamped to the viewport on load and on resize, which is also the
  `window` resize listener `design/scripts/` currently lacks. `/capability/:id`
  opens the desk with that capability in the window and putting the window away
  returns to `/`. Below the 720px breakpoint the window is the screen: `desk--phone`
  is set rather than only read, and the drag and grip handlers do not bind at all
  rather than binding to hidden controls; phone mode ignores rather than overwrites
  desktop geometry, and exposes only the frontmost full-screen window. The developer panel is the one second
  window — read-only, opened from its own tile, allowed to sit beside the
  capability being watched; its tile focuses an open panel and its clay lamp alone
  puts it away — and its presentation record plus the capability
  window's are the whole of what `localStorage` holds. Forget remembered boxes
  clears/reset those preferences without closing content or cancelling work. (design D1, D3, D9, D12, D13, D14;
  M5 plan 1, 2, 6, 18, 47, 48)
- **5.7 — Everything a capability shows lands in the window.** The collection, one record, a
  confirmation and a build's narration all land in the same frame: opening a
  record swaps the collection for the record form under a back control, and
  opening another capability swaps the contents without the frame moving or
  redrawing. Nothing opens over anything else, so the detail modal and its focus
  trap are deleted rather than ported, along with the accessible item wrapper —
  the design's record is a real `<button>` and needs no dialog ARIA and no
  hand-written key handling. Record deletion keeps the shape it has today and
  only changes container: the modal's action row becomes the form's action row,
  so deleting a record starts by opening it and the list carries no per-row
  delete. Every swap runs through 5.3's region rule, where a window-scoped hook
  would leak. Cross-capability staleness needs nothing built: with one window
  only one capability is visible, every open is a fresh read, and the window has
  no refresh verb by design. (design D2; M5 plan 1 (the modal's deletion),
  15, 22)
- **5.8 — Message surfaces and restoration.** The desk needs no notice component,
  because it already has two places to speak. A build that fails, is refused as
  stale, or comes back a measured no-op adds a final line to the build narration
  in the same voice and stops instead of committing — the log is already an
  `aria-live` region and already where the user is looking. Anything rejected
  before a build starts speaks on the prompt bar, where the 400ms `is-refused`
  flash stays as the attention cue but stops being the whole message; structured
  422/409 refusals follow the same split. Its single live slot replaces rather
  than stacks messages, preserves refused input/focus and clears stale copy on
  edit/success. Fail, stale and no-op hold the window
  until dismissed and then restore the displaced capability's current canonical
  collection or the bare desk, while cancel
  restores immediately, because the user already has the information. Putting the
  window away, switching logos or traversing history while a build/evolution runs
  adds one inline warning without replacing the live run, and proceeds only on
  confirmation through the existing cancel teardown plus the captured navigation
  continuation. `waitForZeroReaders`' deadline
  rises above the maximum a single handler may run, so a well-behaved reader can
  never cause a spurious deletion failure, and a deletion that does time out now
  has the window narration to say so in. (M5 plan 14, 17, 23–26)
- **5.9 — Rename and delete from the logo.** A short context menu on a
  capability's logo carries Rename and Delete, reached three ways:
  right-click, press-and-hold, and the keyboard menu key or Shift+F10, since
  the logo is already a real `<button>`. That rehomes the deletion doorway the
  toolbar entry used to carry and supplies the rename doorway nothing ever
  specified, in one component, and it keeps every destructive affordance out
  of window chrome, which is why no lamp goes signal red. Rename uses an inline
  Save/Cancel form anchored to that logo and changes the effective label through
  a platform-owned override and nothing else — not its
  authored snapshot, id, address, version or artwork — under a short coordinator
  write, so it needs no build, logo work or route change. Delete's
  confirmation fills the window in authored product voice and the path stays
  zero-AI. It cannot displace a running build/evolution; that desk-action refusal
  speaks on the prompt bar and leaves the run mounted. On commit the tile vanishes; the window puts itself away only when the
  deleted capability was previously open or the desk was bare, otherwise the
  unrelated displaced capability returns. A link to a deleted capability loads
  the bare desk and speaks a brief prompt-bar notice, which covers the second-tab, bookmark and
  reload cases without a window state of its own. (M5 plan 19–22)
- **5.10 — The form: choice, long text, guidance and in-field errors.** The field
  vocabulary gains a choice type carrying stable stored values plus labels, with the design's
  full picker feature set (per-choice stable group declarations, grouped options,
  per-option notes, per-option disabled
  states) and a per-field declaration of whether it presents as a picker, a radio
  group or a segmented control rather than an inference from option count. It also
  ports the design's complete select-only combobox keyboard, typeahead, focus and
  ARIA behavior; disabled options are skipped rather than merely painted. The form also
  gains long text, following the existing `form.list_inputs` precedent, which fixes
  every notes, description, review and journal field. `SCALAR_FIELD_TYPES` extends
  and `specFieldSchema` gains the values array, so the compiler forces the DDL
  mapper, both `field-renderer.ts` switches and the generator prompt to handle it.
  Option values are append-only through evolution; platform validation refuses
  undeclared or newly disabled values before generated code sees them, through
  typed field-marked structural failures, while disabled stored values remain
  preservable. Per-field `guidance` (which also carries the sentence announcing a default, so
  defaults need no key of their own) and `max_length` (one declaration driving
  platform mutation validation, native `maxlength` and the character counter,
  with crafted overflow refused as a typed field-marked failure) join them; there is no
  placeholder key, because guidance survives typing. The optional marker and the
  platform-lifecycle disabled visual state are renderer-only and free — there is
  no authored per-field disabled key; read-only is not a state at all, because a
  record opens in the form, in edit mode, and an absent value is an empty input
  rather than a muted em dash. (`ui_intent.detail.shows` was already removed in
  5.1's reset-bounded cut.) Errors move into the field, replacing that field's guidance, reading
  the `data-error-fields` the failure responses already emit and nothing reads
  today. The one marked product-voice sentence a Handler returned is relocated,
  not rewritten; `behavioral_errors` owns markers and affected fields rather than
  fixed prose. The browser
  checks required fields before submitting, recovering the native constraint
  validation a drawn picker gives up while replacing the browser tooltip with the
  same in-field platform sentence. `neutral` drops, `ghost` becomes `outline`,
  and a list-of-strings field gets the drawn control it has shipped without;
  repeatable row movement/removal is keyboard-operable and never drag-only.
  (M5 plan 27–33)
- **5.11 — Contrast, motion and focus.** WCAG AA contrast for text and controls
  stays a real commitment: the palette and allowed uses are closed, so every
  declared foreground/background pairing is checked and pinned (not every
  arbitrary palette combination), and every pair a button uses passes. C12's 3.01:1 label on
  `--leaf` is resolved by swapping the two greens — primary is `--shade` at 5.18,
  which is dark enough to need a light label rather than to break the rule, and
  secondary is `--leaf` at 4.54 under ink — and that swap lands with the palette in
  5.1, so this epic audits and pins every pair rather than shipping the fix.
  Keyboard navigation, semantic
  landmarks and reduced motion are honoured but are not release gates. Motion stays
  on by default, because it is part of the product's personality; when the OS
  Reduce Motion setting is on, Aluna stops positional travel — windows flying open,
  content sliding, press-jumps — on one central travel scale, with a style check
  rejecting bypasses rather than a hand-maintained selector list, while in-place character continues, so the pet
  keeps breathing and blinking. A text input shows the focus
  ring on any focus including a mouse click, because the ring tells you where
  typing will land; every other control shows it on keyboard focus only.
  (M5 plan 43, 44, 45)

### Verify by running it
Run `bun run reset`, then type *"I want to keep track of my notes."* into the
prompt bar → after new-capability admission the narration takes the window while a
build-id provisional tile works away on the desk → activation replaces it and the
post-activation attempt fills the incarnation-keyed logo →
click the logo, click a record to swap the collection for the record form, then
press Back → open a second capability and watch the contents swap without the frame
moving → drag the window downward and confirm it stops above the prompt bar →
maximise, reload, and confirm it returns maximised and inside the current screen →
open the developer panel from its tile and watch it sit beside the window → narrow
the browser below 720px and confirm the window fills the screen and no longer drags
→ right-click the Notes logo, choose Delete, confirm in the window, and watch the
tile vanish (with an unrelated previously open capability restored) → open
`/capability/notes` afterwards and get the bare desk with a prompt-bar notice.
Then build something carrying a choice field
and a long-text field, confirm a too-long value reports under its own field, and
confirm a generated record card carries a drawn boundary rather than a CSS border.

### Exit criteria
Aluna is a desk: a wallpaper, a logo layer, a floating prompt bar and one window,
with the developer panel as the only second window. Every capability has a logo,
or a placeholder that has stopped trying. Every visible boundary is drawn,
generated records included, and the design-lint rung accepts colour, type size and
spacing only from the High Meadow sets while refusing font family, border, radius
and shadow outright. The shell keeps presentation state and decides no canonical
state. The capability toolbar, the header row, the sidebar and the detail modal are
gone from the codebase rather than hidden, and `design/styles/` is the only token
layer left.

## Module 6 — Reads Set Free: Ad-hoc Data Queries

**Goal:** add the ephemeral whole-catalog form of free reads. Let the user ask
questions across their data and get a spoken answer without building or persisting a
capability. This is the one exception to "everything is cached."

**Why sixth:** Module 4 already establishes physically read-only SQL for persistent
generated Actions and declared lifecycle dependencies. Module 6 reuses that safety seam
but removes the persisted Handler/spec/dependency: one natural-language question
receives temporary whole-catalog access and a spoken answer. It needs populated
capabilities, which now exist, and it needs somewhere to put an answer — which it
supplies itself, as a third window beside the capability window and the developer
panel.

> **Settled since this section was first written.** The auto-table is gone: Aluna speaks
> her answers, because a grid headed by SQL aliases is the engineering tool §9.7 forbids.
> Resolution is a bounded loop of read-only steps rather than a single translation, it
> runs in a worker so it cannot block the desk, and it carries no timeout. The answer
> surface — the open question this section used to carry — is a window of its own, opened
> for a question beside whatever else is standing, so a capability can stay open while it
> is asked about and nothing waits on the pet.
> [ADR-0008](adr/0008-ephemeral-query-loop-and-spoken-answer.md)
> and [Module 6's plan](../modules/06-reads-set-free/PLAN.md) are the contract.

### Epics

Numbered in build order.

- **6.1 — What every collection holds.** Every collection states how many records it has,
  and says so when that number is filtered, so a filtered count is never presented as the
  whole truth. Platform-owned scaffolding against the read connection; generated code is
  untouched. It answers the module's most common question before it is asked, and it
  depends on nothing else here. (PLAN decision 32)
- **6.2 — Ephemeral whole-catalog read, in a worker.** Reuse M4's physically read-only
  connection/authorizer and expose a bounded whole-active-catalog adapter to this request
  only. Acquire the complete per-incarnation read-token set atomically for the catalog
  snapshot so capability deletion cannot race the query; ownership stays on the main
  thread. Execution moves into a worker with its own read-only connection, which is what
  makes a closing read gate able to cancel a running query at all. Mutation through the
  supplied adapter fails at the SQLite seam, inside the worker as outside it; in-process
  generated execution remains contract/static-check protection rather than hostile-code
  containment. (ARCH §3, §7 "Reads"; PLAN decisions 2, 6, 7, 10, 11, 13)
- **6.3 — The query loop.** Classify intent as `data_query`, then resolve it through a
  bounded loop: one tool, a closed vocabulary of step labels the platform owns the copy
  for, ten steps, and a payload cap that refuses over-size steps rather than truncating
  them. No timeout. Never persisted: no registry entry, no logo on the desk, no version,
  no cache. (ARCH §7 "`data_query`"; PLAN decisions 5, 8, 9, 12, 14)
- **6.4 — What Aluna says.** SQL carries the whole computation; the model only finds the
  words. She states what she looked at before what she found, never phrases zero matched
  rows as a fact about the user's data, is given the vocabulary of that data rather than
  an index of it, and names the gap without offering to fill it when nothing can answer.
  (PLAN decisions 4, 16, 17, 18, 19, 20)
- **6.5 — The answer window.** A third window, opened when the resolver classifies
  `data_query`, carrying the loop's narration and then the answer over the existing
  per-job stream. It displaces nothing: the capability window and the developer panel
  stand as they were, so a capability stays open while it is asked about. One of them: a
  new question replaces its content in place rather than closing and reopening the frame.
  It carries no logo, tile or address and is dismissed rather than put away — closing it
  destroys the answer, nothing survives a reload, and future persistence is out of scope.
  A refusal opens no window and still speaks on the prompt bar.
  A query never locks the prompt bar. First point the module can be seen.
  (PLAN decisions 1, 3, 15, 21, 22, 24, 25, 26, 27)
- **6.6 — Context and refusal.** The prompt bar scopes a query to the capability in the
  window when relevant — context, never a filter — and scope is stated in the answer
  rather than shown as a control. A friendly refusal for obvious non-queries ("delete
  everything") reuses the resolver's existing `reject` bucket rather than adding a second
  classifier; the write restriction itself lives in the supplied read-only adapter from
  6.2, never here. (ARCH §6.1, §7; PLAN decisions 28, 29, 30, 31, 33)

### Verify by running it
With Notes and one other capability built and populated, open a collection and confirm it
states how many records it holds, and that a search says how many matched *and* how many
there are. Then ask *"how many notes did I add last week?"* → Aluna narrates while she
works and answers in a sentence, and no logo is added to the desk. Ask about a category
whose stored values do not use the word you typed → she looks at what things are called
before totalling, and says which values she counted. Ask a cross-capability question → one
spoken answer. Ask about something you do not track → she names the gap and mentions you
can ask her to build one, with no button. Type *"delete everything"* → a friendly refusal.
Start a long question and immediately ask another → the first is abandoned. Confirm the
desk stayed responsive throughout, and that no registry row, version, or cache was created
for any of it.

### Exit criteria
Free-form reads work across all capabilities, use the physically read-only supplied
adapter and its static contract, execute in a worker that cannot block the desk and can be
cancelled, are spoken by Aluna in a window of their own that displaces neither the
capability window nor the developer panel, and create no
registry/version/artifact/cache/read-dependency state. Every collection states how many
records it holds. M8 may later record the ordinary user action in the Event Log without
turning the query into a capability.

## Module 7 — Files: Upload, Store & Serve

**Goal:** apply the same constrained-write / free-read split to bytes (ARCH §7 "Files"). A capability can now hold files: upload is a constrained write through the router, serving is a free read through a platform route. With this the explicit loop is complete.

**Why seventh:** files are the last user-facing surface of the explicit loop. They
reuse M4's mutation interface (for the reference), the router (for upload), and
record lifecycle (for deletion), all of which now exist. The `grid` collection
layout (`ui_intent.collection.layout: "grid"`) and the record view are exactly
where uploaded images present — and that record view is an ordinary swap inside
M5's window, not the modal Module 3 built, so the upload and detail controls are
authored against the drawn field set once.

### Epics

- **7.1 — Object store (S3-shaped tool).** `put / get / delete / url`, default-backed by the local filesystem (`Bun.file` / `Bun.write`), addressed by opaque key under `storage/<key>`; swappable to R2/S3/Garage by config. This is platform infrastructure: the AI never builds storage. (ARCH §6.3 "Object Store", §7 "Files")
- **7.2 — `file` / `file[]` field type.** Schema support for file fields; extend the centralized platform field renderer M3 established and M5 widened to choice and long text, adding upload and record-view controls drawn like every other field. The data table stores only a reference — key, mime, size, original name — never the bytes. A `photos` capability is an ordinary capability with a `file` field. (ARCH §6.3 "Capability Registry", §7 "Files")
- **7.3 — Upload = constrained write.** Multipart through the existing router;
  generated behavior calls the platform file adapter and stores the returned
  reference through M4's mutation interface. Durable pending ownership makes a
  failed Handler/DB commit compensatable. (ARCH §7 "Files")
- **7.4 — Serve = free read.** A platform-owned `/files/:key` route streams bytes with zero-copy `sendfile`; generated HTML simply references `/files/<key>` (e.g. `<img src>`). The AI never builds file serving. (ARCH §7 "Files")
- **7.5 — File ownership & lifecycle.** Opaque keys are exclusively owned by one
  capability incarnation/record/field in the PoC. Durable, idempotent cleanup
  covers failed create, update replacement/removal, record deletion, inactive
  `file | file[]` fields, and M4 whole-capability deletion; already-absent keys are
  success. Whole-capability deletion absorbs committed active/inactive references,
  pending ownership, and already-enqueued cleanup into the incarnation-bound
  tombstone manifest before table drop. Extend M4's pre-drop collector rather than
  inventing a second deletion path. (ARCH §7 "Files", §6.3 lifecycle recovery)

### Verify by running it
Build Photos, upload/replace/delete a file, and force one post-upload DB failure;
confirm committed bytes render and every abandoned/replaced byte is recovered.
Then evolve an existing Notes capability to add `file` and `file[]`, hide one file
field, delete Notes through M4's capability action, and confirm active + inactive
owned keys and version artifacts disappear idempotently.

### Exit criteria
New and evolved capabilities hold files end to end through platform tooling, with
recoverable ownership across create/update/record-delete/capability-delete.
The explicit prompting feature is complete.

## Module 8 — Implicit Loop: Behavior → Proposal → Build

**Goal:** turn on the second intent loop (ARCH §8 "Loop 2"). Aluna watches *how*
the user behaves and proposes a capability. Confirmation hands an already-resolved
request to the explicit Builder established in M2–M4 and extended through M7. It
never silently changes Aluna or reclassifies the accepted proposal.

**Why eighth:** this thin layer is the whole difference between implicit and explicit. It needs a complete, populated app to observe (Modules 2–7) and reuses the entire build pipeline, adding exactly the two things explicit never needed: full-fidelity event capture and the behavior→proposal classifier path.

> **Open in this module: where a proposal appears.** Capture, gate, async
> inference, explicit confirmation, resolved-request hand-off, and reuse of M4's
> mutation/publication/Gate/metrics lifecycle are fixed. The surface a proposal
> arrives on is not, and Module 5 deliberately defines none: it belongs to the pet,
> which will carry Aluna's narration and is not designed yet
> ([Module 5's plan](../modules/05-the-desk/PLAN.md)). Which Builder lifecycle
> presenter follows confirmation — foreground interruption or quieter background
> presentation — is open with it. The core Builder does not force the explicit
> prompt/SSE presenter.

### Epics

- **8.1 — Define the implicit UX (open design).** Settle proposal placement and
  timing, and the post-confirmation Builder presenter, with the pet's design rather
  than ahead of it. M3 supplies presentation primitives, M5 supplies the desk and
  the window they sit on, and M4 supplies presenter-independent resolved-request
  execution. Nothing builds without explicit confirmation.
  (ARCH §8 "Loop 2"; M5 plan)
- **8.2 — Event tracker (dumb shell recorder).** Capture every action — click, hover, dwell, focus, scroll — with full context (timestamp, active capability, element id/type, on-screen data). Batch and ship to the server. No client-side logic: no thresholds, no detection. (ARCH §6.1 "Event Tracker", §8 "Loop 2")
- **8.3 — Event Log (ordinary append + deletion ownership).** Record every action
  with before/after situation and every capability incarnation whose product data
  appears. The server derives ownership from admitted route/query/read-token
  context and canonical payload production; client/model labels are not trusted.
  Normal use only appends; ingestion atomically validates/appends the derived set
  and rejects the batch if any pair is no longer active/current. Explicit
  capability deletion purges/redacts owned product payloads through M4's cleanup
  seam, while a content-free deletion fact may remain.
- **8.4 — Server-side gate.** A cheap deterministic heuristic that trips only on a real pattern. No LLM call until it trips. Thresholds live server-side, next to the dataset — the experiment's main tuning knob, changeable without redeploying the shell. (ARCH §8 "Loop 2", server-side gate)
- **8.5 — Async intent resolution.** Off the interaction path (never blocks). Reads the event batch + context through the existing resolver. Below threshold → log only and back off (raise the bar for this pattern). Above threshold → proceed to a proposal. (ARCH §8 "Loop 2")
- **8.6 — Proposal + decision (contract fixed, presentation per 8.1).** Confirm
  hands the already-resolved request directly to M4's mutation coordinator/Builder;
  it carries `expected_absent` or exact capability id/incarnation/version plus
  the resolver-visible catalog revision/fingerprint used for classification. A
  lease-head mismatch of either refuses stale work rather than rebasing or
  reclassifying it; only then is the dependency-generation catalog frozen.
  Ignore logs and backs off. It never re-runs prompt classification.
  Presentation comes from 8.1. (ARCH §8 "Loop 2", §9.3)

### Verify by running it
Repeatedly do something suggestive. The gate asynchronously proposes a due-date
evolution. Confirm and prove the accepted resolved request enters the M2–M7
Builder exactly once without reclassification; Ignore backs off. Delete the
capability and confirm its Event Log product payloads are gone while content-free
experiment/deletion facts remain.

### Exit criteria
Behavioral patterns produce confirmation-gated proposals that, when accepted, build through the existing explicit pipeline. The app never changes itself without a confirmation. Both intent loops are live.

## Module 9 — Experiment Harness: Metrics, Latency & Tuning

**Goal:** make the PoC's conclusions legible — the reason the project exists (ARCH §6.3 "Generation Metrics", §9.6). Metrics have been written since Module 2; this module surfaces and analyzes them, and gives the implicit gate a tuning loop against the real event-log dataset.

**Why last:** it depends on data accrued by every prior module — generation metrics from Modules 2–8 and the event log from Module 8. It is an experimenter-facing surface, kept clearly separate from the friendly app (ARCH §9.7).

### Epics

- **9.1 — Metrics querying.** Query by build id and capability incarnation across
  `running | success | failed | interrupted` lifecycle status and typed outcomes
  such as `activated | no_change | stale`, plus semantic stage timings, queue
  wait, model, tokens, retries, Gate outcomes, and
  generated/copied/executed/skipped/absent tier states. Compare presentation and
  behavioral modes without assuming every snapshot contains `.html` or tests; add
  a metrics-only artifact-shape dimension if comparison needs one, without
  introducing the deferred registry/serving upgrade marker. (ARCH §6.3, §6.2)
- **9.2 — Outcome & overlap analysis.** Join admitted generation rows with the
  separate non-build `intent_resolution_metrics` rows to analyze
  extend-vs-separate decisions, activation/no-change/stale/failure rates, and
  the complete intent-classification distribution. (ARCH §6.2, §8 "Overlap resolution")
- **9.3 — Experimenter surface.** An internal view/report to read the dataset, deliberately outside the user-facing product voice — the friendly app shows no internals. It lives in the developer panel's window, which is already furniture rather than a capability and already stands outside the product voice, so metrics, latency and gate tuning join it there instead of claiming a third window. (ARCH §9.7; M5 plan)
- **9.4 — Gate tuning loop.** Adjust the implicit gate's thresholds against the event-log dataset and observe the effect on proposal behavior — without redeploying the shell. (ARCH §8 "Loop 2")

### Verify by running it
After exercising both loops, open the developer panel from its tile → see per-generation timing breakdowns, success/failure rates, and overlap decisions → adjust a gate threshold → observe that the implicit loop now proposes more (or less) aggressively.

### Exit criteria
Querying the dataset answers the PoC's questions, instead of guessing at them. Latency and capability conclusions are visible; the implicit gate is tunable against real data.

## Cross-cutting concerns

These are not modules but disciplines, which every module must honor from its introduction point onward. They are listed here so they don't get lost between vertical slices.

| Concern | Introduced in | Rule | ARCH ref |
|---|---|---|---|
| **Mutation coordinator** | M2 (build queue), completed M4 | Resolved builds bind target + resolver-catalog fingerprint, use bounded tickets then one active lease, and fail stale on lease-head mismatch; all shared-connection writes use ownership-checked leases; deletion atomically try-acquires and never queues | §8 "Concurrency" |
| **Spec → derived artifacts discipline** | M2 | The arrow only ever points authored spec → handlers/item renderer/tests. M4's total positive-proof matrix scopes regeneration and preserves committed incarnation/version history. Through M9, platform artifact-shape changes reset/rebuild; preserving upgrades and their marker remain deferred | §2, §9.1 |
| **Validate-before-commit / atomic pointer flip** | M2 | Nothing goes live until it clears every active gate rung — type-check, signatures, smoke run, (behavioral tier on) tests, and (from M3) design lint — then pointer + `success/activated` commit at the point of no return; later transport failure cannot undo it | §6.2, §9.5 |
| **Additive-only structure** | M2 (DDL), M4 (evolution) | The admitted platform DDL path adds or soft-hides and never `DROP`s/destructively renames; this is an interface/static-contract guarantee, not hostile-code containment | §3, §9.3 |
| **Closed-value design contract + design gate** | M3, re-derived M5 | Generated item markup targets allow-listed semantic/primitive classes first (incl. layout utilities), with token-disciplined inline `style` as the escape hatch; a fail-closed design-lint rung enforces it. From M5 the token layer is `design/styles/`: colour, type size and spacing are picked from its sets, and font family, border, `border-radius` and `box-shadow` are never declared at all, because the ink system owns every boundary. Structural mechanics — including the closed `feed \| grid` collection layout the container reads from `ui_intent` — are platform-owned presentation | §6.2, §6.3, §7, §9.7 |
| **Metrics on every admitted build** | M2, lifecycle tightened M4 | Resolver-only/pre-lease outcomes are best-effort and are not builds; durability begins with direct stale or `running`. Activation, no-op, stale admission, failure, and interruption remain queryable | §6.3, §9.6 |
| **Read-only adapter safety** | M1 (connection), M4 (persistent Actions), M6 (whole-catalog query) | Mutation through the supplied query adapter fails at SQLite. Persistent generated Actions declare dependencies; M6 access is ephemeral and atomically acquires the catalog token set. In-process execution is not a security sandbox | §3, §7 |
| **Product voice, never internals** | M2 onward | Narration, proposals, confirmations, errors all speak in friendly product voice | §9.7 |
| **Confirmation boundaries** | M4 (record and capability deletion), M5 (the doorway moves to the logo), M8 (every proposal) | Destructive deletion and implicit proposals require explicit confirmation through platform-owned product UI, which from M5 means a confirmation filling the window and never an affordance in window chrome. Explicit prompt evolution proceeds directly but stays foreground and narrated; no preview/code-steering loop is introduced | §9.3 |

## Dependency flow

```
M1 Scaffold
   │  (shell · SSE · dual SQLite · AI provider)
   ▼
M2 Explicit I  ──────────────────────────────┐  seeds the shared backbone:
   │  (registry · initial data tool · router · │  registry, storage, router,
   │   builder · queue · metrics · SSE swap)  │  orchestrator, AI call, queue
   ▼                                          │  and metrics
M3 Opinionated UI                             │
   │  (platform modules · one item renderer · │  ← presentation contract
   │   closed contract · design gate ·         │     reused by every later
   │   detail modal · new artifact shape)      │     user-facing surface
   ▼                                          │
M4 Explicit II                                │
   │  (split data ports · mutation coordinator│  ← complete Builder lifecycle
   │   · full CRUD · resolver · total diff ·  │     reused by every later module
   │   immutable publish/delete recovery)     │
   ▼                                          │
M5 The Desk                                   │
   │  (wallpaper · logo layer · one window ·  │  ← the surface every later
   │   drawn line · logos · form types;        │     module presents in;
   │   toolbar, header row, sidebar and        │     replaces M3's modal
   │   modal deleted)                          │
   ▼                                          │
M6 Reads free                                 │
   │  (query loop in a worker · spoken       │
   │   answers · record counts)               │
   ▼                                          │
M7 Files  ── explicit loop COMPLETE ──────────┘
   │  (object store · file fields · serve)
   ▼
M8 Implicit loop   ── reuses the M2–M4 Builder as extended through M7
   │  (event tracker · event log · gate · async resolution · proposals)
   ▼
M9 Experiment harness   ── reads metrics (M2–M8) + event log (M8)
      (latency · outcomes · experimenter surface in the developer panel · gate tuning)
```

Linear and progressive: each module runs, is testable, and stands on its own. Capabilities are presentable at M3, fully evolvable at M4, and get the surface they were designed for at M5; the explicit loop is whole at M7; implicit (M8) is a thin layer on top of it; the experiment surface (M9) reads what everything before it produced.
