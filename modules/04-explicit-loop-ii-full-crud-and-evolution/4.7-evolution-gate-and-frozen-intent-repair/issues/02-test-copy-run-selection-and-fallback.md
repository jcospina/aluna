# Test copy/run selection and the full-suite fallback

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.7 — Evolution Gate
and frozen-intent repair
(PLAN decision 23 (execution): `modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`;
ADR-0006)

## What to build

Separate test **generation** from test **execution**: execution follows
executable impact.

- Only unchanged test inputs copy prior tier-on tests byte-for-byte.
- Copied tests **run** whenever a Handler they cover regenerates. If a valid
  test's Handler coverage or runtime failure attribution cannot be narrowed,
  the full frozen suite runs. Only when no covered Handler changes may copied
  tests skip execution.
- Execution results land in the metrics stage states
  (generated/copied/executed/skipped) and the snapshot's tier metadata.

## Acceptance criteria

- [x] Unchanged inputs + no covered Handler change → tests copy and skip
      execution (pinned: no test process spawned)
- [x] Unchanged inputs + a covered Handler regenerates → the copied tests run
      (plan acceptance: rerun of copied tests after Handler impact)
- [x] Non-narrowable coverage/attribution → the complete frozen suite runs
- [x] Copied tests are byte-identical to their frozen originals; a mutated
      copy fails snapshot verification
- [x] Metrics stage states reflect copy/run/skip accurately per Action
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The build story/dev preview for a tier-on evolution shows which Action suites
were copied, which executed, and why (impact vs full-suite fallback) — e.g. a
behavior change visibly runs everything while an item-only change runs none.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.7-evolution-gate-and-frozen-intent-repair/issues/01-per-action-test-generation-from-total-inputs.md

## Implementation notes

**One place states the rule.**
`src/builder/gate/behavioral/behavioral-execution-plan.ts` is the whole decision.
`planBehavioralExecution` takes the frozen artifact, the freeze stage's
generated/copied split, and the build's `BehavioralExecutionImpact`, and returns a
`BehavioralExecutionPlan`: per Action `source` (generated | copied), `execution`
(executed | skipped), and a closed `reason` token, plus a plan-level `fullSuite`
flag with the sentence naming what could not be narrowed. Nothing else in the
codebase decides what runs.

**Coverage is one Handler, and it is a fact about the executor.**
`behavioralSuiteCoverage(action)` returns `[action]` because
`runFullBehavioralCase` seeds setup rows through the platform mutation port,
invokes exactly the one Handler its case names, and reads state back through the
platform query port. No other generated Handler is called. That is pinned by a
test that makes every other Handler throw on invocation and watches the `update`
suite still pass — so "run only the impacted suites" rests on how a case runs, not
on an assumption about the model's output.

**Narrowing failures, one fallback.** Decision 23 names Handler *coverage* and
runtime failure *attribution*. Handler coverage is total (above), so the fallback
fires when:

- nobody stated the impact at all (any direct Gate caller);
- the caller's own change facts name no Action — decision 22's free-text
  `behavior`, threaded through as `unnarrowableReason`;
- **the fields the item renderer may show changed.** The renderer is not a Handler
  and covers no Action, but every fragment assertion is rendered through it and may
  only name row values, so shrinking `ui_intent.item.shows` can make a carried
  assertion unsatisfiable by *any* renderer — with no Handler moving and no test
  digest moving. Without this the Gate would publish a version that violates its own
  frozen intent and poison every later evolution that does run those suites. A
  rename or a reorder leaves the shown fields alone and still skips, so the
  item-only saving survives;
- `item.ts` moved alongside Handler bytes — a fragment failure then could not be
  pinned to the Handler that moved.

Attribution is settled *before* the run rather than after a failure, which keeps
the run itself a plain execution of frozen bytes.

**The fallback only fires when something would be skipped.** Evaluating it against
the narrowed plan — not the inputs — is what keeps a first build from reporting as
a fallback. Every suite generated means nothing is being narrowed, so "we ran
everything" and "we could not prove anything safe" stay distinguishable in the
snapshot and the metrics row.

**Gate repairs count as regeneration.** `withGateRepairImpact` folds the smoke
rung's `repairAction`s and a design-lint `fixed` renderer into the stated impact
before the behavioral rung selects. The pipeline states the plan it made; the Gate
knows what it then rewrote, and selection answers to the bytes it is about to
clear. A caller that stated nothing stays unstated — it already runs everything.

**A skip is a skip.** When the plan selects no cases, `runFullBehavioralRung`
returns without loading a single Handler or opening a scratch database. The pin
for "no test process spawned" is handler source that cannot even be prepared for
execution: the rung passes with it in place.

**Where the verdict lands.** Three surfaces, asserted together end to end:
`gate.behavioral.execution` (and `assembly.behavioralExecution`) for the preview;
`snapshot.json`'s new `behavioral_tests` block for the durable tier metadata; and
per-Action `behavioral_test_generation` / `behavioral_test_execution` stage rows
using the metrics schema's already-defined `test: { kind, name }` subject. The
aggregate rows now read `copied` when every Action carried and `skipped` when
nothing executed, instead of claiming generation and execution that did not happen.

**The manifest states its own invariants.** `snapshot.json` carries no self-digest
by design, so the tier metadata is made tamper-evident by what it may say rather
than by a hash: `reason` is the closed `BEHAVIORAL_EXECUTION_REASONS` enum, each
Action appears once, `full_suite` implies nothing was skipped and requires its
reason, and — the load-bearing one — a suite this build *authored* may never be
recorded as skipped. A version published on tests that never ran is exactly the
failure the frozen tier exists to prevent, and it now cannot be read back.

### Deliberate boundary calls

- **Execution metadata goes in the manifest, never in `tests/behavioral.json`.**
  The frozen artifact must stay byte-identical when its inputs did not move; a fact
  about *this build's* run cannot be written into it without destroying that. The
  manifest already digests the frozen file, so a mutated copy fails verification.
- **`snapshot.json` is a breaking change.** `behavioral_tests` is required exactly
  when the tier is on, enforced in `assertManifestShape`. Per the greenfield rule,
  existing snapshots are wiped (`bun run reset`), not migrated.
- **Repair stays in 4.7/04.** This issue decides what runs. What a *failing*
  frozen assertion repairs — the implicated Handler on total attribution, the
  conservative set otherwise, always rerunning the same test — is the next issue.
- **The living demo's "an item-only change runs none" is honoured, but narrowed.**
  An adversarial pass found the literal reading unsound: an `item.shows` change is
  an item-only change that *can* break a carried fragment assertion. Renderer
  regenerations that cannot change which row values reach a fragment (a label
  rename, a field reorder, a design-direction edit) still run nothing, which is the
  case the demo line illustrates; one that shrinks the shown fields runs the full
  frozen suite. Flagged rather than assumed: tightening further (any renderer
  regeneration re-runs the fragment-asserting suites, at the cost of the
  label-rename saving) is a one-line change in `evolutionImpact`.

## Verification

- `bun run typecheck` — clean
- `bun run lint` — clean
- `bun run test` — **900 passed, 0 failed** across 85 files / 8 shards in 95s
- `git diff --check` — clean
- An adversarial review pass over the whole change (soundness of skipping,
  contract consistency, metrics honesty, fallback logic, test quality); its one
  HIGH finding — the `item.shows` hole — and two MEDIUM findings (the fallback
  branch being unreachable in production, publication not checking the metadata's
  invariants) are closed above and pinned by new tests.

New tests:

- `src/builder/gate/behavioral/behavioral-execution-plan.test.ts` — the rules
  themselves: coverage is one Handler; a generated suite always runs (even over a
  copied Handler); only the impacted Action runs; no covered change skips
  everything; an item-only change runs none; and the three fallback triggers,
  including that a first build is not reported as one. Selection returns the frozen
  case objects by identity, so filtering can never rewrite a case.
- `src/builder/gate/behavioral/gate-behavioral-selection.test.ts` — what only the
  running rung can prove: a skip loads no Handler at all (unloadable handler
  source, rung still passes); the `update` suite passes with every other Handler
  rigged to throw on invocation; the item-renderer fallback runs all five; an
  unstated impact runs all five; and a Handler the *smoke rung* repaired is
  selected as regenerated even though the caller's plan said copy.
- `src/pipeline/evolution/evolution-execution-selection.test.ts` — end to end over
  real snapshots: off→on generates and runs everything; a second additive field
  runs `create`/`update` only while `read`/`delete`/`search` carry byte-identical
  suites and skip; dropping a field from `ui_intent.item.shows` regenerates only
  `item.ts` and carries every suite, yet runs all five through the fallback; and a
  mutated published copy of `tests/behavioral.json` fails
  `verifyCapabilitySnapshot`.
- `src/builder/artifacts/artifact-lifecycle.test.ts` — the manifest carries the
  Gate's verdict verbatim on tier-on and nothing at all on tier-off, and a forged
  `snapshot.json` claiming a build authored a suite it never ran is rejected on
  read.
- `src/pipeline/evolution/evolution-run.test.ts` — the label-only evolution now
  also asserts that nothing executed, through
  `expectEveryFrozenSuiteSkipped`: the Gate ran zero cases, the manifest's
  `behavioral_tests` reads copied/skipped for all five, and the metrics stage
  vector says the same per Action.

## Demo

The evolution dev preview's `assembly.behavioralExecution` now sits next to
`assembly.behavioralTests`, and the `gate-preview`'s `behavioral.execution` carries
the same plan on both pipelines. Read together they show the whole story per Action:
where the cases came from (`generated`/`copied`) and whether they had to be
re-proven (`executed`/`skipped`) with the reason token — plus `fullSuite` and its
sentence when narrowing was refused. No client change was needed; `public/app.js`
pretty-prints the preview payload.

## HITL test instructions

1. Wipe existing artifacts — `snapshot.json` gained a required tier-metadata block
   and old snapshots fail closed by design:

   ```bash
   bun run reset
   ```

2. Start the dev server on port 3030 and open `http://localhost:3030`.
3. Build a capability from scratch (e.g. "track my coffee tastings"). On the
   **gate** panel, confirm `behavioral.execution.fullSuite` is `false` and all five
   entries read `"source": "generated"`, `"execution": "executed"`,
   `"reason": "generated_this_build"` — a first build runs everything because it
   authored everything, not as a fallback.
4. Evolve with a **label-only** change (e.g. "rename the Rating field to Score").
   In the candidate preview confirm `assembly.behavioralExecution` shows all five
   `copied` / `skipped` / `no_covered_handler_change`, `fullSuite` is `false`, and
   the Gate's `behavioral.testRun.cases` is empty — an item-only change runs none.
5. Evolve with an **additive schema** change (e.g. "add an optional brew date").
   Confirm `create` and `update` read `generated` / `executed` while `read`,
   `delete`, and `search` read `copied` / `skipped`, and that only create/update
   cases appear in `behavioral.testRun.cases`.
6. Evolve with a **shown-fields** change (e.g. "stop showing the brew date in the
   list"). Confirm the plan regenerates `item.ts` only and every suite still reads
   `"source": "copied"`, yet all five read `"execution": "executed"` with
   `"reason": "full_suite_fallback"` and `fullSuite: true` naming the shown-fields
   change — the copied assertions are re-proven against a renderer that may no
   longer emit the values they name.
7. Evolve with a **free-text behavior** change (e.g. "notes with a due date should
   stand out"). Confirm everything executes; because that change also regenerates
   all five Handlers, no suite is skipped and `fullSuite` stays `false` — the
   fallback exists for the case where something *would* have been skipped.
8. Open the new version's `capabilities/<id>/<incarnation>/v<n>/snapshot.json` and
   confirm the `behavioral_tests` block matches what the panel showed, and that
   `tests/behavioral.json` is byte-identical to the prior version's for every
   Action that reported `copied`.
