# Transitional two-Action authored shape and Builder emission

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.1 — Incarnation-keyed,
evolution-ready field and input contract
(PLAN decision 4 transitional + approved epic boundaries:
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`; ADR-0006 frozen
behavioral intent)

## What to build

The exact reset-bounded transitional authored shape for prompt-built
capabilities, emitted by the Builder and enforced by validation. This is 4.1's
closing tracer: the evolution-ready spec contract exists before evolution does.

The one admitted prompt-path shape/inventory:

- canonical `tools: [create, read]`;
- `read_dependencies` with **exactly** those two keys, both arrays empty in
  4.1 (valid declared pairs may populate them only once 4.2 enforcement
  exists);
- `behavioral_errors` owned only by those Actions, including the exact `create`
  `missing_required_fields` case whenever active required fields exist,
  covering exactly those fields (inactive and optional fields cannot appear);
- `ui_intent.form.list_inputs` with exactly one `{ field, mode }` entry for
  every active `string[]`, as established by 4.1/05;
- inventory: `create.ts`, `read.ts`, plus `item.ts`.

No update/delete/search contract is admitted or advertised: the Builder does
not emit empty future Action keys or update/delete requirements, and no
registry row advertises a missing Handler. Validators accept only this exact
shape/inventory from the prompt path — never an arbitrary subset.

## Acceptance criteria

- [ ] A prompt-built capability's stored spec shows the exact transitional
      shape (tools, two dependency keys with empty arrays, Action-owned errors,
      and exact active-list form intent)
- [ ] The `create` required-fields error case is required exactly when active
      required fields exist and must cover exactly those fields
- [ ] Fixtures with update/delete/search keys, empty future Action keys, errors
      owned by absent Actions, non-empty dependency arrays, or a missing
      inventory file are rejected warm before registration
- [ ] Transitional-epic integrity (plan acceptance): 4.1 accepts only the exact
      two-Action shape/inventory with empty dependency arrays; no row
      advertises a missing Handler
- [ ] Reserved-name and lifecycle contract violations from 4.1/02–03 are
      covered by the same validation entry point
- [ ] Prompt-building on the homepage still works end-to-end
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Prompt-build a capability and inspect its spec through the existing dev
preview: the exact transitional shape is visible; create/read routes work; no
absent Action is advertised anywhere in the UI or registry.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.1-incarnation-keyed-field-and-input-contract/issues/02-field-labels-lifecycle-nullable-storage-requiredness.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.1-incarnation-keyed-field-and-input-contract/issues/03-reserved-wire-protocol-and-parsed-handler-input.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.1-incarnation-keyed-field-and-input-contract/issues/04-string-array-end-to-end.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.1-incarnation-keyed-field-and-input-contract/issues/05-model-authored-string-array-input-mode.md
