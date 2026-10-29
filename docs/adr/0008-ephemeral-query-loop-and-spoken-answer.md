# 0008 — The ephemeral question loop and the spoken answer

Status: Accepted

## Context

A person asks Aluna about their own things: how many coffees from Colombia they have
tasted, or what they spent on groceries. The Intent Resolver classifies such a sentence
as a `data_query`. The answer may lie in one capability or across several, and the
question's words rarely match the stored values. When someone's expenses are
categorized food, cheese and vegetables, no single label means "groceries", so the
model has to look at what the values are, decide which belong, and only then compute:
two model turns with a read between them. Generated SQL is also sometimes simply wrong.

Aluna is not a coding agent, and during a build the model calls no tools
([What Aluna is and what it is not](../architecture.md#2-what-aluna-is-and-what-it-is-not)).
A question is where a model does call one, so that tool has to be harmless whatever the
model does with it.

`bun:sqlite` is synchronous, so a statement on the main thread blocks the event loop for
as long as it runs. One missing join condition across three capabilities scans the
product of their rows before it returns a single number, and the desk freezes while it
does: no request served, no stream advancing. No bound on result size catches that.

Outside the developer panel, Aluna shows the person no developer surface (ADR-0001), and
a grid with column headers taken from SQL aliases would be one.

## Decision

A `data_query` is a bounded loop of read-only SQL steps whose result Aluna speaks. It
builds nothing, keeps nothing, and runs again in full every time it is asked.
[Answering questions](../architecture.md#410-answering-questions) traces it step by step.

### The loop

The model has one tool, `run_read_only_query`, which runs one parameterized SQL
statement. On each turn it decides its own next step: read, answer, or say that the
desk has nowhere for the subject. It reads to find where the subject lives, to learn
what the person's values are called, and to compute. A question gets ten steps. A
statement that fails, or that the platform refuses, is an ordinary step whose message
goes back to the model, so an unknown column or an empty result needs no retry branch.

SQL computes and the model finds the words. The statement carries the whole
computation, counting, totaling, grouping, ordering and rounding included, and the
model never does arithmetic by reading rows. Arithmetic done that way would make every
answer depend on the payload caps below, which are only a backstop.

No statement and no question has a deadline. Slow is permitted and freezing is not, and
the worker removes the freezing without a timeout. The provider's per-generation
deadline still bounds each model call.

### The read-only seam

Every statement runs in a Worker against the one database file, attached read-only
(`mode=ro`), under `PRAGMA query_only = ON`. The worker also refuses by name `ATTACH`,
`PRAGMA` and the other forms that leave the file behind, and refuses a second statement
(`src/runtime/query/worker/query-worker-thread.ts`). On a read-only connection alone,
`VACUUM INTO` writes a readable copy of the catalog and `CREATE TEMP TABLE` spills to
disk. `query_only` closes both, and only the refusal by name stops `ATTACH`. A mutating
statement fails at this seam however many turns the loop takes and however badly it
reasons. An agent loop is dangerous when the agent can act, and this one can only look.
The Resolver's classification is never the seam, and neither is the table bound, which
checks every read with `EXPLAIN` on the main thread's read-only connection against the
tables and columns a question may see, and passes a write through unchecked to fail at
the seam.

The worker sees the catalog only through views. Each capability's table is read through
a view of the same name listing `id`, `created_at` and the active fields. A file column
comes without its key, and text that may hold a file's address comes as a withheld
phrase, because a statement can disguise any value it can read and no scrub of the
result undoes that. The link table's view holds only the rows of relations that hold,
without the target's incarnation (ADR-0011), and an empty view shadows every other
table in the file. The file itself is attached under a schema name the platform's
connection lacks, so the table bound refuses a statement that names the schema to reach
under a view. A scrub of what comes back catches a stored copy the views cannot
recognize (ADR-0009).

Ownership stays on the main thread. The question takes a read token on every active
capability at once, against one catalog snapshot, or takes none, and releases them in
`finally` (ADR-0006). The worker is handed view statements, never a token, and never
learns which incarnations it reads.

### Cancellation

Closing the worker does not stop a running statement, which runs to its end inside
SQLite after `terminate()`. Closing ends the wait at once, because every pending read
rejects. Cancellation aborts the question, ends its model call and closes its worker.
Four things trigger it: the person asks something new, the person dismisses the answer,
the browser disconnects from the answer's stream, or a deletion closes the read gate of
a capability the question holds a token for. A question holds a token for every
capability that was active when it started, so deleting any of them cancels it,
whatever it was about. The fourth trigger lets a deletion's drain end a question at
once, where a statement on the main thread could only be waited out.

### Results are refused, not truncated

A step whose result exceeds the per-step cap is refused, and the refusal tells the
model to narrow or aggregate. Silent truncation is how a spoken answer becomes wrong:
half the expenses summed with the confidence of a whole total, and no table on screen
to expose it. The cap counts bytes, not rows: four hundred `(month, total)` pairs fit
under it, and two hundred long notes, re-sent in full on every later turn, do not.

A whole question also carries a payload budget. Every turn re-renders every earlier
step, so a question's payload grows with the square of its steps, and a per-step cap
alone would admit about 55 times the cap across ten reads. Once the budget is spent, a
read that fits the step cap is refused the same way.

### What she says

The answer is prose in Aluna's voice, written as a list only when the answer is one, and
there is no auto-table. A separate model call writes it from what the steps returned and
nothing else. She answers the question and stops. Where she looked is not part of what
she says, because the person knows what they keep. The collections a statement opened
and the values it bound still reach the answer's prompt, because the sentence needs
them: "from Colombia" is the value she searched on.

An answer may carry **answer links** to the records it names (ADR-0010). The model
nominates the words that name a record and the id it read, and the platform links a
nomination only after its own checks, the first being that a step returned that id. The
platform strips every returned record id from the spoken text and builds each anchor
itself. Only an answered question carries links.

Two rules bound what a spoken answer may claim:

1. **Nothing matched is never stated as a fact about the person's life.** The platform
   tells **nothing matched** apart from rows that matched and totaled zero, by reading
   what SQLite returned against what the statement's plan returns over no rows, and a
   plan it cannot read counts as matching nothing. This is a code check, never a model
   judgment. A question whose statements ran and matched nothing ends in the platform's
   own sentence, which names any collections she read. One whose every statement failed
   ends in another, which claims only that she got nowhere: she did not search, so she
   may not report a search. She may say she could not find something. She may not say
   the person does not have it.
2. **Narration is platform-owned.** The tool call carries a **step label** from a closed
   vocabulary, and the platform owns the sentence for each label. The model picks the
   kind of step and never writes the words, so it cannot invent progress, report an
   uncomputed number, or narrate outside the product voice. No SQL, table name, column
   or error string reaches the surface. Nothing checks a label against its statement, so
   a mislabeled step says the sentence for the wrong kind of step, which claims nothing
   about the data.

While she looks, the answer window shows the build narration's band: *Looking* in caps,
one square per step, and a rule under her sentence that creeps and states no percentage.
The squares say how many steps she has taken and nothing about what they were. The rule
claims no share of a total, because a question does not know its own length, and it
runs out only when she has seen the question through: an answer, nothing matched, or
nowhere for it. Any other ending leaves the rule where it stands.

Meaning is supplied, not stored. The model is given the vocabulary of the person's
data: a choice field's options come from the registry, a file field lists its kinds and
media types, and an ordinary step reads every other field's values. The model applies
its own knowledge of language, that "mother", "mum" and "mom" are one idea, inside the
SQL it writes. Aluna keeps no embeddings and no other semantic index.

When nothing on the desk can hold the subject, she names the gap and stops: the person
has nowhere for it yet and can ask her to make one. That ending is **nowhere for it**.
The sentence is the platform's, and the model only picks which of the person's own words
name the subject. The platform refuses the gap before any collection has been read, and
answers the question instead when the words name something the desk already holds, or
name nothing while a window stands. She offers no confirmation control, because an offer
with a yes is a proposal and Aluna has no proposal surface. Making the capability is one
ordinary sentence away in the prompt bar.

### The answer window

A question's answer appears in the **answer window**, which opens once the Resolver
returns `data_query` and displaces nothing. A capability stays open while it is asked
about, because reading an answer about a capability while looking at it is one activity,
as watching a build in the developer panel beside it is. The desk stands three windows at
most, the capability window, the developer panel and the answer window, each opened from
its own place, with no window manager.

There is one answer window, and a new question replaces its content in place. The frame
is never closed and reopened between questions, so it stays where the person left it
with nothing stored.

The answer window has no logo, no tile and no address, so the logo layer keeps meaning
the capabilities the person has and nothing leads back to an answer that is gone. It is
dismissed, never put away, because put away means retrievable. A reload starts with no
answer window, and nothing about it reaches storage. An answer link leads to a record's
address, never back to the answer. Aluna keeps no history of answers and no list of
recent questions.

A refusal opens no window. On a desk with no answer window, the Resolver's `reject`
speaks in the prompt bar's notice slot. When an answer window stands, the refusal takes
it instead, re-titled to the words that were refused, brought forward, and said there and
not on the bar. That window was answering a question this sentence is not, and leaving
its answer standing would leave the desk answering something nobody asked. Every other
sentence the prompt bar speaks stays on the bar. Wherever the refusal lands, the typed
words stay in the field, so trying again is one edit away.

A question does not lock the prompt bar. Asking something else is always possible and
cancels the running question.

Build narration stays in the capability window, because a build ends in a capability
appearing there and the person is already looking at it.

The open capability is context, never a filter. It resolves vague references, as it
does for an evolution, and never fences the search: a question about expenses asked
with Recipes open is answered about expenses. No chip, badge or pill shows scope.

### Nothing is kept

A question creates no registry row, logo, version, artifact, cache, persisted read
dependency or conversation thread. Its reads hold read tokens and no mutation lease, and
it creates no lifecycle state. The same question asked twice runs twice. It leaves one
best-effort, content-free `intent_resolution_metrics` row, queued behind the
platform-write lease as a refusal's is, holding the steps taken and the wall-clock
elapsed and nothing about the person's data: no prompt, no SQL, no results, no record id.

## Considered options

**A fixed pipeline.** Classify, write SQL, run it, answer. It grows a retry branch for
malformed SQL, an unknown column and an empty result, and it cannot reach the groceries
case, which needs a read before the SQL that computes.

**Statements on the main thread under a timeout.** A timer cannot fire while a
synchronous statement holds the event loop, and a timeout trades a frozen desk for
cutting off a question that is only slow.

**An SQLite authorizer.** `bun:sqlite` exposes no `sqlite3_set_authorizer`, so the seam
is the read-only attach, `query_only` and the worker's refusals by name.

**Interrupting the statement with `sqlite3_interrupt`.** It would stop a cancelled
statement and free its core, and it needs FFI against the worker's `Database.handle`.
Closing the worker already ends the wait, which is all the person and a deletion's
drain wait on, so what a runaway statement still costs is the core.

**A generic auto-table of the result.** A one-cell table headed `count(*)` is an
engineering artifact. The table would also be the person's one way to audit an answer,
and nothing replaces it.

**Naming what she read before every answer.** A restatement such as "Under Colombia in
your Coffee tasting, you have 7" gives the person a check on a fluent wrong answer, but
every answer arrives in the same shape and reads as a machine reporting in, and the
person already knows what they keep.

**Embeddings or another semantic index.** They would make questions a write feature:
computed on save, recomputed on edit, deleted on delete, rebuilt on evolution and swept
on capability deletion, with their own version key, their own recovery and an AI call on
the write path. One person's whole categorical vocabulary fits in a few hundred tokens,
and an index exists to search a space too large to enumerate.

**The answer in the capability window.** It would displace the capability the person is
asking about.

## Consequences

The model stands between the person and their data. With no table and no restatement, a
fluent and confidently wrong answer is invisible. The nothing-matched rule is the one
defense by proof, and it covers one narrow claim: she may not report a figure for a
search that matched nothing. Beyond that, the collections and values a statement used
reach the answer's prompt, so a mis-scoped answer can show in the words, but nothing
makes it show. Anything that weakens the nothing-matched rule removes the last defense.

The rule leans toward nothing matched: a statement whose plan the platform cannot read,
or a match that hands back what an empty search would, ends as nothing matched, which is
weaker than the truth and never a false figure.

Nothing bounds a statement in time. Ten steps, cancellation and the per-generation
deadline on each model call are the only limits on how long an answer takes. A
pathological statement costs the asker's patience and a CPU core instead of the whole
desk, and the core stays busy until the statement ends, even after its question is
cancelled. A deletion admitted during a long question cancels it instead of waiting,
because the deletion was confirmed and the question can be asked again. Because a
question takes the whole catalog or nothing, every new question is refused while a
deletion holds any capability closing.

The payload caps bound what reaches the model, not memory: the worker materializes an
over-size result in full and copies it to the main thread before anything weighs it.

The views' check for a file's address runs on every row a statement reads, returned or
not, and is slow on text dense with hex digits, so a question over megabytes of such
text runs until it ends or is cancelled. A file key that some Handler stored with other
characters between its digits, or already cut up, is caught only by the scrub of what
comes back, and a statement can reorder its pieces past that scrub.

The loop's route varies from run to run, where a build's stages are fixed, so tests
assert the contract (steps bounded, writes refused, over-size steps refused, nothing
matched never stated as fact, no machinery in the narration) and never a fixed sequence
of statements.

The supplied vocabulary has a ceiling: it cannot find a note about someone's mother that
never uses the word. That gap is accepted.

A read gate can end a long read at once. Any other long-running read that has to be
drainable needs the same shape, with execution the gate's signal can close.

The desk holds three windows at most. A fourth window would reopen this decision.
