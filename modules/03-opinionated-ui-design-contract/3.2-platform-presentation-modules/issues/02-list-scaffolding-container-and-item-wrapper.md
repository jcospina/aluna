# List scaffolding container (feed | grid) + accessible item wrapper

Status: ready-for-agent

> **HITL — human visual sign-off required.** The list layout and item chrome are
> the visible product surface; a human confirms feed/grid layout and the wrapped
> item read on a running `/demo` surface before this issue is done.

## Epic

Module 3 — Opinionated Capability UI · Epic 3.2 — Platform presentation modules
(the thick shell) (`docs/modules.md` §3.2, ARCH §6.1, ADR-0005 §1 & §6,
PLAN decisions 1 & 5: `modules/03-opinionated-ui-design-contract/PLAN.md`)

## What to build

The platform list scaffolding and the accessible **item wrapper** — the container
an item renderer's output lands in, and the standardized trigger each rendered
record is wrapped in. Structural chrome, platform-owned, presentational only.

- **Container**: renders the list scaffolding with its closed `feed | grid` layout
  modes (mapped from `ui_intent.collection.layout` to a token-consuming layout
  class), the empty state, and the "New X" button (opening the create form from
  3.2/01). `table`/`masonry` are out of scope (deferred, ADR-0005 §6).
- **Accessible item wrapper**: wraps one record's generated inner markup in the
  standardized accessible trigger, embeds the full record as an **escaped
  `data-item` payload** (`file` fields as references, never bytes), and carries
  the click-to-open affordance. Escaping/payload/accessibility are platform
  invariants (deterministic tests, ADR-0005 §4), not model concerns.
- Demonstrated with a **hand-written** item renderer (no AI yet): its output
  round-trips through the wrapper into the container in both `feed` and `grid`.

Before 3.3/01 lands, default the layout to `feed` (PLAN decision 5).

## Acceptance criteria

- [ ] The container renders `feed` and `grid` from `collection.layout` via a
      token-consuming layout class; an unknown layout is unrepresentable
      (closed enum)
- [ ] Empty state and a "New X" button (opening the create form) render
- [ ] The item wrapper emits the standardized accessible trigger with an escaped
      `data-item` payload (file fields as references) and a click-to-open
      affordance
- [ ] Platform tests pin the wrapper's escaping/payload/accessibility invariants
- [ ] Demo: a hand-written item renderer round-trips through the wrapper into the
      container in both feed and grid on a `/demo` surface; human visually confirms
      layout + item chrome before done

## Blocked by

- modules/03-opinionated-ui-design-contract/3.2-platform-presentation-modules/issues/01-centralized-field-renderer.md
