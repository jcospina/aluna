# Re-point View serving to spec-rendered platform scaffolding

Status: ready-for-agent

> **HITL — human visual sign-off required.** Opening a capability now renders the
> platform-built list instead of a served view; a human confirms parity and no
> visual regression on the running app before this issue is done.

## Epic

Module 3 — Opinionated Capability UI · Epic 3.2 — Platform presentation modules
(the thick shell) (`docs/modules.md` §3.2, ARCH §6.1, ADR-0005 §1,
PLAN decision 1 & flow step 6: `modules/03-opinionated-ui-design-contract/PLAN.md`)

## What to build

Re-point the capability **View**-serving path so the list scaffolding is rendered
**live from the spec** by the platform (3.2/02) instead of being served from a
generated `list.html`/`create.html`. The ADR-0004 "never-stale cache" property is
preserved because data never enters the platform-rendered chrome — records still
arrive through the `read` **Action**.

- `GET /capability/:id` (toolbar-entry clicks) and the rehydration path in the
  cached-view module (`src/web/cached-view.ts`) render the platform list
  scaffolding from the capability's spec — deterministic, no AI, no regeneration.
- The generated `list`/`create` Views are no longer served. (Their *generation*
  is retired later in 3.4/02 and finalized in 3.7; this issue stops *serving*
  them.)
- Records continue to load through the capability's `read` Action into the
  container's live region.

## Acceptance criteria

- [ ] `GET /capability/:id` and the cached-view rehydration path render the
      platform list scaffolding from the spec (no served `list.html`/`create.html`)
- [ ] Records still arrive through the `read` Action; no user data is baked into
      the platform-rendered chrome
- [ ] The layout honors the capability's `collection.layout` (defaulting to `feed`
      until 3.3/01 lands)
- [ ] Router/serving tests cover the spec-rendered path and the data-free invariant
- [ ] Demo: opening an existing capability from the toolbar shows the
      platform-rendered list; human visually confirms parity / no regression before
      done

## Blocked by

- modules/03-opinionated-ui-design-contract/3.2-platform-presentation-modules/issues/02-list-scaffolding-container-and-item-wrapper.md
