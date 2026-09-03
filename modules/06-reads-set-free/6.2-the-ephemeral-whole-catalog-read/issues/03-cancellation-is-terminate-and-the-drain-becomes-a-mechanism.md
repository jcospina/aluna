# Cancellation is `terminate()`, and a closing read gate turns the deletion drain into a mechanism

Status: ready-for-agent

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

- [ ] The query scope exposes one cancel entry point, and cancelling terminates
      the worker
- [ ] A cancel kills a synchronously-running query rather than waiting for it to
      finish
- [ ] Closing the read gate on any owned incarnation cancels the query, releases
      the token set and lets the drain complete inside its deadline
- [ ] A deletion admitted mid-query drains and commits rather than reporting a
      drain timeout, proved by a test that fails when cancellation is removed
- [ ] No wall-clock timeout is applied to a query anywhere on this path
- [ ] Cancellation releases through 6.2/02's `finally`, leaving no reader behind
- [ ] Decision 13's residual risk is recorded at the code that makes it true
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Still headless. The observable outcome lands with 6.5's demo step 8 (start a long
question, immediately ask a different one) and with the deletion path already on
the desk; here it is proved by test. The deletion case is the one to run: open a
long query scope against a capability, close its gate, and watch the drain finish
where before it would have run to `DEFAULT_READ_DRAIN_TIMEOUT_MS` and refused a
deletion the user had confirmed.

## Blocked by

- modules/06-reads-set-free/6.2-the-ephemeral-whole-catalog-read/issues/02-one-question-one-whole-catalog-read-scope.md
