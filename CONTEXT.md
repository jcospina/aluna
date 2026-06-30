# Aluna

The single-context domain doc for this repo. **Aluna** is a platform where stated
intent becomes a working app: the user describes what they want to keep track of,
and the app builds — and rebuilds — itself to fit. The interface must always read
as a friendly consumer product, never an engineering tool (ARCH §9.7).

> The repository name **"omni-crud" is an engineering name** (it contains "CRUD")
> and must never appear as user-facing branding (ARCH §9.7). **Aluna** is the
> user-facing brand.

## Language

Use these terms verbatim in UI copy, issues, code, tests, and docs. The left
column is the word to use; `_Avoid_` lists the synonyms to keep out.

**Aluna**:
The product. A Kogi word for the realm of thought/spirit from which the material
world is born — a precise metaphor for a platform where stated intent becomes a
working app. The user-facing brand and wordmark.
_Avoid_: omni-crud (engineering name only), "the app", "the platform" (in UI copy)

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
gate, commit) — shown as it streams. Not product UI; product-voice narration stays
in the content area.
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

**Handler**:
The generated logic unit behind one capability action. Written fresh by the
builder each version; runs when the action is called; receives its inputs and
capability-scoped tools, including the capability's presentation adapter, and
returns the HTML the user sees (ADR-0004, amended by ADR-0005).
_Avoid_: controller, service, route handler

**Item renderer**:
The single generated presentation unit for one capability. It turns one record
into the capability-specific inner markup used by create, read, and later search
results. Platform-owned list-item chrome supplies the accessible trigger,
escaped record payload, and modal behavior; handlers receive the renderer
through their injected presentation adapter rather than importing it
(ADR-0005). How the records are *arranged* as a collection (feed vs. grid) is
not the renderer's concern: that is the platform list container reading the
capability's `ui_intent.collection.layout`. The renderer is generated knowing
that layout, but it only ever emits one record's markup.
_Avoid_: row helper, card component, template

**View**:
A capability's data-free content-area surface. Module 2 generates and caches the
initial `list`/`create` scaffolding; Module 3 moves that structural chrome into
platform rendering while live data continues to arrive through capability
handlers. A View never contains cached user data (ADR-0004, amended by
ADR-0005).
_Avoid_: template, page, screen

**Gate**:
The layered, fail-closed validation every build must clear before commit —
type-check, signature assertion, smoke run, and (when the tier is on) behavioral
tests; Module 3 adds design lint for generated item markup. Runs against a
scratch database, never user data (ADR-0004, ADR-0005).
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
