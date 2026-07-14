# Module 2 — Explicit Loop I: Build Your First Capability — Plan

Status: agreed (grilling session 2026-06-12) — ready to convert into issues

This refines [docs/modules.md](../../docs/modules.md) §Module 2 with the design
decisions that module ownership left open. It does not change Module 2's goal,
boundary, or exit criteria. Decision records: [ADR-0002 update](../../docs/adr/0002-sse-transport-conventions.md)
(channel topology), [ADR-0004](../../docs/adr/0004-capability-artifact-contract-and-validation-isolation.md)
(artifact contract + validation isolation). Terms per [CONTEXT.md](../../CONTEXT.md)
("Engineering language").

## Decisions locked in the grilling session

1. **Views are data-free; handlers return HTML.** (ADR-0004) Compiled `.html`
   views hold zero user data — chrome, forms, and HTMX hooks that load dynamic
   regions through the capability's `read` action. Every handler action returns
   an HTML fragment. The version-keyed cache is therefore never stale, and a
   toolbar click can serve the cached view as-is.

2. **Handler contract: the injected toolbox.** (ADR-0004) Each handler file
   default-exports one async function receiving a platform-built context —
   parsed input + a data tool **already scoped to that capability** (it cannot
   name another table) — and returns an HTML string. The platform owns HTTP,
   parsing, headers, status, and routing. Generated code contains no imports,
   no raw HTTP, no table names.

   > **M4 forward amendment:** this is the deliberately scoped M2 slice. Module 4
   > keeps mutation capability-bound but replaces scoped `select` with a distinct,
   > declared cross-capability SQL interface backed by a physically read-only
   > connection. Every Action may use its declared query catalog, while no Handler
   > may issue raw mutation SQL. ADR-0004's 2026-07-10 amendment is authoritative
   > for the end-state Handler interface.

3. **Gate runs on a scratch database.** (ADR-0004) The smoke and behavioral
   rungs execute handlers against a throwaway in-memory SQLite db created by
   applying the build's own generated DDL. Supplied Gate adapters expose only
   synthetic scratch data, and structural/static checks reject known direct
   imports/bypasses. Generated execution remains in-process, so this protects
   against accidental model output rather than containing adversarial code; the
   process sandbox remains deferred under ADR-0003.

4. **SSE topology: per-build ephemeral streams** ("phone call"). (ADR-0002
   update) `POST /prompt` creates a job and immediately returns a subscriber
   fragment; narration → fragments → commit swap → `done` ride
   `GET /build/:id/stream`, which the server closes. Intent resolution runs
   *inside* the job (the POST never blocks on an AI call). The persistent shell
   channel is deliberately **not** built — it is M7's, designed with its UX.
   The htmx SSE extension is vendored and `hx-swap-oob`-over-SSE proven in 2.6
   (the open question flagged in modules.md). The production event vocabulary
   is finalized during 2.6, starting from the seed (`narration`, `fragment`,
   `done`) plus whatever the commit swap needs; record it in ADR-0002.

5. **Behavioral tier ships in M2 and defaults ON.** Tests generated from the
   spec's `behavior` — written from intent, never from the handler code — run
   against the capability on the scratch db. OFF exists only to measure the
   no-test baseline ("how much worse it got"), never as a working mode. In M2 a
   behavioral failure fails the build (friendly message, nothing committed);
   the behavioral repair loop is M4 (epic 4.7). The type-check **fix loop**
   (write → type-check → feed error back → fix) does land in M2, bounded by a
   config-knob step cap (default 2 attempts), every attempt recorded in
   metrics.

6. **Resolver: full enum from day one, act on one.** The intent schema speaks
   the complete language (`new_capability | extend_capability | ui_change |
   data_query` + a reject bucket) from the first build; M2 *acts* only on
   `new_capability`. Everything else gets a warm, product-voice **deflection**
   streamed over the same per-build channel and logged to metrics — so M4/M5
   change no contract, and intent-distribution data accrues from day one.
   Duplicates fall out free: "track my notes" when Notes exists classifies as
   `extend_capability` → deflected; no collision logic, no auto-suffixed ids.
   `requires_confirmation` exists in the shape but is always `false` in M2
   (later confirmations cover record and capability deletion through deterministic
   platform chrome in M4, plus proposals in M7; neither deletion confirmation is
   an Intent Resolver concern).

7. **Concurrency UX: refusal + courtesy, no queueing yet.** The single-flight
   rule is enforced **server-side**: while a job is active, `POST /prompt`
   returns a friendly "one moment" notice (no AI call) targeted at a transient notice spot
   (never the content area — the running build's narration stays intact). The
   shell adds a courtesy busy state on the prompt bar during an active stream
   (presentation state only; the shell stays dumb).

   > **M4 forward amendment:** M2 itself retains single-flight refusal. Module 4
   > supersedes the system-wide end state with bounded FIFO build reservations and
   > one active build lease inside the mutation coordinator. Module 7 later submits
   > confirmed proposals through that existing coordinator; it does not introduce
   > the first real queue.

8. **Spec surface: a deliberately tiny pantry.** The AI authors the **spec**
   (Zod-validated structured object); **deterministic platform code derives the
   DDL** — the AI never writes SQL (ARCH §1 schema ownership). Field type enum
   in M2: `string | number | boolean | datetime`, each with `required`.
   Excluded for now: list types (M4 evolution), `file`/`file[]` (M6),
   relations (never — no foreign keys). Every capability table automatically
   gets platform-owned columns: `id` (PK), `created_at` (uniform — pre-pays
   M5's NL→SQL catalog), and `extra` (the JSON escape-hatch column, present
   from birth). Deviation noted: ARCH's example shows `created_at` as a spec
   field with `auto`; making it platform-owned removes the `auto` concept from
   M2's pantry. Capability tables are prefixed (`cap_<id>`) so they can never
   collide with platform tables.

## The end-to-end flow (happy path)

Type *"I want to keep track of my notes"* →

1. `POST /prompt` → job created → subscriber fragment swapped in → shell opens
   `GET /build/:id/stream`; prompt bar shows its courtesy busy state.
2. Inside the job (single-flight queue): resolver classifies with full registry
   context. `new_capability` → proceed (anything else → product-voice
   deflection, log, `done`).
3. Spec generation: prompt + intent → spec (`schema + ui_intent + behavior`),
   Zod-validated. Narration streams throughout (product voice, never
   internals).
4. Migration derived deterministically from the spec; applied additively inside
   a transaction.
5. Unit generation: `create` + `read` handlers (injected-toolbox contract) and
   `list` + `create` views (data-free), each unit through the bounded
   type-check fix loop.
6. Gate, fail-closed, in order: type-check → signature assertion → smoke
   round-trip on the scratch db → behavioral tests (tier ON by default,
   generated from `behavior` independently of handlers) on the scratch db.
7. Commit: write `capabilities/notes/v1/` artifacts, insert registry row, flip
   pointer — then one SSE response swaps the content area and updates the
   toolbar out-of-band. `done`, stream closes, prompt bar wakes.
8. Metrics row written before the job ends: timing breakdown (spec-gen,
   code-gen, HTML-gen, test-gen, migration, test-run, total), per-rung
   outcomes, fix-loop attempts, model, tokens, outcome, intent classification.

On any failure: roll back the migration transaction, orphan files for GC, leave
nothing in the registry, stream a warm product-voice apology, write the metrics
row (failure is data). A failed build never creates a capability.

## Proposed issue slicing (atomic, per epic)

Per the owner's direction: tackle Module 2's size by splitting the biggest
epics into many atomic issues. Suggested cut — `/to-issues` finalizes:

- **2.1 Registry** — (a) registry table migration + read/write access module;
  (b) toolbar rehydration on load (fragment of entries; flips
  `hasCapabilities`; click serves the cached `list` view).
- **2.2 Data tool + DDL** — (a) deterministic spec→DDL mapper (type enum,
  platform trio, `cap_` prefix, additive-only, applicable to an arbitrary
  connection — the scratch db needs that); (b) capability-scoped data tool
  (`insert` via rw, `select` via the read-only connection).
- **2.3 Router** — `/capability/:id/:action`: validate action against the
  registry row's `tools`, load the handler from `artifacts_path`, build the
  scoped context, wrap the returned fragment.
- **2.4 Resolver** — (a) full-enum intent schema + classification call with
  registry context; (b) deflection path (streamed product-voice copy + logging).
- **2.5 Builder + queue** (the big one) — (a) build job + single-flight queue +
  server-side busy refusal; (b) spec generation; (c) migration derive/apply in
  transaction; (d) unit generation with the bounded fix loop; (e) structural +
  smoke rungs on the scratch db; (f) behavioral tier (test-gen from `behavior`,
  execution, global toggle default ON); (g) commit + rollback paths.
- **2.6 Shell render + commit swap** — (a) vendor the htmx SSE extension +
  prove `hx-swap-oob` over SSE (the flagged spike; finalize event vocabulary,
  update ADR-0002); (b) prompt bar wiring (POST → subscriber fragment →
  narration rendering + courtesy busy state); (c) commit swap (content +
  toolbar oob in one response).
- **2.7 Metrics** — metrics table migration + writer (one row per generation,
  incl. test-gen/test-run columns, per-rung outcomes, fix-loop attempts, and
  intent rows for deflections).

Sensible build order (tracer-bullet): 2.1a → 2.2 → 2.3 (a hand-written spec can
round-trip through router + tool before any AI exists) → 2.7 → 2.5 (hardcoded
intent first) → 2.6 → 2.4 in front → 2.1b polish. The module's acceptance demo
stays modules.md's "Verify by running it" word for word.
