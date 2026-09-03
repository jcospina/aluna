# 0008 — The ephemeral query loop: read-only agent turns, a worker, and a spoken answer

Status: accepted

Seeds Module 6 (`modules/06-reads-set-free/PLAN.md`). It settles what a `data_query`
does, where its answer appears, and what the platform is allowed to say about a user's
data. It amends ARCH §7's `data_query` subsection and narrows ARCH §1's "no roaming
agent loop" to the building path, which is what that sentence was written about.

## Decision

**A `data_query` is a bounded loop of read-only SQL steps whose result Aluna speaks.**
It builds nothing, persists nothing, and is re-run in full every time it is asked.

**The loop.** The resolver classifies `data_query` as it does today. The classified
question then enters a loop in which the model is given exactly one tool — run a
parameterized read-only query — and decides its own next step, up to **ten steps**. It
uses those steps to find where the subject lives, to read what the user's values are
actually called, and to compute. A fixed pipeline was rejected: it answers the
anticipated question and then grows a retry branch for malformed SQL, an unknown column
or an empty result, and a retry branch is a loop that is embarrassed about itself.

**The tool is the physically read-only adapter, and that is the whole safety story.**
Every step runs against `SQLITE_OPEN_READONLY` plus the authorizer. A mutating statement
fails at the SQLite seam regardless of how many turns the loop takes or how badly it
reasons. An agent loop is normally dangerous because an agent can act; this one can only
look, so its blast radius is zero by construction. The cheap reject/route classifier is
a courtesy, never the seam — as ARCH §7 already insists.

**Execution moves off the main thread.** The loop's queries run in a Worker holding its
own read-only connection to the one documented database file. `bun:sqlite` is
synchronous, so an in-process query blocks the event loop for its whole duration: a
clumsy unconditional join across three capabilities would freeze the desk — no request
served, no stream advancing — while returning a single row, which no result-size bound
can catch. Measured on Bun 1.3.12 against `data/omni-crud.db`: a read-only connection
opens inside a Worker; a `CREATE TABLE` through it still fails with *attempt to write a
readonly database*; the main thread ticked 39 times against an expected 40 during two
seconds of a runaway recursive query; and `terminate()` killed that synchronously-running
query in roughly 300ms.

**Ownership stays on the main thread.** The complete per-incarnation read-token set is
acquired atomically against one catalog snapshot or not at all, and released in
`finally`, exactly as ADR-0006 and ARCH §8 require. The worker is only where SQL
executes. It never receives a token and never learns which incarnations it is reading.

**Cancellation is `terminate()`, and it has three triggers**: the user asks something
new, the user dismisses the answer, or a capability the query holds a token for begins
closing for deletion. The third is the one that matters architecturally. An in-process
synchronous query cannot observe cancellation at all, so before this ADR the read gate's
drain could only wait and time out against a long query. In a worker the gate's signal
becomes a real kill, and the drain becomes a mechanism rather than a hope.

**There is no timeout.** Slow is permitted; freezing is not, and the worker addresses
freezing structurally instead of trading one against the other. This replaces the
"defensive `LIMIT` + timeout" that `docs/modules.md` §Module 6 previously specified.

**A step whose result exceeds a payload cap is refused, not truncated**, and the refusal
is addressed to the model so it narrows or aggregates and the loop continues. Silent
truncation is how a spoken answer becomes a lie — half the expenses summed with total
confidence, and no table on screen to expose it. The cap is measured in payload size
rather than rows, because ten thousand `(month, total)` pairs are trivial while two
hundred long-text records are on the order of 100k tokens re-sent on every subsequent
turn.

**SQL computes; the model only finds the words.** Generated SQL must carry the whole
computation — counting, totalling, grouping, ordering. The model never performs
arithmetic by reading rows. Free reads exist precisely so SQL can be asked to do this
(ARCH §3); leaning on the model instead would waste a guarantee the architecture already
bought, and would make the payload cap load-bearing rather than a backstop.

**The answer is prose in Aluna's voice. There is no auto-table.** This replaces the
"platform-owned generic auto-table renders a bounded result" of ARCH §7. Every question a
person actually asks is answered by a sentence, with bullets where a sentence would be a
list. A one-cell table headed `count(*)` is an engineering artifact, and ARCH §9.7
forbids the product from being one.

Three rules make a spoken answer safe to trust:

1. **She says what she looked at before she says what she found** — not the SQL, its
   meaning. Removing the table removed the receipt; the restatement is the honest
   replacement, and a better one, because it exposes what she *decided* rather than what
   she retrieved. It also carries the scope at no extra cost.
2. **Zero matched rows is never stated as a fact about the user's life.** The platform
   distinguishes "no rows matched" from "the rows matched and totalled zero"
   deterministically — a count returns `0`, a sum over no rows returns `NULL` — so this is
   a code check, not a model judgment. She may say she could not find something; she may
   not say the user does not have it.
3. **Narration is platform-owned.** The model's tool call carries a label drawn from a
   closed vocabulary, and the platform owns the sentence for each label. The model picks
   the kind of step; it never writes the words. It cannot invent progress, report an
   uncomputed number, or narrate outside product voice. No SQL, table name, column, or
   error string reaches the surface.

**Meaning is supplied, not stored.** The model is given the vocabulary of the user's
data: `choice` fields already declare their options in the registry, and small
categorical string fields are enumerated by an ordinary loop step. The model applies its
own knowledge of language — that "mother", "mum" and "mom" are one idea — inside the SQL
it writes. **Embeddings and any other semantic index are declined.** They would make this
a write feature: computed on save, recomputed on edit, deleted on delete, rebuilt on
evolution and swept on capability deletion through the incarnation and tombstone
machinery — a fourth derived artifact beside the Handler, the renderer and the tests,
with its own version key, its own lifecycle recovery, its own coordinator traffic, and an
AI call on the write path. This is a single-user app whose entire categorical vocabulary
fits in a few hundred tokens; an index exists to search a space too large to enumerate,
and this one is not. Should the supplied-vocabulary approach prove insufficient in use,
semantic storage earns its own ADR and its own module.

**When nothing can answer, Aluna names the gap and stops.** She says the user has nowhere
for the subject yet and that they can ask her to make one. She presents no confirmation
control: an offer-with-a-yes is a proposal, and the proposal surface belongs to Module 8
— `src/pipeline/intent/schema.ts` admits only `requires_confirmation: z.literal(false)`,
and reserves confirmations for M4 deletion and M8 proposals. The information still
arrives, and the action is one ordinary sentence away in the box already under the
cursor.

**The answer opens in its own window.** This resolves the question ARCH §7 and
`modules/05-the-desk/PLAN.md` both deliberately left open, and it resolves it with
machinery that already exists rather than a new surface primitive. The desk now stands
three singular windows — the capability window, the developer panel, and the answer
window — each opened from its own place, none displacing another, and still no window
manager. **A capability stays open while it is asked about**, which is the whole reason
this is a window and not something anchored to the prompt bar.

M5's one-window rule is superseded rather than bent: it was written when the only thing a
window could hold was a capability, and the developer panel was already its one exception.
An answer is the second, on the same reasoning — reading an answer about a capability
while looking at that capability is one activity, exactly as watching a build in the panel
beside it is.

**One answer window, and a new question replaces its content in place.** It is never
closed and reopened between questions: the frame stays standing and only what it holds
changes, which is the swap the desk already performs when a second capability is opened
into the one window. Because it never closes, it stays where the user left it without
anything being stored — it simply has not moved.

**There is no way back, and that is the point.** It has no logo on the desk, no tile and
no address, so there is no route to an answer that is not on screen — which is why it is
*dismissed* rather than *put away*: put away means retrievable, and this is not. A reload
starts with no answer window, and nothing about it reaches storage. This
also protects a distinction M5 paid for: the logo layer means the capabilities the user
has, and the developer tile is already drawn unlike a capability so nothing confuses the
two. An answer icon would have muddied that for something there is no reason to return
to. Future persistence — a history of answers, a reopen, recent questions — is out of
scope and no groundwork for it is laid.

**A refusal opens no window.** The classification says which it is, so the window opens
only once the resolver returns `data_query`; `reject` speaks in the prompt bar's notice
slot exactly as it does today. This costs one beat between submit and the window opening,
and it means M5's notice contract is left entirely untouched — moving answers into a
window *reduces* what this module changes.

**A query does not lock the prompt bar**; asking something else is always possible and
cancels the running query.

**Nothing here depends on the pet.** An earlier draft of this contract anchored the
answer to the prompt bar so the pet could later inhabit it; the window removes that
dependency entirely. The pet is a delight feature that may never be built, and no plan
should be written that waits on it. `design/research/the-spark.md` was deleted as
abandoned rather than folded into a page, and `docs/pet.md` is guidance of its vintage
rather than a contract — two of its statements are stale, "renders into the content area"
against a desk that ships no content area, and "supports walking" as a claim about a
design not yet made. Module 8 should settle its proposal surface the same way, on
machinery that exists, rather than inheriting this deferral.

**Build narration is untouched.** It stays in the window, where M5 put it, because a
build narration is a long streaming log ending in a thing appearing in that window, and
because during a build the window is where the user is already looking. The pet
travelling into the window is deferred, not rejected.

**The open capability is context, never a filter.** It resolves vague references exactly
as it does for evolution, and never fences the search: a question about expenses asked
with Recipes open is answered about expenses. Scope is stated in the answer sentence
rather than shown as a chip, badge or pill.

**Nothing is created.** No registry row, no logo, no version, no artifact, no cache, no
persisted read dependency, no conversation thread. The same question asked twice runs
twice. Metrics remain the existing best-effort, content-free `intent_resolution_metrics`
row, gaining turns taken and wall-clock elapsed — no prompt, no SQL, no results, nothing
about the user's data.

**Every collection states how many records it holds**, and when that number is filtered
it says so, so a filtered count is never presented as the whole truth. It is
platform-owned scaffolding against the read connection, so generated code is untouched,
and it answers the most common question in this module before anyone has to ask it.

## Context / why

The constrained-write / free-read split (ARCH §3) has until now been a safety property
nobody could see: a second connection with no pen, protecting data the user never
suspected was at risk. `data_query` is the first time the user *receives* something from
it, which is why the module is named for the reads rather than for the answers.

The auto-table was the one place the architecture flinched. Every other surface in this
product refuses to look like a developer tool — the desk, the drawn line, the logo
contract, the closed field vocabulary, ARCH §9.7's flat prohibition — and then
`data_query` was to render a grid with column headers taken from SQL aliases. Removing it
is not a formatting preference; it is the feature finally agreeing with the rest of the
product. The cost is real and was accepted deliberately: the table was also the user's
only way to audit an answer, and the restatement rule above is what replaces it.

The loop earns its place on a case the naive design cannot reach at all. A user asks what
they spent on groceries; their expenses are categorised food, cheese and vegetables.
There is no single label to map "groceries" onto, so the answer requires looking at what
the values actually are, deciding which of them belong, and only then computing. That is
two model turns with a read between them, and once two turns exist, the honest structure
is a bounded loop rather than a pipeline with branches bolted to it. It also absorbs the
failure the naive design has to handle anyway: NL→SQL sometimes simply produces bad SQL.

ARCH §1's "no roaming agent loop" is written inside the argument that Aluna is not a
coding agent, coding platform or site builder, and that there is no preview-adjust-approve
loop where the user supervises generated code. A read-only query loop does not contradict
that intent — the user supervises nothing, approves nothing, and sees no code — but it
does contradict the wording, so the wording is narrowed here rather than discovered later
as a violation.

The worker was not part of the original design and was added on evidence. The
liveness failure it prevents is specific and cheap to trigger: one missing join condition
across three capabilities scans the product of their rows before returning a single
number, and freezes the entire desk while doing it. It is not an adversarial case — the
architecture is explicit that in-process execution guards against clumsy model output
rather than hostile code — but clumsy is exactly what it protects against. The
measurements above were taken rather than assumed, including the one that was genuinely
in doubt: whether a thread blocked inside SQLite's C code can be terminated at all.

Declining embeddings is a scope judgment, not a technical one. Nothing about them is
hard; everything about them is *lifecycle*. They would cross the module's own boundary,
adding machinery to the write path inside a module named for reads, and would do it to
solve a problem that this product's scale does not have.

## Consequences

- ARCH §7's `data_query` subsection is superseded by this contract, including its closing
  paragraph deferring the answer's surface. ARCH §1's agent-loop sentence is narrowed to
  the building path. `docs/modules.md` §Module 6 loses its auto-table epic, its `LIMIT`
  and timeout, and its open-surface block, and is renumbered to the build order in the
  module plan.
- The read gate gains a cancellation mechanism it did not have. Any future long-running
  read that wants to be drainable should follow the same shape.
- Module 8 inherits a named first customer for its proposal surface: the moment a
  confirmation exists, the gap answer is where it belongs. Until then M8 remains free to
  design that surface without inheriting a shape this module guessed at.
- Module 9 inherits two numbers that tell it whether the ten-step budget was generous or
  tight.
- The desk gains a third window and no window manager. Anything later wanting a fourth
  should expect to justify it against this contract's reasoning, not merely cite it.
- The pet is removed from every module's critical path. Module 8's proposal surface is now
  the only thing still deferred to it, and need not be.
- `data_query` remains outside the mutation coordinator, creates no lifecycle state, and
  declares no read dependency, exactly as ARCH §7 and §8 already require.

## Hazards this contract carries forward

**The model now stands between the user and their data.** With no table, a fluent and
confidently wrong answer is invisible. The restatement rule and the zero-row rule are the
whole defence, and they are defences by *disclosure* rather than by proof: they make a
wrong answer catchable by a reader who is paying attention, not impossible. Anything that
weakens the restatement — shortening it, making it optional, letting the model decide when
to include it — removes the only audit the user has.

**Nothing bounds an answer in time.** With no timeout, the only limits are ten steps and
cancellation. A pathological query now costs the asker's patience instead of the whole
desk, which is the intended trade, but a query that runs long while a deletion waits will
be killed by that deletion rather than delaying it. That is the correct precedence — the
deletion was confirmed, the question can be asked again — and it is recorded here so it
reads as a decision rather than a surprise.

**The loop is nondeterministic in a way the build path is not.** The same question may
take a different route on different runs, so tests must assert the contract — steps
bounded, writes refused, over-size steps refused rather than truncated, zero rows never
asserted as fact, no machinery in the narration — rather than a fixed sequence of queries.
A suite that pins the exact steps will be flaky and will be deleted by whoever inherits
it.

**The supplied-vocabulary approach has a known ceiling.** It cannot find a note about
someone's mother that never uses the word. That gap is accepted, and the decision to
close it is deliberately deferred to its own ADR rather than left as an implicit
requirement on this one.
