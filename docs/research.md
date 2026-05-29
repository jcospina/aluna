# Omni-CRUD: Research Grounding & Draft Architecture

> **Purpose**: Ground the omni-crud concept in existing research and prior art before architectural decisions are made. This is a PoC exploring new UI/UX patterns in the AI era — not a production app.

---

## 1. What This Is (and Isn't)

**omni-crud** is a self-building runtime. The user never writes code or approves implementation plans. They state intent, and the app evolves to fulfill it. The distinguishing traits:

- **No predefined UI** (except the prompt shell)
- **No predefined business logic or schemas**
- **Intent-driven**: both explicit (typed prompts) and implicit (behavioral signals like clicks)
- **Self-evolving**: capabilities accumulate as the app runs; each session builds on the last
- **Complete event tracking**: every user action is captured, enabling retroactive intent inference

It is **not** a code agent (user never sees code), **not** a site builder (no static output, the runtime IS the app), and **not** a low-code platform (no form-based configuration).

The closest published inspiration is [flipbook.page](https://flipbook.page/) — described as "an infinite visual browser generated entirely on demand in real time."

---

## 2. Prior Art & Related Work

### 2.1 Self-Evolving Software Architecture

**SelfEvolve** (arXiv 2604.16314) is the closest published architecture to omni-crud's ambition. It is an agentic pipeline that adds new capabilities to running software at runtime:

- Pipeline: `dispatcher → test generator → code synthesizer → sandboxed executor → context memory`
- Achieves 92.7% pass@1 across 11 self-extension tasks
- Key vision: *"individualized software where each user has uniquely generated capabilities"*
- Outperforms AutoGen, MetaGPT, and AgentCoder on extension tasks

**Takeaway**: The sandboxed executor + context memory pattern is directly applicable. omni-crud needs a safe evaluation environment for generated UI/logic and a persistent capability context.

---

### 2.2 Generative UI

Three relevant bodies of work:

**Academic**:
- *"Generative UI: LLMs are Effective UI Generators"* (arXiv 2604.09577, 2026) — demonstrates LLMs generating the interface itself, not just selecting from predefined components. Validates the core rendering premise.
- *"Towards a Working Definition of Designing Generative UI"* (arXiv 2505.15049, DIS 2025) — identifies five core themes: hybrid creation, curation-based workflows, AI-assisted refinement. Positions GenUI as an iterative co-creative process.
- *"Frontend Diffusion"* (arXiv 2408.00778) — abstract-to-detailed task transitions in UI generation; directly maps to how omni-crud should interpret vague user prompts.

**Industry protocols**:
- **CopilotKit AG-UI Protocol** — open, bi-directional agent-user interaction protocol. Adopted by Google, LangChain, AWS, Microsoft, Mastra, PydanticAI. Defines three tiers of generative UI:
  1. **Static**: AI selects from predefined components
  2. **Declarative**: AI generates a structured spec, renderer interprets it
  3. **Open-ended**: AI generates full UI surfaces (most relevant for omni-crud)
- **Google A2UI** (v0.9) — framework-agnostic open JSON format for agent-driven interfaces. Complements AG-UI.
- **Vercel AI SDK** `streamUI` — React Server Components for streaming generated components

**Takeaway**: Don't invent a proprietary UI spec. AG-UI + A2UI are open standards with widespread tooling. The declarative tier (AI generates a spec, renderer interprets) maps cleanly to omni-crud's capability registry approach.

---

### 2.3 Intent Detection from Behavioral Signals

**UI-JEPA** (arXiv 2409.04081, Apple ML Research) is the state of the art for inferring user intent from UI action sequences:
- Self-supervised learning with masking strategies over UI interaction embeddings
- Datasets: "Intent in the Wild" (IIW) and "Intent in the Tame" (IIT)
- Core innovation: extracts *what the user wanted* from a sequence of actions, not just what they did

**"Towards Intent-based User Interfaces"** (arXiv 2404.18196) maps the design space across fixed-scope, atomic, and complex tasks.

**"Anticipation Before Action"** (arXiv 2601.18750, CHI 2026) — uses signal variability (dwell time, velocity) to differentiate exploratory from committed behavior. Directly applicable to omni-crud's click-intent loop: a slow hover + click is different from a rapid tap.

**Predictive UX Modeling** (industry) — heatmaps show *where* users go, not *why*. The next step is combining event sequences with session context to infer missing features.

**Takeaway**: For the PoC, a simplified intent pipeline is feasible: capture event sequences → send to LLM with context → LLM infers intent → propose feature. Full self-supervised learning (UI-JEPA style) is post-PoC.

---

### 2.4 Dynamic Schema Generation

**Schema Inference as a Scalable SQL Function** (arXiv 2411.13278) — schema inference as a native DBMS function rather than external framework. Two-phase: local inference + global schema merging. Demonstrated in Apache AsterixDB.

**Adaptive Schema Databases** (ResearchGate) — databases that heuristically evolve schema as workload changes (CONST system). This is the long-run vision for omni-crud's persistence layer.

**Schema-on-read vs. schema-on-write**: omni-crud needs a hybrid:
- **Schema-on-write** for validated, structured user data (notes have text, dates are dates)
- **Schema-on-read** for exploration and discovery (what fields are users actually storing?)

**Takeaway**: SQLite with a JSON column as an escape hatch is the fastest PoC path. Migrate to a proper schema-adaptive store (Postgres JSONB, AsterixDB, or Firestore) once patterns stabilize.

---

### 2.5 CRUD Automation & Model-Driven Engineering

**AutoCRUD** (WebRatio / IFML) — automated CRUD specification from interaction flow models. Reduces ~60% of CRUD boilerplate. The pattern: a declarative spec → UI generation → persistence wiring is proven at scale.

**Automatic CRUD from UML Models** (2025) — model-driven engineering for low-code platforms following MVC/MVP. Validates that a structured intermediate representation (the capability spec) is the right abstraction layer.

**Takeaway**: The capability registry IS the model. It plays the same role as UML in MDE, but generated by AI from natural language rather than drawn by a developer.

---

### 2.6 Capability Registries & Knowledge Graphs at Runtime

**SAP Beyond Joule** — knowledge graph driven runtime: one endpoint resolves across all capability patterns. Includes validation with evidence logging (query, response, timestamp, user context). Directly maps to omni-crud's capability registry + event tracking requirement.

**Runtime Knowledge Graph for Smart Home** (IEEE) — design-time authoring vs. runtime resolution. The architecture separates *what capabilities exist* from *how they are invoked at runtime*.

**Takeway**: The capability registry needs:
1. A semantic layer (what this capability is, when it's useful)
2. A schema layer (what data it owns)
3. A UI spec layer (what components render it)
4. An event log (every invocation, with context)

---

## 3. Research Gaps omni-crud Explores

No published work fully unifies these three loops in a single runtime:

1. **Behavioral signals → intent inference → capability proposal** (explicit LLM-mediated; UI-JEPA is the closest but is a standalone perception model, not a runtime loop)
2. **Natural language → schema → UI** without a developer in the loop (AutoCRUD / MDE require upfront modeling; site builders require upfront selection)
3. **Capability accumulation across sessions** without user managing a knowledge base

This is the design space omni-crud occupies. It's novel enough to be worth exploring as a PoC.

---

## 4. Draft High-Level Architecture

### 4.1 Layers

```
┌─────────────────────────────────────────────────────────┐
│                    SHELL (Fixed Layer)                   │
│  Prompt UI  │  Capability Toolbar  │  Event Tracker      │
└──────────────────────────┬──────────────────────────────┘
                           │ events + prompts
┌──────────────────────────▼──────────────────────────────┐
│                   ORCHESTRATOR                           │
│  Intent Resolver  │  Capability Builder  │  Diff Engine  │
└──────────────────────────┬──────────────────────────────┘
                           │ reads/writes
┌──────────────────────────▼──────────────────────────────┐
│              CAPABILITY REGISTRY (persistent)            │
│  name │ schema │ ui_spec │ tools │ event_log             │
└──────────────────────────┬──────────────────────────────┘
                           │ queries + mutations
┌──────────────────────────▼──────────────────────────────┐
│                     DATA LAYER                           │
│  SQLite (dev) / Postgres JSONB (scale)                   │
│  Per-capability tables generated at runtime              │
└─────────────────────────────────────────────────────────┘
```

---

### 4.2 Components

#### Shell (static, ships once)

The only fixed UI. Contains:
- **Global prompt bar** — free-form input, always visible, context-aware (knows which capability is active)
- **Capability toolbar** — dynamically populated tabs/icons as capabilities are created
- **Event tracker** — captures every user action (click, hover, dwell, focus, scroll) with full context: timestamp, capability_id, element_id, element_type, current_data

The shell never changes after initial build. Everything inside it is dynamic.

#### Orchestrator

Three sub-components:

**Intent Resolver** — receives either:
- Explicit: a typed prompt ("store a note", "add tags to images")
- Implicit: an event batch from the tracker ("user clicked on image thumbnail 3 times in 2 seconds")

Sends to LLM with full context: current capability registry, recent event log, active capability. LLM returns a structured `Intent` object:
```json
{
  "type": "new_capability | extend_capability | ui_change | data_query",
  "confidence": 0.85,
  "target_capability": "images",
  "proposed_action": "add detail modal with metadata form",
  "requires_confirmation": true
}
```

**Capability Builder** — takes a confirmed Intent and:
1. Generates or updates the capability spec (schema + ui_spec + tools)
2. Writes migrations to the data layer
3. Emits the updated spec to the renderer

**Diff Engine** — computes the minimal delta between current and new capability spec, so the UI only re-renders what changed. Analogous to React's virtual DOM diffing, but at the capability spec level.

#### Capability Registry

The central artifact. Each capability entry:

```json
{
  "id": "notes",
  "label": "Notes",
  "version": 3,
  "schema": {
    "fields": [
      { "name": "text", "type": "string", "required": true },
      { "name": "created_at", "type": "datetime", "auto": true },
      { "name": "tags", "type": "string[]", "added_in_version": 2 }
    ]
  },
  "ui_spec": {
    "list_view": { ... },
    "detail_view": { ... },
    "create_form": { ... }
  },
  "tools": ["create", "read", "update", "delete", "search"],
  "prompt_context": "This capability stores text notes. Users can tag them and search."
}
```

Stored in a fast, queryable format (SQLite JSON columns for PoC, later Postgres JSONB or a document store).

#### Data Layer

Per-capability tables generated at runtime via DDL. Schema evolution via migrations generated by the Capability Builder. For the PoC: SQLite + Drizzle ORM with schema push.

Key constraint: **every data mutation writes an event** to the event log with full before/after context, not just the change.

---

### 4.3 The Two Loops

**Loop 1: Explicit (Prompt → Capability)**

```
User types prompt
      ↓
Intent Resolver classifies: new capability? extend? query?
      ↓
Capability Builder generates spec delta
      ↓
Data Layer migrates (if schema changed)
      ↓
Renderer hot-swaps UI components
      ↓
Toolbar updates (if new capability)
```

**Loop 2: Implicit (Behavior → Intent → Proposal)**

```
Event Tracker accumulates user actions
      ↓
Trigger condition met (N repeated actions on same element type)
      ↓
Intent Resolver sends event batch + context to LLM
      ↓
LLM returns: inferred intent + proposed capability extension
      ↓
If confidence > threshold: show inline proposal to user
      ↓
User confirms → Capability Builder runs Loop 1 from here
User ignores → event logged, threshold raised for this pattern
```

---

### 4.4 Tech Stack Candidates (PoC)

| Layer | Candidate | Rationale |
|---|---|---|
| Shell UI | Next.js + React | RSC enables streaming generated components |
| Rendering | Vercel AI SDK `streamUI` | Purpose-built for generative component streaming |
| Capability spec format | JSON (AG-UI compatible) | Open standard, tooling exists |
| AI | Claude Sonnet 4.x | Fast, tool-use capable, supports structured output |
| DB | SQLite via Drizzle | Zero-config, schema push, fast for PoC |
| Event store | SQLite separate table | Append-only, queryable for intent inference |
| Schema migrations | Drizzle Kit | Generate migrations from spec delta |
| Component sandboxing | `@mdx-js` or `react-live` | Safe eval of AI-generated component code |

---

### 4.5 Critical Open Questions (In Priority Order)

1. **Component rendering safety**: AI generates a UI spec — does it generate JSX code (eval risk) or a declarative JSON spec that a fixed renderer interprets? JSON spec is safer and more predictable; JSX gives more flexibility. **Recommended: JSON spec for PoC, migrate to controlled JSX eval if needed.**

2. **Capability persistence across sessions**: Is the capability registry session-local or persisted to disk? If persisted, the app becomes a personal database that remembers everything the user has ever built. **Recommended: persist from day one — this is the core value proposition.**

3. **Implicit intent trigger threshold**: What constitutes a behavioral signal worth acting on? Too sensitive = annoying proposals. Too conservative = no implicit features ever appear. **Recommended: start with explicit confirmation for all implicit proposals; tune threshold with event log data.**

4. **Multi-user vs. single-user**: Is each user's app completely isolated, or is there a shared schema that multiple users can contribute to? **For PoC: single-user, isolated. Multi-user adds auth complexity without adding to the UX research.**

5. **Capability conflicts and merging**: What happens when a new capability has overlapping schema with an existing one? (e.g., "contacts" and "people" both need a name field.) **Recommended: LLM-mediated merge proposal presented to user before committing.**

---

## 5. What This PoC Proves (or Disproves)

| Hypothesis | How to Test |
|---|---|
| LLMs can reliably generate valid, renderable UI specs from natural language | Run 20 diverse prompts, measure render success rate |
| Schema inference from a single user prompt is accurate enough (no clarifying questions needed) | Compare inferred schema to what user actually stored |
| Implicit intent detection produces proposals users actually want | Track acceptance rate of proposals vs. dismissals |
| Capability accumulation feels like "the app learning me" rather than "I built this app" | User study: 5 minutes of use, ask "did it feel like you configured something?" |
| Event log is rich enough to retroactively understand intent | Replay events; can LLM explain what user was trying to do? |

---

## 6. Key References

| Topic | Source |
|---|---|
| Self-evolving runtime architecture | [SelfEvolve — arXiv 2604.16314](https://arxiv.org/abs/2604.16314) |
| Intent detection from UI actions | [UI-JEPA — arXiv 2409.04081](https://arxiv.org/abs/2409.04081) |
| Generative UI taxonomy | [arXiv 2505.15049](https://arxiv.org/abs/2505.15049) |
| LLMs as UI generators | [arXiv 2604.09577](https://arxiv.org/abs/2604.09577) |
| Dynamic schema inference | [arXiv 2411.13278](https://arxiv.org/abs/2411.13278) |
| Intent-based UI design space | [arXiv 2404.18196](https://arxiv.org/abs/2404.18196) |
| Open agent-UI protocol | [CopilotKit AG-UI](https://www.copilotkit.ai/ag-ui) |
| Framework-agnostic GenUI format | [Google A2UI](https://developers.googleblog.com/a2ui-v0-9-generative-ui/) |
| Streaming generated components | [Vercel AI SDK streamUI](https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces) |
| CRUD automation pattern | [AutoCRUD — ResearchGate](https://www.researchgate.net/publication/327661084) |
| Inspiration | [flipbook.page](https://flipbook.page/) |
