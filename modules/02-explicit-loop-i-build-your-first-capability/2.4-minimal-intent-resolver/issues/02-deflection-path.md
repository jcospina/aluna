# Deflection path

Status: done

## Epic

Module 2 — Explicit Loop I: Build Your First Capability · Epic 2.4 — Minimal
intent resolver (`docs/modules.md` §2.4, PLAN decision 6 & flow step 2:
`modules/02-explicit-loop-i-build-your-first-capability/PLAN.md`, CONTEXT.md
"Product voice")

## What to build

Wire the resolver in front of the builder, inside the build job, and handle
everything M2 doesn't act on with warmth instead of failure.

- **Classification runs inside the job** (ADR-0002 update): `POST /prompt`
  returns instantly; the resolver call happens on the job's clock and its
  outcome is narrated over the per-build stream.
- **`new_capability` proceeds** into the build pipeline.
- **Everything else deflects**: a warm, product-voice message streamed over the
  same per-build channel, then `done` — nothing built, nothing migrated,
  nothing registered. The deflection should feel like Aluna gently redirecting,
  not erroring (e.g. an `extend_capability` ask gets a friendly "soon" — exact
  copy is product voice, no internals vocabulary, distinct per intent family
  where natural).
- **Duplicates fall out free** (PLAN decision 6): "track my notes" when Notes
  exists classifies as `extend_capability` → deflected. No collision logic, no
  auto-suffixed ids.
- **Every classification is logged to metrics** — acted on or deflected — so
  intent-distribution data accrues from day one and M4/M5 inherit a contract
  that never changes shape, only which intents proceed.

## Acceptance criteria

- [x] Non-`new_capability` intents stream a warm deflection and close with
      `done`; no registry row, no migration, no artifacts
- [x] Deflection copy is product voice — no internals vocabulary anywhere
- [x] Every classification writes a metrics row including the intent type
      (deflections included)
- [x] The duplicate ask ("track my notes" while Notes exists) deflects via
      `extend_capability` classification
- [x] The POST never blocks on the AI call — classification is observable only
      through the job's stream
- [x] Tests with a fake provider cover proceed and deflect paths; no test calls
      a real provider

## Blocked by

- modules/02-explicit-loop-i-build-your-first-capability/2.4-minimal-intent-resolver/issues/01-full-enum-intent-classification.md
- modules/02-explicit-loop-i-build-your-first-capability/2.5-capability-builder-and-build-queue/issues/01-build-job-single-flight-queue-and-busy-refusal.md
- modules/02-explicit-loop-i-build-your-first-capability/2.7-metrics-writing/issues/01-metrics-table-and-writer.md

## Comments

**2026-06-25 - implemented.** Wired the full-enum resolver into the default
build-job pipeline in `src/app.ts`. `POST /prompt` still only admits a job and
returns the per-build stream subscriber; `GET /build/:id/stream` now calls the
provider to classify, records the classification in generation metrics, and only
continues into the builder for `new_capability`.

- Non-`new_capability` classifications now write a `deflected` metrics row keyed
  by the build job id, stream one deterministic product-voice deflection line,
  and let the queue close with `done`. They return before migration, unit
  generation, gate, commit, registry writes, or artifact writes.
- `new_capability` jobs reuse the existing builder stages and metrics
  accumulator, including the classification call's token usage in the one
  success/failure metrics row.
- The homepage demo now submits the prompt bar through `POST /prompt` and opens
  the returned per-build stream instead of bypassing the queue through
  `/demo/spec-build`, so the resolver/deflection path is exercised from `/`.
- `src/intent-resolver/resolver.ts` keeps `classifyIntent()` stable and adds
  `classifyIntentWithUsage()` for job metrics.
- `src/app.test.ts` adds fake-provider coverage for the proceed path, a
  `data_query` deflection, and the duplicate `"track my notes"` overlap case
  with Notes already in the registry.

**Verification:**

- `bun test src/app.test.ts`
- `bun test src/intent-resolver/resolver.test.ts`
- `bun test`
- `bun run typecheck`
- `bunx biome check src/app.ts src/app.test.ts src/intent-resolver/resolver.ts src/intent-resolver/index.ts public/app.js public/app.css public/index.html`
- `git diff --check`

## HITL test instructions

1. Start the app with a real provider key: `OMNI_API_KEY=... bun run dev`
2. Open `http://localhost:3030/`
3. If your local `data/omni-crud.db` does not already have Notes, submit:
   `I want to keep track of my notes` and wait for the build to finish.
4. Submit the duplicate prompt: `track my notes`.
5. Confirm the visible behavior: the prompt returns immediately, the stream shows
   one warm "already started / soon" style deflection, no migration/unit/gate
   previews appear, and the stream closes cleanly.
6. Confirm the metrics row:
   `bun -e 'import {Database} from "bun:sqlite"; const d=new Database("data/omni-crud.db",{readonly:true}); console.log(d.query("SELECT id, outcome, intent_type, intent_target_capability FROM generation_metrics ORDER BY created_at DESC LIMIT 1").get());'`
   Expect `outcome: "deflected"`, `intent_type: "extend_capability"`, and
   `intent_target_capability: "notes"`.

**2026-06-25 - follow-up fix.** A real reload/reuse test showed the provider can
still classify the same prompt as `new_capability`; the builder then ran spec,
DDL, units, and gate before commit collided with the existing registry row. Added
a deterministic registry-overlap guard inside the build job before provider
construction/classification, plus the same guard after classification as a
fallback. If the prompt matches an existing capability's id, label, or prompt
context, the job converts it to an `extend_capability` deflection, writes a
`deflected` metrics row, and skips the provider call, spec generation, migration,
unit generation, gate, commit, registry writes, and artifact writes.

**Follow-up verification:**

- `bun test src/app.test.ts -t "existing registry row deflects"`
- `bun test src/app.test.ts -t "resolver-driven default pipeline"`
- `bun run typecheck`
- `bunx biome check src/app.ts src/app.test.ts`
- `git diff --check`

**2026-06-25 - robustness tightening.** The provider contract has no model-side
tool-calling slot yet; it is one structured `generate(prompt, schema)` call. The
platform already owns the equivalent capability-listing tool (`listCapabilities`)
and the resolver calls it before the provider. Tightened the resolver prompt so
registry inspection is a mandatory first decision step: compare the prompt to
every existing capability's id, label, and prompt context; choose
`extend_capability` when the request clearly targets, reuses, or evolves an
existing capability's own subject; choose `new_capability` for a distinct kind of
thing with its own natural structure.

**2026-06-25 - overspecialization tightening.** A recipes prompt with
`personal_notes` already in the registry showed the resolver can over-apply an
existing generic text-like capability. Tightened the resolver prompt again:
`extend_capability` is only for the same subject evolving; a distinct real-world
thing with its own natural structure (recipes with ingredients/steps/cuisine) is
`new_capability`, even if Notes could hold it loosely. Kept examples for the
intended boundary: recipes are new when only Notes exists; due dates on notes and
notes with images are extensions. Narrowed the deterministic duplicate guard so a
single prompt-context field word is not enough to preempt the resolver.
