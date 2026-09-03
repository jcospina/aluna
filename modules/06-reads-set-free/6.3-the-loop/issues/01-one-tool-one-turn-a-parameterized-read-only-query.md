# One tool, one turn: the model asks for a read and gets rows back

Status: ready-for-agent

## Epic

Module 6 — Reads Set Free · Epic 6.3 — The loop
(PLAN decision 5; decision 6's seam is epic 6.2's and is relied on here, not
rebuilt; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

The model is given exactly one tool — run a parameterized read-only query — and
one turn of it runs end to end: a classified `data_query` opens 6.2/02's scope,
the model calls the tool, the statement executes in 6.2/01's worker, and the rows
come back to the model. The turn is the unit decision 5's loop is built out of,
and it lands on its own so the loop in 6.3/02 has something proven to repeat.

**One tool, and it is the physically read-only adapter.** No second tool, no
escape hatch, no side channel. Decision 6 is the whole safety story: every step
runs against `SQLITE_OPEN_READONLY` plus the authorizer, so a mutating statement
fails at the SQLite seam no matter how wrong the model goes. A classifier is never
the seam, and nothing added here may become one.

**The tool is whole-catalog and parameterized.** It carries SQL and its
parameters; values are bound, never interpolated. It reads across every
capability in the scope's snapshot, which is what makes a question that crosses
two capabilities one question rather than two.

**A failed statement is a turn, not an ending.** Malformed SQL, an unknown column
or a syntax error returns to the model as a result it can act on — decision 5's
argument for a loop over a pipeline is precisely that these cases do not deserve a
retry branch bolted to the side. Nothing about the failure reaches a surface; what
the user is told is settled by decision 15 and built in 6.3/04.

**A question that ends here is still a question.** This issue's exit is the tool
result reaching the model. What the model then says is 6.4's, and where it is said
is 6.5's.

## Acceptance criteria

- [ ] A classified `data_query` opens the whole-catalog scope, calls the one tool
      and receives rows from the worker
- [ ] The model is offered exactly one tool, and a test proves the offered tool
      set has one member
- [ ] Statement values are bound as parameters, never interpolated into SQL
- [ ] A mutating statement issued through the tool fails at the SQLite seam and is
      returned to the model as an ordinary failed turn
- [ ] Malformed SQL and an unknown column both return to the model rather than
      ending the question
- [ ] A statement may read across every capability in the scope snapshot, and none
      outside it
- [ ] The turn creates no registry, version, artifact, cache or read-dependency
      state
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Headless, and the last issue that can honestly claim to be. The loop is now
exercisable against a real database, so wire a developer-facing exercise of one
turn behind the existing developer gate (`developerSurfacesEnabled()` in
`src/server/dev-surfaces/dev-surfaces.ts`) rather than leaving the integration
invisible until 6.5. It is scaffolding, and its removal is owned by a named issue rather than
by this sentence: `6.5-the-answer-window/issues/05-the-scaffolding-comes-down.md`
deletes it once 6.5/03 makes the real path visible, and re-homes every assertion
that ran through it.

## Blocked by

- modules/06-reads-set-free/6.2-the-ephemeral-whole-catalog-read/issues/03-cancellation-is-terminate-and-the-drain-becomes-a-mechanism.md
