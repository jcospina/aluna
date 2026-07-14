# Hand-written five-Action reference capability, shape admission, and scratch adapters

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.2 — Mutation
coordinator, split tools, and complete routing Actions
(PLAN decisions 4 and 11 + approved epic boundaries:
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`; ADR-0004
validation isolation)

## What to build

The development-only, hand-written **five-Action reference capability** that is
the 4.2–4.3 living-demo vehicle, plus the second admitted authored shape and
the scratch adapters that let the Gate exercise it.

- Reference capability authored shape: canonical
  `tools: [create, read, update, delete, search]`; `read_dependencies` with
  exactly all five keys; Action-owned errors valid for that set (including
  both `create` and `update` `missing_required_fields` cases when active
  required fields exist); all five Handler files plus `item.ts`. Its fields
  exercise the 4.1 contract: labels, an inactive field with stored data, a
  required field, and a `string[]`.
- Validators accept **only** the two complete shape/inventory pairs — the
  two-Action prompt pair and this five-Action reference pair — never an
  arbitrary subset. The prompt Builder continues producing the exact two-Action
  transitional shape. No registry row advertises a missing Handler.
- Scratch adapters contain all catalog schemas needed by declared joins and
  expose only synthetic data through the supplied split interfaces (never live
  rows).
- Structural/static checks reject direct imports and other known bypasses of
  the injected toolbox. Generated execution remains in-process: this is
  accidental-output protection, not a security sandbox.

## Acceptance criteria

- [ ] The reference capability installs into the living demo: toolbar entry,
      working create/read through existing chrome, and all five routes
      routable (update/delete/search exercised by curl until 4.3 chrome lands)
- [ ] Transitional-epic integrity (plan acceptance): validators accept only the
      exact two-Action pair or the exact five-Action reference pair; no row
      advertises a missing Handler
- [ ] The reference fixture is development-only and clearly marked for removal
      in 4.4
- [ ] Gate smoke runs the reference capability against scratch adapters with
      synthetic data only
- [ ] Structural checks reject a fixture Handler that imports or bypasses the
      toolbox
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The reference capability appears in the homepage toolbar beside prompt-built
capabilities; records can be created and read through the existing platform
chrome.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.2-mutation-coordinator-split-tools-and-routing-actions/issues/02-split-toolbox-scoped-mutations-and-read-only-query-port.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.2-mutation-coordinator-split-tools-and-routing-actions/issues/03-fixed-method-action-matrix-and-record-target-wire.md
