# 0005 — Opinionated capability UI: platform presentation, one item renderer and a closed design contract

Status: Accepted

## Context

Aluna writes a capability's UI out of sight. Generation is one-shot, an evolution
regenerates whatever its changes reach, and no developer reviews the output before
it goes live. Handed a structural contract and a spec with no design guidance, a
model has nothing to imitate, and it reproduces the same bare scaffold on every
build: a title, an empty state and a form. Consistency cannot be hoped for one build
at a time, so it has to be structural.

Model-driven UI tools such as v0 with shadcn, and automated design linters, share
three parts: a closed vocabulary of tokens and primitives, the spec and examples fed
to the model, and an automated audit that rejects violations. Aluna has a closed
token layer, High Meadow in `design/styles/` (ADR-0001), and a Gate that fails
closed. This ADR adds the primitives, the examples, and a design rung for that Gate.

Aluna's platform holds no business logic: a capability's rules live in its
generated Handlers. Presentation is another matter: the platform may own it, as it
owns the record count (§1) and the answer window (ADR-0008), neither of which decides
anything about a record. ADR-0004 defines what a capability's artifacts are and how
the Gate may run them; this ADR defines how its Views and cards are drawn.
[Generated UI](../architecture.md#47-generated-ui) traces one card from the request
to the screen.

## Decision

1. **Thick shell, thin generation: the platform owns the structural chrome.** The
   platform draws every View from the spec on each request, without a model call.
   The collection holds the search rail with the New button beside it, the record
   count, the records region in the capability's declared layout, the search's
   status line and the empty state. A Handler that finds no records returns
   nothing, so the platform's empty state is the only one. Pressing New puts the
   create form in the collection's place. A record opens into its record view: the
   form in edit mode under a back control, the records linking to it (ADR-0011), and
   an action row whose Delete asks for confirmation in place of the row.

   Aluna has no read view of a record and no modal, so opening a record swaps what
   the window holds. The one other surface a record has is the full player a held
   video or sound opens into. No View is a generated unit. None of this chrome
   implements a capability rule or persists canonical state.

   One platform module renders every field, in create and in edit mode, through a
   total switch over the field types, so a new type extends one place and the
   type-checker refuses the build until it does. The module reads the form intent
   the model declared (§6). Both list input modes have drawn controls, and both
   normalize to the same ordered array before a Handler sees the value. A choice
   stores one stable string from its field's ordered options. A retired option
   cannot be picked, and a record already holding one keeps it and still shows it.

   The router refuses an undeclared choice value and a string over its `max_length`
   before any generated code runs, so generated code is never a second validator for
   either. A required or over-limit refusal is the platform's own sentence. A
   declared business error belongs to the Handler: its one marked sentence is
   authoritative, and the platform moves it next to the affected field through the
   `data-error-fields` marker without rewriting it. `behavioral_errors` fixes the
   error's marker and fields, never its wording. How choice options and limits may
   change under evolution is ADR-0006's.

2. **The item renderer is the single generated creative surface.** Each capability
   has one versioned, generated item renderer. It turns one record into the
   capability-specific inner markup of its card, and it is free, and encouraged, to
   fit that record's composition to the data: a stacked block, a compact row, a media
   tile, a text-forward entry. How the records are arranged as a collection is a
   separate closed value, `ui_intent.collection.layout` (§6), which the platform's
   list container reads. A renderer that draws one record cannot choose that
   arrangement. The renderer is generated knowing the layout, so composition and
   arrangement are designed together.

   `create`, `read`, `update` and `search` receive the renderer through `present`, a
   capability-scoped presentation adapter in their injected toolbox, and every record
   they return goes through it. `delete` draws nothing, and the collection is read
   again through `read` or `search`. The record address draws the listed cards of
   linking capabilities through the same adapter. Handlers import nothing
   (ADR-0004). Two Handlers cannot drift apart in how they draw a record, because
   neither of them draws one.

3. **The platform owns item mechanics.** `present` hands the item renderer a copy of
   the record holding only the fields `ui_intent.item.shows` names. It runs the
   runtime enforcer on the markup that comes back, on every record, so a hostile
   field value cannot become executable markup even after the Gate cleared the
   renderer. It holds the markup inside its card, so the markup can neither close an
   element it never opened nor leave one open. Then it frames the result in the
   platform's item wrapper. The model composes the card. The platform serializes and
   escapes the payload, makes the card accessible, inserts record values safely and
   decides what a press does.

   Every capability has `update`, so every card opens its record, and the item
   wrapper is a `<button>`. A button is what the keyboard already reaches, so the
   wrapper carries no `role`, no `tabindex` and no key handling of its own. Item
   markup can hold no interactive element: no `<a>`, no `href`, no `<button>` or
   `<input>`. The wrapper carries an escaped `data-item` projection of the record's
   `id`, `created_at` and active fields, in which a file field is its reference and
   never its bytes. `extra` and inactive fields stay on the server. The wrapper seeds
   the card's drawn line from the record's `id` through `data-ink-seed`, so the
   generation pipeline never learns the ink system exists. When a linked field holds
   a name that picks no record, the wrapper draws the broken-link mark beside the
   markup (ADR-0011).

   A press opens the record at its record address, `/capability/:id/:record`
   (ADR-0010). That route is the platform's: it reads the stored record and draws the
   whole form, so a card that truncates a value never truncates the record. No
   generated Handler runs on it, and the fixed set of five Actions does not grow.

4. **A closed-value design contract, enforced by a design-lint rung.** Generated item
   markup reaches first for an allow-list of classes whose implementations consume
   the design tokens. `design/design-system.md` is the source of truth for that
   vocabulary, under "The class vocabulary", and `design/styles/layout-kit.css` ships
   it. With the kit, common arrangement never needs inline `style`. The kit is a set
   of sensible defaults and not a CSS framework, and no closed class list anticipates
   every composition, so where the kit does not reach, inline `style` is an escape
   hatch held to the tokens.

   Three axes are closed. A colour names a High Meadow palette token, such as
   `var(--leaf)`, from the set `src/presentation/tokens/design-tokens.ts` lists.
   `--signal` is kept for alerts and destructive confirmation. A type size names a
   `--type-*` token, and a margin, padding, gap or offset names a `--space-*` token.
   A raw value on any of the three is refused. A spacing value may be zero or
   `auto`, and a colour may be a keyword that names no colour, such as
   `transparent`. `--ink`, `--ink-2` and `--ink-3` never fill a box, because an ink
   block wrapped round a lighter one is a border by another route.

   Four properties are never declared. A font family is inherited from the surface
   the card sits on. `border` belongs to the ink system, which draws every boundary
   as an SVG path, the card's own included. `border-radius` has no token, because
   every corner in High Meadow is mitred and a square corner is the absence of a
   declaration. `box-shadow` is refused because nothing inside a window casts. The
   shadow tokens are bare `<x> <y> <alpha>` numbers, so
   `box-shadow: var(--shadow-window)` is an invalid value that fails silently, and
   only a ban catches it. Their aliases fall with them, as
   `src/presentation/safety/enforcer/style-discipline.ts` lists: `outline` and
   `column-rule` with `border`, a `clip-path` that rounds its corners with
   `border-radius`, `text-shadow` and `drop-shadow()` with `box-shadow`. There is no
   line-weight token, so a property whose value is a thickness has no value it may
   take. `all` is refused because it resets the inheritance every other rule depends
   on.

   The security bans are absolute: a class outside the vocabulary, an interactive
   descendant, a script or an `on*` handler, and a field value interpolated into
   markup unescaped or into a `style` attribute at all, since styles are literal in
   the renderer source. Inside `style` they also refuse `url(...)` and every function
   that fetches or synthesizes a resource, a raw or computed colour, `!important`, a
   custom property, a `position` other than `static` or `relative`, the transform
   family, and the filters and blend modes that recolour the surface without naming a
   colour. Outside the three axes and these bans, `style` is free: arrangement,
   alignment, aspect ratio, width.

   Two enforcers hold the contract, and both key on the same token and class sets.
   The runtime enforcer in `present` neutralizes whatever reaches render time. The
   design-lint rung of the Gate always runs and fails the build closed. It renders
   the item renderer within the declared collection layout, on a benign record, on
   one record per shown field, on file-type probes, and on one hostile record per
   injection family. It fails when the markup leaves the contract, when the enforcer
   would have to change it, or when changing a shown field leaves the card unchanged.
   A failure regenerates the item renderer once, with the violation fed back. The
   item wrapper, its payload and the form are covered by platform tests, because none
   of them is a requirement the model can get wrong.

   *Closed values, open composition*: the contract closes the design-value space and
   the executable surface, and never how a card arranges its record.

5. **The Core Builder is steered by injection, not a runtime tool.** Unit
   generation is one-shot structured output, bounded to one unit's write, check and
   fix loop, and never a roaming agent (ADR-0003). Design guidance therefore reaches
   the model in its prompt, and the design-lint rung enforces it (§4). The
   item-renderer prompt carries the allow-listed classes, the three token sets, the
   bans, the chosen collection layout and a curated, repo-only gallery of
   deliberately different exemplars, framed "vary, don't copy". Every exemplar
   without a file is shown, and an exemplar with a file is shown only when its file
   fits a field the card shows. The exemplars are never rendered to the person.

6. **`ui_intent` records only capability-specific presentation intent.** The spec's
   `ui_intent` holds three things the model authors. `item` holds the card's design
   direction, in free text, and `shows`, the fields the card shows: active fields or
   `created_at`, at least one, each once. `collection.layout` is `feed` or `grid`,
   which the list container maps to a layout class through a total switch. `form` is
   the form intent §1 renders. It gives exactly one list input mode for every active
   `string[]`: `comma_separated` for comma-free atomic values such as tags,
   `repeatable` for free-form values such as quotes, where a comma may be data. It
   gives exactly one choice presentation for every active choice: `picker`, `radio`
   or `segmented`. It names the string fields drawn as long text, and gives at most
   one line of guidance per field. An unknown value fails the build closed, as an
   unknown field type does.

   Apart from two pieces of free text, every value is closed and maps to a platform
   control or class, never a view tree the model emits. The free text is the card's
   direction, which only the item-renderer prompt reads, and the guidance line the
   form prints under a field. A key nothing reads is not stored, so `ui_intent` names
   no Views and no record surface: the platform owns both.

   On a first build whose card shows a file, the platform draws the layout from the
   capability incarnation's id and tells the model which one it drew, because a
   model asked cold lays out every photo capability as a grid and every sound or
   document as a feed. A card that shows no file keeps the model's layout.

## Considered options

**A better prompt alone, with the whole UI generated.** It re-rolls consistency on
every build and every evolution and gives no structural guarantee, which is the
failure a hidden, unreviewed generator can least afford.

**A single gold example.** A model anchors on one example and reproduces its layout,
trading the sameness of no guidance for the sameness of one sample. A small, diverse
gallery teaches the contract's range.

**A fixed menu of primitives that closes the composition too.** Every capability
would converge on the same layout.

**An identical row helper copied into every Handler.** Independent units would have
to keep one presentation contract in step, and the Diff Engine would have to
coordinate the copies. One injected renderer gives every Handler the same output by
construction.

**A runtime "read the design system" tool, or an agentic design loop.** It fights
ADR-0003's bounded per-unit loop and lengthens every build. Injection and the
design-lint rung reach the same result deterministically.

**Fully declarative server-driven UI, where the model emits JSON and the platform
renders the view.** ADR-0004 rejects it as platform business logic. The platform
owns the presentation mechanics, and the model writes the item renderer and the
Handlers.

**A modal or a read-only detail view for a record.** Everything a capability shows
happens inside its window. A second record surface would need a read rendering for
every field type and its own way into editing.

**A `table` collection layout.** A true table draws aligned cells from fields and
bypasses the item renderer, which dissolves the per-record creative surface.

## Consequences

- A View holds no cached user data. The platform draws it from the spec, and
  records reach it in Handler output, in the records a search's link walk appends
  (ADR-0011), at a record address from the platform's own read of that one record,
  or as the listed cards of the records linking to it (ADR-0010).
- A capability's generated presentation is one unit. The Diff Engine (ADR-0006)
  regenerates the item renderer only when a change reaches the card: its direction,
  its shown fields, the collection layout, or the label, appended options, option
  labels or accepted families of a field it shows. A change to any form intent
  touches only the platform's form.
- Build metrics time the item renderer as the presentation-generation stage, apart
  from Handler generation.
- `design/design-system.md` holds the names and the rules and states no token
  value. Every token value lives once, in `design/styles/tokens.css`. Repo policies
  check the token names in `src/presentation/tokens/design-tokens.ts` against
  `tokens.css` and the class allow-list against `layout-kit.css`, so the code and
  the stylesheet cannot drift apart.
