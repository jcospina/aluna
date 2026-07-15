# Transitional two-Action authored shape and Builder emission

Status: done

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

- [x] A prompt-built capability's stored spec shows the exact transitional
      shape (tools, two dependency keys with empty arrays, Action-owned errors,
      and exact active-list form intent)
- [x] The `create` required-fields error case is required exactly when active
      required fields exist and must cover exactly those fields
- [x] Fixtures with update/delete/search keys, empty future Action keys, errors
      owned by absent Actions, non-empty dependency arrays, or a missing
      inventory file are rejected warm before registration
- [x] Transitional-epic integrity (plan acceptance): 4.1 accepts only the exact
      two-Action shape/inventory with empty dependency arrays; no row
      advertises a missing Handler
- [x] Reserved-name and lifecycle contract violations from 4.1/02–03 are
      covered by the same validation entry point
- [x] Prompt-building on the homepage still works end-to-end
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Prompt-build a capability and inspect its spec through the existing dev
preview: the exact transitional shape is visible; create/read routes work; no
absent Action is advertised anywhere in the UI or registry.

## Implementation notes

- The spec gate now accepts only the ordered `[create, read]` Action list,
  exactly empty `create`/`read` dependency arrays, and the exact active-required
  `create` error case. The Action list uses an OpenAI-compatible homogeneous
  fixed-length JSON Schema plus a local exact-order refinement; positional tuple
  `items` are intentionally avoided because the Responses API rejects them.
- Registry migration `0007_capability_registry_read_dependencies` persists the
  dependency object. Registry reads fail closed for malformed stored contracts
  rather than synthesizing missing behavioral errors.
- Commit validates the ordered `item.ts`, `create.ts`, `read.ts` inventory before
  writing files or registering the capability. Builder prompts emit only the
  transitional shape and now give unambiguous required-field and flat-list
  guidance to generated handlers/tests.
- Live provider verification built `tea_tastings` v1 with incarnation
  `2453f04c-ff3d-4703-af02-67caf90792b4`. Its persisted row has the exact tools,
  dependencies, error ownership, list-input intent, and three-file inventory;
  missing-required create, valid create, and read all passed through the real
  routes.

## Verification

- `bun test` — 408 passed, 0 failed
- `bun run typecheck` — passed
- `bun run lint` — passed
- `git diff --check` — passed

## HITL

1. Run `bun run dev` if the existing `3030` server is not already running, then
   open `http://localhost:3030/` and expand the developer panel.
2. Prompt: `I want to keep track of coffee cuppings, including coffee name,
   origin, tasting notes, and flavor tags`.
3. Confirm the spec preview finishes with exactly `tools: ["create","read"]`,
   `read_dependencies: {"create":[],"read":[]}`, one create-owned
   `missing_required_fields` case for the required fields, and one list-input
   mode for `flavor_tags`. Confirm the commit preview lists only `item.ts`,
   `create.ts`, and `read.ts`.
4. Open the new capability. Submitting without its required name should show a
   warm inline error; submitting a valid entry with comma-separated flavor tags
   should add it to the View and keep it visible after refresh. The toolbar must
   not advertise update, delete, or search.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.1-incarnation-keyed-field-and-input-contract/issues/02-field-labels-lifecycle-nullable-storage-requiredness.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.1-incarnation-keyed-field-and-input-contract/issues/03-reserved-wire-protocol-and-parsed-handler-input.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.1-incarnation-keyed-field-and-input-contract/issues/04-string-array-end-to-end.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.1-incarnation-keyed-field-and-input-contract/issues/05-model-authored-string-array-input-mode.md

## Post-epic quality review (2026-07-15)

- The transitional router now treats Action and HTTP method as one deterministic
  allow-list: `POST create` and `GET read`. Wrong pairs return the same warm 404
  before registry lookup or generated-code loading; 4.2 can extend this single
  matrix when the remaining Actions land.
- Handler and item-renderer ambient contracts no longer advertise platform-owned
  `extra`. Prompts state the same data boundary, keeping generation, static
  checks, Gate, runtime ports, and browser payloads aligned.
- The string-list form switch is exhaustive, preserving the closed input-mode
  vocabulary as future modes are added.
- Final verification: `bun test` — 413 passed, 0 failed, 2 snapshots;
  `bun run typecheck`, `bun run lint`, and `git diff --check` passed. The living
  demo installed at
  `capabilities/field_lifecycle_demo/7c1db2cf-c7f9-4d9a-b5cd-22a04011ee6e/v1/`.
- Live verification on the existing `localhost:3030` server created a record with
  comma-mode Tags and a blank repeatable placeholder, rendered the expected item
  and detail, exposed only admitted active fields in `data-item`, logged no browser
  errors, and returned warm 404s for `GET create` and `POST read`.
