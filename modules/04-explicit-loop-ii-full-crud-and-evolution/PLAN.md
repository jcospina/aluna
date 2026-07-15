# Module 4 — Explicit Loop II: Full CRUD & Evolution — Plan

Status: architecture hardened — ready to convert to issues

This refines [docs/modules.md](../../docs/modules.md) §Module 4 with the design
decisions that module ownership leaves open. It does not change Module 4's goal,
boundary, or exit criteria. Terms follow [CONTEXT.md](../../CONTEXT.md), and the
plan inherits the accepted architecture and ADRs in [docs/adr/](../../docs/adr/).
Decision record:
[ADR-0006](../../docs/adr/0006-capability-evolution-versioning-and-diff-contract.md)
(candidate-spec ownership, total unit diffs, immutable snapshots, publication,
and frozen behavioral intent). The plan reuses
[ADR-0002](../../docs/adr/0002-sse-transport-conventions.md) (the explicit-loop
foreground stream and complete `commit` swap),
[ADR-0003](../../docs/adr/0003-ai-provider-spine-and-coding-harness.md)
(bounded per-unit repair),
[ADR-0004](../../docs/adr/0004-capability-artifact-contract-and-validation-isolation.md)
(parsed Handler input, split injected tools, and scratch isolation), and
[ADR-0005](../../docs/adr/0005-opinionated-capability-ui-design-contract-and-gate.md)
(platform presentation, the item renderer, and design Gate).

## Decisions locked for issue conversion

### Spec and field lifecycle

1. **The AI authors one complete candidate spec; the platform owns lifecycle
   metadata and change scope.** Evolution receives the current committed spec,
   the resolved intent, and a full field-lifecycle catalog. It returns one complete
   candidate in the canonical authored shape: immutable capability `id`, label,
   every active and inactive field, `ui_intent`, `behavior`,
   `behavioral_errors`, the fixed five-Action `tools` set, `read_dependencies`,
   and `prompt_context`. While mutation ownership is held, it also receives an
   immutable active dependency-generation catalog containing every other capability's
   `{ capability_id, incarnation_id, label, prompt_context, active_schema }`;
   inactive external fields are not generation context, and declared dependencies
   must come from that catalog. The AI never authors the capability incarnation,
   version, build id, snapshot metadata, or `artifacts_path`. It does not return a
   patch, migration, or regeneration list. The platform validates the candidate
   and computes every consequence.

2. **Inactive fields stay in candidate-spec context, not runtime-generation
   context.** Candidate generation sees every committed field so it can preserve
   or explicitly reactivate one. The candidate must return each committed field
   exactly once. Validation rejects omission, replacement under a new name,
   duplication, or a change to an existing field's name or type before DDL or
   unit generation begins. An `inactive → inactive` definition must be identical,
   and `active → inactive` may change only lifecycle. Reactivation may combine
   `inactive → active` with mutable label/required changes; the Diff effects union.
   Inactive definitions are then excluded from newly generated Handler,
   item-renderer, behavioral-test, form, detail, and search contexts. Reactivation
   reuses the original column and stored values. A newly introduced field must
   start `active`; introducing it already inactive is invalid.

3. **`required` is a logical invariant owned by the mutation interface; storage
   remains nullable.** Beginning with 4.1's greenfield reset, both transitional and
   final M4 user-authored columns are physically nullable. The platform validates active required fields on create
   and over the complete post-merge record on update. Adding a required field
   therefore creates a nullable column: historical rows remain readable with
   `null` and show the platform empty value until edited. Aluna never invents or
   AI-backfills data, silently weakens requiredness, or asks a field-level
   confirmation. The greenfield transition uses `bun run reset` rather than
   preserving M3 `NOT NULL` columns. Requiredness is total by type: `null` is
   missing for every type; required `string` needs a non-whitespace character
   (without implicitly trimming storage); `date`/`datetime` must be non-empty and
   type-valid; finite `0` is a valid number; and both boolean values are valid.
   Create/update and `missing_required_fields` use this one definition.

4. **The stable error contract is part of the complete spec.** M4 extends
   `behavioral_errors` to name the owning Action. In the final five-Action
   contract, candidate validation requires `missing_required_fields` cases for
   both `create` and `update` whenever active required fields exist, covering
   exactly those fields; inactive and optional fields cannot appear. During the
   exact 4.1–4.3 two-Action transition, only the `create` case exists; the
   five-Action development reference already carries both. Every error case may
   reference only active fields and one Action present in that exact admitted
   shape; additional behavior-specific cases may target any present Action.
   Separately, the mutation interface owns one platform-stable
   `record_not_found` failure for `update`/`delete`; it is not duplicated in the
   authored spec. Product wording remains generated and variable; spec-owned
   semantic markers, error code, Action, and affected fields are consumed
   independently by Handlers and behavioral tests.

5. **M4 adds only `string[]`, behind one extensible list seam.** Spec, request
   parsing, validation, SQLite JSON encoding/decoding, Gate samples, and platform
   form/detail rendering gain `string[]`. `number[]`, `boolean[]`, `date[]`, and
   `datetime[]` wait for a concrete need; M6 still owns `file[]`. A required
   `string[]` must contain at least one non-empty string when created or saved;
   an optional submitted empty list stores `[]`; historical rows may remain
   `null`. Every active `string[]` has exactly one entry in
   `ui_intent.form.list_inputs`, in active schema-field order, shaped as
   `{ field, mode }` with `mode: comma_separated | repeatable`. Missing,
   duplicate, scalar, inactive, unknown-field, or invented-mode entries fail
   validation. The model chooses `comma_separated` only for comma-free atomic
   values such as tags, genres, categories, or skills; commas are separators,
   surrounding whitespace is trimmed, and empty segments are discarded. It
   chooses `repeatable` for free-form elements such as quotes, addresses,
   citations, or names as entered; each control is one value and a comma remains
   data. In both modes every stored element is non-blank, and normalized element
   order/duplicates are preserved.

6. **Repeated-value parsing, edit presence, and record targets share one closed
   HTTP protocol.** Spec field names may not use the reserved `__aluna_` prefix.
   Parsed
   Handler input carries a values map of `string | readonly string[]` plus a
   platform-validated submitted-field set. Repeated query/form keys preserve
   arrival order. Singleton scalar controls remain scalar. A spec-known
   `repeatable` list preserves each raw occurrence as one element; a spec-known
   `comma_separated` list splits every raw occurrence on commas, trims each
   segment, discards empty segments, and flattens the results in arrival order.
   Both normalize to an array even with one value and expose no mode information
   to generated code. Platform create/edit forms emit
   repeated `__aluna_present` values for every rendered active field; the router
   validates and strips them. Edit/delete forms also emit exactly one nonblank
   `__aluna_record_id`; missing, duplicate, or unexpected target markers fail
   before generated code. Create treats every rendered active field as submitted: an empty
   optional scalar becomes `null`, unchecked boolean `false`, and empty list `[]`;
   required empties fail decision 3. On update, absent from the submitted set means
   preserve, while the same submitted-empty normalization explicitly clears. This makes clear vs.
   preserve unambiguous without exposing platform marker keys to generated code.
   Generated code still never sees raw HTTP. The 4.1 tracer crosses the real fixed route and
   proves request → Handler → mutation validation → JSON storage → read/detail
   presentation. Duplicate scalar input fails deterministically rather than
   silently choosing one value.

7. **Stopping tracking a field is explicit, non-destructive soft-hide.** A field
   never disappears from `schema.fields`; its lifecycle changes from `active` to
   `inactive`, preserving identity, type, column, and values. Inactive fields are
   absent from create/edit/detail/search, `item.shows`, runtime-generation
   contexts, requiredness, and structured required-field errors. Reactivation
   restores the same field and values. Removing a field from one presentation
   surface is a `ui_change`, not a lifecycle change.

8. **Field name is stable identity; field label is changeable wording.** Platform
   form/detail chrome renders labels. A wording change performs no migration.
   The item renderer receives only the names/types/labels declared by
   `ui_intent.item.shows`; a shown label change regenerates it, while an unshown
   label change does not. A genuine meaning change is never disguised as a rename.

9. **Item intent declares dependencies without prescribing composition.**
   `ui_intent.item` contains a free creative `direction` plus ordered `shows`
   names. Entries may be active user fields or the closed presentational platform
   field `created_at`; `id`, `extra`, and inactive fields are forbidden. The
   renderer may read exactly those entries; the Gate rejects undeclared access.
   Direction, composition, hierarchy,
   and styling stay AI-authored under ADR-0005. `feed | grid` remains a closed
   collection-layout value read by platform chrome and supplied to the renderer.
   The same entry rule applies to `ui_intent.detail.shows`. `created_at` has one
   immutable platform descriptor—name `created_at`, label `Created`, type
   `datetime`, read-only—and is supplied to item generation/Gate samples. It is
   absent from `schema.fields`, forms, mutations, and search, and is never a
   candidate change fact.

10. **The prompt accepts capability outcomes, not implementation steering.** A
    user may ask for “ratings from one to five” or “make urgent notes stand out.”
    They do not choose types, migrations, frameworks, generated code, CSS tokens,
    or repair steps. Existing field types do not change in place. `ui_change` is
    limited to capability labels, field labels, detail visibility/order, item
    direction/dependencies, `feed | grid`, and active `string[]` list input modes;
    data or behavior changes are `extend_capability`. The model may choose
    `comma_separated` only when field semantics make comma-free elements a valid
    promise. No preview-adjust-approve coding loop is introduced.

### Handler interfaces and full CRUD

11. **The injected toolbox separates constrained mutations from free reads.**
    `create` receives mutation authority bound to the target capability;
    `update | delete` receive authority additionally bound to the one
    router-validated record target. Generated Handlers choose no table,
    capability, or record target, and these adapters are the only path to
    canonical writes. Every Action may receive the distinct query
    interface for capability behavior; `read | search` necessarily use it. It
    accepts arbitrary parameterized `SELECT`/joins and is backed exclusively by a
    physically read-only SQLite connection. Each call declares a closed ordered
    result descriptor (alias/type); the adapter returns only those aliases,
    discards extra SQL result columns, and fails on missing/duplicate/type-invalid
    declared values. Thus `SELECT *` cannot make a later additive column observable
    to old generated code. A write attempted through that
    interface fails physically. Cross-capability rejection applies only to
    mutation. Live and scratch adapters satisfy the same interfaces; the Gate's
    adapters expose only synthetic scratch schemas/data through the supplied
    interfaces. Structural/static checks reject known bypasses; because generated
    execution is in-process, this is not hostile-code containment.

12. **Persistent cross-capability reads declare their lifecycle dependencies.**
    `read_dependencies` has one key for each Action, each a canonical-order unique array of
    strict `{ capability_id, incarnation_id }` pairs. Each pair must resolve to
    one active registry row; self-dependency is implicit and rejected if listed.
    They name every external capability each persistent Handler may join. The query
    adapter permits arbitrary SQL over that committed catalog and rejects access
    outside it. The Gate observes the same catalog against scratch tables. This is
    lifecycle metadata, not a foreign key or stored relationship. M5 `data_query`
    remains ephemeral and may query the whole live catalog without persisting a
    dependency. Capability deletion is refused while a live capability declares a
    dependency on the target incarnation, with deterministic copy naming the
    dependents; Aluna never leaves a committed Handler pointing at a dropped table.

    The dependency's execution ABI is its additive physical field catalog: field
    names/types never change and columns are not dropped by soft-hide. New Handler
    and test generation sees only the dependency's active projection, but an
    already committed Handler may continue reading a field the owner later hides;
    soft-hide is not erasure or read revocation. Live and scratch query adapters
    therefore retain synthetic/full physical columns for copied code while never
    exposing inactive definitions to new model context. Adding, hiding, or
    reactivating an external field does not cascade a dependent rebuild; permanent
    capability deletion remains the incompatible operation and is blocked.

13. **Record-producing queries return target ids; canonical rows stay
    platform-internal.** Generated `read`/`search` SQL may join other tables to
    choose/filter/rank ordered unique target record ids. On the same read-only
    snapshot, the query adapter re-fetches each id with a platform-owned full
    target-row projection and restores Handler order. Missing, duplicate, or
    foreign ids fail. Thus an old explicit projection cannot omit a newly added
    column, and a non-text addition can safely copy behavior-neutral
    `read`/`search` code.

    The adapter retains each canonical row and its record identity inside
    platform code. Generated Handlers receive only the Action-safe active-field
    projection admitted by the candidate contract, declared query-result values,
    and an opaque record handle where presentation needs one; canonical target-row
    inactive fields and `extra` never cross this interface. Decision 12's copied-
    code compatibility for already-declared external query aliases remains a
    separate query-result contract. The presentation adapter narrows again to
    `item.shows` for the item renderer and embeds only the record target, active
    fields needed for detail/edit, and the closed `created_at` platform field.
    Inactive fields and `extra` never enter generated markup or the DOM. Update
    preservation comes from the target-bound mutation adapter reloading the
    canonical stored row, not from Handler or client state.

14. **The mutation interface is the sole authority for structural write
    invariants.** It owns active-field allow-listing, platform-column protection,
    type/list normalization, logical requiredness, lifecycle rules, record target
    scoping, merge semantics, and validation of the resulting canonical row.
    Generated Handlers still own capability behavior: they may normalize input,
    apply stronger intent-derived rules, and translate typed failures into product
    voice, but cannot bypass or weaken platform invariants.

15. **Update is a record-targeted merge patch, never replacement.** The router
    extracts the single validated `__aluna_record_id` marker, strips the reserved
    namespace, and binds the update/delete mutation adapter to that exact target
    before generated code runs; neither marker nor id is writable Handler input,
    and the Handler cannot substitute another record. The target-bound update
    rejects unknown, inactive, and platform keys; loads the scoped row; merges only
    submitted active values;
    preserves omitted active values, every inactive value, `id`, `created_at`,
    and `extra`; validates the resulting active record; persists; and retains the
    canonical result inside platform code while exposing only the Action-safe
    active projection/record handle described in decision 13. `extra` is preserved
    and not directly patchable in M4. Explicit
    `null` clears only an optional active field. A missing target returns a stable
    typed failure and writes nothing. Target-bound delete uses the same validated
    target and not-found contract. Exact adapter and method shapes remain issue
    design; target selection does not.

16. **The Action/method matrix is fixed and fail-closed.** The router exposes
    `GET read`, `GET search`, `POST create`, `POST update`, and `POST delete` at
    `/capability/:id/:action`. Other method/Action combinations are rejected
    before loading generated code. Search receives scalar `q`; update/delete
    require exactly one platform target marker; create/update receive parsed
    values with all reserved markers removed. Create rejects a record target, and
    read/search reject mutation-form markers.
    From the 4.4 steady-state cutover, all five Actions are mandatory and cannot be
    removed by evolution; the only earlier exception is the exact reset-bounded
    two-Action shape in the approved sequence below.

17. **The shared modal has explicit read and edit modes.** Item activation opens
    complete read-only detail. A platform edit affordance switches the same modal
    to a prefilled spec-rendered form; only edit mode shows Save. Save invokes
    `update`. After create/update/delete, platform chrome reruns the current
    nonblank `search?q` or, when no query is active, `read`; it replaces the whole
    records region through the shared renderer so membership/ranking cannot go
    stale. The collection remains a reading surface without per-item edit/delete chrome,
    overflow menus, bulk selection, or a second record shell.

18. **Record deletion is confirmation-gated platform chrome.** Delete appears
    only in the read-detail modal. First activation replaces its action area with
    Confirm/Cancel; only Confirm invokes the generated `delete` Handler. This is
    local platform presentation state, not another modal and not generated logic.

19. **Search chrome is platform-owned; matching/ranking is generated within a
    mandatory baseline.** Every capability View has a debounced search field above
    the collection. It calls committed `GET .../search?q=...`, replaces the records
    region, and renders results through the one item renderer. Clear restores read;
    platform chrome owns loading, clear, and no-matches states. Search is local and
    ephemeral: no resolver call, registry row, version, cache, or build.

20. **The deterministic search baseline is complete and always-on.** Terms are
    Unicode-whitespace-delimited literal substrings. Case/normalization uses one
    platform-owned SQL function over both query terms and stored values:
    JavaScript `normalize("NFKC").toLocaleLowerCase("und")`. Generated SQL cannot
    substitute SQLite's ASCII-only `NOCASE`/`lower()`. Every normalized term must
    match somewhere, including across different fields/list elements. Matching
    includes every active `string` and each active `string[]` element; it excludes
    inactive fields, `extra`, platform columns, and non-text types. SQL wildcard
    and quote characters are literal/parameterized, not patterns or injection. A
    missing, empty, or whitespace-only `q` returns exactly the canonical `read`
    rows in default read order (the UI Clear path calls `read` directly).
    Results contain no duplicates and default to `created_at DESC, id DESC` for a
    behavior-neutral spec. Capability behavior may deterministically rerank the
    same baseline match set. The always-on Gate fixture proves scalar/list
    inclusion, all exclusions, AND semantics, literal metacharacters, composed vs
    decomposed non-ASCII text, case, repeated Unicode whitespace, complete target
    rows, empty-query behavior, and stable ordering—not merely “a field other than
    title participates.”

### Diff, tests, snapshots, and activation

21. **The Diff Engine has one total, monotone change-fact contract.** Every
    admitted committed→candidate difference becomes a typed fact mapped to schema
    work, platform View work, generated units, and Gate work. Multi-fact effects
    are unioned; one fact can never subtract work required by another. A unit may
    copy only when the matrix positively proves it unaffected. A new admitted fact
    without a matrix row fails closed before publication. The same matrix projects
    each unit's generation context, so copied units were never exposed to changed
    facts they are claimed not to depend on.

    Prior source is optional regeneration context, not an entitlement. Before an
    affected Handler or `item.ts` receives its old source, deterministic
    admissibility checks must prove that source references nothing outside the
    candidate unit's current generation contract: no inactive/undeclared fields,
    undeclared dependency data, forbidden platform authority, imports, or other
    context the fresh unit is not allowed to see. If proof fails, the unit
    regenerates without old source. Positively unaffected units are copied without
    entering model context and remain governed by the matrix plus their committed
    compatibility contract. This rule prevents stale source from leaking hidden
    context into generation; it is not a process sandbox.

22. **Free-text behavior changes use a conservative fallback; malformed ownership
    is invalid.** Because free text cannot deterministically identify one Action,
    any valid `behavior` change regenerates all five Handlers.
    `behavioral_errors` and `read_dependencies` have explicit Action ownership and
    select those Actions. Candidate validation rejects missing, duplicate,
    unknown, or otherwise malformed Action ownership before Diff; it is never
    converted into a successful all-Handler fallback. Conservative Handler/full-
    suite fallback remains for admitted semantically unscoped facts such as free
    `behavior`, or for runtime failure attribution that cannot be narrowed without
    weakening a frozen test.

23. **Behavioral-test generation follows total per-Action inputs; execution follows
    executable impact.** Tests are generated independently from `behavior`, the
    Action's `behavioral_errors` + stable markers, its declared dependency
    identities, and this closed schema projection—never Handler code:

    | Action | Canonical schema test input |
    | --- | --- |
    | `create`, `update` | active field name/type/required, excluding labels/order |
    | `search` | active `string`/`string[]` field names/types |
    | `read`, `delete` | none; canonical-row/delete mechanics stay in always-on smoke |

    Free-text `behavior` is conservatively an input to every Action. Current
    declared active dependency projections are generation context and full
    physical compatibility schemas are scratch-fixture context; neither is a
    versioned equality input. A change to a capability's own Action inputs generates those
    Action tests before Handler repair. Only unchanged test inputs copy prior
    tier-on tests byte-for-byte. However, copied
    tests run whenever a Handler they cover regenerates; if a valid test's Handler
    coverage or runtime failure attribution cannot be narrowed, the full frozen
    suite runs. Only when no covered Handler changes may copied
    tests skip execution. A failing assertion repairs only the implicated Handler
    when attribution is total, otherwise the conservative Handler set, and always
    reruns the same frozen test. Tests are never weakened in response to code.

24. **Snapshot contents are explicit for both behavioral-tier states.** Beginning
    with 4.5's reset/rebuild, every surviving version contains all five Handlers,
    `item.ts`, exact `spec.json`, and
    platform-authored `snapshot.json`. Snapshot metadata records capability
    incarnation, version, build id, behavioral tier, exact file inventory, and
    per-derived-unit dependency-generation provenance. That provenance identifies
    the exact dependency incarnation/version, verified dependency snapshot content
    digest/fingerprint, and active-context digest used when those bytes were last generated;
    copied units carry their original provenance forward. It is audit evidence
    only—not authored spec, candidate/spec equality, a Diff fact, or a cascade
    trigger. The manifest
    lists itself without a self-digest and records content digests for every other
    file, avoiding an impossible recursive hash. A tier-off snapshot contains no behavioral-test artifacts;
    test generation/copy/execution metrics are `absent`/`skipped`. A tier-on
    snapshot contains frozen tests. On the next real spec version:

    | Prior snapshot | Candidate tier | Test-input change | Test artifact/execution |
    | --- | --- | --- | --- |
    | off | off | any | absent; no generation or execution |
    | off | on | any | generate, freeze, and run from current candidate inputs |
    | on | on | unchanged, no Handler impact | copy; do not run |
    | on | on | unchanged, Handler impacted | copy; run impacted/full fallback |
    | on | on | changed | generate, freeze, and run |
    | on | off | any | absent; no copy or execution |

    Toggling the global tier alone does not create a version. These rules apply on
    the next spec-changing build after Diff facts exist; a semantic no-op does not
    materialize a tier transition. `snapshot.json` verifies completeness; it is not a
    routing overlay or per-unit pointer manifest.

25. **Each capability lifetime has a platform-owned incarnation.** A new v1 gets
    an opaque `incarnation_id`; evolution preserves it. Artifacts live under
    `capabilities/<id>/<incarnation_id>/v<n>/`. Registry rows, snapshot metadata,
    read dependencies, deletion cleanup, and generation metrics carry it. After
    permanent deletion the same semantic capability id may be created again only
    after cleanup completes, with a new incarnation and path. This prevents stale
    cleanup and Bun's dynamic-import cache from touching or loading the new code,
    and keeps Module 8 metrics distinct across delete/recreate lifetimes.

26. **Artifact publication is staged, verified, atomic, and no-overwrite.** Each
    build writes to a unique same-filesystem build-id staging directory. The
    artifact-lifecycle module writes every required file, computes
    `snapshot.json`, verifies inventory/digests and Gate success, then atomically
    publishes to the final `v<n>/` path without overwriting an existing path.
    Only a verified published snapshot may become a registry pointer. Registry
    activation uses a compare-and-swap on expected incarnation/version; a stale
    writer fails. Direct writes into final version directories and recursive
    “make it exist” commits are forbidden.

27. **Cross-store activation is ordered around one exact point of no return.** Publish
    the complete final directory first, then—in one SQLite transaction—apply the
    additive migration, compare-and-swap the registry spec/version/pointer, and
    finalize the metrics row as `success/activated`. That SQLite commit is the
    activation point of no return: it makes the capability live and committed
    history authoritative. A database failure before it leaves a never-activated
    complete candidate, never a live partial snapshot. A presenter, client, or
    transport failure after it cannot roll back the pointer, relabel the build as
    failed, or restore the prior version; the registry is the recovery authority.
    For an active incarnation at version N, verified `v1..vN`
    are committed immutable history even though only vN is the live pointer;
    `spec.json` in each is authoritative history. Only staging or `v>N` candidates
    (or directories with no active/tombstoned incarnation) may be reconciled after
    positive proof they never activated. Missing/corrupt `v1..vN` is historical
    corruption and fails closed. Historical dependency pairs validate shape and
    digest, not current liveness; any future restore must revalidate dependencies
    and add a committed-version ledger before allowing a backwards active pointer.
    Retry may reuse `vN+1` only after its never-activated occupant is removed.

28. **Resolution admission and generation metrics are distinct.** `/prompt`
    creates a non-mutating stream/job ticket and carries resolver timing/outcome
    in job memory; it owns no mutation lease and may resolve to `reject` or M5
    `data_query`. Resolution reads one versioned active registry catalog and the
    resolved build request binds its revision or canonical fingerprint in addition
    to the target expectation. Only a resolved build intent enters the mutation
    queue. When its reservation reaches the head, the coordinator grants the
    active build lease and requires the current catalog fingerprint and target to
    match exactly. Any mismatch is stale, never silent reclassification against a
    newer catalog. It then assigns or confirms incarnation and creates a
    durable `running` generation row—including the carried resolver measurement—
    before the first Builder provider call. If
    that write fails, Builder work does not start. The row is keyed by build id and
    incarnation, embeds the resolver measurement, and records
    generated/copied/executed/skipped/absent stage states. It does not duplicate a
    resolution row. `reject`/`data_query`, plus cancellation or expiry before an
    active build lease, may write content-free classification/timing/outcome to a
    separate `intent_resolution_metrics` row keyed by prompt job through a later
    short coordinator platform-write lease. Those non-admitted measurements are
    explicitly best-effort: the read/query and user-visible completion never wait,
    and a process crash may lose an unwritten row. No durable-generation guarantee
    is claimed before the active lease. Once `running` or the lease-head terminal
    stale row is written, the generation/admission lifecycle is durable.
    `success/activated` finalizes the build row in the same transaction as pointer
    activation. `success/no_change` finalizes durably under the active lease before
    `done=ok`, without product changes. Failure rolls back product changes then finalizes the row as
    failed in a short independent transaction. Startup reconciliation marks stale
    `running` rows interrupted. No metrics write occurs after a success commit that
    could strand a live version without its measurement. A lease-head stale target
    or resolver-catalog mismatch, or an expected-absent collision, never creates
    `running`; while ownership is held,
    it writes one direct terminal admission row with
    `lifecycle_status=failed, outcome=stale` and all generation stages skipped.
    That row's incarnation is the expected incarnation for evolution and nullable
    only for a new-capability stale refusal before incarnation assignment (catalog
    mismatch or expected-absent collision). The SSE
    `commit` event is attempted only after the success transaction commits.
    `lifecycle_status` is the
    transport/recovery state (`running | success | failed | interrupted`);
    `outcome` is the typed terminal reason such as `activated`, `no_change`, or
    `stale`.

29. **Complete snapshots activate through one bounded complete-View delivery.** Diff
    minimality concerns AI generation and validation, not DOM patches. Explicit
    work records a data-free restoration descriptor for the pre-build content
    (active capability id/incarnation, or the neutral empty surface) before
    placing foreground generation in the content area. Activation sends one
    `commit` event containing the complete data-free View for the new spec; records
    reload through committed `read`. A new/separate capability appends a toolbar
    entry; evolution replaces it only when its label changes. Every non-activating
    terminal path—`no_change`, stale/collision, cancellation, or failure—resolves
    that descriptor against the then-current registry and re-renders its canonical
    live View plus `read` result (or the neutral surface if it no longer resolves)
    through ADR-0002's
    existing `fragment` event, with no toolbar sidecar, then sends `done` with the
    appropriate outcome. Restoration clears search and closes any modal; ephemeral
    query/edit state is not preserved across foreground generation. `commit`
    remains reserved for real pointer activation.

    Terminal presenter work has a bound and cannot hold mutation ownership
    indefinitely. The active lease releases through `finally` whether delivery
    succeeds or fails. After activation, a missed/failed `commit` delivery leaves
    `success/activated` intact; normal shell/toolbar rehydration resolves the live
    registry pointer and recovers the UI. Before activation, terminal delivery
    failure remains a presentation/transport failure on the non-activating path,
    not permission to publish.

### Mutation coordination, resolver reuse, and deletion

30. **One mutation coordinator owns atomic admission for every shared-connection
    write.**
    It replaces check-then-act busy flags with queue tickets and ownership-checked
    leases. Prompt classification stays outside it. A resolved build intent gets a
    FIFO reservation; only the head owns the active build lease through success,
    failure, abort, and presenter teardown. Once any build reservation exists,
    short record `create | update | delete` cannot pass it and are refused; short
    platform writes such as non-build resolver metrics/Event Log ingestion wait
    behind it on the same coordinator. Reads stay concurrent. Capability deletion atomically try-acquires only when there is
    no active owner or queued build and is never queued.
    Direct/demo build paths must use the same coordinator or be removed. Reads and
    search never acquire it. Reservation expiry/cancellation and active release are
    distinct, both ownership-validated and executed in `finally`; presenter
    teardown is bounded, and an abandoned prompt job that never becomes a build
    owns no mutation state.

31. **Explicit-loop foreground presentation is an adapter, not a Builder
    invariant.** The core Builder accepts an already-resolved build request and
    emits lifecycle events without owning the prompt route, active DOM, or SSE.
    Existing-capability work binds exact
    `{ capability_id, incarnation_id, expected_version }`; new-capability work
    binds the proposed semantic id plus an expected-absent condition. Both also
    bind the resolver's active-catalog revision/fingerprint. The coordinator
    revalidates target and catalog after active lease acquisition. A target,
    expected-absence, or catalog mismatch fails stale and is never silently
    rebased, retargeted, or reclassified.
    The M2–M4 explicit adapter resolves a typed prompt, occupies the active content
    area, and narrates the foreground story. Module 7 may hand an already-resolved,
    confirmed implicit proposal to the same Builder without reclassification and
    choose a different presenter in its open UX design. Mutation, staging, Gate,
    activation, and metrics remain identical.

32. **Overlap resolves to extension or a semantically named separate
    capability.** The resolver extends the same collection/lifecycle and creates a
    separate capability for a distinct context or lifecycle. The latter owns its
    own table, incarnation, artifacts, toolbar entry, and versions. Label/id carry
    the meaningful distinction (for example **Work contacts** / `work_contacts`),
    never `contacts_2`; `namespace` is metrics-only. Active capability is strong
    context, explicit wording may override it, and exact identity collisions
    remain deterministic. `reject` and M5 `data_query` never enter the Builder.

33. **Capability deletion is zero-AI, permanent, and dependency-safe.** A
    platform-owned toolbar action uses authored product voice and no resolver or
    provider call. A preflight may show live reverse dependencies, but it is only
    advisory: Confirm atomically try-acquires the deletion lease and revalidates
    target incarnation + reverse dependencies while ownership is held. If any
    exist, deletion is blocked and names the dependent capabilities. The
    confirmation names the capability and states that its records, version/spec
    history, and capability-owned resources/event payloads are permanently lost.
    Generation metrics remain because they are content-free experiment data keyed
    by incarnation. Delete is never archive, hide, deactivate, restore, or
    AI-authored SQL.

34. **Deletion is a durable two-phase lifecycle, not pretend cross-store
    atomicity.** Every target route, declared cross-capability query, M5 whole-
    catalog query, and M6 file serve acquires ownership-validated read tokens for
    the incarnations it can observe. An operation acquires its complete
    incarnation token set atomically against one gate/catalog snapshot; if any
    member is missing, stale, or closing, it receives no tokens and does not
    begin. The complete set releases in `finally`. After the deletion lease is admitted, an
    atomic per-incarnation read gate changes active→closing, refuses new tokens,
    and waits for tracked readers to release by a fixed deadline; cancellation is
    signalled, and failure/timeout before the database point of no return reopens
    the gate in `finally` (boot recovery does the same after a crash). Destruction
    begins only with a proven zero reader count. While the table still exists, platform cleanup
    adapters collect a deduplicated owned-resource manifest, including inactive
    fields. In one SQLite transaction the registry row becomes a non-routable
    deletion tombstone carrying that manifest, capability-owned Event Log payloads
    are purged/redacted when M7 is installed, and the table is dropped. After
    commit, the gate can never reopen: idempotent adapters delete version artifacts and external resources;
    then the tombstone is removed. Crash/failure after the database commit leaves
    the capability logically gone with durable cleanup work. Boot recovery retries
    it. The tombstone reserves id/incarnation until cleanup completes, preventing a
    recreated capability from racing stale cleanup.

    Deletion is not optimistic in the UI. Before tombstone commit, the committed
    toolbar/View remains authoritative; refusal, timeout, or pre-commit failure
    reopens reads and restores the canonical View. Tombstone commit is deletion's
    point of no return: the capability becomes logically absent and its toolbar
    entry/routes disappear. If it was active, content becomes the neutral surface;
    otherwise the current active capability's canonical View remains. Later cleanup
    failure cannot resurrect the deleted surface.

35. **The owned-resource cleanup seam pre-pays Module 6 and Module 7.** M4
    contributes the artifact collector/cleaner and a fake-resource acceptance
    adapter. M6 extends the manifest to absorb every target-incarnation file
    lifecycle state before table drop: committed references from active and
    inactive `file | file[]` fields, pending ownership, and already-enqueued
    cleanup. Keys are deduplicated and remain incarnation-bound through tombstone
    cleanup. M7 adds capability-owned Event Log payload cleanup. Event ownership
    provenance is derived server-side from admitted route/query/read-token context
    and canonical payload production; client- or model-supplied incarnation labels
    are never trusted. Ingestion validates and appends that complete derived set
    atomically only while every pair remains active/current, so a late pre-deletion
    batch cannot resurrect purged data. Collection happens before the
    table disappears; cleanup is idempotent and treats an already-absent resource
    as success. Generation metrics are explicitly outside this seam.

36. **Determinism remains selective.** The platform is deterministic for safety,
    lifecycle integrity, stable presentation mechanics, declared dependencies,
    and cheap change facts. It does not enumerate every capability or creative
    composition. Spec evolution and every affected unit remain AI-authored and
    measured. Conservative regeneration is preferred to inventing a platform rule
    when ambiguity is non-destructive; fail-closed validation is preferred when
    ambiguity threatens state or a committed interface.

37. **A semantically identical canonical candidate is a measured no-op.** It performs no
    DDL, unit copy/generation, snapshot publication, version bump, registry update,
    or `commit` activation. Metrics finalize
    `lifecycle_status=success, outcome=no_change` with every downstream stage
    skipped, and the presenter restores the already committed View via `fragment`
    using decision 29's canonical View/read reset before its warm `done=ok`
    terminal response. An activated build uses
    `lifecycle_status=success, outcome=activated`; ordinary build failures use
    `lifecycle_status=failed` with a typed outcome. A tier toggle alone remains
    versionless.
    Expected-version mismatches never reach this comparison; they finalize a
    distinct `lifecycle_status=failed, outcome=stale` under decision 31.
    “Canonical” means the validated semantic value, not raw JSON serialization:
    object-key order is ignored; fixed Actions, dependency arrays, error cases,
    and error-field sets use their defined canonical order; ordered product facts
    (`schema.fields`, item/detail `shows`) preserve order and therefore diff. Text
    uses the validator's normalized stored value. This prevents key/set reordering
    from manufacturing a version while keeping real presentation order changes.

## Total Diff Engine change-fact matrix

This table is normative. Issue work may split its implementation, but may not add
an admitted spec fact without extending and testing the table.

| Change fact | Platform/schema work | Generated-unit selection | Behavioral-test effect when tier is on |
| --- | --- | --- | --- |
| `id`, `incarnation_id`, `version`, `artifacts_path`, existing field name/type, committed field omission, `inactive→inactive` definition change, `active→inactive` plus another attribute change, newly introduced inactive field, fixed five-Action set changes, or malformed/missing/unknown Action ownership in errors/dependencies | Invalid candidate; fail before DDL/generation | None | None |
| Capability label | Registry + toolbar/View copy | None; unit prompts do not receive it | None |
| `prompt_context` | Resolver catalog | None | None |
| Field order only | Platform form order + canonical list-input entry order | None | None |
| New active field | Nullable `ADD COLUMN`; platform form/detail | `create`, `update`; add `search` for `string`/`string[]`; item follows separate `item.shows` fact | Regenerate `create`/`update`; add `search` for `string`/`string[]` |
| `required` change | Resulting-record validation | `create`, `update` | Regenerate `create`/`update` |
| Field label | Platform form/detail | `item` only when field is in `item.shows` | None |
| Hide/reactivate field | Platform form/detail/requiredness and remove/require active list-input intent; no destructive DDL | `create`, `update`; `search` for text/list text; item through required `item.shows` change | Regenerate `create`/`update`; add `search` for text/list text |
| Active `string[]` list input mode | Platform create/edit form + raw-input normalization | None | None |
| `ui_intent.detail.shows`/order | Platform detail View | None | None |
| Item direction or `item.shows` | None | `item` | None |
| Collection `feed | grid` | Platform list container | `item` | None |
| `read_dependencies.<action>` | Read catalog/reverse index | Named Action | Regenerate/run that Action's tests because dependency identities are a test input |
| Free-text `behavior` | None | All five Handlers | Generate and run the complete candidate suite |
| Valid `behavioral_errors` change | Stable semantic contract | Union of named Actions | Generate/run named Actions; frozen-test failure attribution may still use decision 23's full-suite fallback |
| No facts after canonical comparison | No-op; no DDL/version/publication/activation | None | No test artifacts or execution; stages skipped |
| Any new admitted fact without a row | Fail closed | No copying | None |

For multiple facts, union every column. Structural/interface validation and the
complete full-CRUD/search smoke run against every candidate snapshot regardless
of which units regenerated. Design lint runs whenever `item` regenerates.
Behavioral execution follows decision 23.

## Approved epic build order and boundaries

The epics are numbered in implementation order. Each lands a runnable tracer in
the living demo before the next dimension arrives. The M3→M4 cutover is explicit:

- **4.1** uses `bun run reset`, introduces `incarnation_id`, and immediately moves
  the loader/cache path to `<id>/<incarnation_id>/v<n>`. Prompt-built capabilities
  use one exact transitional authored shape: canonical `tools: [create, read]`,
  `read_dependencies` with exactly those two keys (both arrays empty in 4.1,
  then valid declared pairs may populate them once 4.2 enforcement exists), errors owned only by those
  Actions (including the exact `create` required-fields case when needed), and
  existing `create.ts`, `read.ts`, plus `item.ts`. No update/delete/search contract
  is admitted or advertised.
- **4.2–4.3** exercise the new five-Action ports/routes/UI through one complete
  hand-written reference capability. Its authored shape has canonical
  `tools: [create, read, update, delete, search]`, `read_dependencies` with exactly
  all five keys, Action-owned errors valid for that set (including both required-
  field cases when needed), and all five Handler files plus `item.ts`. The prompt
  Builder continues producing the exact two-Action shape above. Validators accept
  only these two complete shape/inventory pairs—never an arbitrary subset—and the
  reference fixture is development-only.
- **4.4** performs the final greenfield `bun run reset`, removes the transitional
  two-Action allowance and the hand-written reference fixture. The prompt
  Builder/registry then admit only the exact five-Action shape/inventory described
  above, with generated rather than fixture Handlers.
- **4.5** deepens the already-incarnation-keyed path with staging, manifests,
  immutable committed history, and recoverable activation. It begins with one
  greenfield reset/rebuild so v1 is born under that publication contract rather
  than mutating 4.4's pre-manifest final path; it does not introduce or postpone
  the cache-identity cutover.

This is bounded implementation sequencing, not a persisted dual-serving contract
or preservation migration; reset removes every transitional row/artifact.

### 4.1 — Incarnation-keyed, evolution-ready field and input contract

Use `bun run reset`; add capability incarnation to the registry and move current
artifacts/loaders immediately to `<id>/<incarnation_id>/v<n>`. Add field
label/lifecycle, physically nullable storage + logical requiredness, `string[]`,
the model-authored `comma_separated | repeatable` list input modes, reserved
submitted-field/record-target parsing, and the `created_at` descriptor. Extend
current create/read Handler input, centralized create/detail rendering, Gate
samples, and JSON-array storage together. The transitional prompt Builder
must emit the exact two-Action error/dependency/tools/inventory shape defined
above with both dependency arrays empty in 4.1; it does not emit empty future
Action keys or update/delete requirements.

The tracer is a hand-written spec submitted through the real create route. A
comma-separated Tags control turns `fantasy, historical fiction, classic` into
three ordered elements; a repeatable Other names control keeps `Doe, Jane` as one
element. Both reach the Handler as the same ordered-array type, store/render
unchanged after their mode-specific normalization, and retain required/optional
empty semantics. Labels render, inactive definitions persist but do not render,
the registry/artifact/loader share one incarnation path, and validation rejects
invalid lifecycle/reserved-name/form-intent contracts without advertising absent
Actions.

### 4.2 — Mutation coordinator, split tools, and complete routing Actions

Replace build-only busy checks with the atomic mutation coordinator. Split the
Handler toolbox into scoped mutations and read-only queries; add record-targeted
merge update and delete; implement the fixed method matrix and reserved target
wire; add Action-owned errors plus per-Action read
dependency enforcement and target-id→canonical-row rehydration. Scratch adapters
contain all catalog schemas needed by declared joins and expose only synthetic
data through the supplied interfaces. Generated execution remains in-process:
structural/static checks reject direct imports and other known bypasses, but this
is accidental-output protection rather than a security sandbox. Install the
complete hand-written five-Action reference capability for the
4.2–4.3 living-demo path; ordinary prompt builds remain the exact two-Action
transition described above.

The hand-written tracer proves create → read → partial update → search → delete;
hidden values and `extra` survive update; an old row missing a new required value
cannot be saved; cross-capability mutation is unrepresentable through the supplied
mutation interface; a declared
cross-capability read succeeds; and a read-port write fails physically. A paused
build race proves direct record mutation cannot join and be rolled back with the
build transaction.

### 4.3 — Full CRUD platform presentation

Keep item activation as read-only detail. Add explicit edit mode and Save; keep
record Delete in read detail with inline Confirm/Cancel. Add debounced search with
clear/loading/no-matches states. After each mutation, rerun the current nonblank
search or read and replace the whole records region through the item renderer. The tracer uses 4.2's hand-written capability so
the complete interaction is visible before model generation.

### 4.4 — Generate and Gate full-CRUD v1 capabilities

Run the final greenfield reset and delete the two-Action allowance plus the
hand-written reference fixture. Generate all five Handlers and `item.ts` with
Action-specific projected contexts; every final registry row validates against
that complete inventory before it can be routed.
Update unit checks so no Handler can emit raw mutation SQL while every Action may
use only its declared read-only query catalog. Structural validation covers the
whole snapshot.
Always-on smoke executes a full CRUD cycle plus the adversarial search fixture;
the optional independent behavioral tier covers all Actions and stable errors.
Fresh M4 v1 is fully usable before evolution exists.

### 4.5 — Incarnated snapshots, publication, metrics, and atomic activation

Begin with `bun run reset` and rebuild the final five-Action v1 through the new
publication lifecycle; no 4.4 pre-manifest final directory is recut or retained as
history. Introduce build-id staging, `spec.json`, `snapshot.json` inventory/digests/tier
state plus audit-only per-unit dependency-generation provenance, no-overwrite
atomic publication within the already-incarnation-keyed path, registry CAS, and
boot/pre-build reconciliation. An active-build metrics row exists before Builder
provider work; success finalizes with registry activation. Only after the rebuilt
v1 is verified and active, and because candidate generation and Diff ownership
arrive in 4.6, 4.5 uses one hand-authored complete v2 candidate and a temporary
regenerate-all tracer seam. Its sole purpose is to
prove complete immutable history, tier-on/off snapshot shape, a unique
loader/cache path, one complete View swap, and rollback/recovery at every
filesystem/SQLite/presenter fault point.

No runtime overlay or per-unit pointer manifest exists. Verified `v1..vN` are
committed history for active version N; only never-activated staging/`v>N`
candidates are recovery inputs.

### 4.6 — Additive evolution and the total Diff Engine

Generate a complete candidate with the lifecycle catalog, validate it, emit typed
change facts, union the normative matrix, derive additive DDL, project unit
contexts, regenerate the proven impact set, and copy only positively unaffected
units. Remove 4.5's hand-authored/regenerate-all tracer seam; it is not a second
evolution path. Prior source enters a regeneration prompt only after decision
21's admissibility proof. Full smoke still runs over the assembled snapshot. Table tests cover every
matrix row, multi-fact unioning, behavior's all-Handler fallback, target-row
rehydration, measured zero-diff no-op, and unmapped-fact failure.

The first tracer invokes the engine with a known target and resolved intent;
resolver classification remains outside until the engine is independently sound.

### 4.7 — Evolution Gate and frozen-intent repair

Implement the tier transition table and separate test generation from execution.
Changed test inputs generate and freeze tests; unchanged tier-on inputs copy
them. Regenerated Handlers rerun the copied tests they may affect, with full-suite
fallback. Repair cannot edit tests. Exercise pass/failure over existing records,
all tier transitions, every Gate rung, bounded retries, rollback, failure metrics,
and recovery of interrupted `running` metrics.

### 4.8 — Resolver, explicit presenter, active context, and overlap

Create the stream job and resolve outside mutation ownership; then enqueue only
build intents. Send active capability id with prompt submission; act on
`new_capability | extend_capability | ui_change`; keep `reject` and `data_query`
out of the Builder. Narrow the pre-provider duplicate heuristic so semantic
overlap sees the full registry. Separate the resolved build request from the
explicit SSE presenter: explicit evolution remains a foreground product-voice
story and emits one View `commit`, while Module 7 can reuse the same core Builder
with an already-resolved confirmed proposal bound to expected target
id/incarnation/version plus the resolver catalog revision/fingerprint. Revalidate
both after lease acquisition; either mismatch is stale and never reclassified.

### 4.9 — Dependency-safe permanent capability deletion

Add the zero-AI toolbar action, advisory preflight plus lease-held reverse-
dependency revalidation/refusal, atomic deletion lease, per-incarnation read
closing/drain, durable registry tombstone, pre-drop
resource collection, database point of no return, idempotent artifact/resource
cleanup, deterministic pre-/post-tombstone UI, id reservation, and boot recovery.
Read operations acquire their complete incarnation-token set atomically. Use a
fake owned-resource adapter to prove absorption of committed/pending/cleanup M6
states and an Event Log fake to prove server-derived ownership provenance plus
the M7 purge seam. Fault tests
cover before/after DB commit, partial cleanup, restart, same-id recreation with a
new incarnation, read-token timeout/reopen, late stale Event Log ingestion,
path traversal/symlink rejection, and repeated cleanup.

## End-to-end evolution flow

With an existing M4 Notes v1 active, type *“add a due date to my notes and make it
stand out in the list”*:

1. `POST /prompt` creates a non-mutating stream/job ticket and immediately returns
   the subscriber fragment. It owns no mutation state.
2. The explicit presenter narrates while the resolver reads a versioned registry
   snapshot and classifies `extend_capability`; its resolved request binds that
   resolver-catalog revision/fingerprint and resolver metrics attach to the job.
   `reject`/`data_query` would finish without mutation admission.
3. The resolved build request enters the FIFO mutation queue. At its head it
   acquires the active lease and revalidates Notes id/incarnation/version plus the
   resolver-catalog fingerprint. Any mismatch is stale. It then freezes the
   separate active dependency-generation catalog and creates the incarnation-keyed
   `running` generation row before Builder provider work.
4. Candidate generation receives exact v1 (including inactive fields), the stable
   errors/dependencies, resolved intent, and lease-stable dependency catalog. It
   returns one complete authored candidate; platform lifecycle values are absent.
5. Validation proves stable identity/type/action contracts and exact inactive
   preservation. The Diff Engine emits facts for nullable `due_date`, requiredness,
   item dependency/direction, and any behavior/error change; fact scopes union.
   A zero-fact candidate finalizes
   `lifecycle_status=success, outcome=no_change`, restores the canonical
   committed/neutral View + `read` state via `fragment`, and sends `done=ok` here.
6. Tests are generated/copied according to tier and canonical test inputs. They freeze
   before Handler generation or repair.
7. Selected units receive projected change context and receive prior source only
   when deterministic source-admissibility checks pass; otherwise they generate
   fresh. Untouched units copy into a unique staging directory. The full candidate clears
   structural, adversarial CRUD/search smoke, affected design, and tiered behavior.
8. The artifact lifecycle writes exact `spec.json` and non-self-referential
   `snapshot.json`, including audit-only per-unit dependency-generation
   provenance, verifies inventory/digests, and atomically publishes v2.
9. In one SQLite transaction the nullable migration applies, registry CAS changes
   spec/version/pointer, and metrics finalize `success/activated`. That commit is
   the point of no return and makes v2 live.
10. Only after commit does the bounded presenter attempt the complete View
    `commit`; records reload through v2 `read`. The toolbar changes only if the
    capability label changed.
11. `finally` releases the active lease and advances/cancels the queue ticket even
    if terminal presenter delivery fails.

On failure before step 9 commits, live database/registry work rolls back, v1
remains routable with all records, never-activated published/staging candidates
become reconciliation state, and the metrics row finalizes failed (or boot
reconciliation marks it interrupted). The presenter narrates a warm failure,
restores the canonical committed/neutral surface through `fragment`, sends
`done=error`, and the lease releases. After step 9 commits, presenter/SSE/client
failure cannot roll back or reclassify activation: v2 and `success/activated`
remain authoritative, the lease still releases, and normal registry rehydration
recovers the UI. No path overwrites a final version directory.

## Module acceptance

### Living demo

Run `bun run reset`, start Aluna, and build Notes with the behavioral tier on.
Create records containing scalar text, tags, non-text fields, literal `%`, `_`,
quotes, mixed case, composed/decomposed accented text, and repeated Unicode
whitespace. Then:

1. Type *“add a due date to my notes and make it stand out in the list.”* Confirm
   extension, complete v2 activation, existing records, and one final View swap.
2. Open a historical note, enter edit mode, patch/clear one optional field, uncheck
   a boolean, and submit an empty list; confirm presence semantics, omitted active
   fields, inactive data, and `extra` survive while required empties block Save.
3. Search terms that match different scalar/list fields. Confirm AND semantics,
   literal metacharacters, exclusions, no duplicates, stable order, and whitespace-
   only `q` matching read. Confirm composed/decomposed forms match under the one
   platform normalization function. Update/delete under an active query and confirm
   the same search reruns with correct membership/ranking.
4. Delete a record through inline confirmation.
5. Build *“track my work contacts separately”* beside Contacts and confirm a
   meaningful separate capability, not `contacts_2`.
6. Create a persistent Notes read dependency from another capability and confirm
   Notes deletion is refused with the dependent named. Remove that dependency,
   confirm permanent wording, and delete Notes.
7. Recreate Notes and confirm it has a new incarnation/path and executes new v1
   Handler code rather than a cached deleted module.

### Deterministic acceptance companion

Focused tests must additionally prove:

- every Diff matrix row, multi-fact union, and unknown-fact failure;
- hidden lifecycle prompt separation and reactivation of old values;
- full search fixture, split read/mutation safety, id→platform-internal canonical-
  row rehydration, and update merge invariants: inactive fields/`extra` never cross
  the Handler interface or DOM, update/delete cannot substitute the validated
  target, and missing/duplicate/reserved target markers fail;
- dependency compatibility: an old declared reader still executes after an
  external field is soft-hidden, while new model contexts omit that field and a
  table drop remains blocked;
- regenerated prior source is admitted only when it fits the candidate unit
  contract; otherwise generation proceeds without it, while copied-unit behavior
  remains separately proven;
- resolver-job vs. mutation-ticket separation, build-vs-record/delete races,
  queue/lease expiry, abort/finally release, and stale target/collision/catalog-
  fingerprint refusal that starts no provider work and writes the durable direct
  `failed/stale` row; best-effort pre-lease metrics and no direct/demo admission bypass;
- every behavioral-tier transition and rerun of copied tests after Handler impact;
- transitional-epic integrity: incarnation-keyed loading begins in 4.1; 4.1
  accepts only the exact two-Action shape/inventory with empty dependency arrays;
  4.2–4.3 accept only that pair or the exact complete five-Action reference pair;
  no row advertises a missing Handler; and after the 4.4 reset neither the two-
  Action allowance nor the hand-written reference fixture remains admissible or present;
- 4.5 resets/rebuilds v1 through staging/manifest/no-overwrite publication before
  producing v2; no pre-manifest 4.4 directory is mutated or counted as committed
  history;
- staging/publish/SQLite fault injection, self-digest-free manifest verification,
  audit-only dependency provenance that refreshes on regeneration, carries forward
  on byte-copy, and alone changes no equality/Diff/cascade outcome; retained committed `v1..vN` history,
  missing/corrupt-history failure, retry without overwrite, no-op metrics,
  canonical View/read `fragment` restoration with cleared search/closed modal, and
  interrupted metrics reconciliation;
- a disconnect/timeout after SQLite activation preserves the new pointer and
  `success/activated`, releases the lease, and rehydrates the activated View from
  the registry on reload;
- deletion failure before/after the database point of no return, read-gate
  drain/timeout/reopen, atomic all-or-nothing multi-incarnation token acquisition,
  deterministic pre-/post-tombstone UI, idempotent boot cleanup, absorption of
  committed/pending/cleanup resource ownership before table drop, server-derived
  Event Log provenance and late-batch rejection, dependency refusal, and same-id/
  new-incarnation safety.

## Exit criteria

Capabilities support full CRUD through platform chrome and five generated
Handlers; mutation is structurally scoped while declared read-only SQL remains
free across capabilities; update preserves canonical state; search satisfies its
complete always-on baseline; and explicit evolution proceeds from complete
lifecycle-aware candidate specs through a total Diff Engine, frozen-intent Gate,
self-describing immutable snapshots, recoverable publication, measured atomic
activation, and a complete View swap. The core Builder accepts resolved work
independently of the explicit presenter so later loops reuse it. Confirmed zero-AI
capability deletion is dependency-safe, recoverable, extensible to owned files and
event payloads, and preserves only content-free generation metrics. The explicit
build/extend engine is issue-ready and complete for later reuse.

## Issue conversion

Deliberately deferred to a separate session. Conversion must preserve these epic
boundaries, split each epic into independently actionable tracer-bullet issues,
and copy the applicable failure/race/tier acceptance cases into those issue files.
No Module 4 issue files are created by this planning turn.
