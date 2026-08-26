# Omni-CRUD: high-level architecture

> A self-building CRUD runtime. The user states intent, explicitly by prompt or
> implicitly by behavior, and the app evolves to fulfill it. Nothing ships with a
> domain model or capability business logic, and no developer stands in the loop;
> the platform supplies only the presentation mechanics every capability shares.
>
> This document fixes what each moving piece is and how the pieces relate. It is
> not an implementation plan. Research grounding lives in [research.md](research.md).

## 1. What this is: a platform, not an app

omni-crud is a platform that builds apps at runtime. It ships a small fixed set of
parts and contains no domain logic:

- the **shell** (the one fixed UI surface),
- the **capability registry** (the source of truth for everything the app has become),
- **generation-time tooling** (the tools the AI uses to build a capability, like a coding agent using its tools),
- the **router** (deterministic dispatch from UI to capability),
- the **capability API** (the UI↔server contract),
- **platform presentation** (shared list, record view, form, field, and item-wrapper behavior),
- **schema/DDL ownership** (the platform manages the database structure).

The AI generates everything capability-specific at runtime, and the platform
persists it: CRUD business rules, data shape, presentation intent, and item
composition. The platform owns reusable presentation, structural persistence
invariants, and schema mechanics, and never implements capability-specific CRUD
behavior. ADR-0005 names that ownership line: platform presentation and integrity,
generated behavior.

"Platform, not app" describes the internal architecture, not the product
interaction model. Aluna is not a coding agent, coding platform, or site builder:
the user states capability-level outcomes for their personal app, and Aluna chooses
the implementation. The prompt bar takes free-form text, but that does not make
choosing a framework, editing a schema or a type, controlling a migration, tuning
CSS tokens, or iterating on code a supported workflow. There is no roaming agent
loop and no preview-adjust-approve coding loop. The developer panel is a read-only
observation surface for curious people; it never steers the build.

The design applies the [SelfEvolve](https://arxiv.org/abs/2604.16314) pipeline
shape — test generator + code synthesizer + isolated execution + context memory,
gated on executed tests — to the CRUD domain. Supplied scratch adapters isolate
execution from user data, and structural/static checks reject known direct imports
and bypasses. Generated code still runs in-process, so those seams protect against
accidental model output rather than containing deliberately adversarial code or
unknown ambient Bun/OS access; ADR-0003 deliberately defers a process sandbox for
this single-user local PoC. The test-generator stage is the behavioral gate,
tiered for the latency experiment (§6.2).

## 2. Locked-in decisions

These are settled, and everything else is built on them:

| Decision | Choice | Reason |
|---|---|---|
| **Platform, not app** | omni-crud ships tooling + shell + registry; AI generates all capability logic | The app building itself *is* the thesis |
| **AI generates real code** | Handlers and the item renderer are actual `.ts` files on disk, not interpreted specs | Fixed code produces fixed results; the experiment is whether the model can write capability logic and composition |
| **Not React / Next.js** | Rejected | Too slow to render, too heavy, too much boilerplate for a single-surface PoC |
| **Speed is a first-class constraint** | Optimize for it everywhere | The PoC's thesis includes *how fast* an app can build itself — latency is part of the experiment |
| **Capability registry is the core artifact** | Structured spec, persisted | Validated by MDE research — the spec is the "model", everything else is generated from it |
| **Two intent loops** | Explicit (prompt) + Implicit (behavior) | The core UX research question |
| **Complete event tracking** | Every action logged with context; ordinary use appends, explicit capability deletion purges/redacts owned payloads | Required for implicit inference without retaining product data after confirmed deletion |
| **Single-user, persisted** | Isolated per user, survives sessions | The app "remembering you" is the value proposition; multi-user adds auth noise without UX insight |
| **Friendly app, never an engineering tool** | All user-facing language is product voice | "Look how easy / friendly / fast" is part of what's being demonstrated |
| **AI capability is the experiment** | Deterministic platform code owns safety, stable chrome, and cheap load-bearing contracts; capability-specific generation stays AI-authored | The goal is to measure what AI can build, not eliminate AI by growing a website-builder rule engine |

### The generated artifacts

For each capability the AI produces four artifacts, the last three derived from
the first:

1. **Spec** (identity/label + `schema` + `ui_intent` + `behavior` +
   `behavioral_errors` + Actions + persistent read dependencies + resolver
   context) — the source of truth, and the only artifact that cannot be
   reconstructed from something else.
2. **Handler code** — real `.ts` files on disk implementing the capability's logic.
3. **Item renderer** — real generated code for the capability-specific
   presentation of one record. Platform-owned list, form, record-view, and
   item-wrapper modules compose it into the View.
4. **Behavioral tests** *(tiered)* — executable assertions derived independently
   from `behavior`, Action-owned `behavioral_errors`, the Action's canonical
   schema projection, and dependency identities, never from Handler code. Only
   tier-on snapshots get them, and their generation and execution costs are
   measured separately so the tier can be compared with a true no-test baseline.

Only the spec is authored. Handlers, the item renderer, and tests are derived,
version-keyed caches, regenerated only when the spec version bumps, so model
nondeterminism cannot silently drift the UI, logic, or checks. The arrow only
points spec → {handlers, item renderer, tests}. Platform presentation is ordinary
versioned application code, not a per-capability cache.

Every committed capability lifetime has an opaque platform-owned incarnation, and
its immutable versions live at `capabilities/<id>/<incarnation_id>/v<n>/`. A
snapshot describes itself: it always contains the exact spec, all declared
Handlers, the item renderer, and platform-authored inventory/digest/tier metadata.
Tier-on snapshots also contain frozen tests; tier-off snapshots contain no
behavioral-test artifacts by contract. That metadata additionally records, for
audit only, how each derived unit was generated against its dependencies — the
exact dependency incarnation/version, the verified dependency snapshot content
digest/fingerprint, and the active-context digest in force when those bytes were
last generated. Copied units retain that provenance. None of it is authored spec,
an input to candidate equality, a Diff fact, or a cascade trigger. It verifies
publication completeness, and it is neither a routing overlay nor a per-unit
pointer manifest.

An explicit platform artifact-contract upgrade mechanism may eventually re-derive
caches without pretending user intent changed, but its registry/serving marker and
preservation machinery are deferred until after M9. M9 may add a metrics-only
artifact-shape dimension for historical comparisons; that is not a serving marker.

### What is deliberately *not* locked in

This document fixes the architecture, the intended behavior, and the module
boundaries, and leaves the rest open. Whatever it leaves open is decided inside
the module that owns it, against the constraints that actually exist when it is
built:

- **Implementation detail.** Types, classes, function shapes, file layouts,
  templates, libraries, colors, copy — none of it is specified here. Pinning it
  down now would be guesswork the build is free to overrule.
- **The implicit-loop UX.** §8 defines the backstage of the implicit loop; where
  and how the proposal reaches the user is Module 8's call.

Software is not specified front-to-back in advance: constraints surface, tools
change, and better ideas arrive mid-build. What is locked here is the skeleton
everything hangs off, not the flesh.

## 3. The unifying principle: mutation constrained, reads free

Nearly every design decision below collapses to a single line:

> Mutation is constrained and serialized. Reading is free and concurrent.

It shows up on every axis:

| Axis | Write / mutate | Read |
|---|---|---|
| **Data access** | Capability-bound mutation interface (no raw mutation SQL) | Parameterized read-only SQL (`SELECT` + joins); persistent cross-capability dependencies declared |
| **Structure** | Isolated table per capability, no foreign keys | Relationships materialize at query time via joins |
| **Schema lifecycle** | Platform-derived evolution DDL is additive-only; explicit confirmed capability deletion purges that capability's structure | — |
| **Records** | User deletes own records through platform-owned confirmation (recorded once M8's Event Log exists) | — |
| **Orchestration** | One mutation coordinator atomically admits every shared-connection write — builds, record/platform writes, and deletion | Prompt resolution/reads stay outside; deletion briefly closes the target incarnation to new reads |

Every danger of unconstrained access — corruption, drop-table, integrity drift,
races — is a danger of mutation. A read mutates nothing. The one thing that would
normally forbid full read access, security on a deployed multi-tenant system, does
not exist in a single-user local BYO-key PoC. So reads are set free and writes are
kept safe.

## 4. Tech stack

Chosen for minimal overhead, native speed, and one property of the models: they
generate HTML, SQL, and TypeScript natively and reliably.

| Layer | Choice | Why |
|---|---|---|
| **Runtime** | Bun | Fastest cold start, native TypeScript, built-in SQLite, imports generated `.ts` directly |
| **Server** | Hono | ~14KB, runs on Bun directly, no framework ceremony, one route file |
| **Transport** | SSE (Server-Sent Events) | Native streaming, 3 lines of client code, perfect for "watch the UI build itself" |
| **Client shell** | HTMX + Alpine.js | HTMX swaps server HTML into the DOM with no build step; Alpine handles local interactivity. Zero framework in the critical path |
| **Persistence** | `bun:sqlite` + platform-owned SQLite extension bridge | In-process, microsecond queries. A separate read-only connection serves the read/query path. M4 search normalization adds one loadable scalar function compiled locally; it requires a C compiler and extension headers, plus extension-capable SQLite on macOS |
| **File storage** | `Bun.file` / `Bun.write` (local FS), S3-shaped provider | No separate storage process (same "no dependency tax" logic as choosing SQLite over Postgres). Zero-copy `sendfile` streaming; swap to R2/S3/Garage on deploy by config |
| **AI** | Fast variants of flagship models — Claude Opus (fast mode), top GPT (fast tier), pluggable — behind the Vercel AI SDK as the in-process provider spine | Capability quality matters more than per-call cost; latency is part of the thesis. BYO-key keeps the open-sourced demo free. The SDK supplies streaming + structured output + a bounded tool-loop so we don't hand-build a streaming client; provider-agnosticism comes from targeting the Anthropic-/OpenAI-compatible wire shapes (see ADR-0003) |
| **Spec format** | JSON (AG-UI–aligned shape) | Open, structured, diffable. Not invented from scratch |

The shell ships as one HTML page with HTMX attributes: a wallpaper, a layer of
capability logos and a prompt bar, with a window created over them when there is
something to show. Fixed platform presentation renders the window's structural
surfaces; capability-specific item markup and handler responses are generated.

### Model strategy

The system targets the fast variant of each provider's most powerful model, chosen
globally: one configured model serves the whole run, with no per-task routing. A
single model keeps every result attributable, a single key keeps the config
trivial, and a routing layer never has to exist. Comparing models means running the
demo twice rather than mixing them in one session. So the orchestrator depends on a
thin, pluggable provider interface — a `generate(prompt, schema)` contract, not a
specific SDK.

The Vercel AI SDK realizes that contract in-process and fetch-based, running on Bun
with a BYO key, behind a provider registry keyed by `baseURL`. The Anthropic
Messages API has become the de-facto wire format for coding models, so one config
change swaps the global model across Claude, GPT, Gemini, and the open Chinese
coding models (Qwen3-Coder, GLM, Kimi, MiniMax, DeepSeek), all of which expose an
Anthropic-compatible endpoint. The SDK owns the streaming client, retries,
structured-output validation, and the multi-provider switch. It does not own the
harness discipline: the build pipeline, Diff Engine, layered gate, and migration
runner stay ours, because that discipline is the thesis. The code-writing step is a
loop bounded to a single build unit (write → type-check → fix), agentic within a
unit and deterministic across units; a roaming autonomous agent would fight the
spec→derived-caches discipline (§9.1). ADR-0003 records the rationale, the rejected
autonomous-agent and hosted-API shapes, and the deferred execution sandbox.

## 5. The whole picture

```
SHELL (fixed)
  Prompt Bar ──prompt──▶ Intent Resolver ──data_query──▶ ephemeral query service
       │                       │
       │                       └─resolved build request─▶ explicit presenter ─┐
       │                                                                      │
  Event Tracker ─batch─▶ M8 gate + resolver ─confirmed resolved request─▶ chosen presenter
                                                                              │
  Logo layer                                                                  │
       │ open                                                                 │
       ▼                                                                      │
  Window ──Action request──▶ deterministic Router                             ▼
       ▲                         │                                  Capability Builder
       │                         ▼                                  ├─ Diff Engine
       │                   generated Handler                         ├─ layered Gate
       │                    ├─ declared RO query ───────────────────▶ SQLite RO
       │                    └─ scoped mutation ─┐                            │
       │                                        ▼                            │
       │                                  Mutation coordinator ◀──────────────┘
       │                                        │
       │                                        └─exclusive ownership──▶ SQLite RW
       └──HTML/SSE── presenter ◀──lifecycle── Capability Builder

PERSISTENCE
  SQLite: capability registry + data tables + Event Log + generation metrics
  Filesystem: immutable incarnation/version snapshots
  Object store: capability-owned user files behind an S3-shaped port
```

Three tiers: a fixed shell the user sees, a server orchestrator that does the
thinking and generating, and a persistence layer whose structure is itself
generated at runtime. Data flows down on action; HTML streams back up on response.

## 6. The blocks

### 6.1 Shell — the only fixed UI

A desk. A wallpaper fills the viewport, the logo of every capability the app has
built sits on the ground, and a prompt bar floats above them and never leaves.
When there is something to show, a window opens over the wallpaper, and that
window is the content area. The page is not inert after first load: the window is
created and destroyed, and exactly two presentation records — the capability
window's and the developer panel's, each carrying its desktop box and flags —
live in `localStorage`.

**Prompt Bar** — an always-visible free-form text input, clear of all four edges.
It is context-aware: it knows which capability is open, if any, so "add a due
date" scopes to that capability. It submits to the orchestrator and receives
streamed HTML back. The bar also speaks for itself, and explains anything refused
before a build starts: the desk has no notice component, and the window is not yet
involved. Its one replaceable live slot preserves refused input/focus, clears stale
copy when the user edits, and never stacks or times away competing messages.

**Logo layer** — empty for a fresh user, otherwise rehydrated from the registry on
load. Clicking a logo opens that capability's View in the window, and clicking
another swaps what is inside the same window. This is the only navigation. There
is no toolbar and no taskbar, and an empty desk is a wallpaper and a prompt bar,
which needs no special case. After resolution admits a new-capability build, the
server may put a presentation-only, build-id-keyed provisional tile on the ground
out-of-band (`hx-swap-oob`). Activation replaces it with the registry-backed tile;
every non-activating terminal removes it, and evolution/non-build outcomes create
none. After v1 presentation terminates and the build lease releases, artwork is
generated once through an atomically claimed follow-up and is never remade;
ADR-0007 owns its incarnation-keyed delivery,
bounded retry and cost. Only an `absent` tile emits the no-store, load-triggered
POST that claims an attempt and returns tile-scoped markup; this lets the build
stream close before provider work and keeps paid mutation off GET. Attempt
responses are inert even when failure returns to `absent`; only a fresh desk
render/activation arms one, preventing recursive retry in one page load.

From Module 4, a capability can also be permanently deleted, and the desk gives
that action its doorway: a short context menu on the logo — right-click,
press-and-hold, or the keyboard menu key — holding Rename and Delete. Both are
deterministic zero-AI actions, never an Intent Resolver classification or model
call. Delete is confirmation-gated in authored product voice; Rename uses the
user's validated label. Rename changes a platform-owned effective
label override through an inline Save/Cancel form anchored to the logo, and
nothing else: authored snapshots, id, address, version and artwork all stay as
they were. Its short coordinator write advances the resolver
catalog binding. The
doorway is the capability's own face rather than the window chrome, so no window
control ever means destruction.

**The window** — one window, and it is the content area. A collection, one record,
a confirmation and the narration of a build all land in the same frame. Nothing
opens over anything else, which is why Aluna has no modal. The user drags the
window, resizes it, maximises it and puts it away; putting it away changes nothing
in storage and leaves the logo where it was. Put-away, logo switching and
Back/Forward while a build/evolution is running warn first inside the still-mounted
run surface, because each would remove the run and replacing that surface merely
to ask would cancel it prematurely. Confirmation uses the one cancel teardown and
then performs the captured navigation without transient restoration or duplicate
history. The
developer panel is the one exception to a single window: read-only, opened from
its own tile, and allowed to sit beside the capability it reports on. Its tile
focuses an already-open panel; the clay lamp alone puts it away. Below 720px
both use the full-screen phone form and only the frontmost is exposed; their stored
desktop boxes and flags are ignored without being overwritten, then restored and
clamped when widened.
Forget remembered boxes clears the layout storage entry and resets mounted
geometry without replacing content, changing the capability address or cancelling
work; it resets only the developer panel's next-load open preference.

Logo open/switch and put-away push `/capability/:id` or `/` into browser history;
`popstate` renders that identity without pushing another entry, and focusing the
already-open capability adds none. Search, record subview and draft remain
DOM-only and are not encoded in history. During a build the address stays on the
displaced identity; successful v1 activation pushes the new capability only when
its canonical collection takes the window, while evolution and non-activation do
not add a route entry.

A logo action refused before it may take the capability window speaks on the
prompt bar. In particular, Delete cannot replace a build or evolution that is
still mounted; it leaves the run untouched instead of becoming a second cancel
path. After that preflight, deletion still relies on coordinator admission and
lease-held revalidation rather than treating the browser check as authority.
Deletion drain expiry is the distinct typed outcome `deletion_drain_timeout`, so
the window can explain timed-out active work instead of reusing a generic
pre-commit failure sentence.

**Platform presentation** — what fills the window. It is a platform component in
its own right (§1), not a fourth part of the desk: the reusable, data-free
mechanics every capability shares — list scaffolding, empty state, accessible item
wrapper, the in-window record view, which a list item and the create action both
open into, spec-rendered fields, and safe composition of generated item output.
It may read structural spec facts — field type, required state, the collection
layout (`ui_intent.collection.layout`, a closed value selecting how the list
container arranges items), and the closed per-`string[]` list input mode — but it
may not implement capability behavior. The model chooses `comma_separated` only
for comma-free atomic values such as tags, genres, or categories; free-form list
elements that may contain commas use `repeatable`. The platform renders both modes
and normalizes them to the same ordered array before generated code sees them.
Field rendering stays centralized, so later field types (lists in Module 4, files
in Module 7) extend one place instead of every generated artifact. Item composition
stays capability-specific and generated, but the platform enforces the allowed
HTML/class surface at runtime, so record content cannot become executable markup.

**Event Tracker** — a dumb recorder. It captures every user action with timestamp,
active capability incarnation, element id/type, and on-screen context, then batches
the lot to the server, and it holds no inference logic. Recording the incarnation
lets explicit capability deletion later purge or redact product payloads without
guessing from text.

> The shell may remember how things look to the user. It never decides what is
> true. Window geometry, maximised state and where the user likes things are
> presentation state and are the shell's to keep. Which records exist, what is
> valid, what a capability means and what an intent was are canonical state and are
> the server's alone. The shell renders what the server sends and reports what the
> user does.

### 6.2 Orchestrator — the brain (server-side)

A deterministic router fronts everything: the UI only ever calls
`/capability/:id/:action`. M4 fixes `GET read`, `GET search`, `POST create`,
`POST update`, and `POST delete`; every other method/Action pairing fails before
generated code loads. Spec field names cannot use the reserved `__aluna_` prefix.
The router validates and strips repeated `__aluna_present` markers and exactly one
nonblank `__aluna_record_id` for update and delete; missing, duplicate, or
unexpected target markers fail before generated code. The target reaches the
Handler and mutation context separately from writable values, and only as an opaque
platform handle. The router binds update/delete mutation authority to that exact
target before generated code runs, so the Handler has no record selector. Generated
UI never invents routes or touches raw requests. Routing is never an AI concern.

Behind the router, three cooperating modules:

#### Intent Resolver

The entry point for both loops. It receives a typed prompt or a gated batch of
behavioral events, assembles context — every capability's `prompt_context` from the
registry, the active capability, recent events — and asks the AI to classify intent
into a structured object:

```json
{
  "type": "new_capability | extend_capability | ui_change | data_query | reject",
  "confidence": 0.85,
  "target_capability": "images",
  "resolution": "extend",
  "proposed_action": "show metadata in each photo's detail view",
  "user_facing_label": "Adding more detail to your photos",
  "requires_confirmation": false
}
```

Typed explicit intents proceed directly and therefore carry
`requires_confirmation: false`; only an M8 behavior-derived proposal sets it true,
and confirmation belongs to M8's proposal surface before Builder hand-off.

Two responsibilities live here rather than in separate modules:

- **Overlap resolution.** The resolver already sees the whole registry, so when a
  new intent touches an existing capability it decides on its own whether to extend
  that capability or create a separate one with its own semantic identity. There is
  no "share a field" option, because sharing a field would require foreign keys
  (§8). "Namespace" is only the internal resolution and metrics term: it creates no
  hierarchy and no shared schema, and the user simply sees an independent capability
  called Work contacts, never `contacts_2`. The chosen `resolution` is logged to
  metrics for the experiment. The user is never asked to reconcile schemas.
- **The friendly label.** The same call emits `user_facing_label`, one warm
  product-voice sentence about what is happening. That single phrase threads through
  the build narration, the confirmation prompt, and the implicit proposal, so copy
  costs no separate generation call.

Resolution reads one versioned active registry catalog. Any resolved build request
carries that catalog's revision or canonical fingerprint alongside its target
expectation, so queued work cannot later be accepted under different resolver
context without being classified again by a new job.

#### Capability Builder

Takes an already-resolved build request and produces changes through the Mutation
coordinator (§8). Prompt resolution happens before admission and creates no durable
generation row. The request carries one stale-target binding — `expected_absent`
for a new semantic id, or `{ capability_id, incarnation_id, expected_version }` for
evolution — plus the resolver-catalog revision or fingerprint that produced its
classification.

The core Builder emits lifecycle events and owns neither the prompt route, the
active DOM, nor SSE. The explicit-loop presenter turns those events into the
foreground product-voice story, and a later confirmed implicit proposal can reuse
the same Builder without being reclassified or forced into that presenter. Before
the build takes the window, the explicit presenter records only a restoration
descriptor — the open capability's id and incarnation, or the bare desk — never
user data or a pinned artifact path.

ADR-0002's contract survives the window. `commit` and `fragment` keep addressing
one stable id, and the client guarantees that id exists whenever a swap can be in
flight. Two things make that promise keepable. Teardown belongs to the content
rather than to the window, so whatever a view started — in-flight fetches, search
controllers, server read tokens — is released when that content is replaced or
removed, and nothing can arrive at a region that has gone. And the window cannot be
closed out from under running work: closing during a build or an evolution warns
first and proceeds only through the existing cancel path.

The lifecycle is spec-first and recoverable across SQLite and the filesystem:

1. Wait on a bounded build ticket, acquire the exclusive build lease, then, at the
   head of the lease, require both the stale-target binding and the
   resolver-catalog fingerprint to match. Any mismatch is stale, never a silent
   reclassification. Only after that check does the separate active
   dependency-generation catalog freeze. A v1 build gets a new incarnation;
   evolution retains the committed one. Only now create a durable `running`
   generation row, immediately before the first Builder-owned provider call. A
   stale or collision refusal instead writes one direct terminal `failed/stale`
   admission row with all generation stages skipped, and starts no Builder work.
2. Generate one complete candidate authored spec from the resolved intent plus the
   committed field-lifecycle catalog and active-field projections of the dependency
   catalog. Before any DDL or unit generation, validate immutable ids, field names
   and types, Action/error/dependency contracts, exact inactive preservation
   (`active→inactive` is lifecycle-only; `inactive→inactive` is identical),
   active-only presentation references, and additive-only evolution. The platform
   derives SQL identifiers and additive DDL from that validated spec; generated code
   never does.
3. Let the Diff Engine derive additive schema work, affected Handlers/item
   renderer, and Gate scope. A semantic zero-diff candidate completes as a
   measured no-op without publishing a version. Project only admitted facts and
   the declared per-Action dependency schemas into each unit's generation
   context. Before prior source enters a regeneration prompt, deterministic
   admissibility checks prove it references nothing outside that unit's candidate
   generation contract; otherwise generation starts without prior source. Copied
   units are governed separately by positive proof. Every Action may query through
   declared SQL on a physically read-only connection; only create/update/delete
   receive canonical mutation authority, with update/delete bound to the validated
   target. Canonical rows remain platform-internal; generated Handlers receive only
   Action-safe active projections/opaque handles. The same ports have scratch
   adapters over synthetic data.
4. Assemble the complete candidate in a unique build-id staging directory.
   Behavioral tests are generated/copied according to the recorded tier.
   Independent Action cache misses may author with bounded concurrency and
   report per-Action progress, but settle into canonical order and freeze as one
   admitted artifact before any Handler generation or bounded repair.
5. Validate before publication through a layered, fail-closed Gate. One failing
   active rung fails the whole build:
   - **Structural** (always): type-check the complete snapshot and assert every
     required interface.
   - **Smoke** (always): execute the full CRUD cycle plus the complete deterministic
     search contract against scratch data.
   - **Behavioral** *(tiered)*: execute new tests and any copied frozen tests whose
     covered Handler changed; ambiguous ownership runs the full suite. A failure
     may repair Handler code only and reruns the same test.
   - **Design lint** *(always when the item renderer changes)*: render hostile
     values and reject contract/security violations under ADR-0005.
6. Write exact `spec.json` plus platform-authored snapshot inventory/digests/tier
   metadata and audit-only per-unit dependency-generation provenance;
   `snapshot.json` inventories itself but omits its own digest. Verify
   completeness, then atomically publish to the final incarnation/version path
   with no overwrite.
7. In one SQLite transaction apply additive DDL, compare-and-swap the registry
   spec/version/pointer, and finalize `success/activated` metrics. Commit is the
   activation point of no return. Only afterward may the presenter attempt the
   terminal complete View `commit` swap.

For a newly activated v1, that transaction also commits seed plus logo lifecycle
`absent/0`. Only after the presenter terminates and the long build lease releases
may a follow-up offer the logo subsystem its first atomic attempt claim. It runs
after success is authoritative, outside immutable snapshot inventory, and cannot
relabel or roll back the build; desk-load recovery uses the same claim after a
crash in the gap.

A database failure after publication leaves an unreferenced complete candidate,
never a live partial one. For an active incarnation at version `N`, every verified
`v1..vN` directory is committed history even when no longer active; only staging
and a verified `v>N` path that never activated are candidates for recovery.
Failure rolls back product state, finalizes failure metrics separately, and leaves
candidate paths for guarded reconciliation. Startup marks interrupted metrics and
reconciles only paths proven never committed. The prior version stays live
throughout failure. Restore/changelog work in M9 must add a durable activation
ledger before anything may reclaim committed history.

After the activation transaction commits, rendering, SSE delivery, client
disconnect, or terminal-signal failure cannot roll back the pointer or reclassify
the build as failed. The registry and `success/activated` row remain authoritative;
a reload rehydrates the ground from the registry, and the address puts the live
View back in the window.

Any non-activating terminal path — `no_change`, stale or collision, cancellation,
or failure — resolves the presenter's descriptor against the then-current registry.
Through ADR-0002's `fragment` event it restores that canonical live View plus its
`read` result, or the bare desk, clears search, and returns the window's record,
edit, and delete-confirm state to the collection before sending `done`. It puts no
permanent logo on the ground and removes any build-id provisional tile. Terminal presenter work is bounded, and active ownership
releases in `finally`. `commit` is reserved for a real pointer activation.

Restoration waits whenever Aluna has something to say. A build that fails, is
refused as stale, or comes back a measured no-op adds one final line to the
narration in the window, in the same voice, and holds the window until the user
dismisses it; only then does the presenter give back what the build displaced.
Cancellation restores at once, because the user already knows why. A structured
refusal lands the same way any other message does: inside the window it renders in
the window, and from the prompt bar it renders on the bar.

The behavioral rung is a tier rather than an always-on default because generating
and executing a suite adds measured latency. A global toggle keeps tier-off
snapshots test-free and records generation, copy, and execution as absent or
skipped. On the next spec-changing build, off→on generates, freezes, and runs tests
from current intent even when the intent text did not change; on→off carries none.
Switching the toggle alone does not bump a spec version, and a semantic no-op does
not materialize the transition.

Resolver latency belongs first to the in-memory prompt job. An admitted build writes
a `running` generation row only once it holds the lease and has revalidated its
target and resolver catalog, then finalizes spec/code/presentation/test/migration
timings, queue wait, per-rung results and retries, model, tokens, outcome,
tier-stage states, and overlap resolution. Success finalizes with pointer activation, failure finalizes
after rollback, and recovery marks abandoned work interrupted. Zero-diff is a
successful measured outcome with no new version.

Short platform-owned record writes and capability deletion use the coordinator but
create no generation row. Each admitted record write keeps the generated Handler,
its mutation call, and presentation completion inside one SQLite transaction, and
any non-success response rolls the write back before the short lease releases.
Module 2's historical `html-gen` is the first presentation-gen shape; from Module 3
on, item renderer generation is recorded under the semantic stage name. Module 9
need not assume every version writes `.html` or behavioral tests.

`reject` and `data_query` create no generation row. Their classification, timing,
and outcome, plus cancellation or expiry before an active lease, may be written
best-effort to a separate content-free `intent_resolution_metrics` row through a
queued short platform write. Neither the query nor the user-visible completion waits
for that write, so a crash may lose an unwritten non-admitted row. Durable lifecycle
begins with a direct stale admission row or a `running` generation row.

#### Diff Engine

Owns one total, monotone change-fact contract at Handler and item granularity.
Every admitted candidate difference maps to schema work, platform View work,
generated units, and Gate work. Multiple facts union, copying requires positive
proof, and an unmapped admitted fact fails closed. The matrix also projects
generation context, so a unit ruled unaffected was never shown the changed fact.

Changing an existing field's identity or type is invalid. A new field regenerates
create and update, plus search when the field is text or list-text; the item
renderer changes only through its declared `item.shows` dependency. Free-text
behavior has no reliable Action ownership, so it regenerates all five Handlers.
Action-owned error and read-dependency changes select the named Handler, and
malformed or unknown ownership fails candidate validation before Diff. The all-five
fallback is reserved for valid but semantically unscoped facts such as free
`behavior`, and for non-total frozen-test failure attribution.

Every Action has a dependency identity catalog, including an empty one. Current
active dependency schemas are generation context; the physical name/type-stable
catalog is the execution and scratch ABI. Soft-hide never drops a column, so it
neither invalidates already committed readers nor triggers a cascade, and new
generation cannot newly select the inactive field. Old Handler or item source
enters model context only after deterministic checks prove it references nothing
outside that unit's candidate generation contract; otherwise regeneration starts
without old source. Byte-copied units stay governed separately, by positive Diff
proof and their committed compatibility contract. Record-producing Handlers return
ordered target ids and the platform rehydrates canonical target rows on the same
read snapshot, so a copied reader cannot silently freeze an old target-row shape.
The normative matrix lives in the Module 4 PLAN (ADR-0006).

Test artifact generation follows behavior and error intent, the canonical
active-schema validation shape, and per-Action dependency identities, while test
execution follows Handler impact. Active dependency projections inform generation
and full physical schemas inform scratch fixtures; neither is an equality input.
Unchanged tier-on tests copy byte-identically but execute against any regenerated
Handler they cover. Non-total valid-test coverage or runtime failure attribution
runs the full frozen suite. Malformed authored Action ownership fails before Diff.
Code failure never regenerates or weakens assertions.

Minimality applies to AI calls and validation scope, not to DOM patches. The
explicit evolution presenter already holds the window, so activation swaps the
complete data-free View and reloads records through the committed `read` Handler,
while non-activation restores through `fragment` rather than pretending a commit.

### 6.3 Persistence — partly generated at runtime

Four domain stores in `bun:sqlite`, plus small platform lifecycle metadata
(mutation ownership/deletion tombstones), generated code files, and an object
store on disk.

#### Capability Registry — the source of truth

One active row per capability. The structured authored spec is canonical; the
platform-owned incarnation/version and pointer to one complete immutable snapshot
live alongside it. A row may temporarily become a non-routable deletion tombstone
carrying cleanup work; resolvers, routes, and the ground see only active rows.
Through M9 there is no registry/serving artifact-contract upgrade marker:
greenfield shape changes use reset + rebuild (ADR-0005 §7). Snapshot publication
metadata is per-version completeness evidence, and an optional M9 metrics-only
shape label is analytical, not preservation machinery.

```json
{
  "id": "notes",
  "label": "Notes",
  "subject": "an open notebook",
  "ground": "leaf",
  "companion": "clay",
  "noun": "note",
  "display_label_override": null,
  "incarnation_id": "4a80b52d-60a1-47e9-971c-765766a6a3b2",
  "seed": 184206,
  "logo": { "status": "present", "attempts": 1 },
  "version": 3,
  "schema": {
    "fields": [
      { "name": "text", "label": "Text", "type": "string", "required": true, "lifecycle": "active" },
      { "name": "tags", "label": "Tags", "type": "string[]", "required": false, "lifecycle": "active" }
    ]
  },
  "ui_intent": {
    "form": {
      "list_inputs": [
        { "field": "tags", "mode": "comma_separated" }
      ],
      "choice_inputs": [],
      "long_text": ["text"],
      "guidance": []
    },
    "item": {
      "direction": "A text-forward card that emphasizes text and treats tags and date as metadata.",
      "shows": ["text", "tags", "created_at"]
    },
    "collection": { "layout": "feed" }
  },
  "behavior": "Text is trimmed and required. Search ranks by recency. Tagging 'urgent' is allowed but not special.",
  "behavioral_errors": [
    {
      "action": "create",
      "trigger": "missing_required_fields",
      "code": "missing_required_fields",
      "fields": ["text"],
      "expected_markers": {
        "role_attribute": "data-role",
        "role": "error",
        "code_attribute": "data-error-code",
        "fields_attribute": "data-error-fields",
        "fields_separator": " "
      }
    },
    {
      "action": "update",
      "trigger": "missing_required_fields",
      "code": "missing_required_fields",
      "fields": ["text"],
      "expected_markers": {
        "role_attribute": "data-role",
        "role": "error",
        "code_attribute": "data-error-code",
        "fields_attribute": "data-error-fields",
        "fields_separator": " "
      }
    }
  ],
  "tools": ["create", "read", "update", "delete", "search"],
  "read_dependencies": {
    "create": [],
    "read": [],
    "update": [],
    "delete": [],
    "search": []
  },
  "artifacts_path": "capabilities/notes/4a80b52d-60a1-47e9-971c-765766a6a3b2/v3/",
  "prompt_context": "Stores text notes. Users tag and search them."
}
```

The AI authors `id` on v1 and thereafter returns it unchanged, along with `label`,
the logo birth facts `subject`/`ground`/`companion` and empty-state `noun`,
`schema`, `ui_intent`, `behavior`, `behavioral_errors`, the fixed M4 `tools`,
`read_dependencies`, and `prompt_context`. The two colours must differ. Subject,
ground and companion are immutable for the incarnation; noun may evolve as a
View-only fact. The platform owns
`display_label_override`, `incarnation_id`, `seed`, logo lifecycle, `version`,
snapshot metadata, build id, and `artifacts_path`. The effective user-facing name
is `display_label_override ?? label`; rename mutates only the override through a
short coordinator write and advances the resolver catalog binding. Fixed platform
choices such as "a record opens in the window" do not belong in the AI-authored
spec.

`ui_intent` records only capability-specific choices: the item's free design
direction and ordered presentation dependencies, the collection layout (a closed
`feed | grid` value the platform list container reads), exactly one closed list
input mode for every active `string[]`, one presentation entry per active choice
field, scalar-string fields rendered as long text, and optional guidance. It
carries no detail entry: a record opens
in the form, in edit mode, so no read-only surface exists whose fields and order
the model could name, and it says how a record looks by building that form. Form
list-input entries follow active `string[]` schema-field order and use
`comma_separated | repeatable`; missing, duplicate, scalar, inactive,
unknown-field, or unknown-mode entries fail validation. Choosing `comma_separated`
asserts that commas separate elements of that field rather than belong to element
data; `repeatable` preserves commas inside each element. Presentation lists may
name active user fields plus the closed platform field `created_at`, and `id`,
`extra`, and inactive fields are forbidden.

A choice field stores one stable string `value` from its declared option objects;
option values are append-only through evolution, while labels, notes, grouping,
disabled state and picker/radio/segmented presentation may change under the total
Diff contract. Each choice owns an ordered `groups` declaration array with stable
unique ids and nonblank headings; options may refer only to a group on that field,
ids cannot be renamed, and referenced groups cannot be removed. A disabled value
already present in a row remains renderable and preservable but cannot be newly
selected. Undeclared and newly disabled choices
fail before generated code as typed 422 `invalid_choice` and `choice_disabled`,
carrying the affected field in `data-error-fields`. `max_length` is a positive-integer
constraint only on scalar string fields, preserved exactly by soft-hide, enforced
by platform mutation validation, and refused at evolution activation if any
committed physical value already exceeds a new or lower limit. Generated Handlers
receive admitted values rather than reimplementing these structural constraints;
crafted overflow returns typed 422 `max_length_exceeded` with the same field
marker. These three structural codes and their authored platform sentences do not
enter model-authored `behavioral_errors`. Older active rows may omit Module 5's new form
collections; omission canonicalizes to empty without rewriting historical
snapshots, while new specs emit the complete form shape.

The drawn picker implements the select-only combobox keyboard and ARIA contract:
open keys, arrow/Home/End movement, typeahead, commit, Escape/click-away, focus
held on the button and active-descendant reporting, with disabled options skipped.
Radio uses native radio inputs; segmented remains a mutually exclusive,
keyboard-operable button set. Presentation changes do not change the stored wire
value.

`artifacts_path` points to the incarnation/version directory holding the exact
`spec.json`, all Handlers, the item renderer, platform-authored `snapshot.json`,
and tests only when that snapshot's behavioral tier is on. `snapshot.json` also
carries audit-only per-unit dependency-generation provenance, which is neither
registry state nor an equality or cascade input. The registry row keeps only what
the resolver needs — authored spec, lifecycle identity, pointer — while bulky
inventories and tests stay in snapshot files. Each persistent read dependency is a
strict `{ capability_id, incarnation_id }` pair resolving to an active row; arrays
are unique and canonically ordered, and the target capability is implicit. Naming
exact live incarnations lets permanent deletion find reverse dependencies without
inspecting generated code. Through M9 there is no registry/serving
artifact-contract upgrade marker (ADR-0005 §7); an M9 metrics-only shape label may
classify historical rows. Keeping the active registry set lean matters because the
Intent Resolver scans every row on every classification, reading `prompt_context`
to understand the capabilities that already exist.

The logo file is not part of `artifacts_path` or any version inventory. It lives
once at `capabilities/<id>/<incarnation_id>/logo.svg`, beside `vN/`, so bounded
post-activation retry never mutates an immutable snapshot. Platform rendering
serves it from `/capability/:id/:incarnation_id/logo.svg` under the exact
incarnation read gate; delete-and-recreate receives a different immutable URL.
Only `present` emits/serves that immutable URL. Placeholder or missing-file
responses are `no-store`, and a `present` row whose accepted file disappears is
reconciled to `abandoned` rather than generating a second artwork.

Field types include `file` and `file[]`. A file field stores only a reference in
the data table — storage key, mime, size, original name — never the bytes (see
§6.3 Object Store and §7 Files). A `photos` capability is therefore an ordinary
capability whose schema has a `file`-typed field.

The platform form renderer is exhaustive over the committed field-type
vocabulary. Module 4 extends that one renderer when list types arrive and lets
the authored form intent select between the two platform list-input modes without
exposing the choice to generated Handlers; Module 5 adds choice/long-text form
contracts, and Module 7 extends it again for file controls and form presentation.
Unknown types or list-input modes fail
closed rather than falling back to an arbitrary text field.

#### Event Log — append-only during ordinary operation

Every user action, with full before-and-after context: the situation, not just the
change. The Intent Resolver queries it to power the implicit loop and to explain
intent retroactively. Ordinary activity only appends. Explicit confirmed capability
deletion is the one privacy and lifecycle exception: the deletion module purges or
irreversibly redacts capability-owned record and on-screen payloads before deletion
is complete, and a content-free deletion fact may remain.

Event rows and payloads therefore carry the complete set of capability incarnations
whose product data appears in them. The server derives that ownership set from
admitted route, query, and read-token context and from canonical payload
production; it does not trust client- or model-supplied incarnation labels.
Ingestion uses a short coordinator write and atomically validates and appends the
derived set only while every pair is still active and current, so a late
pre-deletion batch is rejected after closing or tombstoning and cannot resurrect
purged content. That lets M8 extend M4's cleanup seam without guessing from free
text.

#### Data Tables — additive-only, generated DDL

The user's actual content. One isolated table per capability, and no foreign keys.
Platform-derived DDL follows the AI-authored candidate spec and is additive-only:
fields are added or soft-hidden, never destructively changed. Only confirmed
capability deletion removes the whole table. JSON columns remain the escape hatch
for fields that do not warrant a real column yet.

#### Generation Metrics — the experiment's measurements

One durable row per admitted generation, keyed by build id and capability
incarnation: `lifecycle_status` (`running | success | failed | interrupted`), a
typed terminal `outcome` (`activated`, `no_change`, `stale`, or a failure reason),
timing breakdown, model, tokens, overlap resolution, and per-stage
generated/copied/executed/skipped/absent states.

Admission writes `running` after the build lease and stale-target check, and
immediately before Builder provider work. Activation finalizes `success/activated`
in the same SQLite transaction as the registry pointer, while zero-diff finalizes
`success/no_change` without a version. A lease-head stale or collision refusal
writes one direct `failed/stale` terminal row without first entering `running`; its
incarnation is nullable only for a new-capability refusal before assignment, from a
catalog mismatch or an expected-absent collision. Recovery closes interrupted rows.

This store is why the PoC exists: conclusions come from data, not guesses. It
survives capability deletion only because it holds measurements and identifiers,
never prompts, records, specs, generated source, or Event Log payloads.

Resolver-only `reject` and `data_query` outcomes live in the same metrics domain
but in a separate content-free `intent_resolution_metrics` table keyed by prompt
job. They, and cancellation or expiry before an active lease, are best-effort:
never mislabeled as generations, and lost if the process exits before their short
write. Admitted build rows embed their own resolver measurement rather than
duplicating that row.

#### Object Store — user files on disk

A platform-provided file store, never something the AI builds. The default local
adapter uses `Bun.file` / `Bun.write`, addressed by opaque key under
`storage/<key>`; an S3-shaped interface (`put` / `get` / `delete` / `url`) keeps
deployment swappable. Bytes live here; the reference lives in a capability table.
Keys have explicit capability-incarnation and record ownership, exclusive in the
PoC rather than silently shareable, and mutations use durable pending and cleanup
work so a failed create/update, a replacement, a record deletion, a soft-hidden
file field, or a whole-capability deletion cannot orphan bytes or delete a live
owner's file.

When capability deletion is admitted, its durable manifest absorbs the target
incarnation's committed active and inactive references, pending ownership, and
already-enqueued cleanup before the table drops; deduplication stays
incarnation-bound.

#### Cross-store lifecycle recovery

Filesystem/object-store operations cannot join a SQLite transaction, so lifecycle
ordering is asymmetric and explicit:

- **Build:** write unique staging → verify inventory/digests/Gate → atomically
  publish final snapshot without overwrite → activate pointer and success metrics
  in SQLite. That commit is activation's point of no return; later presenter or
  transport failure cannot undo it. For an active incarnation at `vN`, every
  verified `v1..vN` is committed history even when it is not the live pointer. A
  post-publication database failure can create a never-activated verified `v>N`
  candidate for reconciliation, and recovery never treats historical versions as
  garbage merely because the registry points at a newer one. A v1 logo attempt
  starts only after that activation, writes outside every `vN` inventory with
  no-overwrite installation, and has its own durable claim/recovery state; it can
  fail without changing the build outcome.
- **Capability deletion:** close/drain reads → collect all owned resources while
  the table exists → commit a non-routable registry tombstone, installed
  SQLite-owned payload cleanup, and table drop → idempotently delete
  artifacts/external resources → remove tombstone. A post-commit external failure
  creates durable retry work, not a live dangling pointer. Before commit the
  committed ground and View remain authoritative and failure restores them; at
  commit the capability becomes absent from the ground and from routes. The window
  puts itself away only when the deleted capability was the open one; otherwise the
  displaced open View is restored from its current canonical state. A direct
  address for an absent capability loads the bare desk and speaks its brief notice
  through the prompt bar's existing message region. Later cleanup retries do not
  resurrect the deleted surface.

Boot recovery runs before serving affected routes. It never infers ownership from
arbitrary stored paths, follows symlinks outside configured roots, overwrites a
final version, deletes tombstone-owned cleanup state, or reclaims a version unless
it has positive evidence that the version never committed.

## 7. Data access model

The unifying principle (§3), applied directly.

### Writes — constrained

Generated Handlers persist canonical state through mutation adapters. Create is
capability-bound; update and delete are bound additionally to the one
router-validated record target before generated code runs. The adapters expose no
table, capability, or record selector. The platform owns active-field
allow-listing, platform-column protection, normalization, logical requiredness,
lifecycle rules, record targeting, and validation of the resulting row. Handlers
own capability-specific behavior and the product-voice translation of typed
failures, but never DDL or raw mutation SQL.

Update has merge-patch semantics, and record identity is a separate platform
target. Only submitted active fields change: omitted active fields, all inactive values,
`id`, `created_at`, and `extra` survive, an explicit `null` clears only an optional
active field, and the complete result validates before the write. An edit therefore
cannot erase soft-hidden or forward-compatible state. Incidental I/O stays the
Handler's business; canonical state always crosses the mutation interface.

### Reads — free

Reads use a distinct parameterized SQL interface backed by a physically read-only
SQLite connection (`SQLITE_OPEN_READONLY` plus an authorizer), so mutation through
that supplied query adapter fails at the SQLite seam. Every persistent generated
Action may query its own table plus the exact capability incarnations declared for
that Action in committed `read_dependencies`, and `read` and `search` necessarily
do. The declaration exists for lifecycle integrity, not mutation safety: SQL and
joins stay arbitrary within those physical tables. The physical dependency ABI is
additive field name and type stability. New Handler and test generation sees only
active external fields, but a committed Handler may keep reading a field its owner
later soft-hides, because soft-hide is neither erasure nor read revocation.

Every query call declares a closed ordered result alias and type descriptor. The
adapter projects only those aliases, discards extra SQL result columns, and fails on
missing, duplicate, or type-invalid declared values, so an added column cannot
become observable to old code through `SELECT *`. Record-producing Handlers return
ordered unique target ids, and the platform then rehydrates full canonical target
rows on the same read snapshot. Canonical rows stay platform-internal: generated
Handlers receive only Action-safe active projections, declared query-result values,
and opaque record handles where they need them. Target-row inactive fields and
`extra` never cross that interface, and already-declared external query aliases for
copied code follow the separate compatibility rule above. Before presentation the
server narrows again — to `item.shows`, the record target, active detail and edit
fields, and the closed `created_at` descriptor — so inactive values and `extra`
never enter generated code, HTML, or the DOM.

The Gate supplies the same query interface over synthetic scratch copies of the full
physical compatibility schemas, while model generation still receives only active
projections. Execution is in-process, so adapter and static-check isolation protects
against accidental model output rather than containing hostile code; the deferred
process sandbox remains the security answer.

For M4's mandatory search baseline, both the live and the scratch connection
register one platform function. It applies JavaScript compatibility decomposition,
lowercases locale-independently, removes combining diacritics only when they follow
a Latin-script base, and recomposes canonically, which folds Latin accents without
erasing voicing, vowel, or tone marks in other scripts. Generated search SQL calls
it instead of SQLite's ASCII-only `NOCASE` and `lower()`. Bun does not expose
scalar-function registration directly, so the platform compiles a small loadable
bridge once into the OS temp directory and calls the canonical JavaScript
normalizer through it. That keeps persistence in-process and adds no service, at
the cost of a local C compiler and SQLite extension headers. On macOS the runtime
selects an extension-capable Homebrew SQLite (or `OMNI_CRUD_SQLITE_LIBRARY`)
instead of Apple's extension-disabled library; setup details live in
`data/README.md`.

M6 `data_query` is the ephemeral whole-catalog reader and persists no reverse
dependency. A cheap classifier may route or reject obvious non-queries early
("delete everything" → friendly refusal), but it is never the safety seam.

### Files — a platform tool, same split

File storage is platform tooling. Building a storage system is out of scope,
brittle, and pointless, so the AI never does it; it calls a provided S3-shaped
tool, backed by default by the local filesystem (`Bun.file` / `Bun.write`) and
swappable to R2, S3, or Garage by config.

- **Upload = write = constrained.** Uploads arrive through the generic router
  (`/capability/:id/create`, multipart); the generated Handler calls
  `files.put(...)` and stores the reference through the mutation interface. A
  durable pending ownership record exists before bytes can be orphaned; database
  success assigns the key exclusively to one incarnation/record/field, while
  failure schedules idempotent compensation.
- **Serve = read = free + infrastructure.** A platform-owned route `/files/:key`
  streams bytes via `Bun.file`, and generated HTML simply references
  `/files/<key>` (in an `<img src>`, say). The AI never builds file serving,
  exactly as it never builds routing.
- **Lifecycle follows ownership.** Update replacement/removal, confirmed record
  deletion, and capability deletion (including inactive file fields) enqueue
  idempotent cleanup. A key is not silently shared between records in the PoC.
  External cleanup failure leaves durable retry work, never an untracked orphan.

### `data_query` — the ephemeral exception

`data_query` ("how many photos tagged sunset?", "notes from last week") builds
nothing. The AI translates NL → read-only SQL and a platform-owned generic
auto-table renders a bounded result. The query creates no registry row, no logo on
the ground, and no version, artifact, cache, or persisted read dependency. Once M8
exists the Event Log may still record the ordinary user action, which does not turn
the query into a built capability. Scope follows the context-aware prompt bar.

Where that answer appears is not settled. An answer is disposable and the window
holds what persists, so the surface waits on the companion — a talking pet that is
not designed yet — and Module 6 inherits the question rather than an answer.

## 8. The two loops

### Loop 1 — explicit (prompt → capability)

```
User types in Prompt Bar
        │
        ▼
Intent Resolver  ── classify (new/extend/ui/query) + overlap resolve + friendly label
        ├─ data_query ──▶ M6 ephemeral query path
        ├─ reject ──────▶ friendly refusal
        └─ resolved request + target/catalog fingerprint binding
                    │
                    ▼
          Explicit-loop presenter  ── product-voice lifecycle over SSE
                    │
                    ▼
          bounded build ticket → exclusive lease → target/dependency revalidation
                    │
                    ▼
          Capability Builder
                    ├─ complete candidate spec
                    ├─ Diff Engine: facts → DDL/unit/Gate scope (or measured no-op)
                    ├─ generate/copy complete snapshot + layered Gate
                    ├─ no-overwrite filesystem publication
                    └─ SQLite pointer + success metrics activation
                    │
                    ▼
          Presenter terminal branch
                    ├─ activated: one committed View swap in the window
                    │  (+ conditional logo sidecar)
                    └─ not activated: restore live View or bare desk via fragment + done
```

The user watches the UI assemble itself, narrated in friendly language and never in
internals, and only ever sees committed, validated results.

### Loop 2 — implicit (behavior → proposal → capability)

```
Event Tracker (dumb) batches actions → server
        │
        ▼
Server-side gate  ── cheap deterministic heuristic; only trips on a real pattern
        │  (no LLM call until it trips)
        ▼
Intent Resolver  ── async, off the interaction path: reads event batch + context
        │
        ├─ confidence < threshold ──▶ log only, back off (raise bar for this pattern)
        │
        └─ confidence ≥ threshold ──▶ M8-owned friendly proposal surface
                                              │
                                  ┌───────────┴───────────┐
                                  ▼                       ▼
                            user confirms           user ignores
                                  │                       │
                                  ▼                       ▼
                     hand resolved request        log dismissal,
                     to chosen presenter          back off pattern
                     → same Builder
```

The gate lives server-side so that its thresholds, the experiment's main tuning
knob, sit next to the Event Log dataset and can be tuned without redeploying the
shell. Inference runs async and never blocks interaction. The implicit loop never
silently changes Aluna: confirmation hands the proposal's already-resolved build
request to the same Builder that Loop 1 uses, and re-runs no prompt classification.

> The implicit UX is deliberately not yet defined. Event capture, the server-side
> gate, async inference, explicit confirmation, and resolved-request hand-off are
> fixed. Module 8 decides where and when the proposal appears, and which Builder
> lifecycle presenter follows confirmation — a foreground interruption, or a
> quieter background presentation. The desk does not settle it: a proposal is Aluna
> speaking unprompted, and the expected carrier is the companion, a talking pet
> that is not designed yet. The Builder itself is independent of the explicit
> prompt/SSE presenter. Nothing builds without confirmation.

### Overlap resolution: extend or create a separate capability

When a new intent overlaps an existing capability, the Intent Resolver decides
silently: extend that capability, or create a separate one whose semantic name
carries the distinction. Work contacts is an independent capability beside
Contacts, never `contacts_2`, and `namespace` is metrics-only. There are no shared
fields and no foreign keys. Persistent cross-capability joins declare exact
incarnation dependencies in the reading capability's spec; ephemeral `data_query`
joins do not. The user never reconciles data models.

### Concurrency

The Mutation coordinator is the sole admission interface for every write on the
shared read-write connection, and prompt resolution owns no mutation state. A
resolved build receives a bounded FIFO ticket. Only the head acquires the active
build lease, revalidates its stale target plus resolver-catalog fingerprint, then
freezes the separate dependency-generation catalog and starts Builder work. A
mismatch is stale rather than a silent reclassification.

Record create, update, and delete take short ownership, but are refused once a
build is queued; short platform writes such as Event Log ingestion or non-build
resolver metrics wait behind it. Capability deletion atomically try-acquires only
when there is no owner and no queued build, and it never queues. Direct and demo
paths use the same interface. Tickets and ownership tokens expire and cancel
separately, and leases release through an ownership-validated `finally`, never an
`isBusy` observation. That stops a request from accidentally joining another
open transaction.

Explicit-loop builds and evolutions use the foreground SSE presenter: the build
takes the window and narrates there, record mutation routes refuse while the build
lease is held, and commit swaps the complete View into that same window. Meanwhile
a build-id provisional tile marks the ground only after new-capability admission,
so the build stays visible whether or not the user is watching the window. It is
replaced on activation and removed on every non-activation. That presentation is not a core Builder invariant;
Module 8 may choose another presenter after confirmation.

Reads remain concurrent and never enter the mutation coordinator. Capability
deletion adds a per-incarnation closing step: once it is admitted, new routes,
reads, queries that reference the incarnation, and file serves are refused, and
bounded already-admitted reads finish or cancel before the destructive transaction.
Any operation that can observe multiple incarnations acquires the complete token set
atomically against one gate/catalog snapshot or receives none, and all tokens
release in `finally`.

Cross-capability reads need no invalidation channel. A capability may read another
capability's table and can never write to it, one window means one visible
capability, and every open is a fresh read, so nothing has to be kept in step. A
second browser tab is the only remaining route to a stale view, and it is an
accepted edge rather than a reason to build a bus, a version stamp, or the refresh
control the window deliberately does not have.

Any UI dependency preflight is advisory. Confirm revalidates the target incarnation
and its reverse dependencies after the atomic try-acquire, and declared dependents
block deletion rather than leaving survivors broken. A new capability has no delete
surface before commit, and a pending deletion reserves its semantic id until cleanup
completes.

Deletion runs in the window like everything else. The doorway is the logo's context
menu and never the window chrome, and the confirmation fills the window in authored
product voice. Before tombstone commit the committed ground and View stay
authoritative, and pre-commit failure restores them. At commit the logo vanishes;
the window puts itself away when the deleted capability was previously open or the
desk was bare, and otherwise restores the unrelated capability the confirmation
displaced. There is no terminal state for the deleted capability. A link to a
deleted capability loads the bare desk and speaks a brief notice through the
prompt bar, which covers a reload, a bookmark and a second tab without a window
state or third notice component of its own.
External cleanup retries cannot resurrect the deleted surface.

## 9. Operating principles

1. **The complete authored spec is the source of truth; derived snapshots follow.**
   Handlers, item renderer, and tier-on tests are version-keyed caches. A total
   positive-proof Diff Engine chooses between regeneration and copy, and snapshot
   metadata proves completeness. The arrow only points spec → derived artifacts.
   Through M9, platform artifact-shape changes still reset and rebuild rather than
   using the deferred preserving-upgrade marker (ADR-0005 §7).

2. **Mutation constrained and coordinated, reads free and declared where
   persistent.** Canonical writes go through capability-bound and
   validated-target-bound mutations under the one coordinator. Reads use physically
   read-only SQL through supplied adapters. Persistent cross-capability Handler
   dependencies are committed lifecycle facts, while M6 queries remain ephemeral.
   (See §3, §7.)

3. **Evolution never destroys; explicit deletion does.** Migrations are
   platform-derived from the AI-authored candidate and additive-only — add or
   soft-hide, never `DROP` or destructively rename — so the admitted platform DDL
   path does not destroy data. That is an interface and static-contract guarantee,
   not process containment for deliberately adversarial generated code. Deleting a
   record or a whole capability is different: after explicit platform-owned
   confirmation, the user has authorized permanent destruction. Capability deletion
   removes the active registry entry, the table and its records, the complete
   artifact and spec history, owned files, and capability-owned Event Log payloads.
   A durable tombstone drives idempotent cross-store cleanup and reserves identity
   until that finishes, and declared dependents block rather than break. The
   confirmation wording states the effect plainly; it never says archive, hide, or
   deactivate. Generation metrics survive only because they are content-free and
   incarnation-keyed.

4. **Merge conflicts are resolved silently, never surfaced.** The Intent Resolver
   decides extend-versus-namespace automatically and proceeds. Getting it wrong
   sometimes is an acceptable, measurable PoC outcome; bugging the user is not.

5. **Builds are validated and recoverably activated.** Nothing becomes live until
   the complete snapshot clears the structural, full-smoke, design, and active
   behavioral work, publishes atomically without overwrite, and then activates the
   registry pointer and success metrics in one SQLite transaction. Tier-off
   snapshots contain no tests; tier-on frozen tests rerun when covered code changes.
   A filesystem or SQLite failure leaves the prior version live plus explicit
   reconciliation state, never a live partial snapshot. The activation transaction
   is the point of no return: a post-commit presenter or transport failure cannot
   undo or relabel success, and the UI recovers from the registry.

6. **Generation is measured, and slowness is expected.** Latency is data, not a
   defect. Every admitted build gets one generation or admission row: successful
   lease-head revalidation enters `running`, while a stale or collision refusal
   writes a direct terminal row without provider work. Resolver-only outcomes
   retain their measurement without pretending a build occurred. Conclusions come
   from querying the dataset.

7. **Friendly app, never a coding agent or engineering tool.** Users state the
   capability-level outcome they want; they do not choose types, migrations,
   frameworks, generated code, CSS values, or build steps. Presentation is not
   theirs to steer either, and a capability's logo is presentation: its subject
   comes from the intent, and a prompt that tries to art-direct it is refused by the
   Intent Resolver under the same rule that refuses "move this 2px right." The
   general rule is the whole defence; no logo-specific validator exists. No
   internals surface in product UI — no "handler," "migration," "compile," or
   "spec." Narration, proposals, confirmations, and errors all speak in product
   voice, in the window showing the work or on the prompt bar that received them.
   The read-only developer panel may reveal internals for curiosity and
   verification, but it never steers the build. "Look how easy / friendly / fast" is
   part of the thesis.

8. **Determinism supports the AI experiment; it does not replace it.** Platform
   code should be deterministic where safety demands it, where shared chrome is
   genuinely invariant, or where a small explicit contract prevents drift or
   unnecessary regeneration. It should not model every possible capability or
   presentation decision. When uncertainty is non-destructive, letting the AI
   generate the affected unit and measuring the result is expected. Aluna must not
   become a website builder whose exhaustive rules leave the AI nothing meaningful
   to do.

## 10. References

Full grounding in [research.md](research.md). The load-bearing ones:

- [SelfEvolve — arXiv 2604.16314](https://arxiv.org/abs/2604.16314) — runtime self-extension pipeline: test generator + code synthesizer + sandboxed executor + context memory, gated on executed tests (the orchestrator + generated-code + behavioral-gate pattern)
- [UI-JEPA — arXiv 2409.04081](https://arxiv.org/abs/2409.04081) — intent from action sequences (the implicit loop)
- [AG-UI Protocol](https://www.copilotkit.ai/ag-ui) — open spec shape for generative UI
- [AutoCRUD](https://www.researchgate.net/publication/327661084) — spec-as-model CRUD generation
- [flipbook.page](https://flipbook.page/) — the original inspiration
