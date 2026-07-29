# The behavioral-tier transition table

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.7 — Evolution Gate
and frozen-intent repair
(PLAN decision 24 (transition table):
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`; ADR-0006)

## What to build

Implement decision 24's tier transition table exactly, on the next real spec
version:

| Prior snapshot | Candidate tier | Test-input change | Test artifact/execution |
| --- | --- | --- | --- |
| off | off | any | absent; no generation or execution |
| off | on | any | generate, freeze, and run from current candidate inputs |
| on | on | unchanged, no Handler impact | copy; do not run |
| on | on | unchanged, Handler impacted | copy; run impacted/full fallback |
| on | on | changed | generate, freeze, and run |
| on | off | any | absent; no copy or execution |

- Toggling the global tier alone does not create a version; these rules apply
  on the next spec-changing build after Diff facts exist. A semantic no-op does
  not materialize a tier transition.
- Snapshot contents follow: tier-off snapshots carry no behavioral-test
  artifacts and `absent`/`skipped` metrics; tier-on snapshots carry frozen
  tests. `snapshot.json` verifies completeness; it is not a routing overlay or
  per-unit pointer manifest.

## Acceptance criteria

- [x] Each of the six table rows is exercised by a test that asserts both the
      snapshot artifact state and the metrics stage states (plan acceptance:
      every behavioral-tier transition)
- [x] Tier toggle alone: no version, no build, no snapshot; the next real spec
      change applies the transition
- [x] A semantic no-op with a toggled tier stays a no-op (`success/no_change`,
      no tier materialization)
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Toggle the tier in the dev preview, run a real evolution, and see the
transition row that applied (artifacts present/absent) in the version's
manifest view.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.7-evolution-gate-and-frozen-intent-repair/issues/02-test-copy-run-selection-and-fallback.md

## Implementation notes

**One place states the table.**
`src/pipeline/evolution/behavioral-tier-transition.ts` is decision 24, and only
decision 24. It takes three facts the build already has — the committed
snapshot's `behavioral_tier`, the candidate's tier, and the Gate's per-Action
execution plan — and returns the row that applied, from a closed six-token
vocabulary carrying the PLAN's own "Test artifact/execution" cell verbatim:

| row | applies to | disposition |
| --- | --- | --- |
| `tier_off` | off→off | absent; no generation or execution |
| `tier_enabled` | off→on | generate, freeze, and run from current candidate inputs |
| `carried_unrun` | on→on, unchanged inputs, no Handler impact | copy; do not run |
| `carried_rerun` | on→on, unchanged inputs, Handler impacted | copy; run impacted/full fallback |
| `regenerated` | on→on, this build authored the suite | generate, freeze, and run |
| `tier_disabled` | on→off | absent; no copy or execution |

It decides nothing. Generation was settled at the freeze stage (4.7/01) and
execution by `planBehavioralExecution` (4.7/02); this names what the two of them
together landed on.

**The rows are per Action where the table is, and per version where it is not.**
The three on→on rows differ per Action in practice — one evolution routinely
regenerates `create`/`update` while `read`/`delete`/`search` carry — so the
transition carries one entry per frozen suite. The two tier-off rows name no
Action at all, because a tier-off version has no per-Action suite to say anything
about; they are one entry carrying only the row. That asymmetry is the honest
shape: it is what makes `rows` total rather than a list with a "mixed" escape
hatch.

**It is not written into `snapshot.json`, on purpose.** A transition is a fact
about a *pair* of versions, and both halves are already durable: v(n-1) records
its own `behavioral_tier`, and v(n) records its tier plus per-Action
`behavioral_tests`. Storing the derived row would make the manifest a pointer to
its predecessor — exactly the routing overlay decision 24 says it must not
become. The row is reported where a *build* is being watched (`candidate-preview`)
and where a *version* is announced (`commit-preview`), so a developer never has
to open two manifests to answer "why does this version carry no frozen tests?".

**Two crossings fail closed.** Every row this module can return states an
outcome, so stating a false one is worse than refusing:

- a `copied` suite over a tier-off prior. That snapshot holds no
  `tests/behavioral.json`, so there is nothing the bytes could have been copied
  *from*; reporting a copy would claim frozen intent whose provenance does not
  exist.
- a suite this build authored and then skipped. It has judged no code at all, so
  "generate, freeze, and run" would be false about a published version.
  `assertBehavioralTestMetadataShape` already rejects it at publication; refusing
  it here keeps the preview and the boundary saying the same thing.

Both are unreachable today (see below) — they are guards on the shape of the
answer, not on a live path.

**The toggle is not a change fact, and the ordering is why.** A run reaches the
tier only at the freeze stage, which sits *after* the Diff. A zero-fact candidate
returns at the Diff (decision 37's measured no-op), so a flipped tier on a
semantic no-op is inert not because anything ignores it but because nothing
downstream ever runs to consult it: no version, no build, no snapshot, and a
stage vector whose whole post-Diff half reads `skipped`.

**Metrics: `absent` now means exactly one thing.** Decision 24 says a tier-off
build's test metrics are `absent`/`skipped`; architecture.md words the same rule
"absent or skipped". Reaching that honestly needed a fix inherited from 4.7/02:
the freeze stage's measurement was only recorded by `recordGateMetrics`, which on
the evolution path runs *after* a successful assembly. A tier-on build that froze
five suites and then failed therefore reported the same stage states as a build
that never turned the tier on, and the five generation calls it paid for
contributed no tokens to the row at all.

`recordBehavioralFreezeMetrics` now records the generation leg where it happens —
timing, tokens, and the per-Action generated/carried report — on both pipelines,
and `recordGateMetrics` keeps only the run leg, so nothing is counted twice. On
the evolution path it is the *assembler* that records it, next to the freeze,
rather than the panel's `onTestsFrozen` hook: that hook is optional and exists for
the developer preview, so a future headless evolution would have silently stopped
measuring what the tier costs. The same run's failed Gate now also leaves its rung
outcomes on the row (`CapabilityGateError.outcomes`), exactly as a v1 build does —
without it a failed row asserted that the behavioral rung failed while its own
stage vector called that rung skipped. The vocabulary is now disjoint:

| generation | execution | means |
| --- | --- | --- |
| `generated` / `copied` | `executed` / `skipped` | a tier-on version |
| `generated` / `copied` | `skipped` | tier-on, froze intent, then failed |
| `absent` | `absent` | the tier was off |
| `skipped` | `skipped` | the run never reached the tier (no-op, early failure) |

### Deliberate boundary calls

- **Row 4's narrowed form cannot come from the Diff, and that is now pinned.**
  Every change fact that regenerates a Handler also selects that Action's tests,
  so a regenerated Handler always arrives with freshly authored tests — the
  coupling is asserted per matrix row against the real `diffCapabilitySpec` in
  `evolution-matrix.test.ts`. "Unchanged inputs, Handler impacted" therefore
  reaches a published version only two ways: the **full-suite fallback** (row 4's
  own disposition names it), which is covered end to end; or a **Gate repair** of
  a copied Handler, which is pinned at the rung in
  `gate-behavioral-selection.test.ts` and, as of this issue, at the snapshot in
  `artifact-lifecycle.test.ts`. Contriving an engine-level Gate repair on a copied
  Handler would need a committed unit engineered to pass its own Gate and fail the
  next one; that fixture would test the fixture.
- **`regenerated` is "this build authored it", not "the inputs moved".** The
  freeze stage also regenerates on its cache-miss path, where a carried suite was
  found inadmissible on unchanged inputs. The disposition is identical either way,
  and the row says what happened rather than guessing why.
- **The transition is evolution-only.** A first build has no prior snapshot to
  transition *from*, so `buildCommitPreview` carries the row optionally and a v1
  build omits it rather than inventing an off→on.

## Verification

- `bun run typecheck` — clean
- `bun run lint` — clean
- `bun run test` — **929 passed, 0 failed** across 88 files / 8 shards in 47s
- Shard weights added for the three new test files (`scripts/test-durations.json`),
  measured on a quiet machine and scaled against `units.test.ts` so the sharder
  stops treating them as the 1s unknown-file default
- Runs attempted while an unrelated process saturated the machine time out in the
  app SSE suites. A controlled A/B on the same file in the same load window —
  5.51s with the change, 5.88s without — confirms the variance is external load,
  not this change.
- `git diff --check` — clean
- Two adversarial review passes. The first found one HIGH (the metrics collision
  and lost freeze tokens above), three MEDIUM (the `absent`/`skipped` vocabulary,
  row 4's narrowed form being uncovered, the asymmetric fail-closed guard), and
  six LOW; all are closed and pinned by new tests. The second pass re-reviewed the
  fixes, confirmed HIGH empty, and found two MEDIUM — the evolution freeze
  measurement riding on an optional presentation hook, and failed evolution Gate
  rungs never reaching the row — both closed above, plus LOW cleanups (exact token
  assertions, a `commit-preview` assertion, collapsing the matrix property test to
  one fixture, refreshed shard weights).

New tests:

- `src/pipeline/evolution/behavioral-tier-transition.test.ts` — the table itself:
  each of the six rows, the two fail-closed crossings, that `on→off` and `off→off`
  are distinct rows rather than one "no artifacts" verdict, that the full-suite
  fallback and a narrowed impact are the same `carried_rerun` row, that every row
  in the closed vocabulary is reachable, and that each disposition is the PLAN's
  cell pinned against a literal.
- `src/pipeline/evolution/evolution-tier-transition.test.ts` — all six rows end to
  end through the real engine, each asserting both halves the acceptance criterion
  names: the published snapshot's tier, verified inventory, on-disk
  `tests/behavioral.json`, and per-Action `behavioral_tests`; plus the aggregate
  and per-Action metrics stage rows. Also: the tier-off candidate preview carries
  the row that explains the absence; an on→off version leaves the prior version's
  frozen intent intact; a toggle alone creates no version and materializes no
  transition, while the next real spec change applies it; and a tier-on run that
  dies after the freeze is not reported as a tier-off row.
- `src/pipeline/evolution/evolution-matrix.test.ts` — one pure test per matrix
  row: the Diff never regenerates a Handler without selecting that Action's tests.
- `src/builder/artifacts/artifact-lifecycle.test.ts` — a carried suite re-run over
  a regenerated Handler is recorded with `covered_handler_regenerated` and
  survives re-verification, alongside its `no_covered_handler_change` sibling.
- `src/pipeline/metrics-recorder.test.ts` — the stage vector itself, over the
  accumulator states a run can reach: the narrowed row-4 form's per-Action rows
  (the metrics half of the case above), the tier-off absence, a froze-then-failed
  run, and an all-carried success.
- `src/app/app.evolution.test.ts` — the activated version's `commit-preview`
  carries the transition row, so the living-demo surface cannot be refactored away
  silently.

## Demo

The evolution dev preview's `assembly.behavioralTierTransition` sits next to
`assembly.behavioralTests` and `assembly.behavioralExecution`, and the
`commit-preview` for the activated version carries the same object. It reads
`{ prior, candidate, artifacts, rows: [{ action?, row, disposition }] }` — the
tier pair, whether this version carries behavioral artifacts at all, and the
table row per Action with its disposition sentence. On a tier-off evolution it is
the only part of the panel with anything to say, since `behavioralTests` is empty
and `behavioralExecution` is absent by construction. No client change was needed;
`public/app.js` pretty-prints the preview payload.

## HITL test instructions

The tier is the global `OMNI_BEHAVIORAL_TIER` env var, and it **defaults on** — an
ordinary `bun run dev` is already a tier-on server, and off exists only to measure
the no-test baseline (PLAN decision 5). It is read at the freeze stage, so a flip
takes effect on the next build and needs a dev-server restart.

That means the tier-on rows can be checked against a capability you already have:
if its latest `snapshot.json` says `"behavioral_tier": "on"`, skip to step 3 and
evolve it. Steps 1–2 are only needed for a capability built from scratch.

1. Start the dev server on port 3030 and open `http://localhost:3030`:

   ```bash
   bun run dev
   ```

2. Build a capability from scratch (e.g. "track my coffee tastings"). This is v1
   and has no prior snapshot, so the `commit-preview` carries
   `behavioralTier: "on"` and no transition row — a first build transitions from
   nothing.
3. Evolve with an **additive** change (e.g. "add an optional brew date"). On the
   candidate panel confirm `assembly.behavioralTierTransition` reads
   `prior: "on"`, `candidate: "on"`, `artifacts: "present"`, with
   `create`/`update` on `regenerated` and `read`/`delete`/`search` on
   `carried_unrun` ("copy; do not run"). The same object appears on the
   `commit-preview` for the new version.
4. Evolve with a **shown-fields** change (e.g. "stop showing the brew date in the
   list"). Confirm every row reads `carried_rerun` with the disposition
   "copy; run impacted/full fallback" — the copied suites were re-proven because
   narrowing was refused.
5. Restart with the tier **off** and evolve again with any real spec change:

   ```bash
   OMNI_BEHAVIORAL_TIER=off bun run dev
   ```

   Confirm the transition is a single row `tier_disabled` with
   `artifacts: "absent"`, that the new version's directory contains **no**
   `tests/` at all, and that its `snapshot.json` has `"behavioral_tier": "off"`
   and no `behavioral_tests` block — while the previous version's
   `tests/behavioral.json` is still there, untouched.
6. Still tier-off, ask for something that changes nothing (e.g. "keep it exactly
   as it is"). Confirm the run ends as a no-op: no new version directory, the
   registry pointer unmoved, and the metrics row `success/no_change` — toggling
   the tier did not, by itself, produce a version.
7. Restart back on the default (`bun run dev`, no env var — the tier is on again)
   and evolve with any real change. Confirm the
   transition reads `prior: "off"`, `candidate: "on"`, every row `tier_enabled`
   ("generate, freeze, and run from current candidate inputs"), and that every
   Action's suite is `generated` — the off→on row regenerates everything, because
   the tier-off predecessor left nothing to carry.
