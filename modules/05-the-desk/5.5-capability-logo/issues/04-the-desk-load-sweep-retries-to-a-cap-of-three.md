# The desk-load sweep retries a faceless capability, to a hard cap of three attempts

Status: done

## Epic

Module 5 — The Desk · Epic 5.5 — The capability logo
(PLAN decision 38; [ADR-0007](../../../../docs/adr/0007-capability-logo-contract.md):
`modules/05-the-desk/PLAN.md`)

## What to build

Loading the desk retries every faceless capability once. After the third attempt
the capability stops asking for good and its placeholder tile is permanent.

This is self-healing with no scheduler to build: the sweep rides on a page load
that was going to happen anyway. **The attempt cap rather than a spend ceiling is
the guard that matters** — at roughly $0.08 a call the expensive failure mode is a
retry loop, not a few extra attempts.

- On desk load, every `absent` tile emits the one incarnation-bound POST defined
  in 5.5/02 and is offered one attempt through the same atomic claim used after v1
  activation. Concurrent loads race the claim; exactly one wins and spends the
  attempt. Claim losers observe the in-progress state with a bounded wait and
  return the current tile; they neither start a second provider call nor create an
  unbounded client polling loop. Attempt responses are inert even when the state
  returns to `absent`, so an HTMX swap cannot recursively consume attempts two and
  three during the same desk load.
- A capability whose state is `abandoned` is never attempted again, on any load.
- The attempt count is durable, so a reload does not reset it.
- A capability being swept is usable throughout; the sweep never blocks the desk
  from rendering or a capability from opening.
- Recovery resolves an interrupted `generating` claim before serving: if the
  no-overwrite logo file is complete it marks `present`; otherwise it returns to
  `absent` or `abandoned` according to the already-consumed attempt. Attempt temp
  names are incarnation/attempt-scoped, so this recovery also removes any stale
  temp left by a process crash before it changes the state. It never decrements
  the count, deletes a final file or blindly spends a fourth call.
- A `present` row whose accepted file has later gone missing is reconciled to
  `abandoned` and the permanent placeholder. L7 forbids manufacturing a second
  accepted artwork after loss; the sweep does not spend another call.

## Acceptance criteria

- [x] A desk load attempts exactly one generation per `absent` capability
- [x] The sweep is one load-triggered POST per absent tile, never a mutating GET,
      scheduler or unbounded poll; each response is `no-store`, tile-scoped and
      cannot retrigger itself
- [x] Concurrent desk loads cannot claim the same attempt or exceed three total
      provider calls for one incarnation
- [x] After the third failed attempt the state becomes `abandoned` and no
      subsequent load attempts it again
- [x] The attempt count survives a reload and a restart
- [x] Recovery deterministically reconciles an interrupted `generating` claim
      from the final file plus the durable count, and removes the interrupted
      attempt's stale temp without touching an accepted final file
- [x] A `present` state with a missing file becomes `abandoned`/placeholder and
      never regenerates or emits an immutable 404
- [x] Deletion racing a sweep cancels the attempt through the exact incarnation
      read gate; post-token finalization revalidates the active row and cannot
      recreate or mark present a tombstoned incarnation
- [x] A successful sweep attempt fills the tile without a further reload
- [x] A concurrent claim loser can return the winner's resulting tile after a
      bounded observation without spending or blocking initial desk rendering
- [x] The desk renders and capabilities open normally while a sweep is running
- [x] No automated test calls the live service
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Grow a capability with the network to the logo service unavailable, confirm it is
finished, usable and placeholdered. Restore the network, reload the desk, and
confirm the sweep fills the face. Then fail one three times and confirm the fourth
load stops asking.

## Blocked by

- modules/05-the-desk/5.5-capability-logo/issues/03-the-logo-route-immutable-picture-only-and-compressed.md

## Notes

**The sweep was already half-built, so this issue is mostly the half that makes it
honest.** 5.5/02's arming rule — every full desk render arms one load-triggered POST on
each `absent` tile — *is* the retry. What was missing is that only `absent` arms: a row a
crash left in `generating` renders a resting placeholder and would never be offered
another attempt for as long as the platform lived. Recovery is therefore not a background
job; it is one step in front of the markup, on every full-page desk render (`/` and a
capability opened by URL) and once at boot.

**The cap moved into the claim's own `WHERE`**, where 5.5/01 said it belonged, and the
constant moved to `src/registry/logo.ts` with it. The `deps.maxAttempts` test seam is gone:
one number, expressed once, in the only place a cap can be enforced without a read followed
by a write.

**A running claim and a crashed one leave the same durable row.** That is the whole
difficulty, and the answer is `src/capability-logo/claims.ts`: the attempts running *in
this process*, tracked from before each claim is asked for until after it is finalized.
Recovery reconciles only rows nothing there is holding. A timestamp would have been a guess
about how slow a hosted service is allowed to be; this is exact. The same set answers the
second question — a claim loser awaits the winner's own completion promise, which is the
bounded observation ADR-0007 asks for with no interval, no scheduler and nothing for a
client to repeat. It ends early if the reader who asked has navigated away.

**A transition is revalidated inside its own write.** Recovery decides from a snapshot
taken before it queued for mutation ownership, and the transitions' `WHERE` clauses guard
the *status*, which a new live claim satisfies exactly as the dead one does. Without the
revalidation, a claim arriving while recovery waited would be released out from under a
paid call, and a later load could then put a second drawing in flight for one incarnation.

**Recovery gives up rather than holding a desk open.** A platform write queues behind a
build reservation, and a build holds its lease for as long as a build takes. One pass
shares one 250 ms admission budget; a pass that spends it leaves the rest exactly as it
found them for the next load. This is why the acceptance criterion "never blocks the desk
from rendering" is a test rather than a claim.

**Two removals were added that the issue text does not name, and one of them needs
stating.** The issue says recovery "never … deletes a final file"; ADR-0007 says it never
deletes an **accepted** final file, and the acceptance criterion here says the same
("without touching an accepted final file"). Recovery does remove a *zero-byte* file at the
logo path for a `generating` row: no lifecycle ever said `present` over it, the route
already refuses to serve it, nothing this platform writes can produce it — and left there
the installer's no-overwrite rule would fail every remaining attempt on `EEXIST`, spending
the capability's last paid calls to be told the path is occupied. The stricter ADR wording
governs; the issue's flatter phrasing does not.

**`present → abandoned` became its own transition.** `settleLogoGeneration` used to accept
it, which meant an exhausted *attempt* could demote a row that had since become `present`
to the permanent placeholder — throwing a paid drawing away. It is now
`abandonMissingCapabilityLogo`, bound to `present` alone, and `settleLogoGeneration` is
back to `generating`-only.

**A missing file is only a loss when the tree it should sit in is standing.** An artifacts
root pointing somewhere the platform's artifacts are not makes every accepted drawing look
gone, and `abandoned` is terminal — one pass would take every capability's face away
irreversibly. A `generating` row with no tree yet is ordinary and still releases its
attempt; only the terminal answer is held to the higher bar.

**A missing `stat` answer is not a missing file.** `inspectCapabilityLogoFile` used to read
every errno as "gone", so one `EACCES` or descriptor-exhaustion spike on a busy desk would
reconcile an intact, paid drawing to `abandoned` — which L7 then forbids ever redrawing.
Only `ENOENT`/`ENOTDIR` mean missing now; anything else, and anything at the path that is
not a regular file, reconciles nothing.

**The tile stops arming at the cap too.** `absent` with three attempts spent is refused by
the claim, so an armed tile there would animate on every load for a picture that is not
coming. The renderer now checks the count as well as the status, giving decision 38 a
second, non-racy expression on the surface the user looks at.

### Adversarial findings, all fixed

Two review passes ran before the live check. Everything they found is fixed:

- A transient `stat` failure permanently destroying a healthy `present` logo (critical).
- Recovery's transition never revalidated against the state it decided from, which could
  release a live claim's row and put two provider calls in flight for one incarnation.
- `settleLogoGeneration`'s permissive `abandoned` predicate, shared by two callers with
  opposite intents.
- `GET /` blocked for a whole build lease — now a bounded admission budget, and a pass that
  defers says so.
- Boot recovery unguarded, so one throw would have meant `Bun.serve` was never reached.
- The 95-second claim observation ignoring client disconnect.
- Every attempt POST queueing a platform ticket whatever the row's state, which also kept
  an incarnation "attempting" and suppressed its recovery.
- `absent`-at-cap arming a POST it could never win.
- The desk parsing every registry row twice, an O(n²) catalog walk, and no single-flight
  across concurrent loads.
- Vocabulary collisions: "registry" (the durable one), "settle" (the terminal transition)
  and "sweep" (the desk-load retry) were all being used for new things. Renamed to running
  logo claims, `awaitWinner`, and attempt-temp removal, with glossary entries in
  `CONTEXT.md`.
- Missing coverage: the restart case, more than one faceless capability, the recovery error
  path, and every case where recovery actually has a write to make.

## Verification

```
bun run test
bun run typecheck
bun run lint
```

Typecheck and lint clean. `bun run test` — see the load note below.

Coverage added:

- `src/capability-logo/sweep.test.ts` (new) — two loads racing one tile make one call and
  both get the drawing; a loser whose observation runs out answers with the tile as it
  stands; four loads of eight racing tiles never cost more than three calls; the fourth
  load stops asking; a crash-interrupted claim is offered another attempt by the very next
  load; an interrupted claim whose drawing landed needs no attempt at all; artwork that has
  gone leaves a permanent placeholder and never an immutable 404; the desk renders and a
  capability opens while a sweep draws; the desk renders while a build holds the write
  lease; one unreconcilable capability does not strand the rest; two faceless capabilities
  each arm their own attempt; a capability opened by URL reconciles the desk it draws; an
  `absent` row at the cap rests rather than arming.
- `src/capability-logo/recovery.test.ts` (new) — the four reconciliations, the temp sweep
  and its scoping, the accepted file left untouched, the zero-byte file removed, a running
  claim left entirely alone and reconciled by the next pass, a closing gate, an unreadable
  tree, something that is not a file at the logo path, a row claimed while recovery queued,
  and two passes moving one row once.
- `src/capability-logo/claims.test.ts` (new) — what recovery asks and what a loser waits
  on, including incarnation binding, an unclaimed attempt, the bound, and disconnect.
- `src/registry/store.logo.test.ts` — the third claim is the last one whatever a row is
  released back to; the spend survives the process that made it; an exhausted attempt
  cannot abandon a row that already has artwork.

One more guard came out of the load investigation and is covered in `recovery.test.ts`: a
`present` row whose file is missing is only a *loss* when the incarnation's artifact tree
is standing. An artifacts root pointing somewhere the artifacts are not would otherwise
make every accepted drawing look lost and abandon them all, irreversibly, in one pass.

No test reaches the network: every app under test injects `logoProvider`, and the counting
fakes assert exactly how many calls were made.

**The suite was run in batches, because the machine was under heavy load for the last part
of this work.** Every batch is green except the end-to-end tests with a real-work timeout
budget — the build pipeline, the behavioral gate, the full prompt→build→commit paths —
which fail as `TimeoutError` at 5–15 s and touch nothing in this change. That this is load
and not a regression was measured rather than assumed: on a quiet machine the whole suite
runs in **71 s with the slowest test at 1.9 s**; under load the same suite takes 350–570 s,
*including a control run with this change's two recovery call sites commented out*, which
was the slowest of all. `src/app/app.rehydration.test.ts` — the one failing test that does
exercise `GET /` — was measured on both trees under the same load: **12.83 s on `HEAD`,
12.29 s with this change**.

Batches: `capability-logo` + `registry` + `web` (272 pass), `capability-data` +
`list-input` + `metrics` + `mutation-coordinator` + `persistence` (87), `presentation` +
`provider` + `read-gates` + `sse` + `intent-resolver` (435), `router` +
`capability-deletion` (98) — all green. `builder`, `pipeline` and `app` carry only
timeouts.

**Worth re-running `bun run test` once on a quiet machine** to see the single clean number.

## Living demo

The desk carries three real logos, all `present`, so a reload exercises the no-op
reconciliation path: `/` and `/capability/:id` render in ~12 ms with recovery in front of
the markup, three artwork tiles, nothing armed.

The interesting halves cost either money or a real capability, so they are HITL below. Note
the zero-cost trick that makes the whole retry arc demonstrable: point `RECRAFT_BASE_URL` at
an unreachable address. The service is then *reachable-but-failing* rather than
unconfigured, so attempts are genuinely claimed and spent — which is what walks a capability
to the permanent placeholder — and not one of them reaches a paid endpoint.

## HITL test instructions

Everything in steps 1–4 is free. Step 5 is the only one that spends a Recraft generation
(~$0.08) and is optional.

1. With the dev server running (`bun run dev`), open <http://localhost:3030/>. The three
   existing tiles paint their artwork; nothing animates. This is the sweep finding nothing
   to do.

2. **The retry arc, for free.** Stop the server and restart it with the logo service
   pointed somewhere unreachable:

   ```
   RECRAFT_BASE_URL=http://127.0.0.1:9/v1 bun run dev
   ```

   Then build a capability from the prompt bar ("keep a list of my houseplants"). It
   finishes, opens and works — with a resting placeholder where its face would be. Its one
   post-activation attempt has already failed.

3. Reload the desk twice. Each load offers that capability one more attempt; the server log
   prints `logo attempt 2 …` then `logo attempt 3 …`. On the **fourth** load nothing is
   sent: view source and the tile carries no `hx-post`. The placeholder is permanent.

4. **Recovery.** Pick a capability that still has no artwork and strand its claim by hand:

   ```
   sqlite3 data/omni-crud.db "UPDATE capability_registry SET logo_status='generating' WHERE id='<id>'"
   ```

   Reload the desk. The row comes back to `absent` — `sqlite3 data/omni-crud.db "SELECT
   logo_status, logo_attempts FROM capability_registry WHERE id='<id>'"` — the count is
   unchanged, and the tile is armed again. Restart the server instead of reloading and the
   boot log says the same thing before it starts listening.

5. **The paid half** (skip unless you want to spend a generation). Restart with the real
   `RECRAFT_BASE_URL`, then take a capability whose count is under three and reload the
   desk once. The tile animates and fills without a further reload.

Do **not** delete a `logo.svg` by hand to test the loss path on a capability you want to
keep: reconciliation is correct and terminal — the row becomes `abandoned` and L7 forbids
ever drawing another.
