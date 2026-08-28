# The drain deadline rises above the longest a single handler may run

Status: done

## Epic

Module 5 — The Desk · Epic 5.8 — Message surfaces and restoration
(PLAN decision 14; ADR-0006: `modules/05-the-desk/PLAN.md`)

## What to build

The read-drain deadline is 5,000ms while a capability handler may run for
10,000ms, so **a well-behaved reader can currently cause a deletion to fail for
reasons the user cannot see.** One window holds several concurrent read tokens
whenever a canonical read, a debounced search and a post-mutation refresh
overlap, which makes the overlap ordinary rather than exotic.

- The drain deadline is raised above the maximum a single handler may run, and
  the relationship is asserted rather than left to two constants that happen to
  be ordered correctly today.
- **Reads are not capped downward to close the gap.** Reads are what the user is
  doing, deletions are rare and deliberate, and killing a slow read to speed up a
  rare operation is the wrong trade.
- A deletion that still times out returns the distinct typed outcome
  `deletion_drain_timeout` for one authored product-voice refusal in the
  confirmation flow. It is not collapsed into the generic pre-commit failure, so
  the user can be told that active work did not finish in time. The window wiring lands with the deletion
  confirmation in 5.9/02; this issue owns the timeout contract, not a premature
  second deletion surface.
- **The documented invariant stands untouched:** never await a queued acquisition
  inside a read-token scope.

## Acceptance criteria

- [x] The drain deadline exceeds the capability handler timeout, with a test
      asserting the ordering rather than the two literals
- [x] The handler timeout is unchanged — no read is capped downward
- [x] A deletion blocked by a slow but well-behaved reader completes once that
      reader finishes, rather than failing spuriously
- [x] A deletion blocked past the deadline returns the typed refusal consumed by
      5.9/02 as `deletion_drain_timeout`, rather than throwing or collapsing into
      an unstructured/generic failure
- [x] The never-await-a-queued-acquisition invariant is unchanged and still
      pinned by its test
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Hold a slow read on a capability and delete it. The deletion waits for the reader
rather than refusing, and completes when the read finishes. A developer preview
shows the drain waiting past the old five-second mark.

## Blocked by

- modules/05-the-desk/5.7-capability-content-in-the-window/issues/03-switching-capabilities-swaps-the-contents-not-the-frame.md

## What landed

**The drain now outlasts the longest a single Handler may run.**
`DEFAULT_READ_DRAIN_TIMEOUT_MS` went from 5,000ms to 15,000ms in
`src/read-gates/index.ts`; `DEFAULT_CAPABILITY_HANDLER_TIMEOUT_MS` in
`src/router/generated-code.ts` is untouched at 10,000ms. No read was capped
downward, and nothing else that bounds a read moved. Both constants' doc comments
were rewritten: the handler's used to claim it sat *above* the drain deadline "on
purpose", which is exactly the ordering this issue inverts.

**The ordering is pinned by test, deliberately, not derived in code.** The
acceptance criterion asks for "a test asserting the ordering rather than the two
literals", and that is what `src/read-gates/index.test.ts` does — the strict
inequality plus a ≥1,000ms margin, so a future edit cannot satisfy the ordering
with a single millisecond. Deriving one constant from the other was considered and
rejected: it would make `read-gates` import from `router`, inverting the direction
the router already depends on.

**A drain that still expires is an outcome, not a throw.** `destroyCapability`
returns `{ status: "deletion_drain_timeout" }` — `CapabilityDestructionResult` is
now a union of that and the committed result. Because the timeout member carries
no `tombstone` or `payloads`, every call site that reads them without narrowing is
a compile error, so no drain timeout can be misread as a success. `http.ts` maps
it to a new refusal kind alongside `blocked`/`busy`/`stale`, with its own authored
sentence: *"Something in {label} was still finishing, so I didn't delete it.
Everything you had there is still safe — try again in a moment."* It is the one
deletion refusal that invites a retry, because it is the one that will probably
work. The window wiring stays with 5.9/02; this is the same confirmation flow that
already speaks the other three refusals, not a second deletion surface.

**The invariant is untouched.** Nothing under `src/mutation-coordinator/` or
`src/capability-logo/` changed, and
`attempt.test.ts`'s "finalization does not run inside the read-token scope" still
pins it.

**The developer preview grew the drain.** `/demo/region-lifecycle` gained
`POST /demo/region-lifecycle/drain`, which closes the preview's own gate at the
production deadline, waits, reports the elapsed time against the superseded
5,000ms number, and reopens — `finalizeClose` is deliberately absent, so nothing
is ever destroyed there. While it drains, a new read receives the router's real
409 and real refusal bytes rather than a stand-in.

**Findings from adversarial review, all fixed.**

1. *The rationale comment claimed a behaviour the code does not have.* It said
   reads are never killed, next to a `closeAndDrain` that aborts every reader the
   moment the gate closes. Rewritten: closing signals cancellation immediately;
   the deadline is only how long the drain waits for a scope that has not yet
   reached a point where it could notice.
2. *The ordering does not generalise to every token holder.* A logo attempt holds
   a read token across provider I/O bounded by 90,000ms — six times the drain
   deadline. The comment now says so, and says such scopes stay compatible by
   observing the close's cancellation (pinned by `attempt.test.ts`), not by being
   shorter.
3. *The margin is headroom, not a bound.* A route holds its tokens across reading
   the request body, which sits outside the Handler deadline. Both comments now
   say that, and name why it is not a hole: a record mutation takes its
   coordinator lease before it parses, so a deletion racing a slow upload is
   refused as busy at the front half instead of waiting at the drain.
4. *The preview's closing-gate answer was a 200 and an invented sentence* while
   production answers 409 with `READ_UNAVAILABLE_FRAGMENT`, whose status is
   load-bearing (htmx will not swap a 4xx unaided). It now returns the real
   fragment and the real status.
5. *Two timing margins were too tight* to survive a loaded machine. The preview
   drain test holds its reader 1,000ms against a 400ms floor; the closing test
   holds 2,000ms so the reader cannot finish between the poll and the refused
   read; the destruction test holds 100ms against a 5,000ms deadline.
6. *A test comment called itself "a scale model of the two production deadlines"*
   at a ratio nothing like the real one. It now says what it actually pins — the
   behaviour — and points at the ordering test for the numbers.
7. *The raise has a cost nothing acknowledged*: deletion holds the coordinator's
   non-queued lease across the whole drain, so a drain that runs to the deadline
   refuses every other write for 15s rather than 5s. Documented where the constant
   is, as the deliberate price of never refusing a deletion that would have
   succeeded a moment later.
8. *`deletion_drain_timeout` as a presentation discriminant* sat oddly beside
   `blocked`/`busy`/`stale`. The refusal kind is `drain_timeout`; the outcome the
   ADR and 5.9/02 name, `deletion_drain_timeout`, stays exactly that on
   `destroyCapability`, with the link written down where the union is declared.
9. *The preview surfaces engineering vocabulary* ("read token", "handler",
   `deletion_drain_timeout`). Its banner now says outright that it speaks in
   engineering terms rather than product voice, and that nothing there is ever
   deleted.

## Verification

- `bun run typecheck`, `bun run lint` clean; `bun run test` green — 1,800 tests
  across 2 shards, 0 failed.
- Live, against the running dev server on :3030: a preview read holding its token
  for 8,000ms, drained mid-read. The drain reported
  `{"outcome":"drained","waitedMs":6985,"deadlineMs":15000,"previousDeadlineMs":5000}`
  — **6,985ms, past the old five-second mark** — the slow read still answered
  normally, and the gate came back `active` with 0 readers.
- The typed refusal end to end: `app.capability-deletion.test.ts` drives a real
  confirm POST against a coordinator with a 1ms deadline and asserts the drain
  sentence is present **and** that the generic "I couldn't delete Notes" is not.
- The slow-reader case: `two-phase-destruction.test.ts` releases its reader after
  the drain has begun and asserts the deletion committed — tombstone written,
  table dropped, gate retired.
- Existing coverage that had pinned the old behaviour was updated, not deleted:
  fault-battery case 6 now asserts the returned outcome instead of a rejection.

## What this issue does not deliver

The Living demo's first sentence — "hold a slow read on a capability and delete
it" — is **not** reachable from any surface, and that is deliberate. The preview
drains a synthetic incarnation and destroys nothing, because making the demo
delete a real capability would build the "premature second deletion surface" this
issue forbids. The real `destroyCapability` wait is evidenced by tests. What the
preview shows is the drain's *timing*, not a deletion.

## HITL

1. Start the dev server (`bun run dev`) and open
   `http://localhost:3030/demo/region-lifecycle`.
2. Leave "The read holds for" at **8000** and press **Show the list**. The
   server's tracked reader count goes to 1.
3. While it is still reading, press **Drain the gate**. The status line ticks up
   live — "Draining — waited 1.2s so far…", past 5.0s, past 6.0s — and the gate
   panel shows `state: "closing"` with the reader still counted. **This is the
   whole point: the old deadline would already have given up here.**
4. While it is draining, press **Show the list** again. You get the router's real
   refusal — "I'm making a careful change here. Give me a moment, then try that
   again." — not a crash and not a stand-in.
5. When the read finishes, the status line reads "Drained after 7.0s — past the
   old 5.0s deadline, which would have refused it. The gate is open again." The
   reader count returns to 0 and `state` returns to `active`.
6. Press **Show the list** once more: it works, because nothing was destroyed.
7. Confirm no console errors on any of it.
