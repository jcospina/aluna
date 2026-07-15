# Hand-written five-Action reference capability, shape admission, and scratch adapters

Status: done
Category: bug

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

- [x] The reference capability installs into the living demo: toolbar entry,
      working create/read through existing chrome, and all five routes
      routable (update/delete/search exercised by curl until 4.3 chrome lands)
- [x] Transitional-epic integrity (plan acceptance): validators accept only the
      exact two-Action pair or the exact five-Action reference pair; no row
      advertises a missing Handler
- [x] The reference fixture is development-only and clearly marked for removal
      in 4.4
- [x] Gate smoke runs the reference capability against scratch adapters with
      synthetic data only
- [x] Structural checks reject a fixture Handler that imports or bypasses the
      toolbox
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The reference capability appears in the homepage toolbar beside prompt-built
capabilities; records can be created and read through the existing platform
chrome.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.2-mutation-coordinator-split-tools-and-routing-actions/issues/02-split-toolbox-scoped-mutations-and-read-only-query-port.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.2-mutation-coordinator-split-tools-and-routing-actions/issues/03-fixed-method-action-matrix-and-record-target-wire.md

## Implementation notes

- Added the second exact admitted authored shape: canonical five-Action `tools`,
  all five `read_dependencies` keys, and paired `create`/`update`
  `missing_required_fields` cases. Arbitrary subsets and cross-paired dependency
  shapes fail; the provider-facing prompt Builder remains hard-pinned to the exact
  two-Action schema and three-file inventory.
- Commit and Gate inventory checks now derive the only valid Handler inventory
  from the admitted Action shape. A five-Action row requires `item.ts` plus
  `create.ts`, `read.ts`, `update.ts`, `delete.ts`, and `search.ts`; a missing
  advertised Handler fails before execution or registration.
- Upgraded the hand-written Field lifecycle tracer into the development-only
  five-Action reference capability, explicitly marked for removal in 4.4. Its
  internal fixture identity stays internal; the consumer surface calls it
  **Journal entry**.
  Existing chrome creates/reads records; search is executable now; update/delete
  are real routable Handler seams that issue 4.2/05 deepens with target-bound
  mutation behavior.
- Added Gate scratch-catalog fixtures keyed by declared capability/incarnation.
  The Gate derives every dependency schema, seeds only caller-supplied synthetic
  rows into the fresh shared-memory database pair, and fails when a declared
  schema is absent. No live registry row or capability data enters scratch.
- Structural validation now rejects direct/static imports, dynamic imports,
  `require`, ambient runtime globals, and dynamic evaluation in Handlers, in
  addition to raw HTTP and mutation-SQL checks. Unit generation and Gate
  structural validation now share this complete Action-sensitive contract, so
  even an unexecuted advertised Handler is checked. Property names such as
  `input.values.process` remain valid while genuine ambient `process` access
  still fails. This remains accidental-output protection for in-process
  execution, not a security sandbox.
- Smoke and behavioral execution now receive the same complete synthetic
  scratch catalog. Platform-owned fixture setup validates and encodes inactive
  physical compatibility-column values without exposing live rows or routing
  canonical Handler writes around the mutation port.
- The prompt Builder's provider JSON Schema now narrows nested Action-owned
  behavioral-error shapes to the exact transitional `create`/`read` pair.
- Reference installation now runs the exact published fixture through Gate,
  acquires the shared mutation coordinator lease, and publishes within that
  admission boundary. When port 3030 is running, the install script calls the
  server-owned route instead of mutating the live database independently.
- Browser-visible copy now uses **Journal entry** and warm consumer-facing
  update/delete unavailability messages without reference-fixture, Handler, or
  future-slice narration.

## Verification

- `bun test` — 453 passing, 0 failing, 2 snapshots
- `bun run typecheck`
- `bun run lint`
- `git diff --check`
- `bun run demo:five-action-reference`
- Live `localhost:3030` probes: browser `POST create`, `GET read`,
  `GET search?q=Browser%20QA`, `POST update`, and `POST delete` all returned HTTP
  200. Read/search contained the saved entry; update/delete contained only the
  warm consumer messages.
- In-app browser: opened **Journal entry**, expanded **New Journal entry**,
  created a scalar/list record, opened it in the shared detail modal, and
  confirmed it survived reload.

## HITL test instructions

1. Run `bun run demo:five-action-reference`, then reuse the app server on port
   3030 (or run `bun run dev` if it is not already running).
2. Open `http://localhost:3030`, reload, and choose **Journal entry** from
   the capability toolbar.
3. Expand **New Journal entry**. Enter `Something` as the event, enter
   `fantasy, historical fiction, classic` in **Tags**, add `Doe, Jane` as one
   **Other names** value, then select **Add**. Confirm the new item appears, opens
   in the shared detail modal, and survives reload with the three tags separate
   while `Doe, Jane` remains one value.
4. Confirm all five Handler files are routable with these developer probes (use
   any nonblank target marker until issue 4.2/05 binds real target mutations):

   ```sh
   curl -i http://localhost:3030/capability/field_lifecycle_demo/read
   curl -i 'http://localhost:3030/capability/field_lifecycle_demo/search?q=Something'
   curl -i -X POST http://localhost:3030/capability/field_lifecycle_demo/update --data-urlencode '__aluna_record_id=reference-record'
   curl -i -X POST http://localhost:3030/capability/field_lifecycle_demo/delete --data-urlencode '__aluna_record_id=reference-record'
   ```

   Confirm each returns HTTP 200; read/search render record markup and
   update/delete return `I can’t save that change just yet. Please try again
   soon.` and `I can’t remove that entry just yet. Please try again soon.` rather
   than engineering terminology or an internal error. This slice exercises search routability by
   matching the reference Handler's `entry` field. Search across every active
   scalar/list text field, including `tags`, lands in issue 4.2/06.

## Comments

> *This was generated by AI during triage.*

## Agent Brief

**Category:** bug
**Summary:** Complete the five-Action reference and scratch-Gate contract without
admitting toolbox bypasses, invalid provider shapes, or engineering-facing
product copy.

**Current behavior:**

- Gate structural validation checks Handler imports and ambient-runtime access,
  but does not apply the existing raw HTTP and mutation-SQL checks. A five-Action
  snapshot can therefore pass every active Gate rung while an unexecuted Handler
  contains raw mutation SQL.
- Declared dependency fixtures reach smoke execution only. Behavioral execution
  creates only the target schema, so a valid Handler join can pass smoke and fail
  later because its declared scratch catalog is absent. Fixture rows are seeded
  through the active-field mutation interface, which cannot represent synthetic
  values in inactive physical compatibility columns.
- The provider-facing transitional spec schema fixes `tools` to `create` and
  `read`, but the nested `behavioral_errors[].action` schema still advertises all
  five Actions. Local validation rejects the mismatch only after generation.
- Source-isolation validation rejects every identifier named `process`, `eval`,
  `Function`, and similar names, including safe field/property access such as
  `input.values.process`.
- The development reference exposes engineering language in the capability
  toolbar, create chrome, and update/delete response fragments. The routed
  notices describe implementation paths and future slices rather than speaking
  in product voice.
- The advertised reference installer directly drops, rebuilds, seeds, and
  commits the capability without passing through the mutation coordinator or
  Gate, even when invoked while the app server is running.
- Existing green tests prove the basic shape, routes, and UI, but the scratch
  test changes the reference spec and read Handler and disables behavioral
  execution rather than pinning the exact published reference snapshot through
  its applicable Gate contract.

**Desired behavior:**

The development reference remains the exact admitted five-Action fixture, while
all of its source units receive the same complete static validation contract as
model-generated units. Gate scratch execution supplies complete synthetic
dependency catalogs consistently to every executing rung and can represent the
physical compatibility data a copied Handler may legally read. The prompt
Builder exposes only the transitional Actions throughout its provider schema.
Isolation checks reject actual ambient authority without rejecting valid field
names. The reference installs through the approved admission path and all
browser-visible strings remain consumer-facing product copy.

**Key interfaces:**

- Handler source validation — one complete Action-sensitive contract shared by
  unit generation and Gate structural validation.
- Gate scratch-catalog input — dependency schemas and synthetic compatibility
  rows available to smoke and behavioral execution without exposing live data.
- Transitional provider spec schema — nested Action-owned contracts narrowed to
  the exact `create`/`read` shape as well as the top-level tools tuple.
- Source-isolation AST checks — distinguish ambient/global references from
  property names and other harmless identifiers.
- Reference capability presentation — internal fixture identity stays internal;
  toolbar, form, and routed fragments use product voice.
- Reference installation — publication and writes respect Gate-before-live and
  mutation-coordinator ownership.

**Acceptance criteria:**

- [x] Gate structural validation rejects raw HTTP and raw mutation SQL in every
      advertised Handler, including Handlers not executed by the current smoke
      rung.
- [x] An unchanged five-Action reference snapshot passes its applicable Gate
      smoke contract, and a regression in any published Handler inventory is
      pinned by a focused test.
- [x] Smoke and behavioral scratch execution receive every declared dependency
      schema and synthetic row set; neither rung can read live registry or
      capability data.
- [x] Synthetic dependency fixtures can represent inactive physical-column data
      needed by a previously committed compatible reader.
- [x] The provider JSON Schema for the transitional Builder advertises only
      `create` and `read` everywhere Action ownership appears.
- [x] A valid capability field named `process` can be read through injected
      Handler input, while genuine ambient `process` access and the other known
      bypasses still fail.
- [x] No engineering-only terminology or implementation-slice narration appears
      in the reference capability's toolbar, form chrome, or routed fragments.
- [x] Installing or refreshing the reference cannot bypass Gate-before-live or
      mutation-coordinator admission, including while the app server is running.
- [x] `bun test`, `bun run typecheck`, `bun run lint`, and `git diff --check`
      remain clean, followed by live verification on the existing port 3030
      server.

**Out of scope:**

- Implementing target-bound merge update and delete behavior owned by issue
  4.2/05.
- Implementing per-Action dependency enforcement, target-id rehydration, or the
  complete normalized search baseline owned by issue 4.2/06.
- Adding hostile-code process containment; generated execution remains
  in-process accidental-output protection.
