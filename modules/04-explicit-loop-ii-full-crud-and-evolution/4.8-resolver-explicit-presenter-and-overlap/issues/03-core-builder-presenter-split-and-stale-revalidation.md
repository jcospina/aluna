# Core Builder / explicit presenter split and stale revalidation

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.8 — Resolver,
explicit presenter, active context, and overlap
(PLAN decisions 31 and 28 (stale rows):
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`; ADR-0002;
ADR-0006)

## What to build

Explicit-loop foreground presentation becomes an adapter over a reusable core
Builder — the seam Module 7's implicit loop will consume.

- The core Builder accepts an already-resolved build request and emits
  lifecycle events without owning the prompt route, active DOM, or SSE.
  Existing-capability work binds exact
  `{ capability_id, incarnation_id, expected_version }`; new-capability work
  binds the proposed semantic id plus an expected-absent condition. Both also
  bind the resolver's active-catalog revision/fingerprint.
- The coordinator revalidates target and catalog after active lease
  acquisition. A target, expected-absence, or catalog mismatch fails **stale**
  — never silently rebased, retargeted, or reclassified against a newer
  catalog, and it starts no provider work. While ownership is held, it writes
  one direct terminal admission row with
  `lifecycle_status=failed, outcome=stale` and all generation stages skipped;
  its incarnation is the expected incarnation for evolution, nullable only for
  a new-capability stale refusal before incarnation assignment.
- The M2–M4 explicit adapter resolves a typed prompt, occupies the active
  content area, and narrates the foreground product-voice story, emitting one
  View `commit`. Module 7 may hand an already-resolved confirmed proposal to
  the same Builder without reclassification and choose a different presenter;
  mutation, staging, Gate, activation, and metrics remain identical. Document
  the reuse seam.

## Acceptance criteria

- [x] The core Builder is invocable without the SSE presenter (test-driven
      with a fake presenter), producing identical mutation/Gate/activation
      behavior — both halves: a full evolution and a full new-capability v1
      (`core-builder.test.ts`)
- [x] Plan acceptance: stale target/collision/catalog-fingerprint refusal
      starts no provider work and writes the durable direct `failed/stale` row
      with the specified incarnation semantics
- [x] Expected-version mismatch never reaches the canonical no-op comparison
      (distinct `failed/stale` vs `success/no_change`) — both rows now covered
      end to end through the seam
- [x] A concurrent registry change between resolution and lease head produces
      the stale refusal and a warm foreground story with canonical View
      restoration (`app.stale-refusal.test.ts`, over the real HTTP + SSE surface)
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Race two prompts against the same capability from two tabs: the second's build
fails stale with a warm story and restored View, and the dev metrics preview
shows its direct `failed/stale` row with stages skipped.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.8-resolver-explicit-presenter-and-overlap/issues/01-non-mutating-prompt-job-and-resolver-separation.md

## What landed

- `src/pipeline/build/core-builder.ts` (new) — the seam. Owns the ticket, the
  exclusive lease, lease-head revalidation, the admission row, and the run. Emits
  one terminal lifecycle event into a `CoreBuilderPresenter`; `emitOnce` makes the
  "exactly one terminal" promise structural.
- `src/pipeline/build/explicit-presenter.ts` (new) — the M2–M4 adapter.
- `src/pipeline/build/resolved-request.ts` — now carries both target bindings:
  exact `{capability_id, incarnation_id, expected_version}` for evolution, and the
  proposed semantic id beside the expected-absent condition for a new capability.
- `src/pipeline/build/prompt-pipeline.ts` — reduced to resolution + hand-off.
  `evolution-pipeline.ts` folded into the core Builder and deleted.
- `src/metrics/lifecycle-store.ts` — `writeStaleGenerationAdmission` writes the
  direct terminal row. An absent incarnation is stored as `''` and translated at
  the access layer (user-chosen over a table rebuild, to keep the additive-only
  migration invariant intact); the row schema permits null only for `stale`.
- Reuse seam documented in `CONTEXT.md`, the `core-builder.ts` header, and the
  pipeline barrel.

## Adversarial findings fixed — first pass

1. Cancelling a **queued** build presented the failure apology and leaked
   `MutationReservationCancelledError` to the dev panel. Both reviewers proved
   this as a regression. Fixed in `runCoreBuild`'s catch (classify the abort) and
   `presentFailed` (mirror the evolution presenter's `isAborted` branch).
   Regression test: "cancelling a queued build is a cancellation, not a failure".
2. `metrics-preview` was emitted as the literal string `null`, blanking the dev
   panel. The presenter now sends nothing when there is no durable row.
3. A terminal reached after `recordMetrics.start` could be filed with no
   incarnation, stranding the `running` row. One catch now owns closing the row.
4. `refuseStaleAdmission` sat outside the try, so a store failure was presented
   after the lease released. Moved inside.
5. `terminalPresenterTimeoutMs` was ignored on every evolution terminal. Threaded
   through `ExplicitEvolutionPresentation`.

## Adversarial findings fixed — second pass

- **Finding 3:** `no_change` had no coverage through the seam (only through the
  demo route issue 04 deletes). Added: a semantically identical candidate now
  drives `success/no_change` end to end through `runCoreBuild`, asserting the two
  columns that separate it from a refusal — a `generated` stage and real token
  spend.
- **Finding 9:** `GenerationFailureOutcome` admitted `"stale"`, so a build that
  had done real work could finalize its running row as one that never started.
  Now excluded at the type level; only `writeStaleGenerationAdmission` can reach
  the outcome. The zod enum and the 0008 CHECK still permit `failed/stale` for
  that direct insert.
- **Finding 10:** an `expected_absent_collision` row was filed under the
  *colliding* capability's id, charging an untouched capability with a refusal it
  had no part in — and with a null incarnation there was no disambiguator to
  correct the reading. A new-capability refusal now files `capability_id` as null,
  exactly as it files its incarnation. The reborn-target case deliberately still
  names its id: that build really did aim at it, and the expected incarnation on
  the row says which one it meant. Both are pinned by assertions.
- **Finding 8:** the evolution engine started its own clock, silently dropping the
  resolution and queue wait a v1 build has always counted. `RunCapabilityEvolution`
  now accepts the caller's `builtAt`; the demo route passes none and keeps its old
  measurement exactly.
- **Finding 11:** added `resolvedExistingCapabilityRequest` and proposed-id
  coverage, and the admitted **new-capability** path through a fake presenter — a
  real v1 spec, units, Gate, publication and activation with no transport
  anywhere, which is the other half of the seam's acceptance claim.
- **Finding 6 — fixed differently than the review proposed, and this is the
  interesting one.** The review asked for a recovery window sending `done` when a
  terminal delivery times out, mirroring `presentActivated`. That cannot work:
  `sseTransport` serializes every write through one chain, so a write that timed
  out *because the reader stopped consuming* is still at the head of it, and a
  follow-up `done` queues behind the stall and lands never — while costing a
  second bounded window with the exclusive build lease held. It was implemented,
  the second adversarial pass caught it with a serialized-transport fixture, and it
  was reverted. What the non-activating terminals do instead is nothing: they
  changed no product state, so no news is withheld, and the client is closed by its
  own reconnect, which `BuildJobQueue.stream` answers with `done`/`missing` on a
  fresh chain. The reasoning is recorded in `explicit-presenter.ts` so it is not
  re-proposed. The **activated** terminal does keep a second attempt — its version
  is durable and worth announcing late — and gained the `canPresent()` guard its
  evolution counterpart already had, so a departed subscriber no longer costs every
  queued build a full extra window.
- **Test-fixture finding:** the first presenter test modelled `send` as
  independent per-event promises, which made the broken recovery look deliverable.
  `explicit-presenter.test.ts` now mirrors `sseTransport`'s serialized chain, and
  each stall case asserts the presenter returns in well under *two* bounds — the
  signature a second recovery window would leave.

## Deferred, deliberately (user-confirmed)

- **Finding 2 (HIGH) → issue 04.** `src/app/evolution-routes.ts` is a second live
  admission path binding no catalog fingerprint and writing no `failed/stale` row,
  user-reachable via `hx-post="/demo/evolution/:id"` on every capability surface.
  Deleting it is issue 04's entire scope (route, control, CSS, checkbox,
  `handSuppliedEvolutionIntent`, and re-pointing its coverage onto `/prompt`). The
  module acceptance line "no direct/demo admission bypass" is satisfied when 04
  lands; 03's own guarantee holds for every path 03 owns.
- **Finding 4 (MEDIUM) → Module 7.** The seam is real for the terminal only: the
  in-flight liveness sink still carries ADR-0002 SSE event names, a dead sink is
  read as cancellation, and the product-voice narration is authored inside the
  stages. The acceptance criterion — a Builder invocable with no SSE presenter,
  identical mutation/Gate/activation — is met by the terminal seam and proven with
  no transport at all. Widening waits for a second real presenter to shape the
  interface against rather than guessing now. Recorded in `core-builder.ts` and
  `CONTEXT.md` so M7 finds it.
- **Whole-catalog staleness — confirmed intended.** The fingerprint covers every
  active row, so any concurrent registry change refuses a queued build even when it
  touched an unrelated capability. Confirmed as the literal reading of decisions
  28/31: the resolver's answer is a judgment about the whole catalog — ownership,
  overlap, proposed naming — so a catalog that moved invalidates the judgment, not
  merely the target. False refusals under concurrency are the accepted price.
  Recorded in `core-builder.ts` and `CONTEXT.md`.

## Verification

- `bun run test` — **1045 passed, 0 failed** (1034 at the pause).
- `bun run typecheck`, `bun run lint`, `bun run build`, `git diff --check` — clean.
- Each new test verified to fail without its fix (including the activated-recovery
  case, checked by reverting the guard).
- Dev server on :3030 healthy after the change (homepage and capability surfaces
  200; `bun --watch` picked the edits up).

## HITL — validate the living demo

The dev server is already running on **http://localhost:3030**. If it is not:

```bash
bun run dev
```

**The two-tab race.**

1. Open http://localhost:3030 in two browser tabs, side by side.
2. In both tabs, click the same live capability (for example **Contacts**) so both
   have it in the active content area.
3. Type a change prompt into **both** prompt bars — e.g. tab A: `add a company
   field`, tab B: `add a phone number`. Do not submit yet.
4. Submit tab A, then submit tab B within a second or so, while A is still working.

**What confirms the work:**

- Tab A builds normally and ends with its new version swapped into the View.
- Tab B stops without guessing. It shows the warm line — *"That changed while I
  was getting to it, so I stopped rather than guess. Have a look and tell me
  again?"* — and its **own View comes back**, showing the capability as it now
  stands. No error dump, no half-built screen, and nothing about catalogs,
  fingerprints or leases anywhere in the wording.
- Tab B's capability is **unchanged by B** — only A's change landed.
- In tab B's developer panel, the metrics row reads `lifecycle_status=failed`,
  `outcome=stale`, with **every generation stage skipped** — the visible proof that
  the refusal cost nothing beyond the resolution already paid for.

If B happens to win the race instead, the roles simply swap — the refused tab is
whichever one reached the lease second.
