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

- **The implicit-loop UX.** The modules below define the implicit loop's *backstage* — event capture, the gate, async inference, confirmations, and the hand-off to the build pipeline. They do **not** define how implicit work is *presented* to the user: whether a proposal interrupts or builds quietly in the background, where it appears, whether there is a persistent assistant presence or a one-off notice, its tone or its timing. That UX is an open design question owned by **Module 6**, to be decided when it is built. The only fixed commitment is the contract: **nothing is built without an explicit confirmation.**
- **Every piece's internals.** The same holds for each module's implementation. The "verify by running it" demos describe *observable behavior*, not the code that produces it.

---

## How this plan is sliced

Every module is a **vertical slice you can run and verify**, not a horizontal layer. There is no "types" module, no "registry" module, no "intent resolver" module — those are pieces that are useless on their own. Instead, each piece of shared infrastructure (capability registry, data tool, router, orchestrator, AI call, toolbar) is introduced **inside the first feature that needs it**, and reused by everything after.

Three rules govern the ordering:

1. **Scaffolding first.** Module 1 stands up the repo and wires every dependency together with zero domain logic.
2. **Explicit prompting before implicit prompting.** Modules 2–5 build the entire explicit loop end to end. Implicit (Module 6) reuses that work.
3. **Each module is progressive and self-contained.** It builds on the one before it, and on its own it is a complete, demonstrable, testable piece of the product. You can stop after any module and have a thing that runs.

### The shared grounding vs. the implicit-only pieces

Both intent loops share the same foundation: the **capability registry, storage layer, data tool, router, orchestrator (intent resolver + capability builder + diff engine), the AI provider call, the build queue, and the toolbar**. All of that is built during the explicit phase (Modules 2–5), because the explicit loop exercises every piece of it.

The **implicit loop adds only two things the explicit loop never needs**: the **event tracker** (full-fidelity behavioral capture in the shell) and the **classifier path that turns behavior into a proposal** (the server-side gate + async intent resolution). That is why implicit is a single later module — it is a thin, high-value layer on top of an already-complete explicit system, not a parallel rebuild.

---

## Module map at a glance

| # | Module | What you can do at the end | Adds | Reuses |
|---|--------|----------------------------|------|--------|
| 1 | **Platform Scaffold & Runtime Spine** | Boot an empty platform: shell loads, server streams, AI answers, DB opens | Bun · Hono · HTMX · Alpine · SSE · dual SQLite connections · AI provider interface | — |
| 2 | **Explicit Loop I — Build Your First Capability** | Type a prompt → watch a working capability build itself → add & see records | Registry · data tool · router · builder · build queue · metrics writing · SSE swap | M1 |
| 3 | **Explicit Loop II — Full CRUD & Evolution** | Edit/delete/search records; extend a capability in place; safe versioned rebuilds | Full tool set · full classifier · overlap resolution · diff engine · versioning · rollback | M1–M2 |
| 4 | **Reads Set Free — Ad-hoc Data Queries** | Ask questions across your data; get answers in a table; nothing is built | Read-only safety boundary · NL→SQL `data_query` · generic auto-table · reject classifier | M1–M3 |
| 5 | **Files — Upload, Store & Serve** | Create capabilities that hold files; upload, view, and delete them | S3-shaped object store · `file` field type · upload (write) · serve (read) · lifecycle | M1–M4 |
| 6 | **Implicit Loop — Behavior → Proposal → Build** | The app notices a pattern in how you work and offers to build for you | Event tracker · event log · server-side gate · async resolution · proposals | M1–M5 |
| 7 | **Experiment Harness — Metrics, Latency & Tuning** | Read the PoC's conclusions; tune the implicit gate against real data | Metrics querying · outcome/overlap analysis · experimenter surface · gate tuning | M1–M6 |

**Explicit loop is fully complete and full-featured at the end of Module 5.** Module 6 turns on the second loop. Module 7 makes the experiment legible.

---

## Module 1 — Platform Scaffold & Runtime Spine

**Goal:** a running platform with every wire connected and **zero domain logic**. Nothing builds capabilities yet — but the shell renders, the server streams, the AI provider answers, and the database opens. This is the "no-dependency-tax" stack from ARCHITECTURE §4, stood up and proven.

**Why first:** everything downstream assumes these wires exist. We prove the stack works *before* we put any thinking on top of it.

### Epics

- **1.1 — Project & toolchain.** Bun project, TypeScript config, directory layout (`capabilities/`, `storage/`, db location), dev/build scripts, lint/format. (ARCH §4)
- **1.2 — Hono server + the fixed shell.** Serve the single static HTML page with HTMX + Alpine. Base product-voice layout and styling. Renders the three shell regions as inert placeholders: prompt bar, empty capability toolbar, empty content area. (ARCH §6.1)
- **1.3 — SSE streaming primitive.** Server→client Server-Sent Events channel. A demo stream that pushes tokens; client wiring that swaps/appends streamed HTML into the content area. (ARCH §4, §6.2)
- **1.4 — SQLite foundation.** Open a **read-write** connection and a separate **read-only** connection (`SQLITE_OPEN_READONLY`). A migrations runner for platform-owned schema. (No domain tables yet — those are created by the modules that need them.) (ARCH §4, §6.3, §7)
- **1.5 — Pluggable AI provider.** A thin `generate(prompt, schema)` streaming contract with one real provider behind it (any SOTA LLM with fast mode), BYO-key config, and a single configured global model. A test round-trip proves a structured response comes back. (ARCH §4 "Model strategy")

### Verify by running it
`bun run dev` → open the browser → the shell renders with an empty toolbar and a prompt bar → an SSE demo streams text into the content area → a test invocation of the provider returns a structured object → the SQLite file exists with the migrations table.

### Exit criteria
The app boots and stays up. Shell, SSE, AI provider, and both DB connections are independently proven. No capability logic exists anywhere.

---

## Module 2 — Explicit Loop I: Build Your First Capability

**Goal:** prove the thesis. A user types a prompt, watches the app build a capability **for that prompt**, and immediately uses it. Scope is deliberately the **smallest complete vertical slice**: a single new capability with the **create + read** subset of CRUD. This module stands up the entire shared backbone the rest of the project reuses.

**Why second:** this is the moment the premise becomes real — *the app writes itself*. Everything here (registry, data tool, router, builder, queue, metrics, SSE swap) is reused by Modules 3–7.

### Epics

- **2.1 — Capability Registry (source of truth).** The store for spec rows: `id, label, version, schema, ui_intent, behavior, tools, artifacts_path, prompt_context`. Read/write access. Toolbar rehydrates from it on load. (ARCH §6.3 "Capability Registry")
- **2.2 — Constrained data tool + additive DDL.** Generate a `CREATE TABLE` migration from a spec; expose row-level `insert` + `select` keyed by capability; a JSON escape-hatch column. Writes go through the tool only; reads use the read-only connection. (ARCH §3, §6.3 "Data Tables", §7 "Writes")
- **2.3 — Deterministic router.** The fixed `/capability/:id/:action` convention; load and run the matching generated handler file. Routing is never an AI concern. (ARCH §6.2 router)
- **2.4 — Minimal intent resolver (`new_capability` only).** Prompt + registry context → a structured intent that seeds a new capability spec, plus the `user_facing_label`. Only the new-capability path for now. (ARCH §6.2 "Intent Resolver")
- **2.5 — Capability builder (new path) + global serial build queue.** The atomic pipeline: spec → additive migration → generate `create` + `read` handler `.ts` → generate `list` + `create` HTML → **validate through a layered, fail-closed gate** (typecheck + assert action signatures; smoke insert; and — when the behavioral tier is on — execute tests generated from the spec's `behavior`, *independently of the handlers*) → commit (write `v1/` artifacts, registry row, pointer flip). The behavioral rung is a **global toggle** so its added latency stays measurable against the no-test baseline; it lifts "validated" from *compiles + runs* to *behaves as specified*. Single-flight build queue. Product-voice narration over SSE throughout. (ARCH §6.2 "Capability Builder", §8 "Concurrency", §9.1, §9.5)
- **2.6 — Shell render + commit swap.** Stream narration as it builds; on commit, swap the content area and update the toolbar out-of-band (`hx-swap-oob`) in one SSE response. Clicking a toolbar entry loads that capability's cached HTML. (ARCH §6.1, §6.2 Diff Engine basics)
- **2.7 — Metrics writing.** One metrics record per generation: timing breakdown (incl. test-gen and test-run when the behavioral tier is on), per-rung gate outcomes and any retries, model, tokens, outcome. The test-tier columns are what let M7 quantify behavioral verification's cost against the no-test baseline. (ARCH §6.3 "Generation Metrics", §6.2)

### Verify by running it
Type *"I want to keep track of my notes."* → watch the friendly narration build it → a **Notes** tab appears in the toolbar → the content area shows a list and an "add note" form → add a note → it persists → refresh the page → the toolbar rehydrates and the note is still there. A metrics row was written for the build.

### Exit criteria
A typed prompt produces a real, persisted, usable capability with create + read, committed atomically and validated before going live. The full backbone (registry, data tool, router, builder, queue, metrics, SSE swap) exists and is reused from here on.

---

## Module 3 — Explicit Loop II: Full CRUD, Evolution & Minimal-Diff Rebuilds

**Goal:** make capabilities **fully usable and evolvable**. Add the rest of CRUD (update, delete, search), let the resolver classify across all intent types, decide extend-vs-namespace, and rebuild **only the units that changed** — safely, versioned, and reversibly.

**Why third:** Module 2 proves a capability can be *born*. This proves it can *grow* without losing data and without regenerating things that didn't change — the efficiency and safety story from ARCH §6.2 and §9.

### Epics

- **3.1 — Complete the tool set.** Generate `update`, `delete`, `search` handlers plus the edit form, delete affordance, and search/list views. The capability now exposes all five declared tools. (ARCH §6.2 router actions)
- **3.2 — Full intent resolver + overlap resolution.** Classify into `new_capability | extend_capability | ui_change`; using the whole registry, silently decide **extend** vs. **namespaced new capability**; emit `user_facing_label` and `requires_confirmation`. The user never reconciles schemas. (ARCH §6.2 "Intent Resolver", §8 "Overlap resolution", §9.4)
- **3.3 — Diff engine.** Compute the minimal change between old and new spec at **unit granularity** (handler files, HTML fragments). Regenerate only affected units; feed the AI the previous version of that unit + the spec diff to apply the delta and preserve the rest; stream only changed fragments with targeted `hx-swap`. (ARCH §6.2 "Diff Engine")
- **3.4 — Additive schema evolution.** Migrations that `ADD COLUMN` or use the JSON escape hatch, or **soft-hide** — never `DROP`/destructive rename. Version-namespaced artifacts (`v<n>/`). (ARCH §3, §6.3 "Data Tables", §9.3)
- **3.5 — Atomic versioning + safety.** Validate before commit through the full layered gate; when the behavioral tier is on, each changed unit's test is regenerated and re-run, and a failing behavioral assertion may trigger a bounded retry of that unit. On failure roll back the migration transaction, leave the previous version live, orphan new files for GC, and log the failure — including which rung failed — to metrics. A failed build never bumps the version. (ARCH §6.2, §9.5, §9.6)
- **3.6 — Capability deletion + confirmation.** Deleting a whole capability is one of only two confirmation-gated actions. Users delete their own records freely (logged). (ARCH §9.3, §3)

### Verify by running it
On the Notes capability, type *"add a due date and let me edit and search my notes."* → the resolver chooses **extend**; only the create/detail/edit units regenerate (list and delete stay byte-identical); the version bumps to v2; existing notes are intact. Edit, delete, and search all work. Then delete the whole capability — and confirm the one confirmation prompt appears.

### Exit criteria
Capabilities support full CRUD, evolve in place via additive migrations, rebuild only changed units, version safely with rollback, and can be deleted behind a confirmation. The explicit *build/extend* engine is complete.

---

## Module 4 — Reads Set Free: Ad-hoc Data Queries

**Goal:** deliver the **read** half of the unifying principle (ARCH §3). Let the user ask questions across their data and get answers — **without building anything**. This is the ephemeral exception to "everything is cached."

**Why fourth:** Modules 2–3 made *mutation* (constrained, serialized, versioned) work. This module makes *reading* (free, concurrent, unconstrained SQL behind a read-only boundary) work. It needs capabilities with data, which now exist.

### Epics

- **4.1 — Read-only safety boundary.** Enforce the read-only connection (`SQLITE_OPEN_READONLY` / authorizer) as the **deterministic** guarantee that a write is physically impossible regardless of the SQL the model emits. Hand the model the registry schema as a catalog so it writes correct SQL. (ARCH §3, §7 "Reads")
- **4.2 — `data_query` path.** Classify intent as `data_query`; translate NL → read-only `SELECT` (including cross-capability joins); apply a defensive `LIMIT` + timeout; run it. **Never persisted** — no registry entry, no toolbar tab, no version, no cache. (ARCH §7 "`data_query`")
- **4.3 — Generic auto-table renderer.** A platform-owned, **presentational-only** table for arbitrary result sets (so it doesn't introduce platform business logic). (ARCH §7 "`data_query`")
- **4.4 — Cheap reject/route classifier.** A friendly refusal for obvious non-queries ("delete everything") — used to route/reject early, but **never** the safety boundary (that's 4.1). (ARCH §7 "Reads")
- **4.5 — Context-aware scoping.** The prompt bar scopes a query to the active capability when relevant. (ARCH §6.1, §7)

### Verify by running it
With Notes and one other capability built, type *"how many notes did I add last week?"* → an auto-table answer appears, and **nothing** is added to the toolbar. Type a cross-capability question → a joined table. Type *"delete everything"* → a friendly refusal. Confirm no registry row, version, or cache was created for any of these.

### Exit criteria
Free-form reads work across all capabilities, are guaranteed write-safe by the connection (not the LLM), render in the generic auto-table, and leave zero persistent trace.

---

## Module 5 — Files: Upload, Store & Serve

**Goal:** apply the **same constrained-write / free-read split** to bytes (ARCH §7 "Files"). A capability can now hold files: upload is a constrained write through the router; serving is a free read through a platform route. With this, the **explicit loop is complete and full-featured.**

**Why fifth:** files are the last user-facing surface of the explicit loop. They reuse the data tool (for the reference), the router (for upload), and record lifecycle (for deletion) — all of which now exist.

### Epics

- **5.1 — Object store (S3-shaped tool).** `put / get / delete / url`, default-backed by the local filesystem (`Bun.file` / `Bun.write`), addressed by opaque key under `storage/<key>`; swappable to R2/S3/Garage by config. **Platform infrastructure — the AI never builds storage.** (ARCH §6.3 "Object Store", §7 "Files")
- **5.2 — `file` / `file[]` field type.** Schema support for file fields; the data table stores only a **reference** (key + mime + size + original name), never the bytes. A `photos` capability is just a normal capability with a `file` field. (ARCH §6.3 "Capability Registry", §7 "Files")
- **5.3 — Upload = constrained write.** Multipart through the existing router (`/capability/:id/create`); the generated handler calls `files.put(...)` and stores the returned reference via the data tool. (ARCH §7 "Files")
- **5.4 — Serve = free read.** A platform-owned `/files/:key` route streams bytes with zero-copy `sendfile`; generated HTML simply references `/files/<key>` (e.g. `<img src>`). The AI never builds file serving. (ARCH §7 "Files")
- **5.5 — File lifecycle.** Deleting a record deletes its file (user-driven, logged) — consistent with "records freely deleted; structure never destroyed." (ARCH §7 "Files", §3)

### Verify by running it
Type *"let me save photos with a caption."* → a photos capability with an upload form builds → upload an image → it renders in the list via `/files/<key>` → delete the record → the underlying file is gone.

### Exit criteria
Capabilities can hold files end to end (upload, store, serve, delete) through platform tooling. **The explicit prompting feature is complete.**

---

## Module 6 — Implicit Loop: Behavior → Proposal → Build

**Goal:** turn on the second intent loop (ARCH §8 "Loop 2"). The app watches *how* the user behaves, and when a real pattern emerges it **proposes** a capability in friendly language. On confirmation it hands off to the explicit builder from Modules 2–3 — **it never silently changes the app.**

**Why sixth:** this is the thin, high-value layer that distinguishes implicit from explicit. It needs a complete, populated app to observe (Modules 2–5) and reuses the entire build pipeline. It adds exactly the two things explicit never needed: **full-fidelity event capture** and the **behavior→proposal classifier path**.

> **Open design work in this module: the implicit UX.** The epics below define the loop's *backstage* — capture, gate, async inference, proposal, hand-off. **How implicit work is surfaced to the user is not predetermined** and is part of what this module decides: interrupt vs. quiet background build, where a proposal lives on screen, a persistent assistant presence vs. a transient notice, tone and timing of notifications. Only the contract is fixed — **the app never changes itself without an explicit confirmation**, and confirmation hands off to the Module 2–3 pipeline. Epic 6.1 makes this design decision explicitly, before the build epics are finalized.

### Epics

- **6.1 — Define the implicit UX (open design).** Decide how implicit work reaches the user — interrupt vs. quiet background build, where a proposal appears, a persistent assistant presence vs. a transient notice, the tone and timing of notifications. **This is genuinely undefined today: it is design work, not a foregone conclusion**, and it constrains every epic below. The only thing fixed going in is the contract — nothing builds without an explicit confirmation. (ARCH §8 "Loop 2")
- **6.2 — Event tracker (dumb shell recorder).** Capture every action — click, hover, dwell, focus, scroll — with full context (timestamp, active capability, element id/type, on-screen data). Batch and ship to the server. **No client-side logic** — no thresholds, no detection. (ARCH §6.1 "Event Tracker", §8 "Loop 2")
- **6.3 — Event log (append-only store).** Every action with full before/after **situation**, not just the change. Queryable. This is the experiment's primary dataset. (ARCH §6.3 "Event Log")
- **6.4 — Server-side gate.** A cheap **deterministic** heuristic that trips only on a real pattern. No LLM call until it trips. Thresholds live server-side, next to the dataset — the experiment's main tuning knob, changeable without redeploying the shell. (ARCH §8 "Loop 2", server-side gate)
- **6.5 — Async intent resolution.** Off the interaction path (never blocks). Reads the event batch + context through the existing resolver. Below threshold → log only and back off (raise the bar for this pattern). Above threshold → proceed to a proposal. (ARCH §8 "Loop 2")
- **6.6 — Proposal + decision (contract fixed, presentation per 6.1).** A confirmation-gated proposal: **Confirm** → enqueue into the existing serial build queue (Loop 1 does the work). **Ignore** → log the dismissal and back off the pattern. *Whether/how the proposal interrupts, where it renders, and what it looks like is decided in 6.1* — only the confirm-before-build contract is fixed here. (ARCH §8 "Loop 2", §9.3)

### Verify by running it
Repeatedly do something suggestive in the app (e.g. keep typing dates into note text). The gate trips; **asynchronously**, a proposal is offered along the lines of *"Want me to add due dates to your notes?"* (the exact presentation is whatever 6.1 decides). Confirm → it builds via the Module 2–3 pipeline and appears. Or ignore it → the system backs off and logs the dismissal. Inspect the event log to confirm full-fidelity capture.

### Exit criteria
Behavioral patterns produce confirmation-gated proposals that, when accepted, build through the existing explicit pipeline. The app never changes itself without a confirmation. **Both intent loops are live.**

---

## Module 7 — Experiment Harness: Metrics, Latency & Tuning

**Goal:** make the PoC's **conclusions legible** — the reason the project exists (ARCH §6.3 "Generation Metrics", §9.6). Metrics have been written since Module 2; this module surfaces and analyzes them, and gives the implicit gate a tuning loop against the real event-log dataset.

**Why last:** it depends on data accrued by every prior module — generation metrics from Modules 2–6 and the event log from Module 6. It is an **experimenter-facing surface**, kept clearly separate from the friendly app (ARCH §9.7).

### Epics

- **7.1 — Metrics querying.** Latency breakdowns (spec-gen, code-gen, HTML-gen, test-gen, migration, test-run, total wall-clock), model, token counts, success/failure and per-rung gate outcomes per generation. Includes the **behavioral-tier comparison**: rung on vs. off — what it costs in wall-clock and how much drift it actually catches. (ARCH §6.3 "Generation Metrics", §9.6, §6.2)
- **7.2 — Outcome & overlap analysis.** Extend-vs-namespace decisions, build success/failure rates, intent-classification distribution — the conclusions about capability quality. (ARCH §6.2, §8 "Overlap resolution")
- **7.3 — Experimenter surface.** An internal view/report to read the dataset, clearly **not** part of the user-facing product voice (the friendly app shows no internals). (ARCH §9.7)
- **7.4 — Gate tuning loop.** Adjust the implicit gate's thresholds against the event-log dataset and observe the effect on proposal behavior — without redeploying the shell. (ARCH §8 "Loop 2")

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
| **Spec → {handlers, HTML} discipline** | M2 | The arrow only ever points spec → derived caches; regenerate only on a version bump | §2, §9.1 |
| **Validate-before-commit / atomic pointer flip** | M2 | Nothing goes live until it clears every active gate rung — type-check, signatures, smoke run, and (behavioral tier on) tests generated from the spec's `behavior` — then an atomic pointer flip | §6.2, §9.5 |
| **Additive-only structure** | M2 (DDL), M3 (evolution) | Add or soft-hide; never `DROP`/destructive rename — structurally incapable of AI data loss | §3, §9.3 |
| **Metrics on every generation** | M2 | Every build writes a metrics record before returning; failure is data | §6.3, §9.6 |
| **Read-only safety boundary** | M1 (connection), M4 (enforced) | A write is physically impossible on the read path, regardless of model output | §3, §7 |
| **Product voice, never internals** | M2 onward | Narration, proposals, confirmations, errors all speak in friendly product voice | §9.7 |
| **Confirmation reserved for two things** | M3 (delete capability), M6 (every proposal) | Field-level evolution is silent and instant; only these two require a confirm | §9.3 |

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
M3 Explicit II                                │
   │  (full CRUD · classifier · overlap ·     │
   │   diff engine · versioning · rollback)   │  ← reused by every later module
   ▼                                          │
M4 Reads free                                 │
   │  (RO boundary · data_query · auto-table) │
   ▼                                          │
M5 Files  ── explicit loop COMPLETE ──────────┘
   │  (object store · file fields · serve)
   ▼
M6 Implicit loop   ── reuses M2–M3 build pipeline
   │  (event tracker · event log · gate · async resolution · proposals)
   ▼
M7 Experiment harness   ── reads metrics (M2–M6) + event log (M6)
      (latency · outcomes · experimenter surface · gate tuning)
```

Linear and progressive: each module runs, is testable, and stands on its own. The explicit loop is whole at M5; implicit (M6) is a thin layer on top of it; the experiment surface (M7) reads what everything before it produced.
