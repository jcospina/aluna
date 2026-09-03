# Module 6 — Reads Set Free: Ad-hoc Data Queries — Plan

Status: decisions locked; ADR-0008 and the doc amendments landed 2026-09-03. Converting to issues.

This refines [docs/modules.md](../../docs/modules.md) §Module 6 with the design
decisions that module ownership leaves open. Unlike Modules 3–5, it **does not leave
that section's text intact**: four things `docs/modules.md` and
[docs/architecture.md](../../docs/architecture.md) currently assert about `data_query`
are changed here on purpose — the auto-table, the defensive `LIMIT`, the timeout, and
the absence of any agent loop. The goal and the exit bar are unchanged: free-form reads
across every capability, through the physically read-only seam, creating no
registry/version/artifact/cache/read-dependency state. Terms follow
[CONTEXT.md](../../CONTEXT.md): *capability*, *incarnation*, *read gate*, *read token*,
*the pet*, *product voice*. Decision record:
[ADR-0008](../../docs/adr/0008-ephemeral-query-loop-and-spoken-answer.md) (the ephemeral
query loop, its worker, and the spoken answer). The plan reuses [ADR-0002](../../docs/adr/0002-sse-transport-conventions.md) (the per-job stream
the prompt bar already opens), [ADR-0004](../../docs/adr/0004-capability-artifact-contract-and-validation-isolation.md)
(supplied adapters and the static contract, reused rather than extended), and
[ADR-0006](../../docs/adr/0006-capability-evolution-versioning-and-diff-contract.md)
(incarnations, which the read-token set is keyed by). ADR-0001's product voice governs
every sentence Aluna speaks here.

**Nothing in Module 5 is edited by this module.** M5's issues and plan are history. Every
change this module makes to a shipped surface is recorded here, in ADR-0008, and in the
architecture and design documents — never by reaching back into a closed module.

## Amendments this plan required — landed 2026-09-03

These were not implementation details; they were assertions in canonical documents that
this module contradicts, and issue conversion was blocked behind them. All are now
applied, together with ADR-0008 and the consequential references listed after them.

1. **`architecture.md` §7, "`data_query` — the ephemeral exception."** "The AI translates
   NL → read-only SQL and a platform-owned generic auto-table renders a bounded result"
   becomes a loop of read-only SQL steps whose result Aluna speaks. The paragraph
   beginning "Where that answer appears is not settled" is answered: the answer opens in
   its own window, a third beside the capability window and the developer panel, and it
   waits on nothing. `architecture.md` §6.1's "one window" and §8's staleness reasoning
   are carried with it, and `CONTEXT.md` gains an *answer window* entry.
2. **`architecture.md` §1.** "No roaming agent loop" is written against the *building*
   path and the "Aluna is not a coding agent" argument. It must be narrowed to say so
   explicitly, because Module 6 introduces a bounded read-only loop on the query path.
3. **`docs/modules.md` §Module 6.** Epic 6.3 ("Generic auto-table renderer") is replaced;
   epic 6.2's "defensive `LIMIT` + timeout" is replaced by a size cap that refuses and no
   timeout; the "Open in this module" block is resolved; the epic list is renumbered to
   the build order in this plan; the "Verify by running it" paragraph is rewritten.
4. **`docs/pet.md`.** Two statements are stale rather than wrong: messages rendering
   "into the content area" predates the desk, which "no longer ships a content area at
   all" (`public/index.html`), and the hard constraint "supports walking" is a claim
   about a design that is not made yet. The file now carries a banner marking it as
   guidance of its vintage, not a contract. `design/research/the-spark.md` was
   **deleted** (2026-09-02) as abandoned; the pet's contract page will be authored under
   `design/` when the pet is designed, as the logo's was.

Four consequential references were carried with them: `CONTEXT.md`'s *the pet* entry
(one surface still waits on the pet, not two), ADR-0001's deferred-surfaces note, and
ADR-0005's two sentences resting on the auto-table — restated rather than retired, since
its actual precedent (presentational platform code is allowed) stands and `table`/
`masonry` stay out of the layout set on their own merits. Module 3's plan and
`modules/05-the-desk/PLAN.md` also mention the auto-table and the deferred surface and
are **deliberately left alone**: closed module plans are history.

## Decisions locked for issue conversion

### What a disposable answer is

1. **One prompt bar, and the sentence decides.** A question reads; a statement of what
   the user wants to keep builds. No mode switch, no slash command, no "ask vs build"
   control. The resolver already classifies `data_query` against the whole registry
   (`src/pipeline/intent/resolver.ts`), and asking the user to pre-classify their own
   sentence would move the platform's one hard job onto them.

2. **A query is disposable by nature, not by policy.** Aluna is handed the whole active
   catalog for the length of one question and it is taken back afterwards. The same
   question asked twice runs twice. Nothing is memoized, and there is no conversation
   thread: no registry row, no logo, no version, no artifact, no cache, no persisted read
   dependency. This is the single exception to "everything is cached", and it is an
   exception in the direction of *less* state, never more.

3. **The answer is prose in Aluna's voice. There is no table.** Every question a person
   actually asks — "how many notes last week", "when did I last write", "what did I spend
   per month" — is answered by a sentence, with bullets where a sentence would be a list.
   A one-cell table with a `count(*)` header is a spreadsheet apologising for itself, and
   §9.7's "friendly app, never an engineering tool" forbids it. This deleted the auto-table
   epic `docs/modules.md` used to carry.

4. **SQL computes; the model only finds the words.** The generated SQL must carry the
   whole computation — `count`, `sum`, `group by`, `order by`. The model never adds,
   counts, averages, or ranks by reading rows. Two reasons: language models are
   unreliable at arithmetic over many rows and confident about it, and an aggregate is
   small by construction, so the size cap in decision 12 almost never bites. Free reads
   exist precisely so SQL can be asked to do this (§3); relying on the model instead
   would waste the guarantee the architecture already bought.

### The loop

5. **A real loop, not a fixed pipeline.** The model receives one tool and a step budget
   and decides its own next step. A three-stage pipeline (read the vocabulary → map the
   words → compute) answers the anticipated question and then needs a retry branch for
   malformed SQL, an unknown column, or an empty result — and a retry branch is a loop
   that is embarrassed about itself. One honest bounded loop is simpler than a pipeline
   with escape hatches, and it handles the questions nobody anticipated.

6. **The loop's only tool is the physically read-only adapter, so its blast radius is
   zero by construction.** An agent loop is normally dangerous because an agent can act;
   this one can only look. Every step runs against `SQLITE_OPEN_READONLY` plus the
   authorizer, so a mutating statement fails at the SQLite seam no matter how many turns
   the loop takes or how wrong it goes. Safety here is structural, never behavioural, and
   never the classifier's job.

   **Which half of the existing port this is.** `CapabilityQueryPort` in
   `src/runtime/data/tool.ts` exposes two methods: `all()`, which projects declared
   aliases into plain rows, and `records()`, which resolves target ids into rehydrated
   canonical records for presentation. A `data_query` wants aggregate rows, not records,
   so it reuses `all()` and never `records()`. The scope machinery generalises without
   change: `CapabilityQueryScope` is `{ target, dependencies }`, `assertScopedQuery`
   enumerates the tables a statement actually opens from its `EXPLAIN` opcodes rather
   than by matching strings, and a whole-catalog scope is simply one whose dependencies
   are every other active incarnation. `CapabilityQueryScope.signal` is already the
   platform-owned cancellation seam decision 10 needs.

7. **The loop's queries run in a Worker holding its own read-only connection.**
   `bun:sqlite` is synchronous and `src/platform/persistence/db.ts` opens on the main
   thread, so a clumsy join across three capabilities would block the event loop and
   freeze the whole desk — no requests served, no streams advancing. Verified on Bun
   1.3.12 against `data/omni-crud.db`: a read-only connection opens inside a Worker; a
   write through it still fails with "attempt to write a readonly database"; the main
   thread ticked 39 times out of an expected 40 during two seconds of a runaway recursive
   query; and `terminate()` killed that synchronously-running query in ~300ms. The safety
   seam survives the move, which is what makes the move admissible at all.

8. **Ten steps.** Capabilities in this PoC are simple and the questions asked of them are
   simple; a budget that a real question never approaches is the right shape for a
   measurement we do not have yet. Decision 32 records the number that will tell us
   whether ten was generous or tight.

9. **No timeout. Slow is allowed.** This replaces `docs/modules.md` 6.2's "defensive
   `LIMIT` + timeout". Waiting is a product cost the user accepts; freezing was a liveness
   bug, and decision 7 fixes that structurally instead of trading one against the other.

10. **The loop is cancellable, and cancellation is `terminate()`.** Three triggers: the
    user asks something new, the user dismisses the answer window, or a capability the query
    holds a token for begins closing for deletion. The third matters most — an in-process
    synchronous query **cannot** observe cancellation, so today M4's read-gate drain
    (`DEFAULT_READ_DRAIN_TIMEOUT_MS`, 15s) could only wait and time out against a long
    query. In a worker the gate's signal becomes a real kill. The worker turns the
    deletion drain from a hope into a mechanism.

11. **Read tokens are acquired and released on the main thread, unchanged from 6.2.** The
    complete per-incarnation token set is acquired atomically against one catalog snapshot
    or not at all, and released in `finally`. The worker is only where SQL *executes*;
    ownership never moves into it, and the worker never receives a token.

12. **The size cap refuses; it never truncates.** A step whose result exceeds the cap
    fails, and the failure is addressed to the model — *that returned too much, narrow it
    or aggregate it* — so the model writes a better query and the loop continues. Silent
    truncation is how a prose answer becomes a lie: half the expenses summed with total
    confidence, and no table on screen to expose it. The cap is measured in payload size,
    not rows, because ten thousand `(month, total)` pairs are trivial while two hundred
    long-text notes are ~100k tokens re-sent on every subsequent turn. It is a worst-case
    backstop, not the primary mechanism; decision 4 is what keeps payloads small.

13. **The residual risk is recorded rather than engineered away.** With no timeout, a long
    query holds its read tokens, and a deletion admitted during it will cancel that query
    rather than wait. That is correct behaviour — the deletion the user confirmed wins over
    the question they can ask again — and it is written down here so the next reader finds
    a decision instead of a surprise.

### What Aluna says

14. **The narration is predefined phrases keyed to a closed set of step labels.** The
    model's tool call carries its SQL *and* a label drawn from a closed vocabulary
    (looking at what things are called, counting, totalling, listing, checking dates, and
    a generic fallback). The platform owns the sentence for each label. The model cannot
    invent progress, cannot report a number it has not computed, and cannot narrate in
    words that are not Aluna's. This is the house pattern — closed token defaults with a
    disciplined escape hatch — already used for the field vocabulary and the logo prompt.

15. **The narration is product voice, never machinery.** She says *"seeing what you call
    things"*. She never shows SQL, a table name, a column, an error string, or a step
    count. The moment SQL appears on screen Aluna is an engineering tool, and §9.7 says
    she is never one.

16. **Aluna says what she looked at before she says what she found.** Not the SQL — its
    meaning: *"looking at your expenses from last month, under groceries…"*. Deleting the
    table deleted the receipt, and this is the honest replacement, because it shows what
    she **decided** rather than what she found. A user who reads "under groceries" and
    calls those Food catches the mistake instantly, and correcting her costs nothing
    because the whole answer is disposable. It also carries the scope (decision 27) at no
    extra cost.

17. **Zero rows is never stated as a fact about the user's life.** The platform can tell
    the difference deterministically — `count` returns `0`, `sum` over no rows returns
    `NULL` — so this is a code check, not a model judgment. "You spent nothing on
    groceries" is a claim about the user; "I couldn't find any groceries in your expenses"
    is a claim about her search. She is only ever permitted the second.

18. **The model is shown the vocabulary of the data, not an embedding of it.** `choice`
    fields already declare their options in the registry (`src/registry/fields/choice.ts`),
    so that vocabulary costs nothing; small categorical string fields are enumerated by a
    bounded distinct read, which is one of the loop's ordinary steps. This is one person's
    app: an expenses capability has perhaps fifteen categories, ever, and the entire
    vocabulary of the user's data fits in a few hundred tokens. Embeddings exist to search
    a space too large to enumerate, and this space is small enough to enumerate.

19. **Semantic storage is declined, and the model expands meaning in its own SQL
    instead.** The model already knows "mother", "mum" and "mom" are one idea, and free
    reads exist so it can put that knowledge into the query. Storing embeddings would make
    this a **write** feature wearing a read costume: an embedding computed on every save,
    recomputed on every edit, deleted on every delete, rebuilt on evolution and swept on
    capability deletion through the incarnation and tombstone machinery — a fourth derived
    artifact beside the Handler, the renderer and the tests, with its own version key, its
    own lifecycle recovery, its own coordinator traffic, and an AI call on the write path
    where the speed thesis lives. A module named *Reads Set Free* does not bolt an engine
    onto the write side. If the cheap version proves insufficient in use, semantic storage
    earns its own ADR and its own module.

20. **When nothing can answer, she names the gap and stops.** *"You don't have anywhere
    for hiking trips yet — you can ask me to make one."* No button, no confirmation
    control. An offer-with-a-yes is a **proposal**, and the proposal surface belongs to
    Module 8: `intent/schema.ts` presently admits only `requires_confirmation:
    z.literal(false)`, and its own comment reserves confirmations for M4 deletion and M8
    proposals. The information still arrives, and the action is one ordinary sentence away
    in the box already under the cursor. This is the first place M8 should wire its
    proposal surface when it has one.

### The surface

21. **The answer opens in its own window, and it displaces nothing.** The desk stands
    three singular windows — the capability window, the developer panel, and the answer
    window — each opened from its own place, none replacing another, and still no window
    manager. **A capability stays open while it is asked about**, which is the whole
    reason this is a window rather than something anchored to the prompt bar. It reuses
    what `public/desk-window.js` already exports (`openWindow`, `dismissWindow`,
    `nameWindow`) rather than introducing a new surface primitive.

    **It has no logo on the desk, and it is dismissed rather than put away.** A capability
    window can be put away because its logo is the way back; the developer panel has its
    own tile for the same reason. An answer has neither, because there is nothing to come
    back to — closing it destroys the information, and that is the point. This also keeps
    the logo layer meaning exactly one thing: the capabilities the user has. The developer
    tile is already drawn unlike a capability precisely so nothing confuses the two, and an
    answer icon would have muddied a distinction M5 paid for.

    **M5's one-window rule is superseded, deliberately and by this module.** That rule was
    written when the only thing a window could hold was a capability, and the developer
    panel was already its one exception — allowed because watching a build in the panel
    beside the capability is one activity. An answer is the second exception on exactly
    that reasoning: reading an answer about a capability while looking at that capability
    is one activity too. Module 5 is closed and is not edited; the change is recorded
    here, in ADR-0008, and in `architecture.md` and `CONTEXT.md`.

    Below the breakpoint the benefit does not hold, and that is accepted: `desk--phone`
    makes a window the screen, so on a phone the answer covers the capability and "ask
    while it stays open" is a desktop benefit. Putting the answer away returns the
    capability, and no phone-specific behaviour is invented for it.

22. **Nothing in this module depends on the pet.** An earlier draft of this plan anchored
    the answer to the prompt bar so the pet could inhabit it later. The window removes
    that dependency entirely. The pet is a delight feature that may never be built, and
    no plan should be written that waits on it — including Module 8's proposal surface,
    which should settle itself on machinery that exists rather than inherit this
    deferral.

23. **A refusal opens no window, and `#prompt-notice` is left alone.** The classification
    says which it is, so the window opens only once the resolver returns `data_query`;
    `reject` speaks on the prompt bar exactly as it does today. This costs one beat
    between submit and the window opening, and it means M5's decision 24 and its notice
    contract are untouched — moving answers into a window *reduces* what this module
    changes rather than adding to it.

24. **Build narration stays in the capability window, untouched.** M5's reasoning holds
    unchanged: during a build the capability window is where the user is already looking,
    and the thing being built appears there. The answer window is for questions.

25. **The window stays standing; a new question replaces its content in place.** It is
    never closed and reopened between questions — no flicker, no re-placement, no
    re-entrance animation. This is the swap the desk already does: opening a second
    capability replaces the one window's contents rather than spawning another (M5
    decision 6), and the answer window swaps the same way. Because it never closes, it
    stays exactly where and as the user left it, which needs no stored box and no third
    presentation record — it simply has not moved. Two answer windows would let answers
    accumulate, which is the property this module exists not to have, and would need the
    window manager M5 declined.

26. **There is no way back, which is what "it does not remember" means.** No logo, no
    tile, no address. Dismissing the window is the end of that answer — not a put-away it
    could be recalled from — and a reload starts with no answer window at all. Nothing
    about it is written anywhere: not the server, not `localStorage`, not the address.
    Future persistence is explicitly out of scope: no history of past answers, no reopen,
    no "recent questions", and no groundwork laid for them. An answer that could be
    recovered would be the one part of this feature pretending to persist, and decision 2
    says this module's exception runs in the direction of *less* state.

27. **A query does not lock the prompt bar.** `promptBusy` disabling the field is correct
    for a build and wrong for a question: asking something else must be possible
    immediately, and doing so cancels the running query (decision 10). Waiting for an
    answer is not the same as waiting for a commit.

### Context and refusal

28. **The open capability is context, never a filter.** It resolves vague references —
    "these", "ones", "how many did I add" — exactly as it already does for evolution
    (`src/pipeline/intent/resolver.ts`). It never fences the search: a question about
    expenses asked with Recipes open is answered about expenses. `data_query` already
    permits a non-null `target_capability` in `intent/schema.ts`, so this epic is mostly
    letting existing, tested machinery through.

29. **Scope is stated in the answer, not shown as a control.** No scope chip, badge or
    pill on the prompt bar. *"Of your recipes, six use butter"* carries the scope in
    ordinary English, so a mis-scoped answer is visible at once and a correctly scoped one
    reads as speech. Decision 16 already requires the sentence; this costs nothing extra.

30. **A question about something with no home is answered by looking, not by guessing.**
    Because a `data_query` holds the whole catalog, the loop's first step *is* "where would
    this live" — it checks whether a capability for the subject exists and whether the open
    one could answer, the same shape of check the resolver makes for evolution, and reaches
    decision 20 only when neither can.

31. **Refusal reuses the resolver's existing `reject` bucket; no new classifier is
    built.** "Delete everything" already classifies as `reject`, and
    `src/pipeline/build/admission/deflection.ts` already writes a warm line for it. Epic
    6.6 routes that line into the answer window and proves the behaviour. `docs/modules.md` is
    emphatic that this path "is never the safety seam" — decision 6 is — and a second
    classifier would be a second thing to drift from the resolver's own judgment.

### What every collection says

32. **Every collection states how many records it holds, and says so when that number is
    filtered.** Plain count at rest; when a search is active, the matched count *and* the
    total, so a filtered number is never presented as the whole truth — the same honesty
    rule as decision 17. It is platform-owned scaffolding, so generated code is untouched,
    and it is a `count` against the read connection, so it is free. It answers the most
    common question in the module before anyone has to ask it. Where it is rendered and
    how it looks are not settled here.

### Measurement

33. **The content-free metrics row gains step count and duration.** `data_query` already
    writes a best-effort row to `intent_resolution_metrics` (ARCH §6.3) carrying no
    content. Adding turns taken and wall-clock elapsed keeps it content-free — no prompt,
    no SQL, no results, nothing about the user's data — and answers the one question
    decision 8 guessed at. Latency is explicitly part of this PoC's thesis, and Module 9
    is the customer.

## What this module does not do

**It does not build the pet, and does not wait on one.** An earlier draft anchored the
answer to the prompt bar so a pet could inhabit it later; the window removed that
dependency entirely. `design/research/the-spark.md` was deleted as abandoned rather than
folded into a page, and nothing in this module reserves space for a companion.

**It does not store meaning.** No embeddings, no vector index, no full-text index. The
model's own knowledge of language, applied at query time, is the whole semantic layer.
Decision 19 states what it would cost to change that and where the decision belongs.

**It does not offer to build anything.** Aluna names a gap; she never presents a
confirmation. The proposal surface is Module 8's to design.

**It does not move build narration.** The capability window keeps it.

**It does not add a fourth window, or a window manager.** Three singular windows, each
opened from its own place. Anything wanting a fourth should argue it against decision
21's reasoning rather than cite it as precedent.

**It does not add a table, a chart, an export, a saved query, or a history of past
answers.** Every one of those makes a disposable answer persistent, which is the one
property this module exists to preserve.

## Approved epic build order and boundaries

Numbered in build order — build them 6.1 → 6.6 top to bottom.

### 6.1 — What every collection holds
Decision 32. Standalone, dependent on nothing else here, and visible on the first day.
Platform-owned collection scaffolding only; no generated code, no query path.

### 6.2 — Ephemeral whole-catalog read, in a worker
Decisions 2, 6, 7, 10, 11, 13. The Worker and its read-only connection, the atomic
per-incarnation read-token set against one catalog snapshot, release in `finally`,
cancellation as `terminate()`, and the gate-close signal wired to it. Proves the write
refusal survives into the worker and that the main thread stays live under a runaway
query.

### 6.3 — The query loop
Decisions 5, 8, 9, 12, 14. One tool, the closed step-label vocabulary, the ten-step
budget, the refusing size cap. Headless and fully testable against fixtures.

### 6.4 — What Aluna says
Decisions 4, 16, 17, 18, 19, 20. Vocabulary in the prompt, computation pushed into SQL,
the restatement, zero-row humility, the gap answer. Still headless.

### 6.5 — The answer window
Decisions 1, 3, 15, 21, 22, 23, 24, 25, 26, 27. The third window, opened when the resolver returns
`data_query`, with the loop's narration and the answer streamed into it over the
existing per-job stream (ADR-0002).
**The first point the module can be seen**, and where the living demo begins. Decisions
1 and 24 land here rather than in an epic of their own: both are already true of the
running system — the resolver classifies `data_query` without a mode switch, and build
narration is in the window — and 6.5 is the one place the query path meets the prompt
path, so it is where either could quietly stop being true. The stale `data_query`
deflection line in `src/pipeline/build/admission/deflection.ts` ("I can't answer across
your things yet") becomes false the moment this epic lands, and is removed here.

### 6.6 — Context and refusal
Decisions 28, 29, 30, 31, and the metrics of decision 33. Smallest epic: mostly letting
tested resolver machinery through and proving the behaviour.

## Module acceptance

### Living demo

Run `bun run reset`, start Aluna on `:3030`, and build Notes and Expenses from the prompt
bar. Add a handful of records to each, giving the expenses categories that do **not**
literally read "groceries" — food, cheese, vegetables.

1. Open Notes. The collection states how many notes there are. Search for something that
   matches a few; the count says how many matched *and* how many there are.
2. **Leave Notes open** and ask *"how many notes did I add last week?"* A second window
   opens beside it, Aluna narrates in her own voice while she works, then answers in a
   sentence — and Notes is still open behind it, unchanged. No table anywhere, and no logo
   is added to the desk.
3. Ask *"how much did I spend on groceries?"* Watch her look at what things are called
   before she totals anything, and watch her say which categories she counted. Correct her
   if she is wrong and ask again; the second answer arrives in the same window, and costs
   nothing.
4. Ask a question that crosses both capabilities. One spoken answer.
5. With Notes still open, ask *"how many did I add this month?"* — she scopes to the open
   capability and says so in the sentence. Then ask about expenses with that window still
   open; she answers about expenses, not about what is on screen.
6. Ask about something you do not track at all. She names the gap and mentions you can ask
   her to build one. No button appears.
7. Type *"delete everything."* A friendly refusal **on the prompt bar** — no window opens
   for it, and the answer window standing from step 6 is left alone.
8. Ask several questions in a row and watch the window stay put — the content changes in
   place, the frame never closes and reopens. Then dismiss it and confirm there is no
   logo, tile or address that brings that answer back. Reload and confirm nothing of it
   returns.
9. Open the developer panel and confirm three windows coexist, none displacing another.
10. Start a long question and immediately ask a different one. The first is abandoned and
    the second answers, without the prompt bar ever locking.
11. Confirm the desk stayed responsive throughout, and that no registry row, version,
    artifact, cache, or read dependency was created by any of it.

### Deterministic acceptance companion

- A write attempted through the worker's connection fails at the SQLite seam, and the
  main thread remains responsive while the worker runs a pathological query.
- The complete read-token set is acquired atomically or not at all; a deletion admitted
  mid-query closes the gate, cancels the query, and drains.
- The loop stops at ten steps and says so in product voice rather than answering half.
- An over-size step is refused, not truncated, and the loop recovers by narrowing.
- Zero matched rows never renders as a statement about the user's data.
- The narration renders only platform-owned sentences; no SQL, table name, column, or
  error string can reach the surface.
- The answer window is singular, refreshed rather than stacked, and unaffected by opening
  or putting away a capability.
- The answer window has no logo on the desk and no address; dismissing it leaves no route
  back to the answer, and a reload restores nothing of it.
- No registry, version, artifact, cache, or `read_dependencies` row is written by any
  query path.
- The collection count matches the rows rendered under it, filtered and unfiltered.

## Exit criteria

Free-form reads work across every capability through the physically read-only supplied
adapter and its static contract, executed in a worker that cannot block the desk and can
be cancelled. Answers are spoken by Aluna in a window of their own that displaces neither
the capability window nor the developer panel, so a capability stays open while it is
asked about, and they create no
registry/version/artifact/cache/read-dependency state. Every collection states how many
records it holds. M8 may later record the ordinary user action in the Event Log without
turning a query into a capability, and remains free to design the proposal surface that
decision 20 deliberately leaves unbuilt.

## Issue conversion

The amendments listed at the top of this plan and ADR-0008 landed first, so issues cite
an architecture that agrees with them. Decision numbers in this plan are stable and are
cited by issue files; renumbering them later would break those citations.

Done in the conversion session of 2026-09-03: **23 issues across 6 epics**, in
`modules/06-reads-set-free/6.1-…` through `6.6-…`. Epic numbers are build order, and
conversion cut each epic into independently actionable issues that leave the repo
working and testable as they land. Every one of the 33 decisions above is cited by at
least one issue, and every issue names its blocker by path.

**6.1 is the module's independent branch and does not gate 6.2.** A collection count and
a query worker share nothing, and the plan already says 6.1 depends on nothing else here.
Splitting it off lets the module's one piece of first-day visible work — which carries a
human sign-off gate — run beside the headless 6.2 → 6.4 trunk instead of behind it. The
trunk is otherwise strictly linear: 6.2/01 → 6.6/04.

**Two decisions are cited outside the epic that owns them, and each issue says so where
it happens.** Decision 10's cancellation mechanism is 6.2's, but two of its three
triggers — a new question, a dismissed answer — have no raiser until the speech
surface exists,
so 6.5/04 connects them to the same entry point rather than building a second one.
And
decision 8's ten-step budget is 6.3's, while the measurement that will judge it is
decision 33's in 6.6.

**Two decisions the epic list assigns to no epic are settled in 6.5/03**, where the
prompt path meets the query path: decision 1 (one prompt bar, and the sentence decides)
and decision 24 (build narration stays in the window). Both are satisfied largely by
what already exists, which is presumably why the epic list passed over them; 6.5/03 is
where each could quietly stop being true, so each is asserted there.

**Seven issues carry a human sign-off gate** rather than merging on green — a higher
share than Module 5's two in thirty-five, because this module's output is almost entirely
authored product voice and one new visible surface whose drawing the plan deliberately
leaves open. They are 6.1/01 (where the count lands), 6.3/04 (the narration vocabulary),
6.4/03, 6.4/04 and 6.4/05 (the answer, the zero-row form, the gap sentence), 6.5/01 (the
answer window itself) and 6.5/03 (the module as the user meets it).

**The module is invisible from 6.2/01 to 6.4/05.** Rather than leave that integration gap
unlit, 6.3/01 stands up a developer-gated exercise of one loop turn behind
`developerSurfacesEnabled()`, which 6.4's issues then use to read Aluna's sentences before
there is an answer window to read them in. It is scaffolding, and 6.5/05 — its own issue, not a clause inside another one — takes
it down once 6.5/03 has made the real path visible, re-homing every assertion that ran
through it rather than deleting the coverage with the surface.
