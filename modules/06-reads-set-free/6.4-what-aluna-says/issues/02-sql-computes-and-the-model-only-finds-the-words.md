# SQL carries the computation, and the model reports only what a step returned

Status: ready-for-agent

## Epic

Module 6 — Reads Set Free · Epic 6.4 — What Aluna says
(PLAN decision 4; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

The generated SQL carries the whole computation — `count`, `sum`, `group by`,
`order by` — and the model never adds, counts, averages or ranks by reading rows.

**Two reasons, and both are load-bearing.** Language models are unreliable at
arithmetic over many rows and confident about it, which is how a spoken answer
becomes a confident wrong number with no table on screen to check it against. And
an aggregate is small by construction, so 6.3/03's size cap almost never bites —
the cap is a backstop, and this decision is what keeps it one.

**Free reads exist precisely so SQL can be asked to do this** (ARCH §3). Leaning
on the model instead would waste a guarantee the architecture already bought.

**The rule is stated where the model can act on it, and enforced where it can be
checked.** The loop's instructions say the computation belongs in the query. The
answer step receives step results and nothing else, so there is no path by which
the model can report a figure that no step returned — a figure in an answer must
be traceable to a result the loop actually received, and a test drives a question
whose answer is a total and proves the total came from a `sum`, not from the
model.

**A question that needs many rows is a question that needs a better query.** When
the model reaches for the rows themselves it meets the size cap, and the refusal
tells it to aggregate. The two decisions work as a pair.

## Acceptance criteria

- [ ] The loop's instructions require the computation to be carried by the SQL
- [ ] The answer step is given step results only, with no access to a raw record
      set it could compute over
- [ ] A question whose answer is a total is answered from an aggregate step, not
      from rows — proved by a fixture asserting the executed SQL aggregates
- [ ] No figure appears in an answer that no step returned
- [ ] A model attempt to pull the rows and total them itself meets the size cap
      and recovers by aggregating
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Headless; exercise through 6.3/01's developer-gated turn. Ask a question that
requires a total across a capability with more records than anyone would read, and
inspect the steps: one aggregate, one small result, one sentence. Then confirm the
same question does not appear as a page of rows being summed a turn later.

## Blocked by

- modules/06-reads-set-free/6.4-what-aluna-says/issues/01-the-vocabulary-of-the-data-is-supplied-not-stored.md
