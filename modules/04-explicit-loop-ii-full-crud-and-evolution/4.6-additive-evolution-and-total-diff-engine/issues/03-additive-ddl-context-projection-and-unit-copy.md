# Additive DDL, per-unit context projection, and positively-unaffected copy

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.6 — Additive
evolution and the total Diff Engine
(PLAN decisions 21, 2, 12 (ABI) + matrix columns:
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`; ADR-0006)

## What to build

Turn unioned change facts into executed work:

- **Additive DDL.** A new active field derives a nullable `ADD COLUMN`;
  hide/reactivate performs no destructive DDL (reactivation reuses the original
  column and stored values); existing field types never change in place.
  Platform form/detail/registry/toolbar work follows each fact's matrix
  column.
- **Context projection.** The same matrix projects each unit's generation
  context, so copied units were never exposed to changed facts they are
  claimed not to depend on. Regenerated units receive their Action-projected
  change context; new Handler/test generation sees only each dependency's
  active projection.
- **Copy.** Positively-unaffected units byte-copy into the staging directory
  without entering model context, carrying their original
  dependency-generation provenance forward; regenerated units get fresh
  provenance. Copied units remain governed by the matrix plus their committed
  compatibility contract.
- Full structural + adversarial CRUD/search smoke runs over the **assembled**
  snapshot (copied + regenerated) regardless of which units regenerated;
  design lint runs whenever `item` regenerates.

## Acceptance criteria

- [x] New-active-field fact produces exactly a nullable `ADD COLUMN` plus the
      matrix's unit selection (`create`, `update`, `search` for text/list,
      item via separate `item.shows` fact); historical rows read back `null`
- [x] Hide/reactivate: no destructive DDL; reactivated field restores original
      column values
- [x] Copied units are byte-identical, never entered model context (pinned by
      provider-call assertion), and carry provenance forward; regenerated
      units refresh provenance
- [x] Provenance alone changes no equality/Diff/cascade outcome (plan
      acceptance: audit-only)
- [x] Smoke + design lint run over every assembled snapshot per the rule above
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Through the dev tracer: evolve a live capability with a new field — the demo
shows the added column rendering as the platform empty value on historical
records, with unchanged Handlers visibly copied (work plan in the dev preview).

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.6-additive-evolution-and-total-diff-engine/issues/02-typed-change-facts-total-matrix-and-canonical-noop.md

## Implementation notes

- **Scope boundary — the assembler stops at a Gate-cleared candidate.** This
  issue consumes the 4.6/02 work plan to *assemble* the executed work; it
  performs no publication, DDL application, activation, version bump, or View
  swap. Publication → atomic activation → the single homepage View swap are
  4.6/05's exclusive scope; admissibility-gated prior source into regeneration
  prompts is 4.6/04. The assembler deliberately regenerates *without* prior
  source until 4.6/04 proves it admissible.

- **Additive DDL is platform-derived and additive-only.**
  `deriveAdditiveCapabilityMigration(committed, candidate)`
  (`src/capability-data/ddl.ts`) emits one nullable
  `ALTER TABLE "cap_<id>" ADD COLUMN <columnDefinition>` per genuinely new
  field (reusing the same `columnDefinition`/`SQLITE_TYPE_BY_FIELD_TYPE` as
  `CREATE TABLE`; no `NOT NULL`, so every historical row reads the column back
  as `null` with no backfill). Hide/reactivate and label/required changes touch
  no columns — a soft-hidden column is never dropped, so reactivation reuses the
  original column and its stored values. It fails closed if a committed column
  is missing or re-typed rather than ever emitting a destructive statement.

- **Per-unit regeneration vs. byte-copy.** `assembleEvolutionCandidate(...)`
  (`src/pipeline/evolution-assembly.ts`) walks the six units in canonical
  snapshot order and, for each, either regenerates it (when
  `diff.workPlan.regeneratedUnits` selects it) through the new public
  `generateCapabilityUnit(...)` (`src/builder/units.ts`, the same bounded
  write→check→fix loop a v1 build uses) or byte-copies it verbatim from the
  committed on-disk snapshot. Copied units never enter a generation prompt.
  Context projection is inherited from the existing per-unit prompt builder,
  which shows a regenerated unit only the candidate's **active** field
  projection and each dependency's active schema — so a copied unit is never
  exposed to the change, and a regenerated unit never sees an inactive field.

- **Provenance carry-forward / refresh (audit-only).** Provenance moved into a
  new `src/builder/artifact-provenance.ts` (keeping `artifact-lifecycle.ts`
  under the 500-line ceiling) with the schemas plus two builders:
  `unitProvenance` (the fresh v1 path) and `evolutionUnitProvenance` — a
  regenerated unit gets a fresh `active_context_digest`; a byte-copied unit
  carries its committed provenance forward verbatim. It is never a candidate
  equality, Diff, or cascade input: the copy/regenerate selection is decided by
  the Diff work plan and provenance is computed afterward.

- **Gate over the assembled snapshot.** The assembler runs `runCapabilityGate`
  over the assembled (copied + regenerated) units with the candidate's full
  `deriveCapabilityTableDdl`, so structural + the frozen adversarial CRUD/search
  smoke exercise the complete snapshot regardless of which units regenerated.
  The matrix's `gate.designLint` flag reflects item regeneration; the Gate's
  own design-lint rung stays always-on but is a no-op review over a clean copied
  item, so the copied item stays byte-identical. Gate repairs fold back through
  the shared `applyGateFixes`. Behavioral-tier evolution is 4.6/05; this runs
  tier off.

- **The assembly streams (follow-up, 2026-07-24).** HITL found the trace felt
  hung: the assembly is the long half of a trace (three live regenerations plus
  the Gate) and it emitted nothing on the wire until the terminal payload. No
  wasted work was found — the Gate's happy path makes zero model calls
  (structural is in-process `tsc`, smoke is deterministic execution, design lint
  only calls the provider when it *rejects*), so the wall clock is real
  generation. It now streams like a v1 build: `assembleEvolutionCandidate` takes
  an `observer` plus a `progress` hook set (`onPlanned` / `onUnitCopied` /
  `onGateStart` / `onUnitsFinalized`), and the tracer wires them to SSE. The
  derived plan — the `ADD COLUMN` and the copy/regenerate split — is known before
  the first model call, so it lands in the Evolution candidate block immediately
  as `assembly.status: "running"`; the regenerated units then assemble in the
  Units block (copied units join it already complete) and the Gate verdict lands
  in the Gate block, before the terminal `complete` summary. The live units view
  itself moved to a shared `src/pipeline/unit-preview-stream.ts` so a v1 build and
  an evolution cannot drift.

- **Hardening found by the adversarial pass.** A Gate repair rewrites bytes the
  panel already showed as final, so the reconciled inventory is re-sent
  (`onUnitsFinalized`), and `regeneratedUnits`/`copiedUnits`/provenance are now
  settled against the **final bytes** rather than the work plan — a unit the Gate
  repaired is reported as written, so "copied" stays a true byte claim (reported in
  the Diff's canonical `GENERATED_UNITS` order, so the running plan and the
  reconciled result never disagree about where `item` sits). A trace that does not
  finish its assembly closes its running plan out — `assembly.status: "cancelled"`
  when the developer stopped it, `"failed"` otherwise — instead of leaving the panel
  showing work nobody is doing; because the Gate itself is not abortable, that
  close-out also runs on the path where a cancel arrives mid-Gate and the assembly
  still resolves. The assembler takes `isAborted` and checks it between units and before
  the Gate, so a cancelled copy-only evolution no longer runs the whole Gate under
  a lease nobody is waiting on. Unit generation no longer sees the evolving
  capability in its own dependency catalog. `previewingProvider` returns
  `flushPreviews()` instead of a `settled` promise, so a stage that throws before
  reaching the provider can no longer strand the build lease on an unsettleable
  await. `makeSequenceProvider` now throws when exhausted instead of replaying its
  last response, which is what makes the copy-is-proof assertions proof.

- **Dev tracer wiring.** The tracer runs the assembler on a real (non-no-op)
  change (`src/pipeline/evolution-candidate-tracer.ts`) and surfaces an
  `EvolutionAssemblySummary` — regenerated vs. copied units, the additive DDL,
  and the Gate verdict — in the accepted `candidate-preview`
  (`src/pipeline/previews.ts`, `src/evolution-candidate-routes.ts`). Still no
  durable effect: no metrics row, no version bump, no `commit`.

## Living demo — as delivered

Run live on the homepage dev tracer against `coffee_tasting_diary` with the
intent *"Add an optional grind size to each coffee."* The accepted
`candidate-preview` streamed into the developer panel now carries the executed
work:

- `assembly.additiveMigration`:
  `["ALTER TABLE \"cap_coffee_tasting_diary\" ADD COLUMN \"grind_size\" TEXT;"]`
  — the nullable added column.
- `assembly.regeneratedUnits`: `["create","update","search"]`; the unchanged
  Handlers are visibly copied — `assembly.copiedUnits`:
  `["item","read","delete"]`.
- `assembly.gate`: `structural passed, smoke passed, behavioral skipped,
  design-lint passed` — the full-CRUD/search smoke ran over the assembled
  snapshot (proving the new nullable column renders as the platform empty value
  for records without it). The committed capability is unchanged: no version
  bump, no DDL applied.

## Verification record

Follow-up round, 2026-07-24 (the streamed assembly + the hardening above):

- `bun run typecheck` and `bun run lint`: clean.
- Two new pure suites run on any platform and are green locally:
  `src/pipeline/unit-preview-stream.test.ts` (lifecycle sends vs. throttled
  partials, a recorded copy landing complete, an aborted stream going quiet) and
  `src/pipeline/previewing-provider.test.ts` (the drain resolves even when the
  stage never reached the provider — the lease-stranding hazard).
- New container-only coverage: the assembly-liveness suite in
  `src/pipeline/evolution-assembly.test.ts` (the plan reported with zero model
  calls spent, the copy/regenerate/Gate ordering, the reconciled inventory after
  a Gate repair, and a cancel stopping before the Gate) and two route tests in
  `src/app.evolution-candidate.test.ts` (the full streamed sequence, a failed
  assembly closing out its running plan, and a cancel mid-assembly closing it out
  as `cancelled` with the Gate never run).
- Two adversarial review rounds (SOTA model) over the change; every finding fixed,
  including four the second round raised against the first round's fixes.

Original round, verified 2026-07-24 (America/Bogota):

- `bun run typecheck` and `bun run lint`: clean.
- Full ALUNA suite green (run by the maintainer): **773 pass / 0 fail**. This
  includes the three new/updated suites (local `bun test` segfaults on the
  pre-existing SQLite-FFI Bun bug for any smoke-loading suite):
  `src/capability-data/ddl.test.ts` (additive `ADD COLUMN`, historical-null
  readback, no-DDL + value-preserving hide/reactivate, fail-closed drop/retype
  guard), `src/pipeline/evolution-assembly.test.ts` (byte-copy identity +
  provider-call assertion that copies never entered model context,
  active-projection of regenerated units, provenance carry/refresh,
  structural+smoke over the assembled snapshot), and
  `src/app.evolution-candidate.test.ts` (the accepted route now surfaces the
  assembly summary while nothing durable changes). The provenance extraction
  keeps the `snapshot.json`/publish surface byte-identical, so no existing
  suite regressed.
- Live end-to-end round-trip on the running dev server (port 3030) against
  `coffee_tasting_diary` — see "Living demo — as delivered": the real AI
  authored the candidate, the assembler copied item/read/delete from disk,
  regenerated create/update/search, derived the `ADD COLUMN`, and cleared the
  Gate over the assembled snapshot.

## HITL test instructions

1. Start the app with `bun run dev` (or reuse the server on port 3030), then
   open `http://localhost:3030/`.
2. Click a capability in the left toolbar (e.g. **Coffee tasting diary**), then
   open the developer panel with the `</>` icon.
3. In the **Evolution candidate** block, type a new-field change — e.g.
   `Add an optional grind size to each coffee` — and select **Trace candidate**.
4. Watch it stream rather than waiting for one payload. Within a second of the
   Diff resolving, the **Evolution candidate** block shows
   `assembly.status: "running"` with the `ADD COLUMN` and the
   regenerated/copied split already filled in; the **Units** block then fills as
   `create`/`update`/`search` are written (with `item`/`read`/`delete` already
   complete — the copies), and the **Gate** block lands its verdict last.
5. Confirm the **Evolution candidate** preview (`#spec-candidate-preview`) ends
   at `assembly.status: "complete"` with:
   - `additiveMigration` with a single nullable `ADD COLUMN` for the new field;
   - `regeneratedUnits` = `create`/`update`/`search` and `copiedUnits` =
     `item`/`read`/`delete` (the unchanged Handlers copied, not regenerated);
   - `gate` = `structural: passed`, `smoke: passed` (the full-CRUD/search smoke
     ran over the assembled snapshot).
   The View is restored and the capability's version is unchanged — this issue
   assembles and gates the candidate but does not publish or activate it (that
   is 4.6/05).
6. Optional: press **Cancel** mid-assembly. The running plan closes out as
   `assembly.status: "cancelled"` rather than sitting at `running` forever, and the
   work stops instead of finishing the Gate.
7. Deterministic proof of the additive DDL, the copy/regenerate/provenance
   split, the Gate over the assembled snapshot, and the streamed liveness: run
   `bun test src/capability-data/ddl.test.ts src/pipeline/evolution-assembly.test.ts src/app.evolution-candidate.test.ts`
   in the Linux container (the smoke rung segfaults `bun test` on macOS). The
   two pure suites run anywhere:
   `bun test src/pipeline/unit-preview-stream.test.ts src/pipeline/previewing-provider.test.ts`.
