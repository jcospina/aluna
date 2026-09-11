# One tool, one turn: the model asks for a read and gets rows back

Status: done

> **The `/demo/question` exercise this issue names came down in 6.5/05.** What it proved about
> the loop is proved without it; the references to it below are the record of how this issue was
> verified while the module was still headless.

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

- [x] A classified `data_query` opens the whole-catalog scope, calls the one tool
      and receives rows from the worker
- [x] The model is offered exactly one tool, and a test proves the offered tool
      set has one member
- [x] Statement values are bound as parameters, never interpolated into SQL
- [x] A mutating statement issued through the tool fails at the SQLite seam and is
      returned to the model as an ordinary failed turn
- [x] Malformed SQL and an unknown column both return to the model rather than
      ending the question
- [x] A statement may read across every capability in the scope snapshot, and none
      outside it
- [x] The turn creates no registry, version, artifact, cache or read-dependency
      state
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

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

## What landed

- `src/runtime/query/question-tool.ts` — the offer. `QUESTION_TOOLS` is a frozen
  one-member inventory, and `questionToolCallSchema` is *derived* from it through
  `theOnlyQuestionTool`, which throws on an inventory that is not exactly one — so a
  second tool cannot be described in the prompt while the schema goes on admitting only
  the first. The call is `{ tool, sql, parameters }`; the wire shape is checked against
  what OpenAI's strict structured outputs accept (every property required,
  `additionalProperties: false`, an `enum` rather than a `const`, no `oneOf`).
  Named `QUESTION_TOOLS` because `tools` already names a capability's fixed five Actions.
- `src/runtime/query/whole-catalog-query-scope.ts` — the table bound decision 6 asks for
  and `query-worker-thread.ts` recorded as the loop's to wire up. Builds the
  `CapabilityQueryScope` the plan describes (first granted incarnation as `target`, the
  rest as `dependencies`) and reuses `assertScopedQuery` unchanged.
- `src/runtime/query/question-turn.ts` — one turn: build the prompt, generate the call,
  take the bound, run the statement through 6.2/02's `scope.read`, return a step.
  `buildQuestionTurnPrompt` renders prior steps, which is what *the result reaching the
  model* means concretely.
- `src/pipeline/query/data-query.ts` — `runDataQueryTurn`. The seam where a classified
  `data_query` stops being a deflection: it refuses every other intent before touching the
  gate, opens the scope, takes one turn, and returns the step plus the prompt the model
  would be handed next. It lives in the pipeline because it is the only part of this path
  that needs an `IntentClassification`; `runtime/query/` knows nothing about classification.
- `src/server/routes/query/demo-question.ts` — `/demo/question`, the developer-gated
  exercise, in the `/demo/*` namespace ADR-0002 reserves for exactly this. Removal is
  owned by `6.5-the-answer-window/issues/05-the-scaffolding-comes-down.md`, which was
  amended to match what actually exists.
- `scripts/build.ts` + `scripts/build.test.ts` — the bundle now ships the query worker's
  thread beside it. See the findings below.
- 47 tests across `question-tool.test.ts`, `question-turn.test.ts`,
  `data-query.test.ts`, `app.demo-question.test.ts` and `build.test.ts`, with
  `question.test-support.ts` carrying the two-capability desk (physical tables, real rows)
  and the scripted provider both query suites share.

## Findings fixed

Two review agents (adversarial and spec-conformance). Every finding is fixed, INFO and
pre-existing included.

**The table bound failed open, and a comment was the whole key.** The first draft skipped
any statement that did not begin with `SELECT`/`WITH`, so that a mutation would reach the
SQLite seam untouched. `/* hi */ SELECT id FROM capability_registry` begins with neither —
and the worker runs it happily, because the worker's refusals are about its *file* and have
nothing to say about which of the catalog's tables a read may open. Demonstrated end to end
against the registry, `sqlite_master`, `pragma_table_list` and `dbstat`. It now fails
closed on everything except `INSERT`/`UPDATE`/`DELETE`/`REPLACE`, and ten disguises are
pinned by test: a block comment, a line comment, a leading paren, a `UNION`, a CTE, a
correlated subquery, an `EXPLAIN` prefix, case mixing, an ambient virtual table and an
`IN (SELECT …)`.

**A `?` count that did not match its values ended the whole question.** The likeliest
mistake a model makes with a parameterized tool, and Bun reports it as a plain `Error`
rather than a `SQLiteError`, so it travelled past every classification and out of the turn:
proved through `/demo/question` as *The question ended*. The bound now counts `paramsCount`
itself and says which way the mismatch went. Too *many* values was the quieter half —
SQLite ignores the extra and answers, so the model would never learn that a value it
thought it bound went nowhere.

**A database that was not answering was reported to the model as a bad query.** Every
`SQLiteError` was being dressed up as *rewrite your statement* — on both sides. Demonstrated
by corrupting the file under a live scope: a perfectly good `SELECT` came back as a failed
step saying *database disk image is malformed*, which 6.3/02's loop would answer by writing
another query, and another, until its budget was gone. SQLite's result code now decides:
`SQLITE_ERROR`, `SQLITE_READONLY` and their siblings are the statement's, and busy, locked,
interrupted, I/O, corrupt and not-a-database are the connection's. The thread classifies,
because the result code does not survive the structured-clone boundary, and
`QueryWorkerConnectionError` is what reaches the caller. Pinned by a worker pointed at a
file that opens and is not a database.

**`extra` and every retired field were readable on all but one capability.**
`assertScopedQuery` protects the platform columns on the scope's *target*, and a
whole-catalog scope nominates a target only because the shape demands one — so eight
capabilities out of nine were unprotected, including fields the user had removed from the
schema. The defence in the first draft was that the prompt never mentions those columns,
which is obscurity offered to a component whose entire job is writing arbitrary SQL.
`assertScopedQuery` gained a `wholeCatalog` option that protects `[target, ...dependencies]`
and refuses a virtual table outright — the table bound counts `OpenRead`, and a virtual
table opens with `VOpen`, so an FTS5 table added later would have been readable without ever
appearing in the accessed set. Off by default: the generated-Handler path keeps exactly the
bound it had.

**The no-state sweep could not see a file.** `sweepPlatformStores` was handed the database
*file* and walked it as a directory, which enumerates nothing — so a `VACUUM INTO` output or
any sidecar written beside the desk passed in silence. It now walks the containing
directory, minus SQLite's own `-wal`/`-shm`/`-journal`, and a test writes the file it is
supposed to catch and watches it get caught. This was 6.2/01's and 6.2/02's sweep too.

**The demo surface.** Deleting `escapeHtml` from the reflected question left the whole suite
green — no test had ever posted markup. A malformed multipart body 500'd instead of
rendering, contradicting the page's own premise. And any third-party page could POST to it
and spend two real provider calls. All three fixed and tested; `Sec-Fetch-Site` is the guard,
because `form-action 'self'` governs where our pages may post and never where a post may
come from.

**The bundle would have shipped a worker with no thread.** 6.2/01 recorded that Bun leaves
`new URL("./query-worker-thread.ts", import.meta.url)` as written and left the seam to
whoever first made the worker reachable from the server. This issue is that. Dropping
`.href` does not make the bundler follow it either, so `scripts/build.ts` copies the thread
beside the bundle — it imports `bun:sqlite` and nothing else — and clears its outdir, so
nothing stale looks shipped. `build.test.ts` asserts the name the bundle asks for is the
name that is there, and that the thread has grown no relative import, dynamic import or
`require` the copy could not resolve.

**The scope's worker opened the wrong database.** `withWholeCatalogReadScope` defaulted to
`DB_PATH` whatever connection it had been handed — invisible while every caller injected a
worker, and wrong the moment the server called it. It now opens
`(deps.database ?? dbReadonly).filename`, so a scope given a scratch connection cannot
answer from the product's desk.

**A commented mutation was refused by us rather than by the seam.** `/* c */ UPDATE …` did
not match the pass-through and was refused on the main thread. The pass-through now strips
comments and literals first — but *only* the pass-through. The bound itself still refuses
what it cannot read, which is the asymmetry that keeps the fail-open hole shut.

**DDL is bounded here rather than at the seam, and it is recorded rather than widened.** A
bare `DROP TABLE` is refused by the bound, not by `SQLITE_OPEN_READONLY`. Widening the
pass-through to every non-read is what looks tidy and is not safe: `(SELECT id FROM
capability_registry)` returns rows and begins with neither keyword. Both refusals reach the
model as an ordinary failed step, no DDL statement can return a row on a `query_only`
connection, and deleting this module still leaves every write failing in the worker — so
what the narrow pass-through costs is which refusal fires first, and what fail-closed buys
is that there is one at all. Pinned by test in both directions, including the harmless read
behind a comment that pays the same price.

**The one-tool assertion did not assert it.** The prompt test checked that each tool in the
inventory appeared in the prompt, which stays true with two of them. It now counts the tool
headings the prompt renders. Found by mutation, not by reading.

**The user's own words go into the model's prompt.** A record whose text reads *IGNORE ALL
PREVIOUS INSTRUCTIONS* arrives in the next turn's prompt intact. Rewriting it is not
available — altering a person's data is how a spoken answer becomes wrong — so the rows are
fenced and labelled as data, with the rule stated once in the platform's voice. The real
bound stays decision 6's: the worst a misled turn can do is write another read-only
statement. Recorded because 6.3/02's loop and 6.4's answer both consume this text.

**Decision 6's `all()` is reused in spirit, not in the letter, and that is written down.**
`CapabilityQueryPort.all()` executes on a main-thread `Database`, and epic 6.2 moved
execution into a Worker. What is reused is what decision 6 was pointing at — the scope shape
and `assertScopedQuery`'s `EXPLAIN` enumeration — and what it ruled out stays ruled out: a
question returns rows, never `records()`' handles. Two consequences ride on it and are
recorded at the code: the worker's connection has no `platform_search_normalize`, and
nothing projects a declared result descriptor.

**Smaller ones.** The `signal` threaded into the query scope was dead — `assertScopedQuery`
never reads it — and read as an ownership check that does not happen; removed, since the
check that does happen is `assertQuestionLive` on both sides of the read. `.min(1)` on the
SQL emitted `minLength`, which OpenAI's strict mode rejects, while the file's header claimed
conformance; it is a refinement now, and the test sweeps for six rejected keywords instead
of one. `assertNoAmbientSchemaReader`'s refusal said *not available to Handlers* to a model
that has never heard of a Handler. `query-worker-thread.ts` still said the table bound was
"the loop's to wire up in 6.3/01", and `dev-surfaces.ts` still said one thing was left to
gate. The demo's section class is a union rather than a string. And four branches nothing
exercised — the empty-catalog refusal, the turn's own re-validation of the model's object,
and both load-bearing prompt rules — now have tests.

**Not defects, recorded.** The statement is compiled three times per step (arity, the
bound's `EXPLAIN`, the worker); two are parses of a short statement and the third is the one
that touches data. And in a production bundle `developerSurfacesEnabled()` folds to `false`,
so nothing in `dist/` can reach the worker yet — the copy is shipped now because the seam
closes cheaply before anything depends on it being closed, not because it is load-bearing
today.

## Verification

- `bun run test` — 2710 pass, 0 fail; `bun run typecheck`, `bun run lint` and `bun run build`
  clean
- `bun run test src/runtime/query src/pipeline/query src/server/routes/query scripts` — 108
  pass across 8 files
- **Live, against the real desk on `:3030` and the real provider.** *"how many things have I
  saved in total across all my collections?"* classified `data_query` at 0.99 and produced
  one eight-way `UNION ALL` across every capability table, answered by the worker in one
  turn. *"how many job applications did I log in July, and how many hikes?"* produced two
  correlated subqueries across two capabilities with `["07","07"]` bound as parameters. This
  is also what proves the wire shape: the union-typed parameter array and the enum tool name
  are accepted by the configured provider, which no test can establish without spending.
- Nine mutations, each turning exactly the intended test red: removing the table bound (5
  tests), restoring the fail-open pass-through (2), interpolating parameters instead of
  binding them, swallowing a cancellation as a step, a second member in the tool inventory,
  removing the arity check, narrowing the column bound back to the target, calling every
  SQLite failure a statement fault, blinding the store sweep to the desk directory, and
  removing the demo's escape and its cross-site guard together (2).
