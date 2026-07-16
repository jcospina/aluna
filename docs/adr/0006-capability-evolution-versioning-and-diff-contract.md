# 0006 — Capability evolution: total diffs, immutable publication & frozen intent

Status: accepted

The fixed-five-Action candidate clauses below describe the steady state after
Module 4 epic 4.4; immutable snapshot/publication clauses apply after 4.5's
greenfield reset/rebuild makes v1 under that contract. The Module 4 PLAN's reset-
bounded 4.1–4.3 two-Action plus development-reference sequence is the sole
temporary Action-shape exception; none of this is a persisted dual-serving or
in-place artifact recut contract.

## Decision

### Canonical candidate and deterministic scope

Module 4 asks the AI for one complete candidate authored spec, then lets
deterministic platform modules validate and activate it. The candidate contains
the complete field-lifecycle catalog—including inactive fields—plus `behavior`,
Action-owned `behavioral_errors`, `ui_intent`, the fixed five Actions,
`read_dependencies`, label, and resolver context. `read_dependencies` has one key
per Action, including empty arrays. Candidate generation also receives the exact
active-field projection of the dependency catalog while mutation ownership is
held. The platform owns
incarnation, version, build id, snapshot metadata, artifact pointer, SQL
identifiers, and additive DDL.

Existing field names/types and capability id are immutable; committed-field
omission is invalid, not a soft hide. `inactive→inactive` preserves the definition
exactly and `active→inactive` changes lifecycle only; reactivation may union
label/required changes through ordinary Diff facts. A new field must start active.
Presentation dependencies may name active user fields plus the closed platform field
`created_at`, never `id`, `extra`, or inactive fields. Form presentation intent
requires exactly one `{ field, mode }` entry for every active `string[]`, in
schema-field order. Modes are closed to `comma_separated | repeatable`; scalar,
inactive, unknown, missing, duplicate, or invented entries fail candidate
validation. Choosing `comma_separated` asserts that commas are separators rather
than meaningful element data for that field; `repeatable` preserves commas within
elements. Before HTML, the platform
retains canonical rows internally and projects only Action-safe active values plus
an opaque record handle to generated Handlers; the item renderer narrows again to
its declared fields. Client state contains only the record target, allowed active
detail/edit fields, and `created_at`, so inactive/forward-compatible state never
leaks from canonical target rows into generated code, markup, or the DOM.
Update/delete mutation authority is
bound to the router-validated target before generated code runs; the Handler
cannot substitute another record.

The Diff Engine converts every admitted old→candidate difference into a typed
change fact. One normative matrix maps every fact to schema work, platform View
work, generated Handlers/item renderer, and Gate work. Effects only union. A unit
copies byte-for-byte only when the matrix positively proves it unaffected; an
unmapped admitted fact fails closed. The same matrix projects unit-generation
context. Before old source enters a regeneration prompt, deterministic
admissibility checks prove it references nothing outside that candidate unit's
current generation contract; otherwise the unit regenerates without prior source.
Copied units never enter model context and remain governed by positive proof plus
their committed compatibility contract. Free-text `behavior` has no reliable
Action ownership, so it regenerates all five Handlers. Valid Action-owned
error/dependency changes select their named Handlers; malformed or unknown
ownership fails candidate validation before Diff rather than becoming a fallback.
A list input mode change is a platform form/View and raw-input-normalization fact
only: it selects no DDL, Handler, item renderer, or behavioral-test generation.
A semantically identical canonical
candidate is `lifecycle_status=success, outcome=no_change`: no DDL, copied units,
snapshot, version, pointer update, or View `commit`. The explicit presenter
restores the canonical current committed/neutral surface through ADR-0002's `fragment`
event, then terminates normally. Equality is over the validated canonical value:
JSON object/set-like ordering is normalized, while ordered field/item/detail facts
remain semantic. Form list-input entries use active `string[]` schema-field order;
an actual mode change remains semantic, while serialization/key reordering does
not manufacture a version.

### Generated data interfaces and dependency compatibility

Every Action may query through parameterized SQL on the physically read-only
connection, limited to its target plus exact committed
`{ capability_id, incarnation_id }` dependencies. Only create/update/delete
receive canonical mutation authority: create is capability-bound, while
update/delete are additionally bound to the router-validated record target.
Record-producing read/search Handlers return ordered unique target ids; the
platform rehydrates full canonical target rows on the same read snapshot but
exposes generated code only to Action-safe active projections/opaque handles. This
keeps copied readers forward-compatible when their own target gains a behavior-
neutral field without exposing target-row inactive fields or `extra`; previously
declared external query aliases retain the separate compatibility rule below.

The mandatory search normalizer is one platform-owned SQLite scalar function.
Bun does not expose scalar-function registration, so the accepted implementation
is a small loadable bridge compiled once into the OS temp directory and connected
to the canonical JavaScript `normalize("NFKC").toLocaleLowerCase("und")`
callback. This remains an in-process persistence adapter, not a service, but it
adds an explicit local-runtime prerequisite: a C compiler and SQLite extension
headers, plus extension-capable SQLite on macOS (Homebrew by default, or
`OMNI_CRUD_SQLITE_LIBRARY`). This is preferred to SQLite `NOCASE`/`lower()`, whose
ASCII-only behavior fails the required composed/decomposed non-ASCII contract.

Dependency identities are committed diff/test inputs. New model generation sees
only active fields in each dependency. Execution and scratch use the stable
physical compatibility catalog: field names/types never change and soft-hide
drops no column. A previously committed Handler may therefore continue reading a
field its owner later hides; soft-hide is not erasure or read revocation, while
new generation cannot newly depend on that field. Query calls expose only a closed
declared alias/type result projection, so extra columns from `SELECT *` are not
observable to copied code. Add/hide/reactivate does not
cascade dependent rebuilds. Deletion still refuses a live reverse dependency
because table removal is not additive compatibility.

### Frozen tests and immutable snapshots

Behavioral-test generation follows authored intent and canonical test inputs;
test execution follows executable impact. Changed `behavior`, Action errors,
target active-schema validation shape, or dependency identities generate affected
tests independently before Handler repair. Unchanged tier-on tests copy
byte-for-byte but execute whenever a covered Handler changes; non-total coverage
or runtime failure attribution for a valid test runs the full frozen suite.
Malformed authored Action ownership never reaches this point. Tests are never
regenerated or weakened after Handler failure.

Complete immutable snapshots live at
`capabilities/<id>/<incarnation_id>/v<n>/`. Every snapshot contains all five
Handlers, `item.ts`, exact `spec.json`, and platform-authored `snapshot.json` with
incarnation/version/build id, behavioral-tier state, exact file inventory,
content digests, and audit-only per-derived-unit dependency-generation
provenance. That provenance records the exact dependency incarnation/version,
verified dependency snapshot content digest/fingerprint, and active-context digest
used when the bytes were last generated; copied units carry it forward. It is not
an authored-spec/equality input, Diff fact, or cascade trigger. `snapshot.json`
lists itself but omits its own digest. Tier-on
snapshots contain frozen behavioral tests; tier-off snapshots contain none. An
off→on transition generates tests from current intent on the next spec-changing
build; switching the global toggle alone creates no version, and a semantic no-op
does not materialize the transition.

### Admission, metrics, publication, and presentation

Prompt resolution is non-mutating and precedes build admission. A resolved build
request binds either `expected_absent` or exact
`{ capability_id, incarnation_id, expected_version }`, plus the revision or
canonical fingerprint of the active resolver catalog used to classify it. It
receives a bounded FIFO ticket; only the head acquires the active build lease and
requires both target and resolver-catalog fingerprint to match. A mismatch is
stale, never silent reclassification; the current lease-stable dependency-
generation catalog is then frozen separately. After successful revalidation, the
platform
assigns/confirms incarnation and writes `lifecycle_status=running` immediately
before Builder provider work. A stale/collision refusal writes a direct terminal
`failed/stale` row without first entering `running`; incarnation is nullable only
for new-capability stale refusal before assignment (catalog mismatch or expected-
absent collision).
Resolver-only `reject`/`data_query` outcomes create no generation row; their
content-free classification/timing/outcome, plus cancellation/expiry before an
active lease, may be written best-effort to `intent_resolution_metrics`. User
completion never waits and a crash may lose an unwritten non-admitted row.
Durability begins with a direct lease-head stale row or `running` generation row;
admitted build rows embed the resolver measurement without duplication.

Publication uses unique same-filesystem build staging, Gate success, exact
inventory/digest verification, and atomic no-overwrite rename. The verified final
directory is published before one SQLite transaction applies additive DDL,
compare-and-swaps registry spec/version/pointer, and finalizes
`success/activated`. That SQLite commit is activation's point of no return. A
database failure before commit may leave a never-activated
complete `v>N` candidate, never a live partial snapshot. For an active incarnation
at version `N`, every verified `v1..vN` is committed immutable history even when
not the live pointer; recovery may remove/quarantine only state positively proven
never committed. Missing committed history is corruption and fails closed. A
future restore/changelog feature must add a durable activation ledger before any
backward pointer or committed-history reclamation.

After activation, presenter rendering, SSE delivery, client disconnect, or
terminal-signal failure cannot roll back the pointer or reclassify the build as
failed. The registry remains the recovery authority.

The core Builder consumes an already-resolved request and emits lifecycle events;
it owns neither prompt routing, active DOM, nor SSE. The explicit presenter turns
those events into the foreground product-voice story and emits one complete View
swap only after commit. Before foreground replacement it stores a data-free active
capability/neutral restoration descriptor. No-change, stale/collision,
cancellation, and failure resolve that descriptor against the current registry,
restore the canonical View/read state via `fragment` without a toolbar sidecar,
clear search, close modal/edit/delete-confirm state, and send `done`; `commit`
remains activation-only. Terminal presenter work is bounded and active ownership
releases in `finally`. A failed post-activation delivery is recovered by normal
shell/toolbar registry rehydration and leaves `success/activated` intact. Module 7
may reuse the same Builder with a different confirmed-proposal presenter without
reclassification.

### Dependency-safe permanent deletion

Confirmed capability deletion uses the same mutation coordinator and never
queues. After atomic try-acquire it revalidates the exact target and reverse
dependencies. Every route/query/file serve uses per-incarnation read tokens;
multi-incarnation work acquires its complete token set atomically against one
gate/catalog snapshot or receives none. Deletion changes the gate to closing,
refuses new tokens, and drains/cancels existing readers by a fixed deadline. All
token sets release in `finally`. Pre-transaction timeout/failure reopens the gate;
destruction begins only at zero readers.

While the table still exists, cleanup adapters collect a deduplicated
capability-owned resource manifest. When M6 is installed this absorbs committed
active/inactive file references, pending ownership, and already-enqueued cleanup
for the target incarnation. Event ownership provenance is derived server-side
from admitted route/query/read-token context and canonical payload production;
client/model incarnation labels are not trusted. One SQLite transaction makes the
registry row
a non-routable tombstone, removes the table, and purges/redacts installed Event Log
payloads. Idempotent post-commit cleanup removes artifacts/external resources and
then the tombstone. The tombstone reserves semantic id/incarnation until cleanup
finishes; same-id recreation receives a new incarnation. Event batches carry all
incarnations whose product data they contain and are accepted only while every
server-derived pair is active/current, so a late pre-deletion batch cannot
resurrect purged data. Before tombstone commit, refusal/timeout/failure reopens
reads and restores the canonical View. Commit makes the capability immediately
absent from toolbar/routes; if it was active the content becomes neutral,
otherwise the current active capability remains. Later cleanup failure cannot
resurrect it.

## Context / why

The authored spec remains the source of truth, so generated code cannot choose
its own rebuild scope. Complete snapshots keep routing, inspection, and future
restore work comprehensible. Total positive-proof diffs avoid “minimal”
regeneration that copies a unit whose real input changed, while target-id
rehydration makes safe copies explicit rather than aspirational.

SQLite cannot transact filesystem publication or object-store cleanup. Staging +
publish-first activation and database-first logical deletion establish recoverable
points of no return instead of claiming impossible cross-store atomicity. The
behavioral tier remains a useful experiment only when tier-off snapshots carry no
tests and frozen tests rerun against changed code.

Free reads add lifecycle coupling: one capability's SQL can depend on another
table. Declared incarnation dependencies keep queries expressive and deletion
truthful without turning additive evolution into cascading rebuilds.

## Consequences

- Amends ADR-0005's `ui_intent.item` shape with `direction + shows`; generated
  composition remains open under the closed-value design contract. It also adds
  closed form list-input intent for active `string[]` fields; the platform owns
  both controls and their normalization.
- Amends ADR-0004's injected toolbox: scoped mutation and declared free-query
  ports are distinct, and submitted-field presence belongs to the platform seam.
- A pre-activation failed build leaves the prior version live. Candidate staging/
  published paths are explicit recovery states; committed history is never treated
  as an orphan. Post-activation delivery failure leaves success intact.
- Capability id and incarnation are different concepts. Evolution preserves both;
  delete/recreate may reuse the semantic id only with a new incarnation after
  cleanup.
- Capability deletion is zero-AI, may be blocked by declared dependents, and never
  cascades or rewrites surviving generated code.
- M6 extends the owned-resource seam with the full file lifecycle; M7 extends it
  with capability-owned Event Log cleanup and chooses proposal/presenter UX.
- The detailed change-fact matrix, tier transitions, fault model, and ordered epic
  boundaries in the Module 4 PLAN are normative for issue conversion.
