# Aluna

The single-context domain doc for this repo. **Aluna** is internally a platform
where stated intent becomes a working app: the user describes the capability-level
outcome they want, and the app builds — and rebuilds — itself to fit. The product
must always read as a friendly consumer app, never a coding agent, coding platform,
site builder, or engineering tool (ARCH §1, §9.7).

> The repository name **"omni-crud" is an engineering name** (it contains "CRUD")
> and must never appear as user-facing branding (ARCH §9.7). **Aluna** is the
> user-facing brand.

## Language

Use these terms verbatim in UI copy, issues, code, tests, and docs. The left
column is the word to use; `_Avoid_` lists the synonyms to keep out.

**Aluna**:
The product. A Kogi word for the realm of thought/spirit from which the material
world is born — a precise metaphor for a platform where stated capability-level
intent becomes a working personal app. Internally it is a self-building runtime;
to the user it is an app, never a coding agent, coding platform, or site builder.
The user-facing brand and wordmark.
_Avoid_: omni-crud (engineering name only), coding agent, coding platform, site
builder, "the app", "the platform" (in UI copy)

**Shell**:
The single static HTML page that is Aluna's one fixed UI surface. It ships once
and never changes; everything inside its regions is generated at runtime and
streamed in. The shell is dumb on purpose — it renders what the server sends and
reports what the user does, nothing more (ARCH §6.1).
_Avoid_: page, layout, frame

**Capability**:
One thing Aluna has built for the user to keep track of (e.g. their photos, their
recipes). Each capability the app has built is an entry in the capability toolbar.
_Avoid_: feature, module, CRUD, resource, entity, model

**Separate capability**:
A new independent capability created when an intent overlaps an existing one but
belongs to a distinct collection or lifecycle. Its user-facing name includes the
meaningful distinction.
_Avoid_: duplicate capability, namespaced capability, suffixed capability

**Capability deletion**:
The explicit, user-confirmed permanent removal of one capability, all records it
owns, its complete version history, and any capability-owned resource or Event Log
payload. Content-free generation metrics remain as experiment data.
_Avoid_: archive, remove, hide, deactivate

**Capability toolbar** (a.k.a. **sidebar**):
The left sidebar listing the user's capabilities. Starts empty on a fresh user and
rehydrates from the registry on load; clicking an entry loads that capability into
the content area. This is the only navigation, and it is the thing that *grows*.
_Avoid_: nav, menu, drawer (the off-canvas mobile presentation is a "drawer", but
the region is the "sidebar")

**Prompt bar**:
The always-visible, free-form text input pinned to the bottom of the content
column. Context-aware: it scopes to the active capability. The user types intent
here and watches the app build above.
_Avoid_: search box, command bar, chat input, composer (acceptable when describing
the field itself, but the region is the "prompt bar")

**Content area**:
The surface that fills the space above the prompt bar and below the header row.
Capabilities and build narration render here. At cold-start it is a neutral,
deliberately-empty surface (the brand lives in the header row, not here).
_Avoid_: main panel, canvas, workspace, body

**Header row**:
The always-present top bar of the content column. Three slots on one line: the
capability-toolbar toggle (left, shown once capabilities exist), the centred Aluna
wordmark, and the developer-panel toggle (right, the `</>` icon).
_Avoid_: topbar, banner, masthead

**Developer panel**:
The right sidebar, mirroring the capability toolbar's look but anchored right and
toggled by the header's `</>` icon. A developer-facing verification surface holding
the build's raw generation internals — each stage's JSON (spec, migration, units,
gate, commit) — shown as it streams. It is read-only and observational: a curiosity
surface for people who want to see how Aluna works, never a place to steer code,
schema, framework, or styling decisions. Not product UI; product-voice narration
stays in the content area.
_Avoid_: console, debug drawer, inspector (the off-canvas mobile presentation is a
"drawer", but the region is the "developer panel")

**The pet**:
An anthropomorphic *spark of Aluna* — a small luminous companion with a face that
lives on the prompt bar, walks along it, and talks from there. A first-class
delight feature carrying no business logic. Defined now, deferred to a later issue
(full spec: [docs/pet.md](docs/pet.md)); its name is a TBD authentic Kogi word (do
not fabricate one). It is *related to* Aluna but is **not Aluna herself**.
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
read dependencies, cleanup work, and generation metrics, and is never user-facing.
_Avoid_: capability version, capability id, generation id

**Mutation coordinator**:
The platform module that atomically admits every write on the shared read-write
connection. A resolved build receives a bounded FIFO ticket and only the head
holds the long active lease; record and platform writes hold short leases;
capability deletion uses a non-queued try-acquire. Reads never enter it. It
replaces advisory busy flags and prevents unrelated requests from joining one open
SQLite write transaction.
_Avoid_: busy flag, build-only queue, mutation lock check

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
client projection, and modal behavior; Handlers receive the renderer
through their injected presentation adapter rather than importing it
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
A capability's data-free content-area surface. Module 2 generates and caches the
initial `list`/`create` scaffolding; Module 3 moves that structural chrome into
platform rendering while live data continues to arrive through capability
handlers. A View never contains cached user data (ADR-0004, amended by
ADR-0005).
_Avoid_: template, page, screen

**Gate**:
The layered, fail-closed validation every publishable candidate must clear before
commit —
type-check, signature assertion, smoke run, and (when the tier is on) behavioral
tests; Module 3 adds design lint for generated item markup. Runs against a
scratch database through adapters that expose only synthetic data; structural/
static checks reject known direct bypasses. Generated execution remains
in-process, so this is accidental-output protection rather than hostile-code
containment (ADR-0003, ADR-0004, ADR-0005).
_Avoid_: CI, checks, test suite

## Product voice

The voice every piece of UI copy speaks in, and the guide every future coding
agent follows when it writes copy. (Authored here, in the durable doc, because it
steers all generated copy — not just this issue's.)

- **Persona:** warm, encouraging, gently curious. Speaks in **first person**,
  addresses the user directly ("you"). Plainspoken and concise, with a quiet
  thread of wonder. Friendly and clear — not cutesy, not cryptic.
- **Hard rule (ARCH §9.7):** never expose internals. No "handler", "spec",
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
