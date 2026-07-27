# Remove the regenerate-all seam; end-to-end engine tracer and matrix battery

Status: done

Implementation is complete and the deterministic battery is green; the one open
item is the live human sign-off at the bottom of this file.

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.6 — Additive
evolution and the total Diff Engine
(Epic 4.6 text + decisions 13, 21, 22, 37:
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`)

## What to build

Close the engine: one evolution path, proven end-to-end.

- Remove 4.5's hand-authored/regenerate-all tracer seam entirely — it is not a
  second evolution path.
- The engine tracer invokes evolution with a known target and a hand-supplied
  resolved intent (resolver classification stays outside until 4.8): the
  “add a due date to my notes and make it stand out in the list” flow —
  candidate → validation → facts (nullable `due_date`, requiredness, item
  dependency/direction, any behavior/error change) → union → DDL → projected
  regeneration with admissibility-gated prior source → copy → staging →
  publication → atomic activation → one complete View swap; existing records
  readable with `null` shown as the platform empty value.
- The consolidated acceptance battery over the whole engine (plan 4.6 text):
  every matrix row, multi-fact unioning, behavior's all-Handler fallback,
  target-row rehydration under evolution (an old explicit `read` projection
  cannot omit the new column), measured zero-diff no-op, and unmapped-fact
  failure — now end-to-end rather than engine-stage-local.

## Acceptance criteria

- [x] The regenerate-all seam and its dev affordance are deleted; grep-level
      check recorded; the engine is the only evolution path
- [x] The due-date tracer passes end-to-end with behavioral tier on and off
- [x] A behavior-neutral additive change proves copied `read`/`search` stay
      byte-identical yet return complete new-column rows (rehydration)
- [x] End-to-end battery green: all matrix rows *except* `read_dependencies`
      (blocked — see "Honest limits"; pinned as a fail-closed refusal instead),
      unions, all-Handler behavior fallback, zero-diff no-op, unmapped-fact
      failure
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean
- [ ] **Human sign-off**: run the due-date evolution live on the homepage —
      one View swap, records intact, due date standing out in the list

## Living demo

The dev tracer becomes the near-final evolution surface: pick a capability,
type the intent, watch validation, facts, work plan, Gate, and the single View
swap happen on the real homepage capability.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.6-additive-evolution-and-total-diff-engine/issues/04-prior-source-admissibility.md

## Implementation notes

### The seam is gone, and the engine took over its job

Deleted outright: `src/pipeline/demo/hand-authored-v2-tracer.ts`,
`src/pipeline/demo/hand-authored-v2-candidate.ts`, their test, the three
`/demo/hand-authored-v2/*` routes and the `createHandAuthoredV2TracerJobs`
pipeline in `src/app/app.ts`, the "Trace next version" affordance
(`renderDeveloperV2TracerControl` + the `developer-v2-tracer-control` slot in
`public/index.html` and `public/css/devbar.css`), and its `scripts/test-durations.json`
entry. `src/pipeline/demo/` now holds only `spec-build-demo.ts`.

That seam was the repo's **only** v(N+1) publication path, so removing it and
wiring the engine had to be the same change — otherwise the tree would have had
no evolution activation at all for a commit.

The grep-level check is not a one-off note; it is two executable assertions in
`src/pipeline/evolution/evolution-faults.test.ts` → *"the engine is the only
evolution path"*:

- no file under `src/`, `public/`, or `scripts/` mentions the seam
  (`hand-authored` / `handAuthored` / `hand_authored` / `v2-tracer` / `v2Tracer`);
- exactly two non-test modules call `publishCapabilitySnapshot(`:
  `src/pipeline/build/build-run.ts` (v1) and
  `src/pipeline/evolution/evolution-run.ts` (evolution).

### The one evolution run

`src/pipeline/demo/evolution-candidate-tracer.ts` became
`src/pipeline/evolution/evolution-run.ts` — `runCapabilityEvolution(...)`. It is no
longer a "candidate tracer": it runs the whole engine and returns one of exactly
three outcomes (`activated | no_change | cancelled`).

Stages, in order: freeze the lease-held dependency-generation catalog → open the
durable `running` lifecycle row immediately before the first provider call →
author + totally validate the candidate → Diff → **either** the measured no-op
**or** assemble (additive DDL, copy/regenerate, prior-source admissibility, Gate)
→ `reconcileCapabilityArtifacts` → `publishCapabilitySnapshot` at
`nextCapabilityVersion(expectedActiveCapability(...))` → `activatePublishedSnapshot`
with `applyAdditiveCapabilityMigration` inside the transaction. The SQLite COMMIT
is the sole point of no return; only after it does the route swap the View.

`applyAdditiveCapabilityMigration` had **zero** non-test callers before this issue.
It now applies the nullable `ADD COLUMN`s the assembler derived — an evolution never
runs the v1 `CREATE TABLE` path.

Supporting changes:

- `publishCapabilitySnapshot` gained an optional `unitProvenance`. Without it the
  manifest recomputed *fresh* provenance for every unit, which would have silently
  erased the carry-forward provenance a byte-copied unit is required to keep
  (decision 24 / ADR-0006). The v1 path omits it and is unchanged.
- `finalizeMeasuredNoChange` no longer opens its own lifecycle row — the run opens
  one row before the first provider call, per ARCH §6.2 step 1, and every terminal
  path finalizes that same row.
- `DemoBuildAccumulator` gained `copiedUnits`, so an evolution's stage vector
  reports byte-copied units as `copied` rather than lying about them as `generated`.
  (The `copied` state was already reserved in `src/metrics/lifecycle-store.ts` and
  had no writer.)
- `classifyEvolutionFailure` replaces the shared `classifyBuildFailure` for this
  path. The generic one infers the stage from which timings are filled, and an
  evolution's migration timing is only produced *inside* activation — so every
  post-Diff failure would have been mislabelled `migration_failed`. The run tracks
  the stage it is in and reports it exactly.
- `deliverCandidateOutcomePresentation` / `CANDIDATE_ACCEPTED_NOTICE` are gone: an
  accepted candidate is no longer a terminal shape, because it goes on to publish
  and ends in `commit`. What is left is `deliverCandidateRejectedPresentation`.

### The tier is one global knob again

4.6/03 pinned evolution tier-off (`behavioralTierEnabled ?? false`) with a note that
tier-on evolution was 4.6/05's job. Both the assembler and the run now omit
`behavioralTier` unless a caller explicitly overrides it, so the Gate resolves
`OMNI_BEHAVIORAL_TIER` exactly as a v1 build does (default on). Tier-on evolution
here means the Gate generates and runs the complete suite over the assembled
snapshot and the frozen artifact lands in the published snapshot; **4.7 still owns**
the copy-frozen-tests-and-rerun-only-covered-Handlers optimisation, which this issue
deliberately does not pre-empt.

### Renames

`evolution-candidate-*` named modules that stopped at a candidate. Now that the same
surface publishes and activates, "candidate" would be actively misleading:

| before | after |
| --- | --- |
| `src/pipeline/demo/evolution-candidate-tracer.ts` | `src/pipeline/evolution/evolution-run.ts` |
| `runEvolutionCandidateTracer` | `runCapabilityEvolution` |
| `src/app/evolution-candidate-routes.ts` | `src/app/evolution-routes.ts` |
| `registerEvolutionCandidateTracerRoutes` | `registerEvolutionTracerRoutes` |
| `POST /demo/evolution-candidate/:id` | `POST /demo/evolution/:id` |
| `#developer-evolution-candidate-control` | `#developer-evolution-control` |
| `src/app/app.evolution-candidate.test.ts` | `src/app/app.evolution.test.ts` |

The developer-panel *preview* vocabulary is unchanged (`candidate-preview`,
`EvolutionCandidatePreview`, the "Evolution candidate" block): that block really does
show the candidate, its facts, its work plan and its Gate verdict. The commit lands in
the existing Commit and Lifecycle blocks.

### Still temporary, and still owned by 4.8

`handSuppliedEvolutionIntent` and the `/demo/evolution/*` routes stay. The issue text is
explicit that resolver classification is outside the engine until 4.8, so 05 removed the
4.5 seam only — the 4.6 tracer route is the *near-final* surface, not a second path.

## Verification record

- `bun run typecheck`, `bun run lint` — clean.
- `bun run test src/pipeline src/app` — 148 passed, 0 failed; the wider
  `bun run test src/pipeline src/app src/builder src/web src/registry src/router`
  sweep — 492 passed, 0 failed.
- New deterministic batteries (all fake providers; no network, no spend):
  - `src/pipeline/evolution/evolution-run.test.ts` (7) — the due-date tracer end to
    end with the tier **on** and **off**: the four-fact union (`new_active_field`,
    `detail_shows`, `item_presentation`, `behavior`), all six units written under
    decision 22's all-Handler fallback, the single nullable `ADD COLUMN`, v2 published
    + activated + pointed at, v1 still verifiable as committed history, the
    pre-existing record intact with `due_date` null and rendered by the platform
    detail surface as `—`, and `tests/behavioral.json` present in the snapshot exactly
    when the tier is on. Plus the behavior-neutral additive change — `read`/`delete`/
    `search`/`item` byte-identical to v1 *on disk* and never in a prompt, the durable
    row marking them `copied` rather than `generated`, and the **published v2
    `read.ts` executed through the real query adapter** so the rehydrated record
    provably carries a column its own SQL never mentions — the measured no-op, and the
    fail-closed unmapped difference.
  - `src/pipeline/evolution/evolution-matrix.test.ts` (16) — one complete engine run
    per matrix row, asserting facts, platform work, regenerated vs. byte-copied units
    *on disk*, the DDL the live table actually got, the projected behavioral-test
    column, and that the seeded record survives; plus the monotone union of three
    unrelated facts, the list-input-mode row (own committed shape, since it needs an
    active `string[]`), hide→reactivate across two sequential evolutions (column
    reused, the v1 value still in it), and the pinned `read_dependencies` refusal.
  - `src/pipeline/evolution/evolution-faults.test.ts` (12) — the coverage the deleted
    4.5 fault battery carried, now through the real engine **and the real SQLite
    metrics recorder**: each of the four pre-commit activation faults (pointer, column
    and durable row all rolled back together), the post-commit `afterCommit` fault
    (success stays authoritative), the staging fault, a failed Gate, corrupt committed
    history, reconciliation of an interrupted never-activated candidate, cancellation,
    and the two "only evolution path" greps.
  - `src/app/app.evolution.test.ts` (11) — rewritten for the closed engine: the
    accepted candidate emits exactly one `commit` (and no restoring `fragment`), the
    registry moves to v2 with the column live, the durable row is `success/activated`,
    and a spy loader proves the router follows the swapped pointer while the surviving
    record renders through v2. The warm rejection closes its row
    `spec_generation_failed`.
  - `src/app/app.evolution-streaming.test.ts` (5) — the streamed liveness split out of
    the above when it outgrew the file-size budget: the running plan before any unit
    work, the units filling in, the Gate verdict, and the plan being closed out as
    `failed`/`cancelled` when a run dies or is stopped mid-assembly. Plus the living
    demo's pre-flight guard: every event a real run puts on the wire must have a
    `sse-swap` region on the subscriber fragment, and every hidden preview listener's
    `data-preview-target` must be a real element id in the shipped shell — an event
    with no home is invisible on the homepage, which is the failure mode that wastes a
    human sign-off rather than failing a test.
- Fixtures corrected along the way: `app.evolution.test.ts` used to insert a
  `shelves` registry row with no artifacts behind it. The engine reconciles every
  committed version before treating a pointer as an evolution base, so that row was
  authoritative corruption; the fixture now publishes and activates a real v1 for it.

### One adversarial review round (SOTA model)

Fixed from it, highest-impact first:

- **The fault battery could not see what it claimed to prove.** It ran on the in-memory
  metrics stub, which mutates a Map and therefore cannot model the SQLite rollback the
  whole point-of-no-return design rests on — it reported `success/activated` for a run
  whose transaction rolled back. The battery now writes through
  `createMetricsRecorder(env.conns.readwrite)` (`durableMetrics: true`) and asserts the
  real row per fault; a missing **`afterCommit`** case was added, so "never overwrite a
  post-commit success" is now covered rather than merely intended.
- **"All matrix rows" was ticked and was not true.** `list_input_mode` and the
  *reactivate* direction of hide/reactivate had no case; both now do (the list-input row
  brings its own committed shape, since it needs an active `string[]`). The
  `read_dependencies` row is genuinely blocked — see below — and is now pinned as a
  fail-closed refusal with the criterion qualified rather than ticked.
- **`presentFailure` treated a measured no-op as an activation.** It read only
  `lifecycleStatus === "success"`, which `success/no_change` also satisfies, so a
  presentation failure after a no-op would have told the user to refresh for a version
  that does not exist. It now requires `outcome === "activated"`.
- **Two failure misclassifications.** A corrupt committed base throws
  `SnapshotVerificationError` during *assembly*, and the type check reported it as
  `publication_failed` on a row whose own stage vector said publication was skipped; the
  type now only means publication while the run is publishing. And a transport failure
  while streaming the post-Gate previews was recorded as `gate_failed` even though the
  Gate had passed — that window is its own `delivery` stage now.
- **The rehydration proof did not execute anything.** It asserted properties of the
  static fixture and of SQLite. It now loads the *published* v2 `read.ts` and runs it
  through the real query adapter, asserting the record handed to `present` carries the
  new column; and `app.evolution.test.ts` regained the app-level half (a spy loader
  proving the router follows the swapped pointer, and the surviving record rendering
  through v2) that the rewrite had dropped.
- **The `copied` stage state — the headline metrics change — had no test.** The
  behavior-neutral run now asserts the durable row's per-unit vector directly.
- `finalizeMeasuredNoChange` fabricated `totalMs` from its own duration; it takes the
  run's `builtAt` now, so the row's elapsed time is real.

Knowingly not fixed, and why:

- **A stale evolution target writes no metrics row.** The route throws before the run
  opens one, so decision 37's `failed/stale` outcome has no writer. The stale-target
  binding (`expected_absent` / exact incarnation+version plus the resolver-catalog
  fingerprint) is epic 4.8's admission contract; wiring half of it here would have
  invented a shape 4.8 then has to change.
- **`publishCapabilitySnapshot` trusts a caller-supplied `unitProvenance`.** It is
  schema-validated but not recomputed, so a buggy caller could publish provenance
  inconsistent with its units. There is exactly one caller and it settles the manifest
  against the final bytes; a digest guard would need the copied-unit set threaded through
  publication, which is more contract than the risk warrants today.
- **A timed-out terminal presentation on the no-op/rejected paths ends the stream with no
  `done`.** Pre-existing behavior carried forward unchanged (the activated path handles it
  via `deliverActivatedRecoveryPresentation`); changing terminal delivery semantics is not
  this issue's scope.

### Honest limits

- **The unmapped-fact case is not reachable through the real provider seam.** The
  candidate schema and the registry row schema are both strict and jointly total with
  the matrix, which is precisely the property 4.6/01+02 were built for. The
  end-to-end test therefore hands the engine a committed row from outside that
  vocabulary (the reset-bounded pre-4.4 two-Action shape) and proves the guard fires
  before any DDL, generation, publication or activation. The construction is
  documented in the test; the pure fact-level cases stay in `diff-engine.test.ts`.
- **Requiredness cannot be changed alone.** Candidate validation requires the
  `missing_required_fields` cases to name exactly the active required fields, so a
  requiredness change is always at least a two-fact evolution. The matrix battery
  encodes that as the union of the two rows rather than pretending it is one.
- **Per-unit evolution metrics beyond the stage vector remain 4.8's.** This issue
  wires the durable row every terminal path needs (`activated`, `no_change`,
  `cancelled`, and each typed failure) plus the `copied` stage state; the richer
  evolution measurement columns are not in scope here.
- **A capability that declares cross-capability `read_dependencies` cannot be evolved
  yet.** The Diff maps the row correctly (the named Action's Handler, and only it), but
  `evolutionUnitProvenance` refuses to write *fresh* provenance for a regenerated unit
  whose Action declares dependencies — it needs a verified dependency snapshot catalog
  to name the dependency's incarnation/version/digest, and would otherwise fabricate
  audit evidence (decision 24). It fails closed, which is the right behavior; but it
  means this matrix row has no end-to-end case, only the pinned refusal in
  `evolution-matrix.test.ts` → *"the read_dependencies row"*. Copied dependency-bearing
  units are unaffected (their provenance is carried, not recomputed), so an evolution
  that does not regenerate the declaring Action still works. Building that catalog is
  its own piece of work and is not smuggled in here.
- **Tier-on evolution regenerates the whole suite every time.** Decision 24's table says
  on→on with unchanged test inputs should *copy* the frozen tests and rerun only what a
  changed Handler covers. That optimisation is 4.7's. Because the tier now follows the
  global toggle (default on), every live evolution currently generates and executes a
  fresh suite — correct results, more provider spend than the steady state will need.
  Setting `OMNI_BEHAVIORAL_TIER=off` avoids it while 4.7 is outstanding.

## HITL test instructions

1. Start the app: `bun run dev` (the live checks below expect it on port 3030), then
   open `http://localhost:3030/`.
2. If the registry is empty, build a capability first: type
   `I want to keep track of my notes` in the prompt bar and wait for the View to land.
3. Click that capability in the left toolbar, then open the developer panel with the
   `</>` icon. Note the current version in the **Lifecycle & committed versions**
   block, and add a record or two so there is history to preserve.
4. In the **Evolution candidate** block, type
   `add a due date to my notes and make it stand out in the list` and select **Evolve**.
5. What confirms the work, in the order it appears:
   - the **Spec** block streams the candidate as it is authored;
   - the **Evolution candidate** block shows `assembly.status: "running"` with the
     whole shape already decided — `regeneratedUnits` / `copiedUnits`, the
     `ALTER TABLE … ADD COLUMN "due_date"` statement, and the per-unit `priorSource`
     admit/withhold decisions;
   - the **Units** block fills as the regenerated units are written (copied units land
     complete, with zero token usage);
   - the **Gate** block lands its verdict, then the **Evolution candidate** block
     flips to `assembly.status: "complete"` carrying that verdict;
   - the content area performs **one** View swap onto the new version — not a restore.
6. Confirm on the swapped View: the version marker has gone up by one, **every record
   you had is still there**, and the due date stands out in each item. Open a record:
   its due date shows the platform empty value `—` for records written before the
   change.
7. Contrast, on the same capability: type `keep it exactly as it is`. That is the
   measured no-op — a warm "that's already exactly how this works", the committed View
   restored through `fragment` (no swap), the version unchanged, and a
   `success/no_change` row in the **Lifecycle & committed versions** block.
8. Deterministic proof (no server, no spend):
   `bun run test src/pipeline/evolution src/app/app.evolution.test.ts src/app/app.evolution-streaming.test.ts`

> **Cost note for this run.** The behavioral tier now follows the global toggle and
> defaults **on**, so step 4 generates *and* executes a full behavioral suite on top of
> the unit regenerations — more provider spend than the steady state will need once 4.7
> lands the copy-frozen-tests optimisation. Export `OMNI_BEHAVIORAL_TIER=off` before
> `bun run dev` to run the sign-off cheaply; do it at least once with the tier on, since
> that is the path that freezes the snapshot's behavioral artifact.
