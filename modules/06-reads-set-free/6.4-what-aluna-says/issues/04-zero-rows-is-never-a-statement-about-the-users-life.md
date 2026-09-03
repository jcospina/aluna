# Zero matched rows is never stated as a fact about the user's life

Status: ready-for-agent

Type: HITL — the two sentences this issue separates are authored product voice,
and the difference between them is the point of the decision. Implementation is
fully specified and agent-ready; a human reads both before sign-off.

## Epic

Module 6 — Reads Set Free · Epic 6.4 — What Aluna says
(PLAN decision 17; ADR-0001's product voice:
`modules/06-reads-set-free/PLAN.md`)

## What to build

*"You spent nothing on groceries"* is a claim about the user. *"I couldn't find
any groceries in your expenses"* is a claim about her search. She is only ever
permitted the second.

**The platform tells the difference deterministically, so this is a code check and
not a model judgment.** A `count` returns `0`; a `sum` over no rows returns
`NULL`. Those are different results and they mean different things, and the
platform distinguishes them before the answer is written rather than trusting the
model to.

**Nothing-found and found-nothing are two endings, not one.** A question whose
steps matched no rows ends in the humble form. A question whose steps matched rows
that genuinely total zero may state the zero, because there the zero is a fact the
data supports.

**The honesty rule is the module's, not this path's alone.** It is the same rule
6.1/02 applies to a filtered collection count: a number that reads as the whole
truth and is not is the thing being forbidden, on a rendered number there and on a
spoken one here.

## Acceptance criteria

- [ ] The platform classifies a step result as no-rows-matched or as
      rows-matched-and-totalled-zero, deterministically, before an answer is
      written
- [ ] A no-rows question is answered as a statement about the search, never about
      the user or their data
- [ ] A rows-matched-totalling-zero question may state the zero
- [ ] The model cannot override the classification, and a fixture where it tries
      still produces the humble form
- [ ] `NULL` from a `sum` over no rows and `0` from a `count` are handled as the
      distinct cases they are, each with its own test
- [ ] **Sign-off gate:** the human has read both sentences and confirms neither
      makes a claim the data does not support
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Headless; exercise through 6.3/01's developer-gated turn. Ask about a category
that exists in the capability but matches nothing, then about one whose records
really do add to zero, and read the two answers side by side. The plan's
deterministic companion names this as *zero matched rows never renders as a
statement about the user's data*.

## Blocked by

- modules/06-reads-set-free/6.4-what-aluna-says/issues/03-she-says-what-she-looked-at-before-what-she-found.md
