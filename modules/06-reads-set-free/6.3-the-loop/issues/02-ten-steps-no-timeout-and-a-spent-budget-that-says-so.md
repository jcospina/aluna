# Ten steps, no timeout, and a spent budget that says so instead of answering half

Status: ready-for-agent

## Epic

Module 6 — Reads Set Free · Epic 6.3 — The loop
(PLAN decisions 5, 8, 9; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

6.3/01's turn becomes a loop. The model decides its own next step and keeps
deciding until it answers or the budget is spent.

**A real loop, not a fixed pipeline** (decision 5). There is no
read-the-vocabulary-then-map-then-compute sequence with a retry branch bolted to
the side; there is one honest bounded loop that handles the question nobody
anticipated the same way it handles the one everybody did. Each turn's result —
rows, an empty result, a failed statement — goes back to the model and it chooses
again.

**Ten steps** (decision 8). Capabilities in this PoC are simple and the questions
asked of them are simple, so the budget is deliberately one a real question never
approaches; decision 33 is what will tell us whether ten was generous or tight,
and 6.6 records the number.

**No timeout** (decision 9), replacing `docs/modules.md` §6.2's *defensive `LIMIT`
+ timeout*. Slow is allowed. Waiting is a product cost the user accepts; freezing
was a liveness bug and epic 6.2 fixed it structurally. No wall-clock deadline is
applied to a step or to the loop, and a test pins that so one is not added back as
a convenience.

**A spent budget says so, and never answers half.** Reaching ten steps ends the
question in product voice — she says she could not get there, not a partial total
with the confidence of a whole one. The words are platform-owned, like every other
sentence on this path (decision 15), and they carry no step count, no SQL and no
machinery.

## Acceptance criteria

- [ ] The loop runs the model's chosen steps in sequence, feeding each result back
      to it, until it answers or the budget is spent
- [ ] The budget is ten steps, exercised by a fixture loop that reaches it
- [ ] No timeout exists on a step or on the loop, pinned by a test
- [ ] A spent budget ends the question with a platform-owned sentence and never
      with a partial computation presented as an answer
- [ ] The ending sentence carries no step count, SQL, table name, column or error
      string
- [ ] An empty result and a failed statement are ordinary turns and do not end the
      loop early
- [ ] The read scope and its tokens release in `finally` on every one of these
      endings
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Headless. Exercise it through 6.3/01's developer-gated turn: drive a fixture that
never converges and confirm it stops at ten and says so rather than answering with
what it happened to have. The user-visible form of this arrives with 6.5.

## Blocked by

- modules/06-reads-set-free/6.3-the-loop/issues/01-one-tool-one-turn-a-parameterized-read-only-query.md
