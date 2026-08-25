# Aluna

The single-context domain doc for this repo. Internally, Aluna is a platform
where stated intent becomes a working app: the user describes the capability-level
outcome they want, and the app builds — and rebuilds — itself to fit. The product
must always read as a friendly consumer app, never a coding agent, coding platform,
site builder, or engineering tool (ARCH §1, §9.7).

> "omni-crud" is the repository's engineering name (it contains "CRUD") and must
> never appear as user-facing branding (ARCH §9.7). Aluna is the user-facing
> brand.

## Language

Use these terms verbatim in UI copy, issues, code, tests, and docs. The bolded
term is the word to use; `_Avoid_` lists the synonyms to keep out.

**Aluna**:
The product. A Kogi word for the realm of thought/spirit from which the material
world is born, and so a metaphor for a platform where stated capability-level
intent becomes a working personal app. Internally it is a self-building runtime;
to the user it is an app, never a coding agent, coding platform, or site builder.
The name is the whole of the user-facing brand: the styled wordmark went with the
header row that carried it, and nothing on the desk or anywhere else replaces it
([M5 plan](modules/05-the-desk/PLAN.md)).
_Avoid_: omni-crud (engineering name only), coding agent, coding platform, site
builder, "the app", "the platform" (in UI copy)

**Shell**:
Aluna's one fixed UI surface: the wallpaper, the logo layer, the prompt bar and
the window. The platform owns all of it and generation writes none of it. The
shell may remember **how things look to the user**; it never decides **what is
true**. Window geometry, maximised state and where the user likes things are
**presentation state**, the shell's to keep in `localStorage`. Which records
exist, what is valid, what a capability means and what an intent was are
**canonical state**, the server's alone
(M5 plan 2).
_Avoid_: page, layout, frame

**Capability**:
One thing Aluna has built for the user to keep track of (e.g. their photos, their
recipes). Each capability the app has built has a logo on the desk and opens into
the window.
_Avoid_: feature, module, CRUD, resource, entity, model

**Separate capability**:
A new independent capability created when an intent overlaps an existing one but
belongs to a distinct collection or lifecycle. Its user-facing name includes the
meaningful distinction.
_Avoid_: duplicate capability, namespaced capability, suffixed capability

**Capability deletion**:
The explicit, user-confirmed permanent removal of one capability, all records it
owns, its complete version history, and any capability-owned resource or Event Log
payload. Content-free generation metrics remain as experiment data. The doorway is
the logo's context menu; the confirmation fills the window in authored product
voice; on commit the logo vanishes and the window puts itself away unless the
confirmation displaced a different open capability, whose canonical collection
then returns. Delete is the
one name for this act, in UI copy and in every document (M5 plan 19, 20).
_Avoid_: retire, archive, remove, hide, deactivate

**Desk**:
The whole surface Aluna occupies: a wallpaper, the logo of every capability the
user has, the prompt bar floating clear of all four edges, and one window. Logos
fill down a column and wrap to the next, taking as many columns as the desk
holds. There is no taskbar, so the logos are the only standing list of what
exists, and a fresh user sees a wallpaper and a prompt bar with nothing withheld
until a first capability arrives. The address `/` is the bare desk and
`/capability/:id` is the desk with that capability in the window
([design/index.html](design/index.html) D4, D14; M5 plan 3, 4, 6).
_Avoid_: capability toolbar, sidebar, header row (all three superseded), nav,
menu, drawer, taskbar, dock

**Window**:
The single frame every capability appears in. It floats on the desk, drags by its
title bar, resizes from the bottom-right corner, and carries two lamps: leaf
maximises, clay puts it away. There is no minimise, and there is never a second
window except the developer panel's. Everything a capability shows happens
inside it — the collection, one record, a confirmation, the narration of a build
— so opening a record swaps what the frame holds and opening another capability
swaps the contents without the frame moving. Nothing in Aluna opens over anything
else. Below the 720px breakpoint the window is the screen, and it neither drags,
resizes nor maximises; desktop geometry is ignored rather than overwritten, and
only the frontmost window is exposed if the developer panel is also open (design
D1, D2, D12; M5 plan 47, 48).
_Avoid_: content area and detail modal (both superseded), modal, dialog, popup,
main panel, canvas, workspace, body

**Put away**:
What the clay lamp does. The window disappears, the logo stays where it was, the
address falls back to `/`, and nothing in storage changes; the same click on the
same logo brings the window back. Putting the window away while a build or an
evolution is running warns first, because it kills the run, and proceeds only on
confirmation through an inline row that leaves the run mounted. Deleting a
capability is a different action and is deliberately
unreachable from window chrome, which is why no lamp is signal red (design D3;
M5 plan 17, 19).
The same leave-run warning guards switching to another capability logo and
Back/Forward while a build or evolution is mounted; confirmation uses the one
cancel teardown and then completes the requested navigation.
_Avoid_: minimise, hide, dismiss, exit; "close" names the gesture, "put away" is
what it does

**Logo**:
A capability's picture, and its permanent identity on the desk. A hosted vector
service draws it in a follow-up after v1 has activated, its presenter has
terminated and the long build lease has released, from a subject phrase and a
ground colour the model names and nothing else. The shell derives the request's
second colour from the closed leaf/shade, teal/sky, sun/ochre and clay/violet
companion lookup. The returned SVG is stored as received once at
the capability incarnation root, beside its immutable version snapshots, and
served immutable from an incarnation-keyed route. It is made once and never
remade: evolving a capability keeps the drawing v1 was born with, and
deleting the capability and building it again is the only route to a different
one. Until the artwork lands the tile is a placeholder, which is also what marks
the ground while a build runs; a logo that fails to arrive is retried through one
durable atomic claim path on desk load to a hard cap of three total attempts,
after which the placeholder is permanent.
The shell adds the 10% rounded corner, the shadow, the size and the name beneath,
and never anything inside the file. The logo also carries the context menu that
opens Rename and Delete, reached by right-click, press-and-hold, or the keyboard
menu key. Rename changes the platform-owned effective-label override and nothing
else through an inline Save/Cancel label form — not the authored snapshot, id,
address, version or artwork
([ADR-0007](docs/adr/0007-capability-logo-contract.md);
M5 plan 19).
_Avoid_: icon, avatar, thumbnail, favicon (the "tile" is the shell's frame around
the artwork, not the artwork)

**Ground colour**:
The colour a logo's artwork sits on, which the model names as one of the
palette's eight tint anchors: leaf, shade, teal, sky, sun, ochre, clay or violet.
Signal red is reserved and never offered. The set is closed for this one purpose,
so validating a ground is a word-list check rather than a measurement — the eight
anchors are already saturated and light enough for daylight, with no near-blacks,
no pastels and no greys. Two capabilities may share one. Distinct from the desk's
ground, which is where logos sit (M5 plan 39).
_Avoid_: background colour, brand colour, accent, theme colour

**Prompt bar**:
The always-visible, free-form text input floating above the desk, clear of all
four edges and never full width. Context-aware: it scopes to the capability in
the window. The user types intent here and watches the app build in the window.
No window drags or resizes into the strip it occupies. Anything Aluna refuses
before a build starts is explained here rather than in the window (design D5;
M5 plan 5, 24).
_Avoid_: search box, command bar, chat input, composer (acceptable when describing
the field itself, but the region is the "prompt bar")

**Drawn line**:
Every visible boundary in Aluna, drawn rather than ruled. A drawn edge deviates
from true on a fixed wavelength, is inked twice from two seeds, and is mitred at
every corner. The weight is 2px everywhere and the hierarchy lives in the
amplitude: a full hand for the things that hold others, a fine hand for what sits
inside a window, a close hand for small parts. It reaches into generated content,
so the cards, rows and tables a capability produces are drawn too, seeded from
the record's own id and therefore stable across a view swap and a resize. No seed
ever comes from where an element sits. Only what sits on the desk casts a shadow,
and the logo tile's 10% corner is the surface's one rounded corner. Because the
ink system owns every boundary, generated markup never declares `border`,
`border-radius`, `box-shadow` or a font family, and takes colour, type size and
spacing only from the sets in `design/styles/` (design D10, D11;
M5 plan 9, 10).
_Avoid_: CSS border, rule, stroke, outline, sketchy, hand-drawn effect

**Developer panel**:
The second window, and the only exception to there being one. It is read-only,
opens from its own tile on the desk, and may sit beside the capability being
watched, because reading what a build did while it does it is one activity. It
holds the build's raw generation internals — each stage's JSON (spec, migration,
units, gate, commit) — shown as it streams, and it is the one place in Aluna a
monospace face appears, because it shows raw payloads and stands outside the
product voice. It is a curiosity surface for people who want to see how Aluna
works, never a place to steer code, schema, framework, or styling decisions.
Module 9's experimenter surface lives in it too (design D13; M5 plan).
_Avoid_: console, debug drawer, inspector, right sidebar

**The pet**:
An anthropomorphic *spark of Aluna* — a small luminous companion with a face that
lives on the prompt bar, walks along it, and talks from there. A first-class
delight feature carrying no business logic. Defined now, deferred to a later issue
(full spec: [docs/pet.md](docs/pet.md)); its name is a TBD authentic Kogi word (do
not fabricate one). It is related to Aluna, but it is **not Aluna herself**. Two
surfaces wait on its design: where a disposable query answer appears (Module 6)
and where a behavioural proposal appears (Module 8). The pet is expected to carry
Aluna's narration once it lands (M5 plan).
_Avoid_: orb (the superseded concept), mascot, avatar, assistant, bot, spinner

**Product voice**:
The single voice all of Aluna's UI copy speaks in — warm, encouraging, gently
curious, first person, addressing the user directly. See *Product voice* below.
_Avoid_: tone, copy style, microcopy guidelines

## Engineering language (never user-facing)

Canonical terms for issues, code, tests, and docs. Per the hard rule (ARCH §9.7)
none of these words ever appear in UI copy.

**Action**:
One operation a capability exposes — `create`, `read`, `update`, `delete`,
`search` (Module 2 ships create + read). Always reached through the fixed route
convention; never an AI-invented route.
_Avoid_: endpoint, route, operation

**Capability incarnation**:
The platform-owned, opaque identity for one lifetime of a capability. Evolution
preserves it; permanent deletion followed by rebuilding the same semantic
capability id creates a new incarnation. It keys artifact/cache paths, declared
read dependencies, cleanup work, and generation metrics. It is never user-facing.
_Avoid_: capability version, capability id, generation id

**Owned-resource manifest**:
The deduplicated, incarnation-bound set of capability-owned resources a deletion
collects while the capability's table still exists, and which its durable deletion
tombstone then owes. Each entry names the cleanup adapter that must discharge it,
so one process can write a manifest that another process discharges. Every adapter
treats an already-absent resource as success.
_Avoid_: cleanup list, orphan list, file list

**Mutation coordinator**:
The platform module that atomically admits every write on the shared read-write
connection. A resolved build receives a bounded FIFO ticket and only the head
holds the long active lease; record and platform writes hold short leases;
capability deletion uses a non-queued try-acquire. Reads never enter it. It
replaces advisory busy flags and prevents unrelated requests from joining one open
SQLite write transaction. A record-write lease contains the complete generated
Handler lifecycle in one SQLite transaction: a non-success response rolls back the
canonical create/update/delete before ownership releases.
_Avoid_: busy flag, build-only queue, mutation lock check

**Core Builder**:
Everything between an already-resolved build request and a changed platform: the
bounded ticket, the exclusive lease, lease-head revalidation, the durable
admission row, and the run itself — spec or candidate, migration, units, Gate,
publication, activation. It owns no prompt route, no active DOM, and no SSE. It
takes a **resolved build request** and a **build presenter**, and emits one terminal
lifecycle event into that presenter while its lease is still held. This is the
reuse seam: the explicit loop resolves a typed prompt and supplies the foreground
presenter, while Module 8's implicit loop will hand over an already-confirmed
proposal in the same shape — never reclassified — and choose a presenter of its
own. Mutation, staging, Gate, activation, and metrics are identical either way
(PLAN decision 31, ADR-0006, ARCH §6.2). Today the seam is terminal-only: the
in-flight liveness sink still carries ADR-0002 SSE event names, a dead sink is
read as cancellation, and the product-voice narration is authored inside the
stages. Module 8 can swap the terminal presenter but not yet the in-flight story;
widening it waits for a second real presenter to shape it against.
_Avoid_: build pipeline, the builder service, prompt pipeline

**Resolved build request**:
What prompt resolution hands to the Core Builder. It binds one **target
expectation** — `expected_absent` for a new semantic id, or the exact
`{ capability_id, incarnation_id, expected_version }` of the capability being
evolved — plus the revision or canonical fingerprint of the one active registry
catalog it was classified against. Both are revalidated at the head of the lease
(PLAN decision 28).
_Avoid_: build job, build intent, classification

**Build presenter**:
The adapter that turns the Core Builder's terminal lifecycle event into what a
person sees. The explicit-loop presenter takes the window, narrates the
foreground product-voice story, and emits one View `commit` — only for a real
pointer activation. Every non-activating terminal instead gives back what the
build displaced, restoring the canonical committed View through `fragment` with
no sidecar for the desk. Presentation is not a Builder invariant: Module 8 may
choose another presenter entirely (PLAN decisions 29, 31; ADR-0002).
_Avoid_: renderer, view layer, the SSE handler

**Stale refusal**:
What happens when a resolved build request's target expectation, expected-absence,
or resolver catalog no longer holds once its lease is granted. The request is
refused outright — never silently rebased, retargeted, or reclassified against the
newer catalog. It starts no provider work and never opens a `running` row; while
ownership is held it writes one direct terminal admission row with
`lifecycle_status=failed, outcome=stale` and every generation stage skipped. That
row carries the expected incarnation for an evolution, and none at all for a new
capability refused before one was assigned. Distinct from the measured no-op
(`success/no_change`), which is a candidate that was authored and found identical
(PLAN decisions 28, 31, 37). The catalog binding covers **every active row**, so
any concurrent registry change refuses a queued build even when it touched an
unrelated capability — deliberate, because the classification was made about a
world that no longer exists, overlap and naming reasoning included.
_Avoid_: conflict, retry, race error, rebase

**Field name**:
The stable identity of one value a capability tracks. It does not change when
the user-facing wording changes.
_Avoid_: property name, column name, field label

**Field label**:
The user-facing name for a field. It may evolve without changing the field's
identity.
_Avoid_: property label, display name, field name

**List input mode**:
The AI-authored, platform-rendered form choice for one active `string[]` field.
`comma_separated` is for comma-free atomic values such as tags, genres,
categories, or skills: commas separate values, surrounding whitespace is
trimmed, and empty segments disappear. `repeatable` is for free-form values such
as quotes, addresses, citations, or names as entered: each control is one value
and commas remain data. Every active `string[]` declares exactly one mode under
form presentation intent; generated Handlers receive the same ordered array from
either mode and never see the choice.
_Avoid_: widget choice, form builder, delimiter setting

**Handler**:
The generated logic unit behind one capability Action. Generated when first
created or affected by a later Diff, and otherwise copied byte-for-byte into the
next immutable snapshot. It runs when the Action is called, receives parsed input
and injected mutation/query/presentation interfaces, and returns the HTML the user
sees. Canonical rows stay platform-internal: it receives only Action-safe active
projections/opaque handles, and update/delete mutation authority is already bound
to the router-validated target (ADR-0004, amended by ADR-0005/ADR-0006).
_Avoid_: controller, service, route handler

**Item renderer**:
The single generated presentation unit for one capability. It turns one projected
record into capability-specific inner markup used by `create`, `read`, `update`,
and `search`; delete refreshes the collection without rendering a deleted record.
Platform-owned list-item chrome supplies the accessible trigger, safe active-field
client projection, and the swap that puts one record in the window; Handlers
receive the renderer through their injected presentation adapter rather than
importing it
(ADR-0005). How the records are *arranged* as a collection (feed vs. grid) is
not the renderer's concern: that is the platform list container reading the
capability's `ui_intent.collection.layout`. The renderer is generated knowing
that layout and may read only active user fields or the closed presentational
platform field `created_at` when declared by `ui_intent.item.shows`; `id`,
`extra`, and inactive fields remain unavailable. It emits one record's markup;
canonical hidden values stay out of owning-capability input/presentation and new
model context. Because soft-hide is not erasure, a previously committed external
Handler may still use a hidden physical column through its declared dependency
until that Handler is regenerated (ADR-0006).
_Avoid_: row helper, card component, template

**View**:
A capability's data-free surface inside the window. Module 2 generates and caches
the initial `list`/`create` scaffolding; Module 3 moves that structural chrome
into platform rendering while live data continues to arrive through capability
handlers. Module 5 makes the window the only place a View lands, and ties
teardown to the content it replaces rather than to the window, so a swap from the
collection to one record and back releases what each left running. A View never
contains cached user data (ADR-0004, amended by ADR-0005; M5 plan 13).
_Avoid_: template, page, screen

**Gate**:
The layered, fail-closed validation every publishable candidate must clear before
commit — type-check, signature assertion, smoke run, and (when the tier is on)
behavioral tests; Module 3 adds design lint for generated item markup, which
Module 5 re-derives against the drawn line — three properties picked from the
High Meadow sets, four never declared at all. It runs against a scratch database
through adapters that expose only synthetic data, and its structural/static
checks reject known direct bypasses. Generated code still executes in-process, so
the Gate protects against accidental output rather than containing hostile code
(ADR-0003, ADR-0004, ADR-0005; M5 plan 10).
_Avoid_: CI, checks, test suite. Unqualified "gate" always means this one — the
per-incarnation read gate below is a different thing and is never shortened.

**Read gate**:
The per-incarnation admission state deletion drains against. It is `active` or
`closing`; closing refuses new read tokens, signals cancellation to the readers it
already tracks, and waits for them by a fixed deadline. Any failure before the
database point of no return reopens it; the tombstone commit retires it forever.
Distinct from the **Gate** above, which validates candidates before commit.
_Avoid_: gate (unqualified), lock, mutex, read lock

**Read token**:
The ownership record one operation holds over the exact incarnations it can observe.
An operation acquires its *complete* set atomically against one gate/catalog
snapshot or receives none, and releases the complete set in `finally`. Generated code
never receives the token — it only observes cancellation as a thrown error.
_Avoid_: read lock, handle, reservation

**Content region**:
The element a view is rendered into, and the owner of everything that view starts.
The shell's content area and each capability's records region are content regions
today; the window's content is the one that matters once the window ships. Marked
`data-content-region` so the release scope can find it, and never confused with the
**window**, which is the frame around it — one window holds many successive region
contents (M5 plan 13).
_Avoid_: content area (the shell's one instance, not the concept), container,
mount point, slot

**Release scope**:
What a content region holds on behalf of its current content: every in-flight
fetch, search controller, observer and timer that content started, each anchored to
the node that started it. It runs when the content is replaced or the region is
removed — the same fact, an anchor leaving the document, so there is no third path.
Aborting an in-flight request is what frees its **read token**, which makes the
client-side release and the server-side release one act rather than two mechanisms
that have to agree (M5 plan 13).
_Avoid_: teardown hook, unmount, cleanup callback, destructor

**Swap target**:
The named place a server-addressed swap lands — the stable id `commit` and `fragment`
carry, and the literal anchors page assembly composes a full page by replacing.
The server addresses one unconditionally and never asks whether it is there; the
client guarantees it is, for as long as a swap can be in flight. A target that cannot
be found is never absorbed: page assembly throws, and a `commit` or `fragment`
arriving at a region that has gone raises, because a swap that lands nowhere is
indistinguishable from a build that produced nothing (ADR-0002; M5 plan 16).
_Avoid_: swap destination, mount point, sink, drop zone

**Deletion tombstone**:
The non-routable state an active registry row becomes at deletion's point of no
return, carrying the owned-resource manifest it still owes. Resolvers, routes, and
the desk see only active rows, while the tombstone reserves the semantic id until
cleanup completes, so a recreated capability can never race stale cleanup.
_Avoid_: soft delete, deleted flag, archive row

**Frozen behavioral intent**:
The behavioral test suite a tier-on version is held to, generated per Action from
that Action's total inputs and written before any Handler byte exists. Published
as `tests/behavioral.json` and digested into the snapshot manifest. Because it
precedes the code, repair answers to it and never the other way around: a failing
assertion rewrites a Handler, never a test (PLAN decision 23, ADR-0006).
_Avoid_: the generated tests, the test file, expectations

**Total inputs**:
The closed set one Action's behavioral tests may be generated from — free-text
`behavior`, that Action's own `behavioral_errors` with their stable markers, its
declared dependency identities, and a per-Action schema projection. Never Handler
source, field labels, field order, `ui_intent`, inactive fields, or a
dependency's schema. Their canonical serialization is content-addressed as the
Action's **test input digest**: equal digests mean the Action's tests carry
forward untouched, which is what makes "a label rename regenerates nothing" a
fact about a hash rather than a policy (PLAN decision 23).
_Avoid_: test context, the prompt, generation inputs

**Executable impact**:
Which Handlers a build authors rather than copies forward — the thing test
*execution* follows, as distinct from the total inputs generation follows. A
frozen suite copied byte-for-byte still runs whenever a Handler it covers
regenerates, and may skip only when no covered Handler moved; each Action's suite
covers exactly its own Handler, because a case invokes that one Handler and seeds
and asserts everything else through platform ports. When coverage or runtime
failure attribution cannot be narrowed — nothing was stated, a change fact names
no Action, or the shared item renderer moved alongside Handler bytes — the
**full-suite fallback** runs the complete frozen suite rather than trusting an
unsound skip (PLAN decisions 22–23, ADR-0006).
_Avoid_: affected tests, dirty tests, invalidation

## Product voice

The voice every piece of UI copy speaks in, and the guide every coding agent
follows when it writes copy. It lives in this durable doc, not in the issue that
first needed it, because it steers all generated copy.

The voice is warm, encouraging, gently curious. It speaks in first person and
addresses the user directly ("you"), plainspoken and concise, with a quiet thread
of wonder — friendly and clear, not cutesy, not cryptic.

The hard rule (ARCH §9.7): never expose internals. No "handler", "spec",
"migration", "compile", "build artifact", "schema", "endpoint", "CRUD". Ever.
Narration, proposals, confirmations, and errors all speak in product voice.

### Do / Don't

| Do (product voice) | Don't (internals leak) |
| --- | --- |
| "Got it — putting that together now." | "Generating handler and running migration." |
| "All set. Want to add anything else?" | "Build committed; v1 artifacts written." |
| "Hmm, that didn't work — mind trying again?" | "Smoke test failed; build aborted." |

The one piece of voice copy shipped today is the cold-start prompt placeholder:
**"What would you like to keep track of?"** — warm, jargon-free, on-thesis.
