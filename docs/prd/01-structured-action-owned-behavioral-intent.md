# PRD: Structured Action-owned behavioral intent and deterministic freezing

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.7 — Evolution Gate
and frozen-intent repair

This PRD amends PLAN decisions 22–24 and ADR-0006 without weakening their core
guarantee: frozen behavioral intent is admitted and fixed before the Handler
bytes it judges, and repair always answers to the same frozen artifact.

## Problem statement

Aluna currently asks the configured model to author one behavioral suite per
Action before Handler generation. That ordering is safe, but it makes ordinary
capability evolution feel stalled and expensive. A change to free-text
`behavior` invalidates all five Action input digests, so five independent model
calls run before the first unit can appear in the developer panel. Even an
optional non-text field needs new `create` and `update` suites, even though the
canonical schema, platform-owned errors, and Action contracts already imply most
of their mechanical cases.

The current representation also gives one global free-text sentence more scope
than the user may have intended. A candidate that changes that sentence while
also adding a field or changing presentation turns an otherwise narrow evolution
into full Handler and behavioral-suite regeneration. The Diff is behaving
correctly given its inputs, but the authored contract does not preserve enough
Action ownership for the platform to prove a narrower result.

The problem is not that frozen intent exists. It is that executable frozen cases
are model-authored after the spec instead of being compiled deterministically
from a structured, Action-owned part of the authored spec whenever the semantics
are representable.

## Solution

Aluna will make behavioral intent an explicit, canonical, Action-owned part of
the capability spec. The complete authored spec will state, for each of the
fixed five Actions, the structured behavioral clauses that Action owns and an
optional residual semantic description only when the closed clause vocabulary
cannot express the behavior.

A platform-owned behavioral compiler will turn schema facts, stable
`behavioral_errors`, Action contracts, and structured clauses into the existing
frozen executable case artifact. Mechanical and structured cases require no
additional model call. Only an Action with genuine residual semantics will use
the configured provider, and that fallback receives exactly that Action's total
inputs. Its output must pass the same platform-owned response and fixture
admission contract before it can join the compiled cases.

The result remains frozen before any Handler generation or repair. Its canonical
bytes are still digested into the immutable snapshot. A behavioral failure still
repairs Handler bytes only and reruns the same frozen case. Existing snapshots
remain immutable and verifiable: versioned readers and a canonical legacy
projection carry compatibility, never a rewrite of history.

For the user, schema and presentation changes start unit generation promptly,
while genuinely semantic behavior remains checked. In the developer panel, each
Action clearly reports whether its frozen intent was carried, compiled without
AI, or required a model fallback.

## User stories

1. As a user evolving a capability, I want ordinary field and presentation
   changes to begin visibly without a long unexplained pause, so that I know
   Aluna is working.
2. As a user adding an optional date or number field, I want Aluna to preserve
   existing behavior without reinterpreting every Action, so that the change is
   narrow and predictable.
3. As a user changing only how an item looks, I want all prior behavioral intent
   carried forward, so that presentation work does not spend behavioral model
   calls.
4. As a user stating new Action-specific behavior, I want that behavior checked
   before the new version becomes live, so that lower latency does not weaken
   correctness.
5. As a user whose requested behavior cannot be represented mechanically, I
   want Aluna to retain a bounded model fallback, so that expressive capability
   behavior is still possible.
6. As a user, I want a failed evolution to leave my previous View and records
   intact, so that a compiler or fallback failure is warm and recoverable.
7. As a user with historical records containing `null` for a newly added field,
   I want evolved behavior checked against that compatibility shape, so that a
   new version cannot assume all records were freshly written.
8. As a developer, I want every behavioral clause to name one owning Action, so
   that generation, execution, Diff, and metrics share the same scope.
9. As a developer, I want platform-mechanical cases generated deterministically,
   so that repeated identical inputs produce identical frozen bytes without a
   provider call.
10. As a developer, I want structured clauses compiled behind one small
    interface, so that the clause vocabulary can deepen without spreading
    fixture mechanics through the pipeline.
11. As a developer, I want residual semantics explicitly represented rather
    than inferred during freezing, so that model fallback is an auditable
    authored decision.
12. As a developer, I want fallback prompts to receive only one Action's closed
    total inputs and never Handler source, so that frozen intent remains
    independent of generated code.
13. As a developer, I want compiled and fallback cases admitted by the same
    Action response-shape contract, so that neither path can redefine what an
    Action may observably prove.
14. As a developer, I want the compiler to reject contradictory or incomplete
    structured intent before Handler work, so that malformed intent never
    becomes a Gate repair problem.
15. As a developer, I want unchanged Action intent to carry byte-for-byte by
    canonical digest, so that equality remains evidence rather than policy.
16. As a developer, I want legacy snapshots to remain verifiable and routable,
    so that adopting the new contract does not mutate committed history.
17. As a developer, I want the first real evolution from a legacy snapshot to
    lift its intent conservatively, so that reuse occurs only when equivalence
    is proven.
18. As a developer, I want snapshot metadata to identify the behavioral-intent
    and compiler formats, so that future readers know how frozen bytes were
    produced.
19. As a developer, I want model fallback calls, tokens, duration, and affected
    Actions measured separately from deterministic compilation, so that Module
    8 can compare cost and quality honestly.
20. As a developer watching a build, I want per-Action freeze progress and a
    summary-first Gate preview, so that I can distinguish carry, compilation,
    fallback, execution, and repair without reading the full artifact.
21. As a maintainer of the bounded-repair battery, I want the deliberate
    first-pass Handler failure to remain downstream of freezing, so that the
    deterministic proof that code answers to intent keeps holding.
22. As a maintainer, I want tier-off snapshots to remain test-free, so that the
    behavioral experiment keeps a valid no-test baseline.
23. As a maintainer, I want cancellation to stop pending fallback work and
    prevent unit generation, publication, or activation, so that abandoned
    builds do not spend or publish late work.
24. As a maintainer, I want deterministic compilation failures attributed to
    behavioral-test generation rather than a fabricated Gate rung, so that
    durable lifecycle evidence remains truthful.

## Implementation decisions

- The canonical capability spec gains a fixed-five-Action behavioral-intent
  section. Each Action entry owns an ordered list of closed structured clauses
  and may carry an optional residual semantic description. Empty Action entries
  are explicit; ownership is never inferred from array position or prose.
- Free-text `behavior` remains a concise capability-level description, but it is
  no longer the behavioral-test equality input for every Action. Handler and
  test scope derive from the Action-owned behavioral-intent entries. Any
  capability-wide semantic statement that truly affects all Actions must be
  expanded into all five Action entries during candidate authoring and validated
  as such.
- The structured clause vocabulary is closed, discriminated, canonical, and
  deliberately smaller than an executable test DSL. It expresses semantic
  outcomes and stable evidence, not SQL, Handler source, arbitrary code, raw
  fixture values, product wording, CSS, or implementation steering.
- The first vocabulary covers the behavior Aluna already treats as canonical:
  normal Action success, required-field rejection, record-not-found behavior,
  preservation/deletion state, collection ordering, searchable match/miss
  semantics, and stable marker/code/field assertions. New clause kinds require
  an explicit registry addition and exhaustive compiler/Diff tests.
- Schema-requiredness, platform-owned record-not-found behavior, canonical empty
  states, and the always-on smoke contract are platform facts. The compiler
  derives their executable cases without duplicating authored prose. Authored
  `behavioral_errors` continue to own stable Action-specific error contracts.
- A deep behavioral compiler accepts one candidate spec plus one Action's
  canonical structured intent and produces that Action's admitted frozen cases,
  deterministic report, and compiler-version evidence. It owns fixture
  synthesis, stable marker selection, response-shape construction, and canonical
  case ordering.
- The compiler must be pure with respect to provider, filesystem, database, and
  Handler source. Equal canonical inputs and compiler version produce
  byte-identical output.
- Model fallback is selected only by an explicit non-empty residual semantic
  description on that Action after structured clauses have compiled. A compiler
  failure never silently becomes fallback; malformed structured intent fails
  closed.
- Each fallback remains an isolated provider call with only that Action's total
  inputs, compiled case summary, legal fixture vocabulary, and residual
  semantics. It cannot observe other Actions' intent, Handler/item-renderer
  source, prior failures, or live data.
- Fallback output supplements rather than replaces compiled cases. The platform
  admits the combined Action suite, enforces case ceilings and unique stable
  identity, and rejects contradictions between compiled and fallback evidence.
- Freezing remains a complete pre-code barrier: every Action must be carried,
  compiled, or successfully supplemented and admitted before the first Handler
  or item-renderer generation callback can run.
- Frozen executable artifact shape stays Action-addressed and suitable for the
  existing Gate. Repair, execution selection, failure attribution, per-Handler
  retry budgets, cancellation, and immutable publication continue to consume
  the artifact rather than the authored behavioral-intent section.
- Test input digests include the Action's canonical schema projection,
  Action-owned error/dependency identities, canonical structured clauses,
  residual semantics, and the compiler format/version. Labels, field order,
  presentation intent, Handler source, inactive fields, and dependency schemas
  remain excluded.
- Diff gains typed Action-owned behavioral-intent facts. A changed Action entry
  selects only its Handler and test generation/execution unless a separately
  admitted shared fact requires the existing conservative fallback. Malformed
  or unknown ownership fails candidate validation before Diff.
- Candidate authoring must preserve unchanged Action intent exactly. The current
  explicit evolution path and the later resolver path both return the same
  complete candidate contract; the Builder does not infer requested scope from
  user prose after candidate validation.
- Existing immutable snapshots are never rewritten. Snapshot verification gains
  explicit behavioral-intent/compiler format recognition and continues to
  verify the legacy spec and frozen artifact shapes already committed.
- A canonical legacy adapter projects an older spec into the new internal
  behavioral-intent shape for comparison and candidate context. It preserves the
  legacy frozen artifact as authority. On the next real spec-changing evolution,
  matching per-Action normalized inputs may carry; an Action whose equivalence
  cannot be proven regenerates conservatively. The format lift alone does not
  create a version.
- Newly published snapshots record the behavioral-intent format and compiler
  version in platform-owned metadata. Tier-on snapshots include frozen
  behavioral intent; tier-off snapshots contain no frozen artifact and perform
  no compilation or fallback.
- Durable measurement separates carried Actions, deterministically compiled
  Actions/cases, fallback Actions/calls, fallback tokens/duration, admission
  duration, execution duration, and repair work. Existing aggregate test
  generation timing remains the end-to-end freeze duration for longitudinal
  comparisons.
- Compilation or fallback failure finalizes at
  `behavioral_test_generation`; no Gate rung is reported as executed. Usage
  already reported by a rejected fallback is retained exactly once.
- The developer panel receives per-Action freeze progress and a compact summary
  showing `carried`, `compiled`, or `model_fallback`, case counts, residual
  reason, duration, and usage. Full frozen cases remain available as raw
  developer detail but do not obscure the repair summary.
- The content area remains product-voice only. Guided repair remains an explicit
  content-area demonstration control and does not toggle the behavioral tier or
  influence candidate intent, compilation, Diff, or fallback selection.

## Acceptance criteria

- A tier-on new capability with only schema-, error-, and closed-clause behavior
  freezes a complete admitted suite with zero behavioral fallback calls.
- An optional non-text field addition with unchanged Action-owned semantics
  regenerates/compiles only `create` and `update`; `read`, `delete`, and `search`
  carry byte-for-byte.
- A presentation-only evolution carries every Action suite, makes zero
  behavioral provider calls, and runs only the Gate work licensed by executable
  impact.
- Changing one Action's structured or residual intent changes only that Action's
  test input digest and selects only its Handler/test work unless an independently
  documented conservative fallback applies.
- Residual semantics trigger exactly the owning Action's fallback call. Removing
  the residual while preserving equivalent structured clauses returns that
  Action to deterministic compilation.
- Every compiled and fallback case passes the existing platform-owned Action
  response/fixture contract before freezing; contradiction fails before unit
  generation.
- All behavioral generation/fallback prompts precede every unit-generation
  prompt, and no prompt contains Handler or item-renderer source.
- A guided-repair failure rewrites only the attributed Handler within its own
  budget and reruns the byte-identical frozen case.
- Legacy active and historical snapshots verify and route without modification.
  A real evolution publishes the new format without overwriting prior versions;
  an unprovable legacy equivalence regenerates rather than reusing stale intent.
- Tier-off builds compile nothing, call no behavioral fallback, publish no
  behavioral artifact, and retain `absent`/`skipped` measurement states.
- Success, fallback rejection, compiler failure, cancellation, repair
  exhaustion, and interrupted recovery all record exact stage state and provider
  usage once.
- The homepage living demo visibly distinguishes carried, compiled, fallback,
  executed, skipped, and repaired Actions without requiring the reviewer to
  search the full Gate JSON.
- Focused tests, the full test suite, typecheck, lint, build, and diff checks are
  clean before this issue is marked done.

## Testing decisions

- Tests assert externally observable contracts: canonical spec admission, Diff
  work, provider call boundaries, frozen artifact bytes, Gate behavior,
  immutable snapshots, lifecycle measurements, streamed previews, and the live
  View. They do not pin private helper structure or prompt prose beyond the
  closed-input boundary.
- The behavioral compiler receives table-driven and property-style coverage for
  every clause kind, canonical ordering, stable fixtures, historical `null`
  compatibility, contradictory clauses, case ceilings, and byte-identical
  repeatability.
- Candidate validation and Diff tests prove fixed Action ownership, unchanged
  preservation, one-Action changes, all-Action expansion, unknown clause
  rejection, and total matrix coverage.
- Fallback-router tests use fake providers to prove zero calls for fully
  structured Actions, one isolated call for one residual Action, cancellation,
  rejected structured output with retained usage, and absence of Handler/other
  Action context.
- Freeze tests prove carry/compile/fallback composition, same-input byte
  equality, current-candidate re-admission, and the hard ordering barrier before
  unit generation.
- Gate tests reuse the existing behavioral execution and adversarial repair
  batteries to prove that the new authoring path does not weaken response-shape
  admission, execution selection, attribution, same-test rerun, or per-Handler
  retry bounds.
- Artifact tests verify both legacy and new immutable snapshot formats,
  compatibility projection, no historical rewrite, format-lift no-op behavior,
  and conservative one-time regeneration where equivalence is not provable.
- Metrics tests cover success and every terminal failure/cancellation path,
  asserting compiled work has zero provider usage and fallback/repair usage is
  counted exactly once.
- App tests consume the real SSE sequence and verify per-Action progress arrives
  before units, the Gate summary exposes fallback/repair directly, and product
  narration contains no engineering language.
- The final living check uses the configured provider only through a
  user-initiated homepage flow. Automated tests use fake providers.

## Out of scope

- Changing the global behavioral-tier experiment or making the guided-repair
  checkbox control that tier.
- Weakening frozen-before-code ordering, platform admission, same-test repair,
  fail-closed publication, or immutable snapshot history.
- A general-purpose executable test DSL, arbitrary user-authored code, SQL,
  implementation steering, or hostile-code containment.
- Model routing across different providers per Action. The existing global
  provider contract remains authoritative.
- Parallel Handler generation, Gate-rung redesign, mutation semantics, search
  normalization, permanent deletion, or Module 8 experiment analysis.
- Rewriting, deleting, or silently upgrading historical snapshot files.

## Further notes

- This issue supersedes issue 4.7/01's claim that five behavioral provider calls
  are inherent to per-Action independence. Isolated Action ownership remains
  essential; model authorship and sequential calls are not.
- The current frozen executable artifact and repair loop are valuable seams.
  This work should replace how that artifact is authored, not merge authored
  intent, execution, and repair into one module.
- If implementation reveals that the initial structured vocabulary cannot
  represent an existing semantic case without becoming an executable DSL, keep
  that case as explicit Action residual semantics and measure the fallback. Do
  not widen a clause until its invariant is clear.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.7-evolution-gate-and-frozen-intent-repair/issues/04-frozen-intent-bounded-repair.md

## HITL test instructions

1. Run the focused behavioral compiler, transition, Gate repair, metrics, and app
   streaming tests documented by the implementation, then run:

   ```bash
   bun test
   bun run typecheck
   bun run lint
   bun run build
   git diff --check
   ```

2. Start Aluna with the behavioral tier on using `bun run dev` and open
   `http://localhost:3030/`.
3. Build a capability whose behavior is fully covered by schema, stable errors,
   and structured clauses. Confirm the developer panel shows all five Actions as
   `compiled`, zero behavioral fallback calls/tokens, and frozen intent before
   the first unit.
4. Evolve it with an optional date field and no semantic behavior change.
   Confirm `create` and `update` compile while `read`, `delete`, and `search`
   carry, then the new View activates with existing records intact.
5. Make a presentation-only change. Confirm every Action carries and behavioral
   fallback usage remains zero.
6. Request one genuinely unstructured, Action-specific behavior. Confirm only
   that Action reports `model_fallback`, its admitted frozen cases appear before
   units, and unrelated Actions carry.
7. The guided-repair story is no longer a control on the page (4.8/04 removed the
   demo surface). Read it from the deterministic battery instead: run
   `bun test src/pipeline/evolution/evolution-frozen-repair.test.ts` and confirm
   it still proves the frozen failing case, the attributed Handler, the bounded
   provider repair, the same-case pass, and the final activation.
8. Open a capability whose active snapshot predates this format. Confirm it
   still renders; perform one real evolution and verify the prior snapshot stays
   byte-identical while the new snapshot records the new intent/compiler format.
