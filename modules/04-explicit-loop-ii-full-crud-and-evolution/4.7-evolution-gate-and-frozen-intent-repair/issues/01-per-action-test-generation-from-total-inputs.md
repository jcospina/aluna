# Per-Action behavioral test generation from total inputs

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.7 — Evolution Gate
and frozen-intent repair
(PLAN decision 23: `modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`;
ADR-0006 frozen behavioral intent; ADR-0004 behavioral tier)

## What to build

Behavioral tests generated from total per-Action inputs — **never from Handler
code** — and frozen before any Handler generation or repair.

Each Action's tests are generated independently from: `behavior`, the Action's
`behavioral_errors` plus stable markers, its declared dependency identities,
and this closed schema projection:

| Action | Canonical schema test input |
| --- | --- |
| `create`, `update` | active field name/type/required, excluding labels/order |
| `search` | active `string`/`string[]` field names/types |
| `read`, `delete` | none; canonical-row/delete mechanics stay in always-on smoke |

Success-fragment evidence is also Action-scoped: create/update observe one
mutated item, read/search observe collections, and delete observes no fragment.
Collection ordering may therefore appear only in read/search tests. An
unordered create/update assertion may use submitted values or values from one
affected expected row (for example a normalized result), but never an unrelated
preserved row; any mutation marker that also occurs in an unrelated setup row is
inadmissibly ambiguous, even when it is also a submitted value. State assertions
own persistence, preservation, and deletion.

- Free-text `behavior` is conservatively an input to every Action.
- Current declared active dependency projections are generation context, and
  full physical compatibility schemas are scratch-fixture context; **neither**
  is a versioned equality input.
- A change to a capability's own Action inputs generates those Action tests
  before Handler repair; tests freeze before Handler generation or repair
  begins.

## Acceptance criteria

- [x] Test generation consumes exactly the closed inputs (pinned by a
      prompt-context test: no Handler source, no labels/order, no inactive
      fields, no full external schemas as equality inputs)
- [x] A label-only or field-order-only change produces byte-identical test
      inputs (no regeneration); a required/type-relevant change regenerates
      exactly the mapped Actions' tests
- [x] Generated tests are frozen (content-addressed/digested in the snapshot)
      before any Handler generation or repair starts
- [x] Tests assert stable markers/codes/Actions/fields, never product wording
- [x] Platform validation rejects response-shape contradictions before Gate
      execution: create/update collection-order or preserved-row fragment
      assertions, delete fragment assertions, and fragment assertions on error
      cases
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The build story/dev preview shows, per Action, whether tests were generated
(and from which inputs) during a tier-on evolution of a live capability.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.6-additive-evolution-and-total-diff-engine/issues/05-remove-tracer-seam-engine-tracer-and-matrix-battery.md

## Implementation notes

**The closed projection and its content address.**
`src/builder/gate/behavioral/behavioral-test-inputs.ts` is the single place a
per-Action test input is computed. `actionTestInputs(spec, action)` returns
exactly five keys — `action`, `behavior`, `schema`, `behavioral_errors`,
`read_dependencies` — and computes them *canonically*: active fields sorted by
name, each error case's `fields` sorted, error cases and dependency identities
sorted by their own stable identity, and every object key sorted at
serialization (`canonicalTestInputJson`). `actionTestInputDigest` is
`contentDigest` over those bytes, mirroring the existing
`active_context_digest` pattern. Labels, field order, `ui_intent`, the
capability label, `prompt_context`, inactive fields, and dependency *schemas*
are all structurally absent.

**Generation is per Action and driven by digest equality.**
`freezeBehavioralTests` (`behavioral-test-freeze.ts`) walks the declared Actions
in canonical order; an Action whose prior frozen `input_digest` equals its
current digest carries its cases forward verbatim, everything else is generated
through its own provider call. The prompt builder
(`buildActionBehavioralTestPrompt`) takes `ActionTestInputs` and *never* a
`CapabilitySpec`, so the closed set is enforced by what is reachable rather than
by prompt discipline. It separately receives the candidate's active
name/type-only row vocabulary as scratch-fixture context; those mechanics are
not part of `ActionTestInputs`, their digest, or the generated behavior contract.
A carried suite is still re-admitted against the candidate contract before it
can be reused. If unchanged digest inputs point to cases whose fixture rows are
no longer admissible (for example, they name a newly inactive field), that suite
is a cache miss and regenerates before Handler work instead of permanently
failing every retry from the same committed base.

**Freezing moved ahead of Handler work.** This is the structural change. The
behavioral rung no longer authors anything: `runFullBehavioralRung` requires
`behavioralTier.frozen` and throws without it, and re-asserts the platform
contract before executing. Both pipelines freeze first — `build-run.ts` between
the migration preview and `generateUnitsWithPreview`, `evolution-assembly.ts`
between `onPlanned` and `assembleUnits`. Execution still happens last in the
Gate (after design-lint's item rewrite and the smoke re-entry), which now costs
the suite nothing: what moves is the code under test, never the intent.

**The frozen artifact is per Action.** `tests/behavioral.json` is now
`{ actions: [{ action, input_digest, cases }] }` — same snapshot path, same
manifest digesting and inventory assertion, new content shape. This is a
breaking artifact change; per the greenfield rule, existing on-disk snapshots
must be wiped (`bun run reset`) rather than migrated.

**Platform response-shape contract.** `assertResponseShape` in
`gate-behavioral-full-contract.ts` states the matrix explicitly and in order:
error cases carry no fragment assertions; `delete` carries none at all;
`create`/`update` may not assert ordering; and `assertMutationFragmentEvidence`
rejects any mutation marker that also occurs in an unrelated setup row with a
message naming that reason. `assertActionSuiteContract` runs per Action at
generation time; `assertFrozenTestsContract` runs over the assembled artifact
(covering every declared Action once, in canonical order, each addressed to its
current inputs) both at freeze time and again inside the Gate.

**Typed failure.** `BehavioralTestGenerationError` keeps a generation or
admission failure attributable to the behavioral tier now that it happens
outside the Gate; `classifyBuildFailure`/`classifyEvolutionFailure` map it to
`{ stage: "behavioral_test_generation" }` with no fabricated rung. The lifecycle
vector marks test generation executed and every Gate rung skipped. The durable
terminal outcome remains the existing coarse `gate_failed` experiment bucket so
the additive-only migration contract and its SQLite `CHECK` remain unchanged.

**Adversarial hardening.** Follow-up review closed the other total-input edge
conditions. Read/delete prompts now receive legal active row names without
moving their empty schema digest; field references are validated before freeze;
searchability shares the registry's `isListFieldType` exhaustiveness seam; the
per-Action case ceiling derives from the registry's eight authored-error limit
(eight errors + normal + `record_not_found` = ten); and a caller cannot supply a
frozen artifact while resolving the tier off.

**Empty-collection ownership hardening.** A generated zero-row `read` case is
legal and the conforming Handler returns `""`; behavioral execution now accepts
that exact result instead of applying the seeded-smoke non-empty assertion.
Always-on smoke owns the platform mechanics directly: it verifies `read` before
the first insert and requires empty `read`/no-match `search` results to return
exactly `""`, so Handler-authored empty-state markup cannot defeat the
platform-owned `:empty` states. The per-Action prompt also steers the normal
generated `read` case toward seeded row evidence rather than using the generic
empty collection as its sole behavioral proof.

### Deliberate boundary calls

- **Carry-forward is here, run/skip selection is not.** Acceptance criterion 2
  says a label-only change causes "no regeneration" and a required change
  regenerates "exactly the mapped Actions", which forces this issue to own the
  generate-vs-carry decision (and therefore to read the prior frozen artifact).
  4.7/02 still owns everything about *execution*: which frozen suites run, the
  impact-driven run/skip rule, the full-suite fallback, and the
  copied/executed/skipped metrics states.
- **Digest equality is the authority, not the Diff's `BehavioralTestPlan`.**
  Decision 23's criterion is "unchanged test inputs", so selection is derived
  from the inputs themselves. `behavioral-test-inputs.test.ts` asserts the two
  agree across the change-fact matrix rather than threading the plan through.
- **Cost note:** a tier-on build may make up to five isolated behavioral
  provider calls, but only for Action input digests that missed carry-forward.
  Independent Action context is what makes mapped regeneration provable;
  serial execution is not part of that guarantee. Cache misses run with bounded
  concurrency and settle back into canonical Action order before any Handler
  generation begins.

## Verification

- `bun run typecheck` — clean
- `bun run lint` — clean
- `bun test` — clean
- `git diff --check` — clean
- Existing user-owned `http://localhost:3030` — homepage prompt and visible
  developer panel smoke-checked without mutating the live demo state or spending
  provider calls

New tests:

- `src/builder/gate/behavioral/behavioral-test-inputs.test.ts` — the closed set
  (exactly five keys, per-Action schema projections, no presentational or
  inactive material, key-order independence) and digest equality across the
  change-fact matrix, cross-checked against `diffCapabilitySpec`.
- `src/builder/gate/behavioral/behavioral-test-freeze.test.ts` — independent
  per-Action generation, content addressing, the report's named inputs,
  carry-forward proven with a provider that *throws* if asked, selective
  regeneration on a required change, rejection of freshly inadmissible output,
  and successful regeneration when a hide-field evolution invalidates a
  byte-addressed carried fixture.
- `src/builder/gate/behavioral/gate-behavioral-full-schema.test.ts` — an
  admitted Action with all eight authored errors still fits its normal and
  platform `record_not_found` cases, while an eleventh case remains bounded.
- `src/builder/gate/behavioral/gate-behavioral-response-contract.test.ts` — the
  four response-shape rejections acceptance criterion 5 names.
- `src/builder/gate/behavioral/gate.behavioral.test.ts` — the prompt-context
  test now parses the prompt's payload, pins its exact keys, and proves
  read/delete receive active row-field vocabulary with inactive fields and
  labels absent.
- `src/builder/gate/behavioral/gate-behavioral-execution.test.ts` — tier-on
  requires frozen tests, tier-off rejects supplied frozen intent rather than
  silently discarding it, and a frozen zero-row read accepts the required empty
  fragment without suppressing semantic error fragments.
- `src/builder/gate/smoke/gate.smoke.test.ts` and
  `src/builder/gate/smoke/gate.smoke-search.test.ts` — always-on smoke rejects
  Handler-authored empty/no-match markup while preserving platform-owned empty
  states.
- `src/app/app.spec-build-failures.test.ts` — pre-Gate freeze failure records
  the exact test-generation stage, no rung, and a skipped behavioral Gate.
- `src/pipeline/evolution/evolution-run.test.ts` — "frozen behavioral intent
  under evolution": every behavioral prompt precedes every unit prompt, the
  published artifact is content-addressed per Action, and a following label-only
  evolution issues zero behavioral prompts and publishes a byte-identical
  `tests/behavioral.json`.

## Demo

The evolution dev preview (`POST /demo/evolution/:id` → `candidate-preview`)
carries `assembly.behavioralTests`: per Action, `generated` vs `carried`, the
`inputDigest`, the case count, and an `inputs` block naming what fed it
(`behavior`, `schemaFields`, `behavioralErrorCodes`, `dependencies`). It is sent
from the new `onTestsFrozen` assembly progress hook — after the plan, before the
first generated byte — so the panel shows the ordering guarantee as it happens.
The v1 build path surfaces the same report on `gate-preview.behavioralTests`.
No client change was needed: `public/app.js` pretty-prints the preview payload.

## HITL test instructions

1. Wipe the existing artifacts first — the frozen-test artifact shape changed
   and old snapshots fail closed by design:

   ```bash
   bun run reset
   ```

2. Start the dev server on port 3030 and open `http://localhost:3030`.
3. Build a capability from scratch (e.g. "track my coffee tastings"). In the
   dev previews, confirm on the **gate** panel that
   `behavioral.testGen.generatedActions` lists all five Actions and
   `carriedActions` is empty, and that `behavioralTests` shows the inputs each
   Action's suite came from.
4. Evolve that capability with a **label-only** change — e.g. "rename the
   Rating field to Score" — and watch the candidate preview. Confirm every
   entry in `assembly.behavioralTests` reads `"status": "carried"` and the
   build finishes without any behavioral test generation.
5. Evolve again with a **schema** change — e.g. "add a required brew method
   field". Confirm `create` and `update` read `"generated"` while `read`,
   `delete`, and `search` read `"carried"`, and that the new version's
   `capabilities/<id>/<incarnation>/v<n>/tests/behavioral.json` has one entry
   per Action, each with an `input_digest`.
6. Evolve a capability that has an optional checkbox/list field with a
   **hide-field** change. Confirm the evolution activates instead of repeatedly
   failing. `create`/`update` regenerate because their digests move; any
   unchanged Action whose old fixtures named the hidden field also regenerates,
   while an already-admissible suite may still carry.
7. Server console: the build log's `gate.behavioral` block shows the frozen
   per-Action suite and the generated/carried split.
