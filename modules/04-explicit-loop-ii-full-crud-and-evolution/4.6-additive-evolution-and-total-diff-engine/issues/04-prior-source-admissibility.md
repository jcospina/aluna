# Prior-source admissibility for regeneration prompts

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.6 — Additive
evolution and the total Diff Engine
(PLAN decision 21 ¶2: `modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`;
ADR-0006)

## What to build

Prior source is optional regeneration context, not an entitlement. Before an
affected Handler or `item.ts` receives its old source in a regeneration
prompt, deterministic admissibility checks must prove that source references
nothing outside the candidate unit's **current** generation contract:

- no inactive or undeclared fields;
- no undeclared dependency data;
- no forbidden platform authority;
- no imports or other context the fresh unit is not allowed to see.

If proof fails, the unit regenerates **without** old source. Positively
unaffected units still copy without entering model context (4.6/03). This rule
prevents stale source from leaking hidden context into generation; it is not a
process sandbox.

## Acceptance criteria

- [x] Plan acceptance: regenerated prior source is admitted only when it fits
      the candidate unit contract; otherwise generation proceeds without it,
      while copied-unit behavior remains separately proven
- [x] Test fixtures: old source referencing a now-hidden field, a
      newly-undeclared dependency, and a forbidden platform authority are each
      rejected; clean prior source is admitted verbatim
- [x] The admissibility decision is recorded per unit (visible in the dev
      preview work plan / metrics stage states)
- [x] Prompt-content assertion: an inadmissible unit's regeneration prompt
      contains no old source bytes
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The dev tracer's work plan shows, per regenerated unit, whether prior source
was admitted or withheld and why — visible on a hide-then-evolve scenario
against a live capability.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.6-additive-evolution-and-total-diff-engine/issues/03-additive-ddl-context-projection-and-unit-copy.md

## Implementation notes

- **One deterministic proof, two halves.**
  `checkPriorSourceAdmissibility(...)` in the new
  `src/builder/units/prior-source-admissibility.ts` decides every verdict — no
  model call, no execution, same answer for the same inputs. It runs against the
  **candidate** spec and the candidate's frozen dependency catalog, never the
  committed ones the source was written for:
  1. *The unit's static contract* — the very checks a freshly generated unit must
     pass (`checkHandlerSourceContract` and the new
     `checkItemRendererSourceContract`, factored out of `checkItemRendererUnit` so
     both callers share one definition). This catches an import, raw HTTP, raw
     mutation SQL, direct connection access, an item renderer reading outside
     `ui_intent.item.shows`, or query SQL naming a table the Action no longer
     declares. The isolated type-check is deliberately *not* re-run: a regeneration
     is coming either way and the fresh unit is type-checked on its own.
  2. *The hidden-name boundary* — no **inactive** field name and no **undeclared
     capability table** may appear anywhere in the bytes: identifier, property,
     object key, string literal, SQL text, or comment. A hidden field's name
     surviving in a comment or a `data-error-fields` marker leaks the same stale
     context a live read would, and a dropped dependency's `cap_*` table left in a
     comment or a dead SQL constant is data the executable-SQL check never sees.
     Matching is whole-token, so a derived identifier such as `tags_element`
     (which the generated search Handler builds) is not a reference to `tags`.

- **Active target fields outside an Action's field list are *not* forbidden.**
  Decision 21 ¶2 says "inactive or undeclared", and an active field is neither:
  the spec's `behavior` text reaches every Action's prompt verbatim, and the
  read/search prompts authorize SQL over the target table — so a `read` Handler
  naming an active column in an `ORDER BY` is inside its contract. (An earlier
  draft equated "not in this Action's projected field list" with "outside the
  contract", which withheld nearly every unit of a *behavior* change — the fact
  that regenerates all five Handlers and the most common evolution there is.)
  Where the projection boundary is real it is already enforced structurally:
  `item.shows` by the item renderer's AST field-access check, dependency scope by
  the query catalog check.

- **It withholds on doubt, never admits on doubt.** The name scan reads raw source
  text, so a capability that hides a field named after a common markup or SQL
  token (`text`, `value`, `code` — words the platform's own boilerplate contains)
  can lose an admission it would have deserved. That direction is free (the unit
  regenerates from the contract alone, exactly as a v1 build does) while the other
  direction leaks. As decision 21 says, this is not a process sandbox: it governs
  what enters *model context*, and execution safety stays the Gate's, the
  router's, and the toolbox's job.

- **Threading, with a backstop.** `buildUnitPrompt` gained an optional
  `priorSource` argument and places it after the contract and before any retry
  failure, framed as reference material the contract outranks; it decides nothing
  itself. `generateCapabilityUnit` gained `priorSource` and **re-proves it** before
  building the prompt, so no caller — present or future — can leak stale source by
  forgetting to ask. The assembler and the backstop call the same pure function on
  the same inputs, so the recorded decision and the actual prompt can never
  disagree. The Gate's own repair loops (`gate-smoke-repair.ts`,
  `gate-design-lint.ts`) go through `generateUnitContent`, which has no prior-source
  parameter at all — a repair prompt is contract plus failure, never old bytes.

- **Decided before the first model call.** `assembleEvolutionCandidate`
  (`src/pipeline/evolution/evolution-assembly.ts`) proves every regenerated unit's
  prior source *before* it reports the plan, so the whole shape of an evolution —
  copy/regenerate **and** admit/withhold — is visible with zero spend. A withheld
  unit is simply absent from the admitted map, so `regenerateUnit` passes no
  `priorSource` key at all: not an emptied section, no section.

- **Recorded per unit, audit-only.** `EvolutionAssemblyPlan.priorSource` and
  `AssembledEvolutionCandidate.priorSource` carry
  `{ unit, admitted, reason? }` in canonical unit order (copied units are absent —
  they never enter model context, so no admission arises). The terminal record also
  covers a unit the **Gate** rewrote: a repair can reclassify a copied unit as
  written, and every unit that entered model context needs a decision. It reads as
  withheld, truthfully — the repair rungs go through `generateUnitContent`, which has
  no prior-source parameter at all. It reaches the developer panel through
  `EvolutionAssemblySummary.priorSource` (`src/pipeline/streaming/previews.ts`),
  streamed in the `running` plan by the tracer and in the terminal summary by the
  route. Like unit provenance it is audit-only: it never feeds equality, the Diff,
  or a unit's `active_context_digest`, which stays a digest of the *contract* prompt.

- **On "metrics stage states"** (acceptance criterion 3's parenthetical): the
  decision surfaces in the dev-preview work plan, not in metrics. Evolution writes
  no per-unit lifecycle rows yet — the tracer's only durable metrics effect is the
  measured no-op's `success/no_change` row, and real metrics wiring is 4.8. The
  `"copied"` generation stage state in `src/metrics/lifecycle-store.ts` is still
  reserved and unused for the same reason.

## Living demo — as delivered

Run live on the homepage dev tracer (port 3030) against `experiment_journal`
with the intent *"The tags are no longer useful — hide them from each
experiment."* — the hide-then-evolve scenario. The `candidate-preview` streamed
into the developer panel carries, per regenerated unit, whether prior source was
admitted and why not:

```json
"priorSource": [
  { "unit": "create", "admitted": false,
    "reason": "it names a field the candidate has made inactive: tags" },
  { "unit": "read",   "admitted": true },
  { "unit": "update", "admitted": false,
    "reason": "it names a field the candidate has made inactive: tags" },
  { "unit": "delete", "admitted": true },
  { "unit": "search", "admitted": false,
    "reason": "it names a field the candidate has made inactive: tags" },
  { "unit": "item",   "admitted": false,
    "reason": "it no longer satisfies the unit contract — The item renderer reads fields not declared by ui_intent.item.shows: tags." }
]
```

The four units whose committed source wrote, matched, or rendered `tags`
regenerated from the candidate contract alone; `read` and `delete` never named a
field, so their bytes were handed back. The decisions were already complete in
the first `assembly.status: "running"` payload, before any unit was written, and
the Gate over the assembled snapshot came back `structural passed, smoke passed,
behavioral skipped, design-lint passed`. Nothing durable changed: no DDL, no
version bump, no publication.

## Verification record

Verified 2026-07-26 (America/Bogota):

- `bun run typecheck` and `bun run lint`: clean.
- `bun test src/builder src/pipeline src/app`: **394 pass / 0 fail** (macOS, no
  container needed). New/updated coverage:
  - `src/builder/units/prior-source-admissibility.test.ts` (new, 16 tests): clean
    source admitted verbatim; a now-hidden field rejected whether it is read, named
    in a comment, or named in an error-marker attribute; whole-token matching not
    misfiring on derived identifiers; an *active* field named outside an Action's
    own field list still admitted; a dependency the Action no longer declares
    rejected, including one surviving only in a comment or a dead SQL constant; a
    declared dependency's active data admitted while its inactive data is rejected;
    import / raw HTTP / raw mutation SQL / direct connection access each rejected;
    the item renderer rejected for reading a field outside `item.shows`, for
    importing, and for an export shape that cannot be analyzed; the prompt carrying
    admitted source, staying byte-identical to a fresh unit's prompt without it, and
    keeping the retry's failure feedback last; and the `generateCapabilityUnit`
    backstop dropping inadmissible source before the prompt is built.
  - `src/pipeline/evolution/evolution-assembly.test.ts`: a new-field evolution
    admits all three regenerated units and their committed source appears in the
    prompts; a direction-only change regenerates `item` and records it last, in
    canonical unit order; the hide-then-evolve scenario withholds `create` and
    `update` with a reason naming the hidden field and **no byte** of their
    committed source (nor the field name) reaches any prompt; and every unit in
    `regeneratedUnits` has a decision, including after a Gate repair.
  - `src/app/app.evolution-candidate.test.ts`: `assembly.priorSource` reaches the
    developer panel in both the `running` plan and the terminal summary.
- Live end-to-end round-trips on the running dev server (port 3030) — see "Living
  demo — as delivered": the real AI authored the hide candidate, four units were
  withheld with reasons, two admitted, and the Gate cleared the assembled snapshot;
  the additive contrast (`coffee_tasting_diary`, *"Add an optional grind size"*)
  admitted all three regenerated units. Re-run after the review fixes below.
- One adversarial review round (SOTA model). Fixed from it: the contract field set
  was too strict (see the active-fields note above — the highest-impact finding);
  the `cap_*` table sweep over raw bytes; the item renderer's export-shape check
  restored ahead of its field-access check, which silently passes an export shape it
  cannot analyze; a Gate-repaired copied unit now gets a decision row; the
  prior-source prompt header no longer implies the behavior it implements is still
  current. Knowingly not fixed: obfuscated field references
  (`values["legacy_note"]`) defeat the raw-text scan — no generator emits that,
  and the AST checks cover the reachable shapes; and the design-lint rung quotes a
  rejected unit's *rendered markup* into its own repair prompt, which is the Gate's
  failure feedback over bytes it was handed, not prior source entering a
  regeneration prompt (both repair rungs use `generateUnitContent`, which has no
  prior-source parameter at all). Both are recorded in the module docstring.
- Not covered by a test, and honestly so: the `"its committed source is
  unreadable"` branch is unreachable through the public surface (the snapshot is
  hash-verified before it is read), and a Gate repair reclassifying a *copied* unit
  cannot be constructed either — publication refuses to write units that do not
  match the bytes the Gate cleared. Both stay as fail-safe code, and the invariant
  that every written unit has a decision is asserted where it is observable.

## HITL test instructions

1. Start the app with `bun run dev` (or reuse the server on port 3030), then open
   `http://localhost:3030/`.
2. Click **Experiment journal** in the left toolbar, then open the developer panel
   with the `</>` icon.
3. In the **Evolution candidate** block, type a *hide* intent — e.g.
   `The tags are no longer useful — hide them from each experiment` — and select
   **Trace candidate**.
4. The moment the Diff resolves, the **Evolution candidate** block shows
   `assembly.status: "running"` with `priorSource` **already complete**: the
   admit/withhold decision per regenerated unit is deterministic, so it is known
   before the first unit is written.
5. Confirm the terminal preview (`#spec-candidate-preview`,
   `assembly.status: "complete"`) shows `priorSource` with:
   - `create`, `update`, `search` and `item` `admitted: false`, each with a
     `reason` naming `tags` — their committed source named the field the candidate
     hides, so they regenerated from the contract alone;
   - `read` and `delete` `admitted: true` — they never named the hidden field.
6. Contrast with an additive intent — e.g.
   `Add an optional grind size to each coffee` against **Coffee tasting diary**.
   Adding a field takes nothing away, so every regenerated unit shows
   `admitted: true` and its old source is fed back as reference.
   The View is restored and the version is unchanged either way — publication and
   activation are 4.6/05.
7. Deterministic proof (runs anywhere, no container needed):
   `bun test src/builder/units/prior-source-admissibility.test.ts src/pipeline/evolution/evolution-assembly.test.ts src/app/app.evolution-candidate.test.ts`
