# Frozen-intent generation latency and progress

Status: ready-for-human

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.7 — Evolution Gate
and frozen-intent repair

## Problem

Tier-on evolution currently authors every changed Action suite serially before the
first Handler byte. Five cache misses therefore make wall time the sum of five
provider calls, and the foreground stream reports no per-Action progress during
that interval. A healthy build can look stalled for more than a minute.

Incidental candidate rewrites of the capability-wide free-text `behavior` make
this worst case common: because `behavior` is conservatively an input to every
Action, a schema or presentation request can unnecessarily invalidate all five
suites. The terminal Gate preview then embeds the complete frozen artifact,
burying the much smaller repair evidence in a large JSON payload.

## What to build

- Preserve the frozen-before-Handler and closed per-Action input guarantees.
- Generate independent Action cache misses with bounded concurrency while
  returning, measuring, and publishing results in canonical Action order.
- Stop scheduling untouched Actions after a concurrent generation failure; fail
  closed after already-started work settles.
- Stream canonical per-Action `pending | generating | generated | carried`
  progress through a dedicated, compact behavioral-intent preview before units
  begin.
- Make candidate authoring preserve `behavior` and `prompt_context` byte-for-byte
  for schema/presentation-only intent; only explicit semantic/purpose changes may
  rewrite them.
- Project a compact, repair-first behavioral Gate preview. Keep full frozen test
  bytes in the issued Gate result and immutable snapshot, not in the primary
  developer-panel payload.

## Acceptance criteria

- [x] At most two behavioral-suite provider calls run concurrently.
- [x] Five cache misses complete in three bounded waves rather than five serial
      waves, without combining Action prompt contexts.
- [x] Carried and generated suites, usage, reports, and the published artifact
      retain canonical Action order regardless of completion order.
- [x] A failed Action starts no later pending Action after failure is known.
- [x] The behavioral-intent preview visibly updates throughout the pre-unit freeze and never
      exposes test fixture bytes.
- [x] Every suite is admitted and frozen before Handler generation still begins.
- [x] Candidate authoring explicitly keeps schema/UI changes out of global
      `behavior` and capability-purpose changes out of `prompt_context`.
- [x] Gate preview exposes test-generation/execution counts and repair evidence
      without embedding `setupRows` or complete frozen cases.
- [x] Focused tests, full tests, typecheck, lint, build, and diff checks pass.

## Living demo

Evolve a tier-on capability with an optional non-searchable date and a
presentation direction. The candidate preview should update per Action while
intent freezes; only `create` and `update` should generate when semantic
`behavior` remains unchanged. Unit generation starts only after the freeze is
complete. The Gate panel should lead with generation counts and guided-repair
evidence rather than the full frozen fixture artifact.

## Blocked by

- None.

## Implementation notes

**Independent calls now run in bounded waves.** The freeze stage first computes
every Action's canonical digest and re-admits possible carries. Only cache misses
enter a two-worker scheduler. Provider calls remain isolated to one Action's
closed inputs, while result bytes, reports, and usage settle back into canonical
`create`, `read`, `update`, `delete`, `search` order. A known failure stops new
work from starting; an already-started sibling settles before the typed
generation failure escapes.

**The pre-unit wait is visible without exposing intent bytes.** Evolution streams
a dedicated `behavioral-tests-preview` containing only Action, digest, case
count, and `pending | generating | generated | carried` state. The preview
remains `running` even after the last provider response and becomes `complete`
only after the aggregate frozen artifact passes platform admission. Unit events
still cannot precede that complete freeze.

**Candidate authoring no longer treats presentation as behavior.** The candidate
prompt now defines `behavior` as semantic Action contract rather than field
inventory, preserves it for schema/presentation-only changes, routes visual
direction to `ui_intent`, and likewise preserves `prompt_context` unless the
capability's purpose changes. This is the strongest safe immediate boundary
while the explicit demo still supplies unstructured intent; deterministic
change authorization remains Epic 4.8/structured-intent work.

**Gate output is summary-first.** The developer Gate preview retains generation
metrics, execution scope, repair attempts, Action/case counts, and the durable
`tests/behavioral.json` artifact location. Complete fixtures remain in the
issued Gate result and immutable snapshot but are no longer duplicated into the
primary panel payload.

Architecture and Module 4 documentation now state that isolated Action
authorship may run concurrently while the complete artifact remains a hard
pre-Handler barrier.

## Verification

- `bun test src/builder/gate/behavioral/behavioral-test-freeze.test.ts
  src/pipeline/evolution/evolution-run.test.ts
  src/app/app.evolution-streaming.test.ts src/app/app.build-jobs.test.ts
  src/app/app.test.ts src/pipeline/streaming/previews.test.ts
  src/app/app.spec-build.test.ts` — **63 passed, 0 failed**
- `bun test` — clean
- `bun run typecheck` — clean
- `bun run lint` — clean across 271 files
- `bun run build` — clean
- `git diff --check` — clean
- Existing user-owned `http://localhost:3030/` serves the new
  **Behavioral intent** panel target; `GET /capability/experiment_journal`
  returns HTTP 200. No provider call or live evolution was initiated by
  automated verification.

## HITL test instructions

> **Current surface after Epic 4.8:** the temporary **Evolve this capability**
> form and **Show me the guided repair** checkbox were retired once the prompt
> bar became the single evolution entrance. Use the prompt bar for the live
> progress check; the deliberate repair case now lives in the deterministic
> frozen-repair battery below.

1. Keep the existing server on port 3030, or start it with:

   ```bash
   bun run dev
   ```

2. Open an existing tier-on capability from `http://localhost:3030/` and expand
   the developer panel.
3. In the prompt bar, request a narrow non-text addition, for example: “Add an
   optional confidence score and make it stand out.”
4. Confirm **Behavioral intent** appears before Units, updates while work runs,
   shows no fixture rows, and reaches `complete` before the first unit starts.
   With unchanged semantic `behavior`, `create` and `update` should generate
   together while `read`, `delete`, and `search` carry.
5. Confirm the Gate panel is compact: it shows test generation/execution counts,
   repair status, and `tests/behavioral.json`, but no `setupRows`.
6. Run `bun test src/pipeline/evolution/evolution-frozen-repair.test.ts` for the
   repair story. Confirm it proves the frozen failing case, `update`
   attribution, bounded repair against the same case, and final activation; no
   production composition root can inject the deliberately weak first pass.
