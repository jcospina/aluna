# Frozen-intent bounded repair

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.7 — Evolution Gate
and frozen-intent repair
(PLAN decisions 23 (repair) and 22:
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`; ADR-0003 bounded
per-unit repair)

## What to build

Repair that answers to valid frozen tests, never the other way around. Generated
tests must first pass the platform-owned per-Action input and observable-response
contract from issue 4.7/01; an inadmissible suite is regenerated or fails the
build before Handler repair and is never frozen as behavioral intent.

- A failing behavioral assertion repairs **only the implicated Handler** when
  attribution is total; otherwise the conservative Handler set (decision 22's
  fallback for runtime failure attribution that cannot be narrowed without
  weakening a frozen test). It always reruns the **same frozen test**.
- Repair cannot edit, regenerate, weaken, or skip tests in response to code.
- Bounded per-unit retries per ADR-0003; exhaustion fails the build: product
  changes roll back, metrics finalize failed with a typed outcome, the
  presenter restores the canonical View via `fragment`.
- Exercise the whole Gate under evolution: pass/failure over **existing
  records**, every Gate rung (structural, smoke, design lint when `item`
  regenerates, behavioral), bounded retries, rollback, failure metrics, and
  recovery of interrupted `running` metrics.

## Acceptance criteria

- [x] Total attribution repairs exactly one Handler and reruns the same frozen
      bytes; non-narrowable attribution repairs the conservative set
- [x] No code path can modify a frozen test during repair (pinned by digest
      verification at publication)
- [x] Only a suite already admitted by the platform-owned Action response
      contract can be frozen or drive Handler repair
- [x] Retry bound respected; exhaustion → rollback + `failed` metrics + warm
      `fragment` restoration; prior version stays live and routable
- [x] Gate runs prove behavior over existing records (a repair cannot pass by
      ignoring historical `null`s)
- [x] Interrupted mid-repair build reconciles to `interrupted` at boot
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

A deliberately hard evolution (dev fixture forcing a first-pass behavioral
failure) shows the repair story in the foreground stream: failing rung, bounded
repair, then either the View swap or the warm failure with the prior View
restored.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.7-evolution-gate-and-frozen-intent-repair/issues/02-test-copy-run-selection-and-fallback.md

## Implementation notes

**Frozen intent is the constant; Handler bytes are the variable.**
The behavioral rung now attributes a failing case from a closed execution
surface rather than parsing error text. A failure after exactly one Handler
executes repairs that Handler only. A fragment failure that may also come from a
changed shared item renderer repairs the conservative declared Handler set.
Setup failures repair nothing and fail closed. Item-renderer exceptions are
wrapped and recognized through their cause chain, so they cannot be blamed on an
innocent Handler merely because rendering happened inside its invocation.

**The repair loop is bounded and auditable.**
Every attempt re-plans and executes the same admitted frozen artifact, whose
in-memory seal is checked before and after callbacks. The loop rejects
structurally invalid rewrites, feeds their exact validation failure into the same
Handler's remaining budget, does not count byte-identical provider output as a
repair, and records attribution, duration, provider usage, failing case, and
repaired Handler bytes. The bound is genuinely per Handler: one Action cannot
consume another Action's repair allowance, including across sequential failures
or a conservative multi-Handler round. A successful repair re-enters structural
and smoke with provider repair disabled before it can publish.

**Cancellation is immediate and provider-safe.**
An already-aborted provider wrapper starts no underlying request. An abort raised
during a conservative repair round escapes as cancellation rather than an
ordinary rejected candidate, so no later Handler receives a provider call. Repair
attempt duration measures the elapsed turn once; it no longer adds an already
included repair interval a second time.

**Repair provenance reaches the committed unit.**
Behavioral repair attempts and token usage are folded into the affected
generated unit's history. The evolution assembler settles copied/regenerated
status against the bytes that actually cleared the Gate, so a copied Handler
stays byte-identical while a Diff-regenerated Handler displaced by the demo
fixture or rewritten during repair is published and reported as regenerated.

**Failure metrics report the work that actually happened.**
Evolution records the assembled unit inventory before the Gate can throw, then
refreshes final unit history without adding the same usage twice. Typed Gate
failure evidence carries smoke, design-lint, behavioral execution, and every
repair generation into both v1 and evolution lifecycle rows. Successful and
failed behavioral repairs count each provider call exactly once; failed smoke
and design-lint repairs do the same. When structured output rejects but the
provider has already reported usage, that usage remains attached to the typed
failed generation. Failed rows therefore retain honest generated/copied and
executed/skipped stages rather than looking as though assembly never ran.

**Existing records and interruption are exercised end to end.**
A tier-on prior version contributes carried cases whose setup rows predate the
new nullable column. The evolved Gate runs those rows with historical `null`s
against the candidate renderer and fails closed if the candidate assumes every
record has the new field. The interruption test suspends the provider during an
actual repair regeneration, observes the durable `running` row and absent v2,
then runs boot reconciliation and proves the abandoned completion cannot
overwrite `interrupted`.

**All adversarial findings are closed.**
The final passes additionally removed the unsafe shortcuts found by independent
review:

- a design-lint-only `item.ts` repair now runs the complete carried frozen suite,
  because every Action may assert against a fragment rendered through that
  shared unit;
- the living demo uses an explicit guided-repair checkbox, so the resolver, Diff,
  test freeze, and generation prompts receive the exact requested change;
- guided repair is rejected before admission when the behavioral tier is off,
  cannot widen the Diff plan to replace a copied unit, and fails closed unless
  the synthetic first pass causes a real frozen-test failure followed by a
  provider-authored repair;
- retry budgets are per Handler, abort stops remaining provider calls, and timing
  does not double count repair;
- failed behavioral, smoke, and design-lint provider work is retained exactly
  once in durable metrics, including usage reported alongside rejected output.

## Verification

- `bun test
  src/builder/gate/behavioral/behavioral-failure-attribution.test.ts
  src/builder/gate/behavioral/gate-behavioral-repair-adversarial.test.ts
  src/builder/gate/behavioral/gate-behavioral-repair.test.ts
  src/builder/gate/gate-failure-metrics.test.ts
  src/pipeline/demo/hard-evolution-fixture.test.ts
  src/pipeline/evolution/evolution-frozen-repair.test.ts` — clean
- `bun test
  src/builder/gate/behavioral/behavioral-execution-plan.test.ts
  src/builder/gate/behavioral/gate-behavioral-selection.test.ts
  src/app/app.evolution.test.ts
  src/app/app.spec-build-behavioral-repair-metrics.test.ts
  src/provider/abort.test.ts src/web/fragments.test.ts` — clean
- `bun test` — **978 passed, 0 failed** across 95 files
- `bun run typecheck` — clean
- `bun run lint` — clean
- `bun run build` — clean
- `git diff --check` — clean
- Existing user-owned `http://localhost:3030/capability/experiment_journal` —
  HTTP 200 with the first-person **Show me the guided repair** control visible;
  no live capability was mutated and no provider call was spent

## Demo

The content-area evolution form now includes **Show me the guided repair**.
When enabled for a tier-on evolution that already regenerates `update.ts`, only
that first pass is replaced with a structurally valid Handler that contradicts a
frozen required-field assertion. The fixture cannot select a copied unit, run
under tier-off, or reach publication as candidate bytes. The rest is the real
evolution path: the behavioral rung fails, attributes the failure, calls the
configured provider within `update`'s own repair budget, reruns the same frozen
bytes, revalidates the repaired snapshot, and either activates it or restores the
prior warm View. The developer preview carries the failed attempt, attribution,
repaired Handler, usage, and final Gate verdict.

## HITL test instructions

1. Keep the existing dev server on port 3030, or start it with:

   ```bash
   bun run dev
   ```

2. Open `http://localhost:3030/` and open a capability that has a required text
   field. If none exists, create one first, for example with “track my notes”.
3. In the content-area **Evolve this capability** form, enter a realistic
   additive request such as “add an optional due date and make it stand out”.
4. Enable **Show me the guided repair**, then click **Evolve**.
5. In the developer Gate preview, confirm the first behavioral attempt fails,
   attribution names only `update`, a bounded repair attempt is recorded, and
   the same frozen case then passes. The complete View should swap to the new
   version and existing records should still render.
6. To inspect the warm-failure side, repeat with a provider configuration that
   cannot return an admissible repair. Confirm the prior View is restored through
   `fragment`, the prior version remains routable, and the metrics row ends
   `failed` / `gate_failed` with rung `behavioral`.
7. To verify the tier boundary, run the app with
   `OMNI_BEHAVIORAL_TIER=off`, submit the same form with the guided-repair box
   selected, and confirm the request is refused warmly before provider work and
   before any version change.
