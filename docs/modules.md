# Omni-CRUD: Phased Development Plan

> This is the **build plan** derived from [architecture.md](architecture.md). It is not a list of tickets.
> It defines the **modules** (high-level phases). Each module contains **epics**; each epic later breaks down into individual issues.
>
> Read [architecture.md](architecture.md) first — it explains *what* each piece is. This document explains *in what order we build them and why*.

---

## Scope — what this plan locks in, and what it doesn't

This is **high-level planning**: the general architecture, the intended behavior, and the module boundaries. That is all it locks in.

It deliberately does **not** specify implementation — types, classes, function signatures, file layouts, templates, libraries, colors, or copy. Those are decided **inside the module that owns them**, when the real constraints are known. Software isn't planned front-to-back in advance: constraints surface, tools evolve, and better approaches appear mid-build. Read every epic below as *intent and boundary*, not as a finished spec.

Two things are called out as **intentionally undefined here**:

- **The implicit-loop UX.** The modules below define the implicit loop's *backstage* — event capture, the gate, async inference, confirmations, and the hand-off to the build pipeline. They do **not** define how implicit work is *presented* to the user: whether a proposal interrupts or builds quietly in the background, where it appears, whether there is a persistent assistant presence or a one-off notice, its tone or its timing. That UX is an open design question owned by **Module 7**, to be decided when it is built. The only fixed commitment is the contract: **nothing is built without an explicit confirmation.**
- **Every piece's internals.** The same holds for each module's implementation. The "verify by running it" demos describe *observable behavior*, not the code that produces it.

---

## How this plan is sliced

Every module is a **vertical slice you can run and verify**, not a horizontal
layer. There is no "types" module, no "registry" module, no "intent resolver"
module—those pieces are useless on their own. Instead, shared infrastructure
(capability registry, data-access seam, router, orchestrator, AI call, toolbar) is
introduced **inside the first feature that needs it**, then reused or deliberately
deepened by everything after.

Four rules govern the ordering:

1. **Scaffolding first.** Module 1 stands up the repo and wires every dependency together with zero domain logic.
2. **Explicit prompting before implicit prompting.** Modules 2–6 build the entire explicit loop end to end. Implicit (Module 7) reuses that work.
3. **Each module is progressive and self-contained.** It builds on the one before it, and on its own it is a complete, demonstrable, testable piece of the product. You can stop after any module and have a thing that runs.
4. **The demo stays alive.** Relevant runtime work is wired into the current
   homepage demo as soon as it can be exercised. The demo is allowed to be ugly
   and developer-facing while it is temporary; it is the integration surface that
   prevents pieces from drifting apart before the final end-to-end flow replaces
   it.

### The shared grounding vs. the implicit-only pieces

Both intent loops share the same foundation: the **capability registry, storage
layer, split mutation/query ports, router, orchestrator (intent resolver +
presenter-independent capability builder + diff engine), AI provider, mutation
coordinator, and toolbar**. All of that is built during the explicit phase
(Modules 2–6), because the explicit loop exercises every piece of it.

The **implicit loop adds only two things the explicit loop never needs**: the **event tracker** (full-fidelity behavioral capture in the shell) and the **classifier path that turns behavior into a proposal** (the server-side gate + async intent resolution). That is why implicit is a single later module — it is a thin, high-value layer on top of an already-complete explicit system, not a parallel rebuild.

---

## Module map at a glance

| # | Module | What you can do at the end | Adds | Reuses |
|---|--------|----------------------------|------|--------|
| 1 | **Platform Scaffold & Runtime Spine** | Boot an empty platform: shell loads, server streams, AI answers, DB opens | Bun · Hono · HTMX · Alpine · SSE · dual SQLite connections · AI provider interface | — |
| 2 | **Explicit Loop I — Build Your First Capability** | Type a prompt → watch a working capability build itself → add & see records | Registry · data tool · router · builder · build queue · metrics writing · SSE swap | M1 |
| 3 | **Opinionated Capability UI** | The capabilities the app builds look and feel like a coherent product — styled lists, a shared modal, a prefilled detail view — not a 1990s form dump | Platform UI modules · single generated item renderer · closed-value primitive vocabulary · few-shot design gallery · design-lint gate rung · `ui_intent` (item/collection/detail) · new artifact shape (reset, no cutover) | M1–M2 |
| 4 | **Explicit Loop II — Full CRUD & Evolution** | Edit/delete/search records; extend or permanently delete a capability without breaking data/readers | Split data ports · mutation coordinator · total diff engine · immutable incarnated snapshots · recoverable activation/deletion · full resolver | M1–M3 |
| 5 | **Reads Set Free — Ad-hoc Data Queries** | Ask questions across your data; get answers in a table; nothing is built | Whole-catalog NL→SQL `data_query` · generic auto-table · reject classifier | M4's physical read-only query seam |
| 6 | **Files — Upload, Store & Serve** | Create capabilities that hold files; upload, view, and delete them | S3-shaped object store · `file` field type · upload (write) · serve (read) · lifecycle | M1–M5 |
| 7 | **Implicit Loop — Behavior → Proposal → Build** | The app notices a pattern in how you work and offers to build for you | Event tracker · event log · server-side gate · async resolution · proposals | M1–M6 |
| 8 | **Experiment Harness — Metrics, Latency & Tuning** | Read the PoC's conclusions; tune the implicit gate against real data | Metrics querying · outcome/overlap analysis · experimenter surface · gate tuning | M1–M7 |

**Explicit loop is fully complete and full-featured at the end of Module 6.** Module 7 turns on the second loop. Module 8 makes the experiment legible.

---

## Module 1 — Platform Scaffold & Runtime Spine

**Goal:** a running platform with every wire connected and **zero domain logic**. Nothing builds capabilities yet — but the shell renders, the server streams, the AI provider answers, and the database opens. This is the "no-dependency-tax" stack from ARCHITECTURE §4, stood up and proven.

**Why first:** everything downstream assumes these wires exist. We prove the stack works *before* we put any thinking on top of it.

### Epics

- **1.1 — Project & toolchain.** Bun project, TypeScript config, directory layout (`capabilities/`, `storage/`, db location), dev/build scripts, lint/format. (ARCH §4)
- **1.2 — Hono server + the fixed shell.** Serve the single static HTML page with HTMX + Alpine. Base product-voice layout and styling. Renders the three shell regions as inert placeholders: prompt bar, empty capability toolbar, empty content area. (ARCH §6.1)
- **1.3 — SSE streaming primitive.** Server→client Server-Sent Events channel. A demo stream that pushes tokens; client wiring that swaps/appends streamed HTML into the content area. (ARCH §4, §6.2)
- **1.4 — SQLite foundation.** Open a **read-write** connection and a separate **read-only** connection (`SQLITE_OPEN_READONLY`). A migrations runner for platform-owned schema. (No domain tables yet — those are created by the modules that need them.) (ARCH §4, §6.3, §7)
- **1.5 — Pluggable AI provider.** A thin `generate(prompt, schema)` streaming contract realized by the **Vercel AI SDK** (in-process, Bun, BYO-key) behind a `baseURL`-keyed provider registry, with a single configured global model. Provider-agnosticism comes from the SDK targeting the Anthropic-/OpenAI-compatible wire shapes — so the global model swaps in one config change across Claude, GPT, Gemini, and the open Chinese coding models (Qwen, GLM, Kimi, MiniMax, DeepSeek). A structured round-trip proves a structured response streams back — shown live in the shell (the real provider answers a user-initiated trigger), not in a paid unit test. (ARCH §4 "Model strategy"; see [ADR-0003](adr/0003-ai-provider-spine-and-coding-harness.md))
  > **Note (forward-pointer to M2–M4):** 1.5 stands up *only* the provider contract — streamed structured round-trip + the one-line model swap — keeping Module 1's "zero domain logic" line. The **code-writing harness** is a bounded tool-loop scoped to a single build unit (write → type-check → fix), and it lands with the **Capability Builder** (epic 2.5, tightened with behavioral repair in 4.7), *not here*. We deliberately do **not** adopt a roaming autonomous agent, a hosted agent API, or an execution sandbox; the harness *discipline* (pipeline, diff, gate, migrations) stays ours. Full rationale and the rejected alternatives are in ADR-0003.

### Verify by running it
`bun run dev` → open the browser → the shell renders with an empty toolbar and a prompt bar → click *Meet Aluna* and the real AI provider streams a product-voice greeting into the content area (a structured round-trip, end to end) → the SQLite file exists with the migrations table.

### Exit criteria
The app boots and stays up. Shell, SSE, AI provider, and both DB connections are independently proven. No capability logic exists anywhere.

---

## Module 2 — Explicit Loop I: Build Your First Capability

**Goal:** prove the thesis. A user types a prompt, watches the app build a capability **for that prompt**, and immediately uses it. Scope is deliberately the **smallest complete vertical slice**: a single new capability with the **create + read** subset of CRUD. This module stands up the entire shared backbone the rest of the project reuses.

**Why second:** this is the moment the premise becomes real — *the app writes
itself*. Everything here (registry, data-access seam, router, builder, queue,
metrics, SSE swap) is reused and deepened by Modules 3–8.

### Epics

- **2.1 — Capability Registry (source of truth).** The store for spec rows: `id, label, version, schema, ui_intent, behavior, behavioral_errors, tools, artifacts_path, prompt_context`. Read/write access. Toolbar rehydrates from it on load. (ARCH §6.3 "Capability Registry")
- **2.2 — Constrained data tool + additive DDL.** Generate a `CREATE TABLE` migration from a spec; expose row-level `insert` + `select` keyed by capability; a JSON escape-hatch column. Writes go through the tool only; reads use the read-only connection. (ARCH §3, §6.3 "Data Tables", §7 "Writes")
- **2.3 — Deterministic router.** The fixed `/capability/:id/:action` convention; load and run the matching generated handler file. Routing is never an AI concern. (ARCH §6.2 router)
- **2.4 — Minimal intent resolver (`new_capability` only).** Prompt + registry context → a structured intent that seeds a new capability spec, plus the `user_facing_label`. Only the new-capability path for now. (ARCH §6.2 "Intent Resolver")
- **2.5 — Capability builder (new path) + global serial build queue.** The atomic pipeline: spec → additive migration → generate `create` + `read` handler `.ts` → generate `list` + `create` HTML → **validate through a layered, fail-closed gate** (typecheck + assert action signatures; smoke insert; and — when the behavioral tier is on — execute tests generated from the spec's `behavior` + stable `behavioral_errors`, *independently of the handlers*) → commit (write `v1/` artifacts, registry row, pointer flip). The behavioral rung is a **global toggle** so its added latency stays measurable against the no-test baseline; it lifts "validated" from *compiles + runs* to *behaves as specified*. Single-flight build queue. Product-voice narration over SSE throughout. (ARCH §6.2 "Capability Builder", §8 "Concurrency", §9.1, §9.5)
- **2.6 — Shell render + commit swap.** Stream narration as it builds; on commit, swap the content area and update the toolbar out-of-band (`hx-swap-oob`) in one SSE response. Clicking a toolbar entry loads that capability's cached HTML. (ARCH §6.1, §6.2 Diff Engine basics)
  > **Historical closure:** Module 2 vendored the HTMX SSE extension and proved
  > the per-build ephemeral `sse-connect`/`sse-close="done"` path plus OOB toolbar
  > swap. Module 4 reuses that explicit presenter but keeps SSE/DOM ownership out
  > of the core Builder so Module 7 may choose another presenter. See ADR-0002.
- **2.7 — Metrics writing.** One metrics record per generation: timing breakdown (incl. test-gen and test-run when the behavioral tier is on), per-rung gate outcomes and any retries, model, tokens, outcome. The test-tier columns are what let M8 quantify behavioral verification's cost against the no-test baseline. (ARCH §6.3 "Generation Metrics", §6.2)

### Verify by running it
Type *"I want to keep track of my notes."* → watch the friendly narration build it → a **Notes** tab appears in the toolbar → the content area shows a list and an "add note" form → add a note → it persists → refresh the page → the toolbar rehydrates and the note is still there. A metrics row was written for the build.

### Exit criteria
A typed prompt produces a real, persisted, usable capability with create + read,
committed atomically and validated before going live. The first backbone
(registry, data-access seam, router, builder, queue, metrics, SSE swap) exists and
is evolved rather than bypassed from here on.

---

## Module 3 — Opinionated Capability UI

**Goal:** make the capabilities the app builds **look and feel like a coherent product**, without a developer hand-crafting each one. Today a freshly built capability is born usable but ugly — the builder gets no design guidance, so it reproduces the same bare *[title][empty state][form]* scaffold every time. This module takes the **structural mechanics into the platform** (a shared modal, list scaffolding, accessible item wrapper, and spec-rendered fields) and hands the builder one generated **item renderer** governed by a **closed-value design contract + a few-shot exemplar gallery + a design-lint gate rung**. Every capability is consistent, on-brand, and pleasant while item composition still varies to fit the data.

**Why third:** Module 2 proves a capability can be *born*; it is born ugly. We fix *how capabilities present* **before** making them fully evolvable (M4), because every later surface — edit forms, search results, file thumbnails, the auto-table — inherits this presentation contract. Doing it now means Full CRUD builds *on* the contract instead of retrofitting it later. It reuses the M2 backbone (builder, gate, registry, SSE swap) and adds no new loop.

### Epics

- **3.1 — Closed-value design contract + primitive vocabulary.** Promote the token layer into a **closed** contract: generated item markup may use only allow-listed semantic/primitive classes (truncation, media frame, intra-item stack/grid for arranging *one record's own* fields — distinct from the collection layout, which the platform container owns — and Tailwind-style layout utilities: flex, grid, alignment, gap), whose CSS consumes the design tokens. The token layer owns the design values — theme colors, the default Outfit font, the t-shirt type scale, the base spacing unit, the thin/regular/thick border weights — and generated markup never redeclares them raw; when the class vocabulary doesn't suffice, inline `style` is allowed as a **token-disciplined escape hatch** (free properties outside the token-owned axes). The vocabulary is sensible defaults, not an all-purpose CSS framework — the escape hatch absorbs the long tail. Fabricated classes and executable markup stay forbidden absolutely. (CONTEXT.md voice; [design-system.md](design-system.md))
- **3.2 — Platform presentation modules (the thick shell).** Build the shared, platform-owned **presentational** modules every capability uses: modal (open/close/prefill/focus), list scaffolding (container with its closed `feed | grid` layout modes, empty state, "New X"), accessible item wrapper, safe composition of generated item output, and create/detail field rendering from the spec. Keep field-type dispatch exhaustive and centralized so M4 list types and M6 file types extend one place. Presentation only, no business logic — the same line ARCH §7 draws for `data_query`. Consequently `list.html` and `create.html` stop being generated artifacts. (ARCH §6.1, §7; [ADR-0005](adr/0005-opinionated-capability-ui-design-contract-and-gate.md))
- **3.3 — Presentation intent + detail modal (read-only).** Replace M2's generated-view list in `ui_intent` with the capability-specific choices that remain: item design direction, the collection layout (a closed `feed | grid` value the platform container reads), and detail fields/order. The modal itself is a fixed platform invariant, so `modal: true` is not model-authored state. Clicking the standardized item wrapper opens it **prefilled** from the escaped record payload. Read-only in M3; M4 adds editing to the same module. (ARCH §6.3 "Capability Registry")
- **3.4 — One item renderer, shared by every action.** Re-cut the artifact contract: each capability gets one generated item-renderer unit. The router extends the injected toolbox with a capability-scoped presentation adapter that supplies it to `create.ts`, `read.ts`, and later `search.ts`; handlers never import it or duplicate markup. The platform wrapper owns the escaped `data-item` payload, accessible trigger, and click-to-open behavior. Amends [ADR-0004](adr/0004-capability-artifact-contract-and-validation-isolation.md); see [ADR-0005](adr/0005-opinionated-capability-ui-design-contract-and-gate.md).
- **3.5 — Few-shot design gallery.** A curated, **repo-only** set of 2–3 deliberately *different* item-renderer exemplars, each pairing an item composition with the collection layout it suits (e.g. text-forward cards in a `feed`, media tiles in a `grid`, compact metadata rows in a `feed`) and obeying the same contract while composing differently, injected into the unit prompt alongside the capability's chosen `collection.layout` with explicit *"vary, don't copy"* framing. LLM-facing only — never rendered to the user. (ADR-0005)
- **3.6 — Design-lint gate rung.** A new **fail-closed** rung in the existing layered gate: render hostile synthetic field values and reject off-token styling (raw values on the token-owned color/font/type/spacing/border axes, forbidden style constructs), fabricated/unknown classes, executable markup, and unsafe field interpolation — fed back through the same bounded fix loop as the type-check rung. Item payload/accessibility/modal invariants are platform-owned and covered by deterministic platform tests, not delegated to the model. (ARCH §6.2 gate; ADR-0005)
- **3.7 — Switch to the new artifact shape (reset, not migrate).** Make the M3 shape (platform-rendered views + one item renderer) the only one the build pipeline produces and the registry/router serve; retire the M2 `list.html`/`create.html` paths. Because the project is greenfield, the M2→M3 transition is **`bun run reset` + rebuild fresh** — Module 3 builds **no** preservation cutover, **no** dual-serving, and **no** persisted `artifact_contract` marker. That preservation path and registry/serving marker are deferred until the platform is feature-complete (ADR-0005 §7); M8 may add only a metrics classification for historical shape comparison. (ADR-0005)

### Verify by running it
Run `bun run reset`, then build *"I want to keep track of my notes"* fresh → the styled list truncates long text and exposes a **New note** button → the shared modal opens with an on-brand form → a created note appears through the same item renderer used by the read path → clicking its platform-owned wrapper opens the same modal prefilled and read-only. Build *"save links with a title and a url"* and confirm its item composition differs from Notes while reusing the same modal and primitives; build something visual (e.g. *"a place for my photos"*) and confirm it comes out as a `grid` collection while Notes stays a `feed`. Finally, make an item renderer emit an unknown class or unsafe field value and confirm the design gate fails with friendly narration and no pointer flip.

### Exit criteria
All capabilities present through platform-owned modal/list/form/item-wrapper modules. One generated item renderer is the builder's creative surface and is shared by every action through the presentation adapter. The closed-value contract is fail-closed; the collection layout is a closed `feed | grid` choice the platform container honors; clicking an item opens a prefilled read-only modal; future field types extend one centralized renderer. The M2 `list.html`/`create.html` artifact shape is fully retired; the platform produces and serves only the M3 shape.

---

## Module 4 — Explicit Loop II: Full CRUD, Evolution & Minimal-Diff Rebuilds

**Goal:** make capabilities **fully usable and evolvable**. Add update/delete/search,
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
  requiredness, `string[]`, reserved presence/target parsing, and the closed
  `created_at` descriptor. The real-route `create | read` tracer stays honest
  about its exact files while proving repeated values and inactive preservation.
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
- **4.4 — Final M4 cutover; generate & Gate full-CRUD v1 capabilities.** Reset,
  remove the transition/reference fixture, then generate five Handlers plus
  `item.ts` from Action-projected contexts. Whole-snapshot structural validation
  and full CRUD/search smoke are always on; the adversarial search fixture proves
  scalar/list inclusion, exclusions, AND/literal semantics, platform NFKC +
  locale-independent lowercase normalization, canonical rows, and stable order.
  The behavioral tier covers all Actions/errors independently.
- **4.5 — Immutable snapshots, publication, metrics & atomic activation.** Start
  with one greenfield reset/rebuild so the surviving five-Action v1 is born
  in unique staging under the new contract rather than recutting 4.4's final path.
  Write exact `spec.json` and non-routing `snapshot.json`
  inventory/digests/tier state plus audit-only per-unit dependency-generation
  provenance; publish no-overwrite under
  `<id>/<incarnation_id>/v<n>`; registry-CAS + `success/activated` metrics activate
  together at the point of no return. Before 4.6 lands candidate generation/Diff,
  use one hand-authored v2 and a temporary regenerate-all tracer, then remove that
  seam. Post-activation presenter/transport failure cannot undo success and the UI
  recovers from the registry. Boot/pre-build reconciliation handles abandoned
  staging,
  never-activated `v>N` candidates, and interrupted metrics without reclaiming
  committed `v1..vN` history. (ADR-0006; ARCH §2, §6.2)
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
  Repair never edits tests.
- **4.8 — Resolver, explicit presenter, active context & overlap.** Act on
  `new_capability | extend_capability | ui_change`; keep `reject`/`data_query` out
  of the Builder; resolve meaningful separate capabilities. Separate the resolved
  build request/core lifecycle from the explicit foreground SSE presenter so M7
  can reuse it without reclassification or forced foreground UX. Bind
  `expected_absent` or exact id/incarnation/version plus the resolver-visible
  catalog revision/fingerprint, and refuse either mismatch as stale after lease
  acquisition before freezing the separate dependency-generation catalog.
- **4.9 — Dependency-safe permanent capability deletion.** Zero-AI confirmation
  atomically acquires mutation ownership, revalidates/refuses declared dependents, closes the
  target to new reads, collects resources before table drop, commits a non-routable
  tombstone, then idempotently cleans artifacts/resources/Event Log payloads.
  Multi-incarnation reads acquire their full token set atomically. Event ownership
  is server-derived, M6 deletion absorbs committed/pending/cleanup file states, and
  the UI restores the canonical View before tombstone, then removes the target
  route/toolbar entry at commit; active-target deletion goes neutral while an
  unrelated active View remains. Cleanup retries cannot resurrect it. Recovery reserves identity until
  complete; late Event Log batches cannot resurrect payloads; same-id rebuild gets
  a new incarnation; content-free
  incarnation-keyed metrics remain. (ADR-0006; ARCH §8, §9.3)

### Verify by running it
Run `bun run reset`, build Notes with tier on, add scalar/list/non-text/hidden test
data, and evolve due date/item presentation. Confirm affected generation, copied
units, rerun frozen tests where code changed, complete incarnation/v2 snapshot,
atomic metrics+pointer activation, preserved records, and one View commit. Exercise
partial update preservation and the complete adversarial search baseline. Prove a
declared dependent blocks Notes deletion; remove it, fault/recover cleanup, then
recreate Notes with a new incarnation and new v1 code (no stale import cache).

### Exit criteria
Full CRUD uses scoped mutations plus declared free reads; update/search contracts
are deterministic; complete candidates flow through total diffs, tier-honest frozen
tests, immutable self-describing snapshots, recoverable publication, measured
activation, and a presenter-independent Builder. Dependency-safe zero-AI deletion
removes product state/resources/payloads with recoverable cleanup while retaining
only content-free incarnation-keyed metrics. The explicit build/extend engine is
ready for later loops.

---

## Module 5 — Reads Set Free: Ad-hoc Data Queries

**Goal:** add the **ephemeral whole-catalog** form of free reads. Let the user ask
questions across their data and get answers—without building or persisting a
capability. This is the exception to “everything is cached.”

**Why fifth:** Module 4 already establishes physically read-only SQL for persistent
generated Actions and declared lifecycle dependencies. Module 5 reuses that
safety seam but removes the persisted Handler/spec/dependency: one natural-
language question receives temporary whole-catalog access and a generic answer.
It needs populated capabilities, which now exist.

### Epics

- **5.1 — Ephemeral whole-catalog query adapter.** Reuse M4's physically read-only
  connection/authorizer and expose a bounded whole-active-catalog adapter to this
  request only. Acquire the complete per-incarnation read-token set atomically for
  the catalog snapshot so capability deletion cannot race the query. Mutation
  through the supplied adapter fails at the SQLite seam; in-process generated
  execution remains contract/static-check protection rather than hostile-code
  containment. (ARCH §3, §7 "Reads")
- **5.2 — `data_query` path.** Classify intent as `data_query`; translate NL → read-only `SELECT` (including cross-capability joins); apply a defensive `LIMIT` + timeout; run it. **Never persisted** — no registry entry, no toolbar tab, no version, no cache. (ARCH §7 "`data_query`")
- **5.3 — Generic auto-table renderer.** A platform-owned, **presentational-only** table for arbitrary result sets (so it doesn't introduce platform business logic). (ARCH §7 "`data_query`")
- **5.4 — Cheap reject/route classifier.** A friendly refusal for obvious non-queries ("delete everything") — used to route/reject early, but never the write-restriction mechanism (the supplied read-only adapter + static contract in 5.1 is). (ARCH §7 "Reads")
- **5.5 — Context-aware scoping.** The prompt bar scopes a query to the active capability when relevant. (ARCH §6.1, §7)

### Verify by running it
With Notes and one other capability built, type *"how many notes did I add last week?"* → an auto-table answer appears, and **nothing** is added to the toolbar. Type a cross-capability question → a joined table. Type *"delete everything"* → a friendly refusal. Confirm no registry row, version, or cache was created for any of these.

### Exit criteria
Free-form reads work across all capabilities, use the physically read-only supplied
adapter and its static contract, render in the generic auto-table, and create no
registry/version/artifact/cache/read-dependency state. M7 may later record the
ordinary user action in the Event Log without turning the query into a capability.

---

## Module 6 — Files: Upload, Store & Serve

**Goal:** apply the **same constrained-write / free-read split** to bytes (ARCH §7 "Files"). A capability can now hold files: upload is a constrained write through the router; serving is a free read through a platform route. With this, the **explicit loop is complete and full-featured.**

**Why sixth:** files are the last user-facing surface of the explicit loop. They
reuse M4's mutation interface (for the reference), the router (for upload), and
record lifecycle (for deletion)—all of which now exist. The `grid` collection
layout (`ui_intent.collection.layout: "grid"`) and the detail modal from Module 3
are exactly where uploaded images present.

### Epics

- **6.1 — Object store (S3-shaped tool).** `put / get / delete / url`, default-backed by the local filesystem (`Bun.file` / `Bun.write`), addressed by opaque key under `storage/<key>`; swappable to R2/S3/Garage by config. **Platform infrastructure — the AI never builds storage.** (ARCH §6.3 "Object Store", §7 "Files")
- **6.2 — `file` / `file[]` field type.** Schema support for file fields; extend M3's centralized platform field renderer with upload/detail controls. The data table stores only a **reference** (key + mime + size + original name), never the bytes. A `photos` capability is just a normal capability with a `file` field. (ARCH §6.3 "Capability Registry", §7 "Files")
- **6.3 — Upload = constrained write.** Multipart through the existing router;
  generated behavior calls the platform file adapter and stores the returned
  reference through M4's mutation interface. Durable pending ownership makes a
  failed Handler/DB commit compensatable. (ARCH §7 "Files")
- **6.4 — Serve = free read.** A platform-owned `/files/:key` route streams bytes with zero-copy `sendfile`; generated HTML simply references `/files/<key>` (e.g. `<img src>`). The AI never builds file serving. (ARCH §7 "Files")
- **6.5 — File ownership & lifecycle.** Opaque keys are exclusively owned by one
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
**The explicit prompting feature is complete.**

---

## Module 7 — Implicit Loop: Behavior → Proposal → Build

**Goal:** turn on the second intent loop (ARCH §8 "Loop 2"). Aluna watches *how*
the user behaves and proposes a capability. Confirmation hands an already-resolved
request to the explicit Builder established in M2–M4 and extended through M6—it
never silently changes Aluna or reclassifies the accepted proposal.

**Why seventh:** this is the thin, high-value layer that distinguishes implicit from explicit. It needs a complete, populated app to observe (Modules 2–6) and reuses the entire build pipeline. It adds exactly the two things explicit never needed: **full-fidelity event capture** and the **behavior→proposal classifier path**.

> **Open design work in this module: the implicit UX.** Capture, gate, async
> inference, explicit confirmation, resolved-request hand-off, and reuse of M4's
> mutation/publication/Gate/metrics lifecycle are fixed. Module 7 decides where and
> when proposals appear and which Builder lifecycle presenter follows confirmation
> (foreground interruption or quieter background presentation). The core Builder
> does not force the explicit prompt/SSE presenter.

### Epics

- **7.1 — Define the implicit UX (open design).** Decide proposal placement/timing
  and the post-confirmation Builder presenter. M3 supplies presentation primitives;
  M4 supplies presenter-independent resolved-request execution. Nothing builds
  without explicit confirmation. (ARCH §8 "Loop 2")
- **7.2 — Event tracker (dumb shell recorder).** Capture every action — click, hover, dwell, focus, scroll — with full context (timestamp, active capability, element id/type, on-screen data). Batch and ship to the server. **No client-side logic** — no thresholds, no detection. (ARCH §6.1 "Event Tracker", §8 "Loop 2")
- **7.3 — Event Log (ordinary append + deletion ownership).** Record every action
  with before/after situation and every capability incarnation whose product data
  appears. The server derives ownership from admitted route/query/read-token
  context and canonical payload production; client/model labels are not trusted.
  Normal use only appends; ingestion atomically validates/appends the derived set
  and rejects the batch if any pair is no longer active/current. Explicit capability deletion purges/redacts
  owned product payloads through M4's cleanup seam while a content-free deletion
  fact may remain.
- **7.4 — Server-side gate.** A cheap **deterministic** heuristic that trips only on a real pattern. No LLM call until it trips. Thresholds live server-side, next to the dataset — the experiment's main tuning knob, changeable without redeploying the shell. (ARCH §8 "Loop 2", server-side gate)
- **7.5 — Async intent resolution.** Off the interaction path (never blocks). Reads the event batch + context through the existing resolver. Below threshold → log only and back off (raise the bar for this pattern). Above threshold → proceed to a proposal. (ARCH §8 "Loop 2")
- **7.6 — Proposal + decision (contract fixed, presentation per 7.1).** Confirm
  hands the already-resolved request directly to M4's mutation coordinator/Builder;
  it carries `expected_absent` or exact capability id/incarnation/version plus the
  resolver-visible catalog revision/fingerprint used for classification. Lease-
  head mismatch of either refuses stale work rather than rebasing/reclassifying it;
  only then is the dependency-generation catalog frozen. Ignore
  logs/backoffs. It never re-runs prompt classification. Presentation comes from
  7.1. (ARCH §8 "Loop 2", §9.3)

### Verify by running it
Repeatedly do something suggestive. The gate asynchronously proposes a due-date
evolution. Confirm and prove the accepted resolved request enters the M2–M6
Builder exactly once without reclassification; Ignore backs off. Delete the
capability and confirm its Event Log product payloads are gone while content-free
experiment/deletion facts remain.

### Exit criteria
Behavioral patterns produce confirmation-gated proposals that, when accepted, build through the existing explicit pipeline. The app never changes itself without a confirmation. **Both intent loops are live.**

---

## Module 8 — Experiment Harness: Metrics, Latency & Tuning

**Goal:** make the PoC's **conclusions legible** — the reason the project exists (ARCH §6.3 "Generation Metrics", §9.6). Metrics have been written since Module 2; this module surfaces and analyzes them, and gives the implicit gate a tuning loop against the real event-log dataset.

**Why last:** it depends on data accrued by every prior module — generation metrics from Modules 2–7 and the event log from Module 7. It is an **experimenter-facing surface**, kept clearly separate from the friendly app (ARCH §9.7).

### Epics

- **8.1 — Metrics querying.** Query by build id and capability incarnation across
  `running | success | failed | interrupted` lifecycle status and typed outcomes
  such as `activated | no_change | stale`, plus semantic stage timings, queue
  wait, model, tokens, retries, Gate outcomes, and
  generated/copied/executed/skipped/absent tier states. Compare presentation and
  behavioral modes without assuming every snapshot contains `.html` or tests; add
  a metrics-only artifact-shape dimension if comparison needs one, without
  introducing the deferred registry/serving upgrade marker. (ARCH §6.3, §6.2)
- **8.2 — Outcome & overlap analysis.** Join admitted generation rows with the
  separate non-build `intent_resolution_metrics` rows to analyze extend-vs-
  separate decisions, activation/no-change/stale/failure rates, and the complete
  intent-classification distribution. (ARCH §6.2, §8 "Overlap resolution")
- **8.3 — Experimenter surface.** An internal view/report to read the dataset, clearly **not** part of the user-facing product voice (the friendly app shows no internals). (ARCH §9.7)
- **8.4 — Gate tuning loop.** Adjust the implicit gate's thresholds against the event-log dataset and observe the effect on proposal behavior — without redeploying the shell. (ARCH §8 "Loop 2")

### Verify by running it
After exercising both loops, open the experiment surface → see per-generation timing breakdowns, success/failure rates, and overlap decisions → adjust a gate threshold → observe that the implicit loop now proposes more (or less) aggressively.

### Exit criteria
The PoC's questions can be answered by **querying the dataset**, not guessing. Latency and capability conclusions are visible; the implicit gate is tunable against real data.

---

## Cross-cutting concerns

These are not modules — they are disciplines every module from its introduction point onward must honor. They are listed here so they don't get lost between vertical slices.

| Concern | Introduced in | Rule | ARCH ref |
|---|---|---|---|
| **Mutation coordinator** | M2 (build queue), completed M4 | Resolved builds bind target + resolver-catalog fingerprint, use bounded tickets then one active lease, and fail stale on lease-head mismatch; all shared-connection writes use ownership-checked leases; deletion atomically try-acquires and never queues | §8 "Concurrency" |
| **Spec → derived artifacts discipline** | M2 | The arrow only ever points authored spec → handlers/item renderer/tests. M4's total positive-proof matrix scopes regeneration and preserves committed incarnation/version history. Through M8, platform artifact-shape changes reset/rebuild; preserving upgrades and their marker remain deferred | §2, §9.1 |
| **Validate-before-commit / atomic pointer flip** | M2 | Nothing goes live until it clears every active gate rung — type-check, signatures, smoke run, (behavioral tier on) tests, and (from M3) design lint — then pointer + `success/activated` commit at the point of no return; later transport failure cannot undo it | §6.2, §9.5 |
| **Additive-only structure** | M2 (DDL), M4 (evolution) | The admitted platform DDL path adds or soft-hides and never `DROP`s/destructively renames; this is an interface/static-contract guarantee, not hostile-code containment | §3, §9.3 |
| **Closed-value design contract + design gate** | M3 | Generated item markup targets allow-listed semantic/primitive classes first (incl. layout utilities), with token-disciplined inline `style` as the escape hatch — the token layer owns color/font/type-scale/spacing/border values, never redeclared raw; a fail-closed design-lint rung enforces it; structural mechanics — including the closed `feed | grid` collection layout the container reads from `ui_intent` — are platform-owned presentation | §6.2, §6.3, §7, §9.7 |
| **Metrics on every admitted build** | M2, lifecycle tightened M4 | Resolver-only/pre-lease outcomes are best-effort and are not builds; durability begins with direct stale or `running`. Activation, no-op, stale admission, failure, and interruption remain queryable | §6.3, §9.6 |
| **Read-only adapter safety** | M1 (connection), M4 (persistent Actions), M5 (whole-catalog query) | Mutation through the supplied query adapter fails at SQLite. Persistent generated Actions declare dependencies; M5 access is ephemeral and atomically acquires the catalog token set. In-process execution is not a security sandbox | §3, §7 |
| **Product voice, never internals** | M2 onward | Narration, proposals, confirmations, errors all speak in friendly product voice | §9.7 |
| **Confirmation boundaries** | M4 (record and capability deletion), M7 (every proposal) | Destructive deletion and implicit proposals require explicit confirmation through platform-owned product UI. Explicit prompt evolution proceeds directly but stays foreground and narrated; no preview/code-steering loop is introduced | §9.3 |

---

## Dependency flow

```
M1 Scaffold
   │  (shell · SSE · dual SQLite · AI provider)
   ▼
M2 Explicit I  ──────────────────────────────┐  seeds the shared backbone:
   │  (registry · initial data tool · router · │  registry, storage, router,
   │   builder · queue · metrics · SSE swap)  │  orchestrator, AI call, toolbar,
   ▼                                          │  queue, metrics
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
M5 Reads free                                 │
   │  (whole-catalog data_query · auto-table) │
   ▼                                          │
M6 Files  ── explicit loop COMPLETE ──────────┘
   │  (object store · file fields · serve)
   ▼
M7 Implicit loop   ── reuses the M2–M4 Builder as extended through M6
   │  (event tracker · event log · gate · async resolution · proposals)
   ▼
M8 Experiment harness   ── reads metrics (M2–M7) + event log (M7)
      (latency · outcomes · experimenter surface · gate tuning)
```

Linear and progressive: each module runs, is testable, and stands on its own. Capabilities are presentable at M3, fully evolvable at M4, and the explicit loop is whole at M6; implicit (M7) is a thin layer on top of it; the experiment surface (M8) reads what everything before it produced.
