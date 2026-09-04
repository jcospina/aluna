# Cancellation is `terminate()`, and a closing read gate turns the deletion drain into a mechanism

Status: done

## Epic

Module 6 — Reads Set Free · Epic 6.2 — The ephemeral whole-catalog read
(PLAN decisions 10, 13; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

One cancel entry point on the query scope, implemented as `terminate()` on the
worker, and the read gate wired to it.

**Cancellation is not a timeout, and must not become one.** Decision 9 — slow is
allowed, and no query is given a wall-clock deadline — belongs to epic 6.3 and is
stated there. It is named here because a cancel entry point is exactly where a
deadline would be smuggled back in: freezing was the liveness bug, 6.2/01 fixed
it structurally, and waiting is a product cost the user accepts.

**Cancellation has to be a kill, because a synchronous query cannot be asked to
stop.** An in-process `bun:sqlite` statement can never observe an `AbortSignal`,
so before the worker the gate's drain could only wait against a long query and
time out. `terminate()` kills a synchronously-running query — decision 7 measured
roughly 300ms — which is what turns `DEFAULT_READ_DRAIN_TIMEOUT_MS` from a hope
into a mechanism.

**Decision 10 names three triggers, and this issue wires the one that has a
raiser today:** a capability the query holds a token for begins closing for
deletion. The token set's `signal` from 6.2/02 is what the scope listens to, and
closing any owned incarnation cancels the query, terminates the worker and
releases the tokens so the drain completes. The other two triggers — the user
asks something new, and the user dismisses the answer — are raised by a surface
that does not exist until 6.5, and 6.5/04 connects them to this same entry point.
There is one cancel path, not three.

**Decision 13's residual risk is recorded, not engineered away.** With no
timeout, a long query holds its tokens, and a deletion admitted during it cancels
that query rather than waiting for it. That is the correct outcome — the deletion
the user confirmed wins over the question they can ask again — and it is written
down so the next reader finds a decision rather than a surprise. Record it where
the code makes it true, not only here.

## Acceptance criteria

- [x] The query scope exposes one cancel entry point, and cancelling terminates
      the worker
- [x] A cancel kills a synchronously-running query rather than waiting for it to
      finish
- [x] Closing the read gate on any owned incarnation cancels the query, releases
      the token set and lets the drain complete inside its deadline
- [x] A deletion admitted mid-query drains and commits rather than reporting a
      drain timeout, proved by a test that fails when cancellation is removed
- [x] No wall-clock timeout is applied to a query anywhere on this path
- [x] Cancellation releases through 6.2/02's `finally`, leaving no reader behind
- [x] Decision 13's residual risk is recorded at the code that makes it true
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Still headless. The observable outcome lands with 6.5's demo step 8 (start a long
question, immediately ask a different one) and with the deletion path already on
the desk; here it is proved by test. The deletion case is the one to run: open a
long query scope against a capability, close its gate, and watch the drain finish
where before it would have run to `DEFAULT_READ_DRAIN_TIMEOUT_MS` and refused a
deletion the user had confirmed.

## Blocked by

- modules/06-reads-set-free/6.2-the-ephemeral-whole-catalog-read/issues/02-one-question-one-whole-catalog-read-scope.md

## What landed

- `src/runtime/query/whole-catalog-read-scope.ts` — `scope.cancel(reason?)`, the one cancel
  entry point. It records the first cause, aborts the scope's own controller, and closes the
  worker; `query-worker.ts`'s `close()` is the kill, because `terminate()` is the only thing
  that ends a statement nothing can be asked to stop.
- **`scope.signal` is now the question's, not only the gate's.** It is
  `AbortSignal.any([tokens.signal, cancelled.signal])`, so it aborts when a gate closes *and*
  when `cancel()` is called, carrying whichever came first as its reason. 6.3's loop and
  6.5/04's two triggers spend most of their time between statements; a cancel a body could
  only learn about by attempting another read would be invisible exactly there.
- **The gate's trigger is wired, and only the gate's** (decision 10). The listener is
  attached inside `withTokens` and removed in the scope's `finally`, before the release
  aborts the same signal — so an ordinary ending is never reported as a cancellation. The
  user's two triggers have no raiser until 6.5 and reach the same `cancel()`.
- **A cancel releases nothing on its own.** The token goes back when the body unwinds, which
  a rejected `await` is what starts. That is what makes
  `DEFAULT_READ_DRAIN_TIMEOUT_MS` a mechanism: what used to run a drain to its deadline was a
  main thread parked on a statement, never the statement's own cycles. Recorded in the module
  header, and `read-gates.ts`'s own deadline comment now names the question as its second
  unbounded token holder.
- **A refused statement keeps its own message.** A cancel closes the worker underneath the
  read, so only a `QueryWorkerClosedError` is rephrased as the cancellation; a
  `QueryWorkerStatementError` reaches the caller intact, which is what 6.3's loop needs.
- `src/runtime/query/query-worker.ts` — `close()` is idempotent: the bookkeeping repeats, the
  `terminate()` happens once. A cancelled question closes through it twice by construction,
  and the second call would otherwise reach a thread that may still be inside its statement.
- `src/runtime/query/whole-catalog-read-scope.cancel.test.ts` — 10 tests, and
  `src/runtime/query/read-scope.test-support.ts` and `runaway-query.test-support.ts` carry the
  scratch platform and the runaway statement all three query suites now share.
  `two-phase-destruction.test.ts` gains the deletion end of the claim.
- Decision 13's residual risk is recorded where the precedence is decided — the module header
  — and no wall-clock deadline exists anywhere on this path, which a test asserts against the
  source of all three modules rather than trusting.

## Findings fixed

Two review agents (adversarial and spec-conformance). Every finding is fixed, LOW and
pre-existing included.

**A cancel was invisible to everything except the next `read()`.** `scope.signal` was the
token set's, so `cancel()` aborted nothing: the only observable effect was that a later read
threw. Every other cancellation in this codebase is observed through a signal, and 6.5/04's
triggers land while the body is between statements — a loop waiting on a model, an answer
being written — where a read is exactly what is not about to happen. The scope now owns an
`AbortController` and exposes the composition of it with the gate's.

**The comment said a cancel releases the token; it does not.** The drain waits on the token,
and the token goes back in `withTokens`' `finally` when the *body* unwinds. Every caller
today propagates, so the code was right and the sentence was not — in the one paragraph
6.5/04 will read before wiring a body that catches the cancellation to render a dismissal.
Corrected in the module header and in `read-gates.ts`, where a reader of
`DEFAULT_READ_DRAIN_TIMEOUT_MS` will actually find it: a body parked on something other than
a statement still holds its tokens and can still run that deadline out.

**`cancellation ?? error` masked SQLite's own refusal.** A read rejecting with *near "bad":
syntax error* while a cancel was recorded surfaced as a cancellation. Now only a closed
worker — which is what a cancel produces — is rephrased.

**`close()` was not idempotent, and the scope's guard hid it.** The scope had a flag set
*before* the call, so a `close()` that threw was never retried and left a thread nobody would
reclaim; and the no-double-`terminate()` invariant lived in the scope rather than in the
worker, so any other caller could terminate twice. The flag now moves after a successful
close, and `close()` guards its own `terminate()`.

**Nothing asserted the `terminate()` at all.** `close()`'s whole observable behaviour is
`end()` rejecting the pending reads, so deleting `worker.terminate()` left the suite green —
under an issue whose title is that cancellation *is* `terminate()`. A test now counts the
call through a `Worker` subclass, and counts it twice-closed as one.

**The fake worker proved a counter, not a kill.** Its `close()` incremented a number and its
`read()` never rejected, so `expect(log.closed).toBe(1)` was evidence of nothing being
killed. It now holds reads outstanding on request and rejects them on close, the way the real
worker does, and the first cancellation test asserts the read in flight.

**The tests' discrimination was hard-wired to wall-clock statement length.** A machine fast
enough would leave them passing whether the wiring was there or not — the way a timing-shaped
test dies quietly. A guard now prices the statement from a tenth of it and fails if the
fixture has become too short for the deadlines racing it.

**The extraction silently halved a pre-existing margin.** Sharing one runaway statement moved
`query-worker.test.ts`'s liveness fixture from 30M rows to 20M against an unchanged
one-second window. The shared statement is 6.2/01's own, unchanged, and the guard above
covers that window too.

**A test that hung instead of failing.** With the kill removed, a held read left the body
awaiting forever and the run had to be killed rather than read. It races a settle deadline
now: a regression nobody reads the failure of is not a regression test.

**Smaller ones.** The deletion test attaches an ignoring subscriber to its destruction
promise, so a failure between starting it and awaiting it lands as this test's failure rather
than as a process-level unhandled rejection. `query-worker.ts` no longer claims an unmeasured
millisecond in a paragraph whose authority is that its numbers were measured, and
`runaway-query.test-support.ts` no longer claims the process waits for a terminated thread —
`bun test` does not; what it leaves behind is a core-burning thread the rest of the run
shares.

**Not a defect, recorded.** After a cancel, a read reports the cancellation rather than *the
scope is over* even once the scope has ended — the cancellation is why it ended, and it is
the more useful of the two true answers.

## Verification

- `bun run test` — 2650 pass, 0 fail; `bun run typecheck` and `bun run lint` clean
- `bun run test src/runtime/query` — 46 pass across 3 files; the deletion suite 10
- Seven mutations, each turning exactly the intended test red: removing the gate listener
  (the drain test and the deletion test), the `closeWorker()` in `cancel` (4 tests), the
  scope's own abort (the signal test), the closed-worker discrimination in `readFailure` (the
  refused-statement test), `worker.terminate()` and its guard (the terminate test, once in
  each direction), and setting the close flag before the call rather than after (the
  close-retry test)
- The two tests whose discriminating assertion is not the obvious one: for the gate, it is
  `draining` resolving — the body's own rejection arrives either way, just seconds late; for
  the deletion, it is `{ status: "deleted" }` against `deletion_drain_timeout`
