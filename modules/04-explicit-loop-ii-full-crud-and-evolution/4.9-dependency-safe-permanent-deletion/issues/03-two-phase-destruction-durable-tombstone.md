# Two-phase destruction with a durable tombstone

Status: done
## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.9 — Dependency-safe
permanent capability deletion
(PLAN decisions 34 (destruction) and 25 (recreation):
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`)

## What to build

Deletion as a durable two-phase lifecycle, not pretend cross-store atomicity.

- After the deletion lease is admitted, the per-incarnation read gate goes
  `active → closing` and drains (4.9/01). Destruction begins only with a
  proven zero reader count.
- While the table still exists, platform cleanup adapters collect a
  deduplicated owned-resource manifest, **including inactive fields**.
- In one SQLite transaction: the registry row becomes a non-routable deletion
  tombstone carrying that manifest, capability-owned Event Log payloads are
  purged/redacted when M7 is installed (fake seam in 4.9/04), and the table is
  dropped. That commit is deletion's point of no return; the gate can never
  reopen after it.
- After commit: idempotent adapters delete version artifacts and external
  resources; then the tombstone is removed. Crash/failure after commit leaves
  the capability logically gone with durable cleanup work; boot recovery
  retries it. The tombstone reserves id/incarnation until cleanup completes,
  preventing a recreated capability from racing stale cleanup.
- **UI is not optimistic.** Before tombstone commit, the committed
  toolbar/View remains authoritative; refusal, timeout, or pre-commit failure
  reopens reads and restores the canonical View. At commit the capability
  becomes logically absent: toolbar entry/routes disappear; if it was active,
  content becomes the neutral surface. Later cleanup failure cannot resurrect
  the deleted surface.
- **Recreation.** After cleanup completes, the same semantic id may be created
  again with a new incarnation and path — executing new v1 Handler code, never
  a Bun-cached deleted module.

## Acceptance criteria

- [x] Plan acceptance: deletion failure before/after the database point of no
      return — pre-commit failure reopens reads and restores the canonical
      View; post-commit crash leaves it logically gone and boot retries
      cleanup idempotently
- [x] Deterministic pre-/post-tombstone UI pinned: authoritative View before,
      neutral surface/absent toolbar after, no resurrection on cleanup failure
- [x] Owned-resource manifest collected pre-drop includes inactive-field
      resources; keys deduplicated and incarnation-bound
- [x] Module-acceptance step 7: recreate the deleted capability — new
      incarnation, new path, new v1 code (not a cached module)
- [x] Tombstone reserves id/incarnation until cleanup completes; recreation
      during pending cleanup is refused
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean
- [ ] **Human sign-off**: full permanent-delete + recreate flow on the running
      app (module-acceptance steps 6–7)

## Living demo

Delete a dependency-free capability: toolbar entry vanishes, content falls to
the neutral surface, and recreating it by prompt yields a visibly fresh v1 at
a new incarnation path (dev preview shows both incarnations' metrics).

## Implementation notes

- The active registry row now changes atomically into a non-routable deletion
  tombstone carrying the exact incarnation-bound cleanup manifest. Active
  registry reads filter tombstones, while the row continues to reserve the
  semantic id until cleanup finishes.
- Destruction closes and drains the exact read gate, collects through the
  physically read-only database connection, then tombstones the registry row
  and drops the capability table in one SQLite transaction. Before that commit
  every failure reopens reads; after it, cleanup failure leaves durable boot
  retry work and can never resurrect the capability.
- Live deletion and pre-serve recovery share one production cleanup-adapter
  inventory. Artifact cleanup proves the row's configured root, incarnation,
  and live version before commit; it refuses traversal, symlink, and mismatched-
  root targets before deleting anything.
- The UI carries an explicit `neutral | capability(id, incarnation)` restoration
  descriptor through confirmation, refusal, failure, and **Keep it**. Restoration
  is revalidated server-side, so a deleted/recreated semantic id falls to neutral
  rather than opening the wrong lifetime.
- Same-id recreation runs through the real prompt, Core Builder, Gate, publisher,
  and router with a new incarnation/path and freshly imported v1 Handler code.
  Pending tombstones also remain excluded from artifact reconciliation during
  unrelated builds and evolution.
- A neutral committed-deletion response contains only adjacent out-of-band
  toolbar and notice updates. After HTMX consumes those updates, the primary
  output is truly empty—without a sentinel or whitespace—so an already-open tab
  using the preceding stylesheet cannot show an empty bordered result frame.
  The neutral refusal and pre-commit-failure responses now hold to that same
  rule: with no restoration to carry, they emit the notice alone rather than a
  separator that would leave a text node behind.
- The development server no longer runs under `bun --watch`. Bun watches every
  file in the module graph, and a capability's generated Handler files join that
  graph as soon as the router imports them, so deletion removed exactly what the
  watcher was watching and restarted the process **mid-response**. The browser
  saw a severed connection, HTMX swapped nothing, and the confirmation panel
  stayed on screen at the same URL while the capability was already permanently
  gone. `scripts/dev.ts` watches authored `src/` only, so generated artifacts
  churn without touching the running server.
- A Confirm submission whose response never lands no longer leaves that stale
  panel up. The form carries its preflight URL, and the shell re-asks the server
  on `htmx:sendError`/`htmx:timeout`, applying the answer's `HX-Replace-Url`
  itself so a recovered browser never keeps a deleted capability's dead route.
- **Delete permanently** names the act while it runs. HTMX marks the submitting
  form `htmx-request` for exactly as long as the deletion takes, so the danger
  control reads *Erasing…* and disables, **Keep it** goes inert, and the choice
  cannot be pressed twice. Pure CSS — no client state to fall out of step with
  the request.
- A target that is already gone is no longer a dead-end panel with its own
  **Back to Aluna** link. Both entry points (preflight and Confirm) answer with
  the neutral home state — toolbar entry removed, notice explaining it, empty
  primary, `HX-Replace-Url: /` — because a deleted capability has no page of its
  own left to stand on and a reload of its route only 404s.

## Verification

- `bun run test --shards=2 --timeout=60000`: **1,108 passed, 0 failed** across
  118 files.
- Focused deletion, app, registry, migrations, recreation, and evolution run:
  **46 passed, 0 failed**.
- `bun run typecheck`: clean.
- `bun run lint`: clean (`Checked 307 files`).
- `git diff --check`: clean.
- Stale-client regression: **36 focused tests, 260 expectations**, including an
  exact-response assertion that neutral deletion leaves zero primary bytes.
- Live browser diagnosis of the reported evolution-then-delete sequence: the
  evolution lifecycle was correctly recorded as `cancelled`, deletion remained
  committed, and the neutral output had zero children with computed
  `display: none` after the fix.
- A follow-up 1,109-test stress run while an unrelated foreground application
  held sustained CPU produced 14 wall-clock/timing failures (1,095 passed).
  Isolated reruns cleared every product-path timeout, including deletion/recreate
  and the evolution failure; one unchanged sub-30ms timing assertion remained
  environment-sensitive. The clean full-suite evidence above predates only this
  exact-response regression assertion and its two-line neutral-renderer fix.
- Independent spec/architecture and adversarial/standards re-reviews: blocker-
  free after fixes for registry-row tombstones, exact View restoration, unsafe
  recursive cleanup, read-only collection, transaction escape, live/boot adapter
  drift, pending-cleanup evolution, and cached-module recreation.
- Non-destructive live browser check on the user-owned `http://localhost:3030`:
  neutral **Keep it** returned to a frameless neutral surface; deleting an
  inactive target carried Reading list's exact incarnation and restored
  `/capability/reading_list`. **Delete permanently was not clicked.**
- Reported jank reproduced and fixed. A destructive run on the user-owned
  `http://localhost:3030` (Work contacts, at the user's direction) captured the
  failure exactly: `htmx:sendError` with status `0` twenty-nine milliseconds
  after the Confirm submission, no swap, no URL change, panel still on screen —
  and the capability permanently gone server-side. `bun --watch` had restarted
  the server when cleanup removed the imported Handler files. The same flow
  under `scripts/dev.ts`, against a copy of the same runtime data in headless
  Chrome, completes cleanly: toolbar entry gone, panel replaced, URL replaced
  with `/`, notice *I deleted … permanently.*
- Severed-response recovery verified in headless Chrome, both branches: with the
  server taken away mid-submission and restored, the shell re-asked and showed
  the confirmation panel again when nothing had been deleted, and *That part of
  Aluna is already gone* when the deletion had in fact committed.
- Deletion journey verified in headless Chrome against a copy of the live runtime
  data, with the response held open to make the pending state observable:
  **Delete permanently** → *Erasing…*, `disabled`, **Keep it** at
  `pointer-events: none` → toolbar entry gone, panel gone, `/`, notice
  *I deleted … permanently.* A reload of the resulting URL stays on the homepage.
- Already-gone recovery verified: with the deletion committed out of band and the
  server taken away mid-submission, the shell re-asked and landed on `/` with
  *That's already gone, so I didn't delete anything.* — no dead-end panel, no
  dead route.
- `bun run test`: **1,116 passed, 0 failed** across 119 files.
  `bun run typecheck` and `bun run lint` (`Checked 309 files`): clean.

## HITL sign-off

Use a disposable, dependency-free capability because this check intentionally
destroys its records and complete history.

1. **Restart the dev server** — `bun run dev` now uses `scripts/dev.ts`, and a
   session still running under the old `bun --watch` will keep tearing itself
   down mid-deletion. Stop it, run `bun run dev`, and open
   `http://localhost:3030`.
2. Open the disposable capability and note its incarnation, v1 path, and metrics
   in the developer panel. Use all five Actions once if you want to confirm its
   current Handler behavior before deletion.
3. Open **Permanently delete …**. Confirm the loss copy is clear, **Keep it**
   restores the same View, and reopening the confirmation still offers only the
   outlined **Keep it** and red **Delete permanently** actions.
4. To repeat the reported overlap path, first ask Aluna to evolve the disposable
   capability, then open **Permanently delete …** while that evolution is still
   visible. The replaced evolution may finish as cancelled; deletion must still
   either refuse clearly or proceed only after it owns the mutation boundary.
5. Click **Delete permanently**. Confirm its toolbar entry disappears immediately,
   its route no longer opens, and the content becomes neutral when it was active
   (or preserves the other exact active View when it was inactive). The neutral
   state must have no empty bordered bar above the prompt.
6. In the prompt bar, ask Aluna to recreate the same capability. Wait for the
   build to finish, then confirm it appears as fresh v1 with a different
   incarnation and artifact path, its Actions execute the new Handler code, and
   none of the deleted records return.
7. In the developer panel, confirm generation metrics retain separate rows for
   both incarnations. Check **Human sign-off** above only after the complete flow
   matches these visible results. This sign-off also closes the combined live
   confirmation/destruction flow still awaiting human approval in issue 02.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.9-dependency-safe-permanent-deletion/issues/02-deletion-lease-reverse-dependency-refusal-and-confirmation.md
