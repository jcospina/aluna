# The size cap refuses, the refusal is addressed to the model, and the loop narrows

Status: ready-for-agent

## Epic

Module 6 — Reads Set Free · Epic 6.3 — The loop
(PLAN decision 12; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

A step whose result exceeds the cap **fails**, and the failure is addressed to the
model — *that returned too much, narrow it or aggregate it* — so it writes a
better query and the loop continues.

**It never truncates.** Silent truncation is how a prose answer becomes a lie:
half the expenses summed with total confidence, and — because decision 3 deleted
the table — nothing on screen to expose it. A refusal the model can act on is the
only safe shape once the receipt is gone.

**The cap is measured in payload size, not rows.** Ten thousand `(month, total)`
pairs are trivial; two hundred long-text notes are on the order of 100k tokens
re-sent on every subsequent turn. Rows are the wrong unit for the cost the cap
exists to bound.

**It is a backstop, not the primary mechanism.** Decision 4 — SQL carries the
computation, so a result is an aggregate and small by construction — is what keeps
payloads small, and it lands in 6.4/02. The cap catches the case where that
failed, and a cap that fires often is evidence decision 4 is not holding.

**An over-size refusal is a turn, not an ending.** It consumes one of the ten
steps, goes back to the model like any other result, and the loop recovers by
narrowing. Nothing about it reaches a surface.

## Acceptance criteria

- [ ] A step whose result exceeds the cap fails and returns nothing to the model
      but the refusal
- [ ] No result is ever truncated, sampled or partially returned — a test proves
      the over-size path returns no rows rather than fewer rows
- [ ] The cap is measured in payload size, and a many-row small-payload result
      passes while a few-row large-payload result is refused
- [ ] The refusal is worded for the model and tells it to narrow or aggregate
- [ ] The loop continues after a refusal, consumes one step for it, and can reach
      an answer by narrowing — proved by a fixture that does exactly that
- [ ] No cap message, size or count reaches any user-facing sentence
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Headless. Exercise it through 6.3/01's developer-gated turn with a capability
holding long-text records: ask for the rows themselves and watch the step be
refused, then watch the loop come back with an aggregate. This is the behaviour
the plan's deterministic companion states as *an over-size step is refused, not
truncated, and the loop recovers by narrowing*.

## Blocked by

- modules/06-reads-set-free/6.3-the-loop/issues/02-ten-steps-no-timeout-and-a-spent-budget-that-says-so.md
