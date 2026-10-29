# 0006 — Capability evolution and deletion: total diffs, immutable publication and frozen intent

Status: Accepted

## Context

An evolution changes a live capability in place. Books gains a finished date or a
new card, and it keeps its id, its incarnation, its table, its records and its logo
while the code underneath changes. That code is written by a model, so its rebuild
scope cannot be left to the model or to the code itself. A scope that copies a unit
whose real input changed ships a capability that no longer matches its spec.

The stores a version touches share no transaction. SQLite holds the registry and the
records, the file system holds every version's code, and the object store holds
uploaded files. A crash can stop work between any two of them.

A Handler may read another capability's table through a declared dependency, so one
capability's SQL can depend on a table that a deletion is about to drop. The
behavioral tier adds one more constraint: it holds only if a tier-off version carries
no tests and a frozen test runs again whenever code it covers changes.

## Decision

### Canonical candidate and deterministic scope

An evolution asks the model for one complete candidate spec, never a patch, and
deterministic platform code validates, diffs and activates it. The candidate holds
the complete field catalog, hidden fields included, plus `behavior`, the Action-owned
`behavioral_errors`, `ui_intent`, the five Actions, `read_dependencies` with one key
per Action (an empty array included), the label and record nouns, the logo birth
facts (`subject`, `ground`, `companion`) and the Intent Resolver's `prompt_context`.
While the build lease is held, candidate generation also receives the id,
incarnation, label, `prompt_context` and active fields of every other capability it
may read from.

The platform owns the rest: incarnation, version, build id, snapshot metadata, the
artifact pointer, SQL identifiers, additive DDL, the logo seed and lifecycle
(ADR-0007), relations (ADR-0011) and a nullable `display_label_override`, which the
Resolver and the shell read ahead of the authored `label`. None of these reaches a
candidate, and every evolution carries the logo, the relations and the override
forward unchanged.

Rename writes the override and nothing else, makes no version and calls no model.
The catalog fingerprint covers the override, so a build queued before a rename is
refused as stale.

A relation change makes no version either: a relation diff of its own maps it to
platform work, so the change-fact contract does not grow. Hiding a relation's source
or target field, or an evolution that breaks one of its rules, makes the relation
dormant, and reactivating the field or mending the rule revives it with its link rows
(ADR-0011).

The capability id, every field's name and type, and the logo birth facts are
immutable, and every spec carries exactly the five Actions. Every committed field
comes back exactly once: omitting one is invalid, never a soft hide. A field that
stays hidden comes back unchanged, and hiding a field changes its lifecycle and
nothing else. Reactivation may change the field's label, `required` and `max_length`
in the same step, and the Diff facts union. A new field is born active. Every declared
read dependency must name a pair in the catalog frozen under the build lease.
Validation checks the spec schema, then the rules against the committed spec,
reporting every violation in a pass at once; any violation ends the run.

The card's shown fields and the form's intents follow ADR-0005's closed contract,
checked against the candidate's active fields: a hidden field drops out of both, and
an entry naming a hidden, unknown or ineligible field fails validation.

Committed values stay admissible. A choice's committed option values may be appended
to, never removed or renamed, and a file field's accepted families may only widen
(ADR-0009). A retired option stays valid in the rows that hold it but can no longer be
picked. A new or lower `max_length` is refused when a scan under the build lease finds
a committed value over it, in hidden fields' columns too, because such a row could be
read but never saved again. Retiring an option, changing a limit or widening families
moves platform validation and the writing Actions' test inputs, never a Handler
prompt. An appended option also regenerates create and update. Option labels, notes,
order and groups, long text and field guidance are presentation and never reach a
Handler. None of these facts selects logo or DDL work, and generated Handlers never
repeat the platform's checks.

The Diff Engine turns every difference between the committed spec and the validated
candidate into a typed change fact. One matrix maps each fact to platform work, the
generated units it regenerates and Gate work, and the effects of several facts only
union. Once every region a fact accounts for is set aside, the rest of the two specs
must be identical, and a difference no fact explains stops the run before
publication. A unit is copied byte for byte only on the matrix's positive proof that
no fact selects it. The same matrix projects each regenerated unit's generation
context.

Free-text `behavior` names no Action, so a change to it regenerates all five Handlers
and runs the complete suite. An Action-owned error or read-dependency change
regenerates only the Handlers it names; malformed or unknown ownership fails
validation before the Diff.

A regenerated unit sees its old source only when deterministic checks prove, before
any model call, that the source references nothing outside the unit's current
generation contract: no hidden field name and no undeclared capability table, even in
a dead string. Otherwise the unit regenerates without it. A copied unit never enters a
generation prompt. A bounded Gate repair may still rewrite one, and the rewritten unit
then counts as regenerated and records fresh provenance.

A candidate that produces no fact is the measured no-op. It finishes as
`lifecycle_status=success, outcome=no_change`, with no DDL, no copied units, no
snapshot, no version, no pointer move and no View `commit`. Equality is over the
validated canonical value: object keys and set-like lists compare without order,
while ordered lists (field order, the card's shown fields, choice option order) keep
their order, so reordering one is a change.

### Generated data interfaces and dependency compatibility

Generated code reads and writes through ADR-0004's injected toolbox. Every Action may
query through parameterized SQL on the physically read-only connection, limited to its
own table and the exact committed `{ capability_id, incarnation_id }` pairs it
declares. Mutation is bound to the capability, or to the record target the router
validated, and runs inside one SQLite transaction the mutation coordinator owns, so a
Handler or presentation failure rolls the write back. A Handler that produces records
returns ordered, unique ids, which the platform rehydrates and hands back as active
projections. A copied reader therefore keeps working when its own capability gains a
field that changes no behavior, and the value of a field that capability hides never
reaches the projections of its records, their markup or the DOM.

Search compares text through one platform-owned SQLite scalar function. It folds
case, and strips accents only from Latin letters, so "Café" matches "cafe" while
voicing, vowel and tone marks in other scripts survive. An empty field matches no
term. Bun cannot register a scalar function, so the platform compiles a small native
bridge to one.

Dependency identities are committed inputs to the Diff and to behavioral tests. New
generation sees only each dependency's active fields. Execution and the Gate's scratch
database use the stable physical catalog, where field names and types never change and
hiding drops no column. A Handler committed earlier may therefore keep reading a field
its owner later hides: hiding is neither erasure nor read revocation, though no new
generation can start depending on that field. A query exposes only the closed alias
and type projection it declares, so copied code never observes the extra columns of a
`SELECT *`. Adding, hiding or reactivating a field rebuilds none of the capabilities
that read it. Deletion, by contrast, refuses while a live capability declares a read
dependency on the target, because dropping a table is not an additive change.

### Frozen tests and immutable snapshots

Behavioral test generation follows authored intent and each Action's total inputs,
and test execution follows executable impact. An Action's inputs are `behavior`, its
declared errors and read dependencies, and the validation shape of the fields it
handles. When they change, the build writes that Action's suite again, on its own,
before any Handler byte is generated or repaired. A suite whose inputs are unchanged
and which still fits the current test contract is copied byte for byte, and it runs
whenever a Handler it covers changes. The complete frozen suite runs when coverage or
failure attribution cannot be narrowed: a `behavior` change, a change to the card's
shown fields, or the shared item renderer moving, whether regenerated beside a Handler
or repaired by the Gate. No test is regenerated or weakened after a Handler fails it.

The behavioral tier is global. A tier-on snapshot carries frozen tests and a tier-off
snapshot carries none. The first spec-changing build after the tier is switched on
authors every suite from current intent and runs it. Switching the toggle alone
creates no version, and a measured no-op does not apply the transition. A version
built with the tier off drops the prior frozen tests unrun.

Each version is a complete immutable directory at
`capabilities/<id>/<incarnation_id>/v<n>/`: the six generated units, the exact
`spec.json`, `tests/behavioral.json` when the tier was on, and a platform-written
`snapshot.json` with the file inventory and digests, each Action's test source and run
reason, and per-unit provenance. Provenance names the context and the dependency
snapshots each unit was generated from. It is audit evidence only, never authored
spec, an equality input, a Diff fact or a cascade trigger, and a copied unit carries
its provenance forward.

### Admission, metrics, publication and presentation

Prompt resolution changes nothing. A resolved build request binds either
`expected_absent` or the exact `{ capability_id, incarnation_id, expected_version }`,
plus the fingerprint of the active catalog the Resolver classified against, which
leaves out logos and relations. The request takes a FIFO ticket. Only the ticket at
the head of the queue acquires the build lease, and both bindings must match again
before the build starts. A mismatch is a stale refusal, never a silent
reclassification, and writes one terminal `failed/stale` row without entering
`running`. After the check passes, the platform freezes the dependency catalog,
assigns or confirms the incarnation, and writes `lifecycle_status=running` just before
the first Core Builder provider call. A prompt that builds nothing, whether a refusal,
a deflection, a question or a linking-only request, writes no generation row. A
refusal, a deflection or a question leaves a content-free measurement, best-effort, in
`intent_resolution_metrics`; a linking-only request leaves none (ADR-0011).

Publication stages the build at a unique path on the same file system, requires Gate
success, verifies the exact inventory and digests from disk, and renames the directory
to its version with a rename that never overwrites. Activation follows in one SQLite
transaction. It applies the additive DDL, compare-and-swaps the registry row's spec,
version and pointer, wakes dormant relations that hold again, writes the link step's
relations and finalizes the row as `success/activated`. An evolution's transaction
also re-verifies, just before COMMIT, every other capability's snapshot against the
one frozen under the lease, so no provenance names bytes that changed. The SQLite
commit is activation's point of no return. A failure before it may leave a complete
`v>N` directory that never went live, never a live partial snapshot.

For an incarnation live at version N, every `v1..vN` is committed history, verified
at boot and before an evolution publishes. Recovery removes only directories the
metrics prove never activated, and a missing or damaged committed version fails
closed. Nothing moves the pointer backward or reclaims committed history; either
would need a durable activation ledger first.

After activation, a failure in presenter rendering, SSE delivery, the client
connection or the terminal signal cannot roll back the pointer or turn the build into
a failure. The registry stays the recovery authority: the presenter asks the person to
refresh, and a reload rebuilds the desk from the registry.

The Core Builder consumes an already-resolved request and owns no prompt routing, DOM
or SSE, so any loop that produces one can drive it without reclassification. The
explicit presenter emits one View `commit`, only after activation. Before it takes the
window it stores a data-free restoration descriptor naming the open capability or the
bare desk, never search terms, records, an open edit or a draft. Every other terminal
resolves the descriptor against the current registry and streams its canonical View
through ADR-0002's `fragment` event before `done`. Cancellation restores at once,
because the person who pressed Cancel already knows why the run stopped. A measured
no-op, a rejected candidate, a stale refusal and a failure each end the narration with
their own authored line and hold the window until the person dismisses it. Terminal
presentation is bounded, and the build lease releases in `finally`.

### Dependency-safe permanent deletion

Delete opens from the logo's context menu, beside Rename (ADR-0007). It is never on
window chrome, so closing the window only puts it away and no lamp is signal red. The
question is asked over the window, the way leaving a running build asks. The
capability's own collection, as it opens, stands dimmed and inert under a veil, and a
panel over it asks whether to delete the capability permanently. Its one sentence says
how many records go with it, when they can be counted, and that this cannot be
undone. It names no versions, files or kept measurements. When another capability
reads from this one, the panel says so. **Keep it** goes back to whatever the question
displaced, and **Delete permanently** confirms. The whole path is zero-AI, and Delete
is the only word for the act, in UI copy and in every document.

Confirm never queues: the deletion lease is a try-acquire, refused at once while any
lease is held or awaited. Under the lease the platform revalidates the exact target
incarnation and refuses while any live capability declares a read dependency on it. A
relation names its target's incarnation but is no read dependency, so it never blocks
a deletion.

Every route, query and file serve holds per-incarnation read tokens. Work that reads
several incarnations takes its whole token set atomically against one gate and catalog
snapshot, or takes none. The linked-text refresh, a deletion's clearing, the record
view's listed cards and a search's link walk instead take each linking capability's
token on its own and skip one that is closing (ADR-0010, ADR-0011).

The deletion closes the target's read gate, refuses new tokens, aborts the readers and
waits up to 15 seconds for them to drain. That deadline sits above the 10-second Handler
timeout, so a route bounded by the Handler timeout always drains in time. A logo attempt
and a question hold their tokens across provider round trips, which that bound does not
cover; each observes the closing gate, ends its call and lets go as it unwinds
(ADR-0007, ADR-0008). A drain that runs out reopens the gate and returns the typed
outcome `deletion_drain_timeout`, a refusal that invites a retry, distinct from the
generic failure. Reads are not capped shorter to speed up a rare operation. Token sets
release in `finally`, and nothing is destroyed while a reader remains.

While the table still exists, cleanup adapters collect the owned-resource manifest:
the incarnation directory, with every version and the logo, and every file key the
ledger holds for the incarnation. One SQLite transaction then makes the registry row a
non-routable tombstone holding that manifest. It removes every relation at either end
as Unlink does, so each linking record keeps its text. It deletes the incarnation's
ledger rows and drops the table. The same transaction purges the incarnation's
payloads from an Event Log store when one is installed, in fixed core SQL that runs no
generated code; Aluna ships none. The commit is deletion's point of no return, and
content-free generation metrics survive it. Idempotent cleanup then removes the files
and the directory, and last the tombstone. It retries on a short backoff and again on
the next page load or boot, and it can never bring the capability back. The tombstone
reserves the id until cleanup finishes, and rebuilding the id afterwards makes a new
incarnation.

Every way a deletion is turned down before the commit leaves reads open and everything
intact: busy, stale, blocked by a reverse dependency, `deletion_drain_timeout` and a
failure before commit. Each answers with an ending in the same panel, one authored
sentence in place of the question and one **Continue** control, and the window holds
it until the person dismisses it. The press takes the data-free route **Keep it**
takes, resolved against the registry at that moment, so a capability gone meanwhile
gives back the bare desk. A window torn down over an unread ending carries its
sentence to the prompt bar.

On commit the logo leaves the desk, and the prompt bar says the capability was deleted
permanently. The window puts itself away when the deleted capability was the one open
or the desk was bare, and otherwise restores the capability the confirmation
displaced; the address follows. A target already gone when the question or Confirm
arrives is handled the same way, and the prompt bar says it was already gone. When a
Confirm's reply never arrives, the client asks the server what happened, so a
permanent deletion never looks like it did nothing. An address naming a deleted
capability loads the bare desk with a brief notice, which covers a second tab, a
bookmark and a reload without a window state of its own.

## Considered options

**A patch from the model.** The platform validates and diffs whole specs, so the
authored spec stays the one source of truth and nothing generated chooses its own
rebuild scope.

**A minimal rebuild scope, chosen by heuristic or by the model.** A minimal scope can
copy a unit whose real input changed; the total diff copies a unit only on positive
proof that nothing it depends on moved.

**Regenerating every unit on every evolution.** It regenerates units no fact touches
and throws away bytes the previous frozen suite already passed.

**One atomic step across SQLite and the file system.** SQLite cannot transact a rename
or an object-store delete. Publication writes files first and activates in SQLite;
deletion commits in SQLite first and cleans files after, so every crash point is one
recovery can repair.

**Deleting dependents along with their target.** It would destroy capabilities the
person never chose to delete, so deletion refuses and names the dependents instead.

**A staleness bus, version stamp or refresh lamp for reads across capabilities.** The
desk shows one capability at a time, every open is a fresh read, and builds and
deletions both take the window.

**SQLite `NOCASE` or `lower()` for search.** Both fold ASCII only, so neither matches a
composed letter to its decomposed form, an accented Latin letter to a bare one, or case
outside ASCII.

## Consequences

- Capability id and incarnation are different concepts. Evolution preserves both, and
  delete and recreate reuse the id only with a new incarnation, after cleanup
  ([Evolving a capability](../architecture.md#48-evolving-a-capability),
  [Deleting a capability](../architecture.md#413-deleting-a-capability)).
- The local runtime needs a C compiler, the SQLite extension headers and, on macOS,
  an extension-capable SQLite: Homebrew's by default, or one named by an environment
  variable (README).
- The matrix is stated one case per row in
  `src/pipeline/evolution/matrix/evolution-matrix.cases.ts`, and
  `evolution-matrix.test.ts` runs every row end to end through the Diff Engine
  (`src/builder/evolution/diff/diff-engine.ts`). The tier table is
  `src/pipeline/evolution/tiers/behavioral-tier-transition.ts`. A new spec fact
  extends the matrix and the engine together.
