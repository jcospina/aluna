# Re-cut unit generation: one item renderer + adapter-receiving handlers

Status: ready-for-agent

> **HITL — human visual sign-off required.** The generated item renderer is the
> builder's creative surface — the whole point of the module. A human must
> eyeball the generated, styled output on the running app before this issue is
> done; tests cannot judge whether it looks good.

## Epic

Module 3 — Opinionated Capability UI · Epic 3.4 — One item renderer, shared by
every action (`docs/modules.md` §3.4, ADR-0005 §2, ADR-0003 bounded fix loop,
ADR-0004 amended, PLAN decision 2 & flow steps 4 & 7:
`modules/03-opinionated-ui-design-contract/PLAN.md`)

## What to build

Re-cut unit generation (`src/builder/units.ts`) so a capability's generated
artifacts are **one item renderer + `create` + `read` Handlers** instead of M2's
four units (`handler:create`, `handler:read`, `view:list`, `view:create`). The
item renderer turns one record into capability-specific inner markup, generated
**knowing** the chosen `collection.layout`; the Handlers receive the presentation
adapter (3.4/01) and call it instead of emitting their own markup. This kills
create/read drift by construction.

- Generate the item renderer through the existing bounded type-check fix loop
  (`DEFAULT_UNIT_FIX_ATTEMPTS`, default 2 — reused, not new).
- Generate `create`/`read` Handlers to the ADR-0004 skeleton that call the
  injected adapter; no imports, no row markup.
- Retire the `list`/`create` **View** generation and their checks
  (`checkListView`/`checkCreateView`).
- Metrics: presentation-gen now measures **item-renderer** generation (the
  semantic successor to M2's html-gen) plus fix-loop attempts (ADR-0005 "metrics
  retain semantic continuity"; flow step 7). No `artifact_contract` marker in M3.

## Acceptance criteria

- [ ] Unit generation produces one item renderer + `create`/`read` Handlers; the
      four M2 units and their View checks are gone
- [ ] The item renderer is generated knowing `collection.layout` and runs through
      the bounded fix loop (default 2); exhaustion fails the build cleanly
- [ ] Handlers call the injected presentation adapter and import nothing; create
      and read render identical item markup by construction
- [ ] Metrics record item-renderer generation + fix-loop attempts as the
      presentation-gen stage
- [ ] Tests with a fake provider cover clean generation, fail-once-then-fix, and
      cap exhaustion; no test calls a real provider
- [ ] Demo: building a capability through `/demo/spec-build` shows the generated
      item renderer producing styled output through the adapter; human visually
      confirms the generated UI before done

## Blocked by

- modules/03-opinionated-ui-design-contract/3.3-presentation-intent-and-detail-modal/issues/01-reshape-ui-intent-and-spec-generation.md
- modules/03-opinionated-ui-design-contract/3.4-one-item-renderer/issues/01-presentation-adapter-in-injected-toolbox.md
