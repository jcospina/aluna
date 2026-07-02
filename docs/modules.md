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

Every module is a **vertical slice you can run and verify**, not a horizontal layer. There is no "types" module, no "registry" module, no "intent resolver" module — those are pieces that are useless on their own. Instead, each piece of shared infrastructure (capability registry, data tool, router, orchestrator, AI call, toolbar) is introduced **inside the first feature that needs it**, and reused by everything after.

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

Both intent loops share the same foundation: the **capability registry, storage layer, data tool, router, orchestrator (intent resolver + capability builder + diff engine), the AI provider call, the build queue, and the toolbar**. All of that is built during the explicit phase (Modules 2–6), because the explicit loop exercises every piece of it.

The **implicit loop adds only two things the explicit loop never needs**: the **event tracker** (full-fidelity behavioral capture in the shell) and the **classifier path that turns behavior into a proposal** (the server-side gate + async intent resolution). That is why implicit is a single later module — it is a thin, high-value layer on top of an already-complete explicit system, not a parallel rebuild.

---

## Module map at a glance

| # | Module | What you can do at the end | Adds | Reuses |
|---|--------|----------------------------|------|--------|
| 1 | **Platform Scaffold & Runtime Spine** | Boot an empty platform: shell loads, server streams, AI answers, DB opens | Bun · Hono · HTMX · Alpine · SSE · dual SQLite connections · AI provider interface | — |
| 2 | **Explicit Loop I — Build Your First Capability** | Type a prompt → watch a working capability build itself → add & see records | Registry · data tool · router · builder · build queue · metrics writing · SSE swap | M1 |
| 3 | **Opinionated Capability UI** | The capabilities the app builds look and feel like a coherent product — styled lists, a shared modal, a prefilled detail view — not a 1990s form dump | Platform UI modules · single generated item renderer · closed-value primitive vocabulary · few-shot design gallery · design-lint gate rung · `ui_intent` (item/collection/detail) · new artifact shape (reset, no cutover) | M1–M2 |
| 4 | **Explicit Loop II — Full CRUD & Evolution** | Edit/delete/search records; extend a capability in place; safe versioned rebuilds | Full tool set · full classifier · overlap resolution · diff engine · versioning · rollback | M1–M3 |
| 5 | **Reads Set Free — Ad-hoc Data Queries** | Ask questions across your data; get answers in a table; nothing is built | Read-only safety boundary · NL→SQL `data_query` · generic auto-table · reject classifier | M1–M4 |
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
  > **Note (forward-pointer to M2–M4):** 1.5 stands up *only* the provider contract — streamed structured round-trip + the one-line model swap — keeping Module 1's "zero domain logic" line. The **code-writing harness** is a bounded tool-loop scoped to a single build unit (write → type-check → fix), and it lands with the **Capability Builder** (epic 2.5, tightened with behavioral retries in 4.5), *not here*. We deliberately do **not** adopt a roaming autonomous agent, a hosted agent API, or an execution sandbox; the harness *discipline* (pipeline, diff, gate, migrations) stays ours. Full rationale and the rejected alternatives are in ADR-0003.

### Verify by running it
`bun run dev` → open the browser → the shell renders with an empty toolbar and a prompt bar → click *Meet Aluna* and the real AI provider streams a product-voice greeting into the content area (a structured round-trip, end to end) → the SQLite file exists with the migrations table.

### Exit criteria
The app boots and stays up. Shell, SSE, AI provider, and both DB connections are independently proven. No capability logic exists anywhere.

---

## Module 2 — Explicit Loop I: Build Your First Capability

**Goal:** prove the thesis. A user types a prompt, watches the app build a capability **for that prompt**, and immediately uses it. Scope is deliberately the **smallest complete vertical slice**: a single new capability with the **create + read** subset of CRUD. This module stands up the entire shared backbone the rest of the project reuses.

**Why second:** this is the moment the premise becomes real — *the app writes itself*. Everything here (registry, data tool, router, builder, queue, metrics, SSE swap) is reused by Modules 3–8.

### Epics

- **2.1 — Capability Registry (source of truth).** The store for spec rows: `id, label, version, schema, ui_intent, behavior, tools, artifacts_path, prompt_context`. Read/write access. Toolbar rehydrates from it on load. (ARCH §6.3 "Capability Registry")
- **2.2 — Constrained data tool + additive DDL.** Generate a `CREATE TABLE` migration from a spec; expose row-level `insert` + `select` keyed by capability; a JSON escape-hatch column. Writes go through the tool only; reads use the read-only connection. (ARCH §3, §6.3 "Data Tables", §7 "Writes")
- **2.3 — Deterministic router.** The fixed `/capability/:id/:action` convention; load and run the matching generated handler file. Routing is never an AI concern. (ARCH §6.2 router)
- **2.4 — Minimal intent resolver (`new_capability` only).** Prompt + registry context → a structured intent that seeds a new capability spec, plus the `user_facing_label`. Only the new-capability path for now. (ARCH §6.2 "Intent Resolver")
- **2.5 — Capability builder (new path) + global serial build queue.** The atomic pipeline: spec → additive migration → generate `create` + `read` handler `.ts` → generate `list` + `create` HTML → **validate through a layered, fail-closed gate** (typecheck + assert action signatures; smoke insert; and — when the behavioral tier is on — execute tests generated from the spec's `behavior`, *independently of the handlers*) → commit (write `v1/` artifacts, registry row, pointer flip). The behavioral rung is a **global toggle** so its added latency stays measurable against the no-test baseline; it lifts "validated" from *compiles + runs* to *behaves as specified*. Single-flight build queue. Product-voice narration over SSE throughout. (ARCH §6.2 "Capability Builder", §8 "Concurrency", §9.1, §9.5)
- **2.6 — Shell render + commit swap.** Stream narration as it builds; on commit, swap the content area and update the toolbar out-of-band (`hx-swap-oob`) in one SSE response. Clicking a toolbar entry loads that capability's cached HTML. (ARCH §6.1, §6.2 Diff Engine basics)
  > **Note (carried from Epic 1.3):** the 1.3 demo proved SSE consumption via raw `EventSource` + manual DOM, **not** the HTMX-driven swap path this epic needs. The htmx SSE extension is **not yet vendored**. Vendor it and prove `hx-swap-oob` over SSE *here*, before relying on it — the client wire the product actually uses is still unproven. Also resolve the channel-topology question (per-build ephemeral stream vs. one persistent shell channel for async push). See ADR-0002.
- **2.7 — Metrics writing.** One metrics record per generation: timing breakdown (incl. test-gen and test-run when the behavioral tier is on), per-rung gate outcomes and any retries, model, tokens, outcome. The test-tier columns are what let M8 quantify behavioral verification's cost against the no-test baseline. (ARCH §6.3 "Generation Metrics", §6.2)

### Verify by running it
Type *"I want to keep track of my notes."* → watch the friendly narration build it → a **Notes** tab appears in the toolbar → the content area shows a list and an "add note" form → add a note → it persists → refresh the page → the toolbar rehydrates and the note is still there. A metrics row was written for the build.

### Exit criteria
A typed prompt produces a real, persisted, usable capability with create + read, committed atomically and validated before going live. The full backbone (registry, data tool, router, builder, queue, metrics, SSE swap) exists and is reused from here on.

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
- **3.7 — Switch to the new artifact shape (reset, not migrate).** Make the M3 shape (platform-rendered views + one item renderer) the only one the build pipeline produces and the registry/router serve; retire the M2 `list.html`/`create.html` paths. Because the project is greenfield, the M2→M3 transition is **`bun run reset` + rebuild fresh** — Module 3 builds **no** preservation cutover, **no** dual-serving, and **no** persisted `artifact_contract` marker. That preservation path is deferred until the platform is feature-complete (ADR-0005 §7); M8 reintroduces a contract marker if it needs to compare presentation-gen across contract versions. (ADR-0005)

### Verify by running it
Run `bun run reset`, then build *"I want to keep track of my notes"* fresh → the styled list truncates long text and exposes a **New note** button → the shared modal opens with an on-brand form → a created note appears through the same item renderer used by the read path → clicking its platform-owned wrapper opens the same modal prefilled and read-only. Build *"save links with a title and a url"* and confirm its item composition differs from Notes while reusing the same modal and primitives; build something visual (e.g. *"a place for my photos"*) and confirm it comes out as a `grid` collection while Notes stays a `feed`. Finally, make an item renderer emit an unknown class or unsafe field value and confirm the design gate fails with friendly narration and no pointer flip.

### Exit criteria
All capabilities present through platform-owned modal/list/form/item-wrapper modules. One generated item renderer is the builder's creative surface and is shared by every action through the presentation adapter. The closed-value contract is fail-closed; the collection layout is a closed `feed | grid` choice the platform container honors; clicking an item opens a prefilled read-only modal; future field types extend one centralized renderer. The M2 `list.html`/`create.html` artifact shape is fully retired; the platform produces and serves only the M3 shape.

---

## Module 4 — Explicit Loop II: Full CRUD, Evolution & Minimal-Diff Rebuilds

**Goal:** make capabilities **fully usable and evolvable**. Add the rest of CRUD (update, delete, search), let the resolver classify across all intent types, decide extend-vs-namespace, and rebuild **only the units that changed** — safely, versioned, and reversibly.

**Why fourth:** Module 2 proves a capability can be *born* and Module 3 makes it *presentable*. This proves it can *grow* without losing data and without regenerating things that didn't change — the efficiency and safety story from ARCH §6.2 and §9. Editing slots straight onto Module 3's modal: `update` is the Save button on the already-built detail view.

### Epics

- **4.1 — Complete the tool set.** Generate `update`, `delete`, `search` handlers. Editing is the **Save button on Module 3's detail modal**; delete is a platform affordance backed by the generated handler; search results reuse the platform list scaffolding and the capability's one item renderer. The capability now exposes all five declared tools. (ARCH §6.2 router actions)
- **4.2 — Full intent resolver + overlap resolution.** Classify into `new_capability | extend_capability | ui_change`; using the whole registry, silently decide **extend** vs. **namespaced new capability**; emit `user_facing_label` and `requires_confirmation`. The user never reconciles schemas. (ARCH §6.2 "Intent Resolver", §8 "Overlap resolution", §9.4)
- **4.3 — Diff engine.** Compute the minimal change between old and new spec at **unit granularity** (handler files + the single item renderer). Platform form/detail changes derive deterministically from the new spec; regenerate the item renderer only when item intent changes. Feed the AI the previous generated unit + spec diff to preserve the rest; stream only affected surfaces with targeted `hx-swap`. (ARCH §6.2 "Diff Engine")
- **4.4 — Additive schema evolution + list field types.** Expand the field vocabulary with list types and extend M3's centralized field renderer for their create/edit/detail controls. Migrations may `ADD COLUMN`, use the JSON escape hatch, or **soft-hide** — never `DROP`/destructive rename. Version-namespaced artifacts (`v<n>/`). (ARCH §3, §6.3 "Data Tables", §9.3)
- **4.5 — Atomic versioning + safety.** Validate before commit through the full layered gate (now including the M3 design-lint rung); when the behavioral tier is on, each changed unit's test is regenerated and re-run, and a failing behavioral assertion may trigger a bounded retry of that unit. On failure roll back the migration transaction, leave the previous version live, orphan new files for GC, and log the failure — including which rung failed — to metrics. A failed build never bumps the version. (ARCH §6.2, §9.5, §9.6)
- **4.6 — Capability deletion + confirmation.** Deleting a whole capability is one of only two confirmation-gated actions. Users delete their own records freely (logged). (ARCH §9.3, §3)

### Verify by running it
On the Notes capability, type *"add a due date and let me edit and search my notes."* → the resolver chooses **extend**; only the affected units regenerate (untouched units stay byte-identical); the version bumps to v2; existing notes are intact. Editing happens in the detail modal (now with a Save button), delete, and search all work. Then delete the whole capability — and confirm the one confirmation prompt appears.

### Exit criteria
Capabilities support full CRUD, evolve in place via additive migrations, rebuild only changed units, version safely with rollback, and can be deleted behind a confirmation. The explicit *build/extend* engine is complete.

---

## Module 5 — Reads Set Free: Ad-hoc Data Queries

**Goal:** deliver the **read** half of the unifying principle (ARCH §3). Let the user ask questions across their data and get answers — **without building anything**. This is the ephemeral exception to "everything is cached."

**Why fifth:** Modules 2–4 made *mutation* (constrained, serialized, versioned) work. This module makes *reading* (free, concurrent, unconstrained SQL behind a read-only boundary) work. It needs capabilities with data, which now exist.

### Epics

- **5.1 — Read-only safety boundary.** Enforce the read-only connection (`SQLITE_OPEN_READONLY` / authorizer) as the **deterministic** guarantee that a write is physically impossible regardless of the SQL the model emits. Hand the model the registry schema as a catalog so it writes correct SQL. (ARCH §3, §7 "Reads")
- **5.2 — `data_query` path.** Classify intent as `data_query`; translate NL → read-only `SELECT` (including cross-capability joins); apply a defensive `LIMIT` + timeout; run it. **Never persisted** — no registry entry, no toolbar tab, no version, no cache. (ARCH §7 "`data_query`")
- **5.3 — Generic auto-table renderer.** A platform-owned, **presentational-only** table for arbitrary result sets (so it doesn't introduce platform business logic). (ARCH §7 "`data_query`")
- **5.4 — Cheap reject/route classifier.** A friendly refusal for obvious non-queries ("delete everything") — used to route/reject early, but **never** the safety boundary (that's 5.1). (ARCH §7 "Reads")
- **5.5 — Context-aware scoping.** The prompt bar scopes a query to the active capability when relevant. (ARCH §6.1, §7)

### Verify by running it
With Notes and one other capability built, type *"how many notes did I add last week?"* → an auto-table answer appears, and **nothing** is added to the toolbar. Type a cross-capability question → a joined table. Type *"delete everything"* → a friendly refusal. Confirm no registry row, version, or cache was created for any of these.

### Exit criteria
Free-form reads work across all capabilities, are guaranteed write-safe by the connection (not the LLM), render in the generic auto-table, and leave zero persistent trace.

---

## Module 6 — Files: Upload, Store & Serve

**Goal:** apply the **same constrained-write / free-read split** to bytes (ARCH §7 "Files"). A capability can now hold files: upload is a constrained write through the router; serving is a free read through a platform route. With this, the **explicit loop is complete and full-featured.**

**Why sixth:** files are the last user-facing surface of the explicit loop. They reuse the data tool (for the reference), the router (for upload), and record lifecycle (for deletion) — all of which now exist. The `grid` collection layout (`ui_intent.collection.layout: "grid"`) and the detail modal from Module 3 are exactly where uploaded images present.

### Epics

- **6.1 — Object store (S3-shaped tool).** `put / get / delete / url`, default-backed by the local filesystem (`Bun.file` / `Bun.write`), addressed by opaque key under `storage/<key>`; swappable to R2/S3/Garage by config. **Platform infrastructure — the AI never builds storage.** (ARCH §6.3 "Object Store", §7 "Files")
- **6.2 — `file` / `file[]` field type.** Schema support for file fields; extend M3's centralized platform field renderer with upload/detail controls. The data table stores only a **reference** (key + mime + size + original name), never the bytes. A `photos` capability is just a normal capability with a `file` field. (ARCH §6.3 "Capability Registry", §7 "Files")
- **6.3 — Upload = constrained write.** Multipart through the existing router (`/capability/:id/create`); the generated handler calls `files.put(...)` and stores the returned reference via the data tool. (ARCH §7 "Files")
- **6.4 — Serve = free read.** A platform-owned `/files/:key` route streams bytes with zero-copy `sendfile`; generated HTML simply references `/files/<key>` (e.g. `<img src>`). The AI never builds file serving. (ARCH §7 "Files")
- **6.5 — File lifecycle.** Deleting a record deletes its file (user-driven, logged) — consistent with "records freely deleted; structure never destroyed." (ARCH §7 "Files", §3)

### Verify by running it
Type *"let me save photos with a caption."* → a photos capability with an upload form builds → upload an image → it renders in the list (as a media tile in a `grid` collection, via `/files/<key>`) → click it → the detail modal shows the full image and caption → delete the record → the underlying file is gone.

### Exit criteria
Capabilities can hold files end to end (upload, store, serve, delete) through platform tooling. **The explicit prompting feature is complete.**

---

## Module 7 — Implicit Loop: Behavior → Proposal → Build

**Goal:** turn on the second intent loop (ARCH §8 "Loop 2"). The app watches *how* the user behaves, and when a real pattern emerges it **proposes** a capability in friendly language. On confirmation it hands off to the explicit builder from Modules 2–4 — **it never silently changes the app.**

**Why seventh:** this is the thin, high-value layer that distinguishes implicit from explicit. It needs a complete, populated app to observe (Modules 2–6) and reuses the entire build pipeline. It adds exactly the two things explicit never needed: **full-fidelity event capture** and the **behavior→proposal classifier path**.

> **Open design work in this module: the implicit UX.** The epics below define the loop's *backstage* — capture, gate, async inference, proposal, hand-off. **How implicit work is surfaced to the user is not predetermined** and is part of what this module decides: interrupt vs. quiet background build, where a proposal lives on screen, a persistent assistant presence vs. a transient notice, tone and timing of notifications. Only the contract is fixed — **the app never changes itself without an explicit confirmation**, and confirmation hands off to the Module 2–4 pipeline. Epic 7.1 makes this design decision explicitly, before the build epics are finalized.

### Epics

- **7.1 — Define the implicit UX (open design).** Decide how implicit work reaches the user — interrupt vs. quiet background build, where a proposal appears, a persistent assistant presence vs. a transient notice, the tone and timing of notifications. **This is genuinely undefined today: it is design work, not a foregone conclusion**, and it constrains every epic below. Its presentation uses M3's tokens/primitives, but M3 does not predetermine its placement or interaction model. The only fixed contract is that nothing builds without an explicit confirmation. (ARCH §8 "Loop 2")
- **7.2 — Event tracker (dumb shell recorder).** Capture every action — click, hover, dwell, focus, scroll — with full context (timestamp, active capability, element id/type, on-screen data). Batch and ship to the server. **No client-side logic** — no thresholds, no detection. (ARCH §6.1 "Event Tracker", §8 "Loop 2")
- **7.3 — Event log (append-only store).** Every action with full before/after **situation**, not just the change. Queryable. This is the experiment's primary dataset. (ARCH §6.3 "Event Log")
- **7.4 — Server-side gate.** A cheap **deterministic** heuristic that trips only on a real pattern. No LLM call until it trips. Thresholds live server-side, next to the dataset — the experiment's main tuning knob, changeable without redeploying the shell. (ARCH §8 "Loop 2", server-side gate)
- **7.5 — Async intent resolution.** Off the interaction path (never blocks). Reads the event batch + context through the existing resolver. Below threshold → log only and back off (raise the bar for this pattern). Above threshold → proceed to a proposal. (ARCH §8 "Loop 2")
- **7.6 — Proposal + decision (contract fixed, presentation per 7.1).** A confirmation-gated proposal: **Confirm** → enqueue into the existing serial build queue (Loop 1 does the work). **Ignore** → log the dismissal and back off the pattern. *Whether/how the proposal interrupts, where it renders, and what it looks like is decided in 7.1* — only the confirm-before-build contract is fixed here. (ARCH §8 "Loop 2", §9.3)

### Verify by running it
Repeatedly do something suggestive in the app (e.g. keep typing dates into note text). The gate trips; **asynchronously**, a proposal is offered along the lines of *"Want me to add due dates to your notes?"* (the exact presentation is whatever 7.1 decides). Confirm → it builds via the Module 2–4 pipeline and appears. Or ignore it → the system backs off and logs the dismissal. Inspect the event log to confirm full-fidelity capture.

### Exit criteria
Behavioral patterns produce confirmation-gated proposals that, when accepted, build through the existing explicit pipeline. The app never changes itself without a confirmation. **Both intent loops are live.**

---

## Module 8 — Experiment Harness: Metrics, Latency & Tuning

**Goal:** make the PoC's **conclusions legible** — the reason the project exists (ARCH §6.3 "Generation Metrics", §9.6). Metrics have been written since Module 2; this module surfaces and analyzes them, and gives the implicit gate a tuning loop against the real event-log dataset.

**Why last:** it depends on data accrued by every prior module — generation metrics from Modules 2–7 and the event log from Module 7. It is an **experimenter-facing surface**, kept clearly separate from the friendly app (ARCH §9.7).

### Epics

- **8.1 — Metrics querying.** Latency breakdowns (spec-gen, code-gen, presentation-gen — including M2's historical HTML-gen and M3+'s item-renderer generation — test-gen, migration, test-run, total wall-clock), model, token counts, success/failure and per-rung gate outcomes per generation. Includes behavioral-tier and artifact-contract comparisons. (ARCH §6.3 "Generation Metrics", §9.6, §6.2)
- **8.2 — Outcome & overlap analysis.** Extend-vs-namespace decisions, build success/failure rates, intent-classification distribution — the conclusions about capability quality. (ARCH §6.2, §8 "Overlap resolution")
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
| **Global serial build queue** | M2 | One build at a time, system-wide; both loops enqueue into it | §8 "Concurrency" |
| **Spec → derived artifacts discipline** | M2 | The arrow only ever points spec → handlers/item renderer/tests; spec evolution regenerates only affected units. Platform artifact-contract upgrades are separately marked and atomically re-derive caches without pretending user intent changed | §2, §9.1 |
| **Validate-before-commit / atomic pointer flip** | M2 | Nothing goes live until it clears every active gate rung — type-check, signatures, smoke run, (behavioral tier on) tests, and (from M3) the design-lint rung — then an atomic pointer flip | §6.2, §9.5 |
| **Additive-only structure** | M2 (DDL), M4 (evolution) | Add or soft-hide; never `DROP`/destructive rename — structurally incapable of AI data loss | §3, §9.3 |
| **Closed-value design contract + design gate** | M3 | Generated item markup targets allow-listed semantic/primitive classes first (incl. layout utilities), with token-disciplined inline `style` as the escape hatch — the token layer owns color/font/type-scale/spacing/border values, never redeclared raw; a fail-closed design-lint rung enforces it; structural mechanics — including the closed `feed | grid` collection layout the container reads from `ui_intent` — are platform-owned presentation | §6.2, §6.3, §7, §9.7 |
| **Metrics on every generation** | M2 | Every build writes a metrics record before returning; failure is data | §6.3, §9.6 |
| **Read-only safety boundary** | M1 (connection), M5 (enforced) | A write is physically impossible on the read path, regardless of model output | §3, §7 |
| **Product voice, never internals** | M2 onward | Narration, proposals, confirmations, errors all speak in friendly product voice | §9.7 |
| **Confirmation reserved for two things** | M4 (delete capability), M7 (every proposal) | Field-level evolution is silent and instant; only these two require a confirm | §9.3 |

---

## Dependency flow

```
M1 Scaffold
   │  (shell · SSE · dual SQLite · AI provider)
   ▼
M2 Explicit I  ──────────────────────────────┐  builds the shared backbone:
   │  (registry · data tool · router ·        │  registry, storage, router,
   │   builder · queue · metrics · SSE swap)  │  orchestrator, AI call, toolbar,
   ▼                                          │  build queue, metrics
M3 Opinionated UI                             │
   │  (platform modules · one item renderer · │  ← presentation contract
   │   closed contract · design gate ·         │     reused by every later
   │   detail modal · new artifact shape)      │     user-facing surface
   ▼                                          │
M4 Explicit II                                │
   │  (full CRUD · classifier · overlap ·     │  ← build pipeline reused by
   │   diff engine · versioning · rollback)   │     every later module
   ▼                                          │
M5 Reads free                                 │
   │  (RO boundary · data_query · auto-table) │
   ▼                                          │
M6 Files  ── explicit loop COMPLETE ──────────┘
   │  (object store · file fields · serve)
   ▼
M7 Implicit loop   ── reuses M2–M4 build pipeline
   │  (event tracker · event log · gate · async resolution · proposals)
   ▼
M8 Experiment harness   ── reads metrics (M2–M7) + event log (M7)
      (latency · outcomes · experimenter surface · gate tuning)
```

Linear and progressive: each module runs, is testable, and stands on its own. Capabilities are presentable at M3, fully evolvable at M4, and the explicit loop is whole at M6; implicit (M7) is a thin layer on top of it; the experiment surface (M8) reads what everything before it produced.
