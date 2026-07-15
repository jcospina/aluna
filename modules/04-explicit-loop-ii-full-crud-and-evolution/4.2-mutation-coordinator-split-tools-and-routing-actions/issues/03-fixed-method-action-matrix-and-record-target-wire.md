# Fixed method/Action matrix and the record-target wire

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.2 — Mutation
coordinator, split tools, and complete routing Actions
(PLAN decisions 16 and 6: `modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`;
ADR-0002 route conventions)

## What to build

The fail-closed Action/method matrix at `/capability/:id/:action`:

- `GET read`, `GET search`, `POST create`, `POST update`, `POST delete`. Every
  other method/Action combination is rejected before loading generated code.
- Search receives scalar `q`; update/delete require exactly one platform
  target marker; create/update receive parsed values with all reserved markers
  removed. Create rejects a record target; read/search reject mutation-form
  markers.
- The router extracts the single validated `__aluna_record_id`, strips the
  reserved namespace, and (in 4.2/05) binds the update/delete mutation adapter
  to that exact target before generated code runs.
- An Action a capability does not advertise (the two-Action transitional
  prompt shape) fails closed at the route — no generated code is loaded.

## Acceptance criteria

- [x] The full matrix is pinned by tests: the five admitted pairs route; every
      other combination (wrong method, unknown action) is rejected warm before
      generated code loads
- [x] Missing, duplicate, or unexpected record-target markers fail before
      generated code; create rejects a target; read/search reject mutation-form
      markers
- [x] A two-Action capability's `update`/`delete`/`search` routes fail closed
      without loading anything
- [x] Rejections use warm, internals-free product voice (existing error
      boundary conventions)
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

A curl matrix against a live capability shows each accepted route and each
warm rejection; the homepage keeps using `create`/`read` unchanged.

During the reset-bounded 4.2/03 transition, the live Field lifecycle capability
still advertises only `create`/`read`: those routes exercise the admitted matrix,
while correctly-methoded `update`/`delete`/`search` calls prove the advertised-
Action gate. Issue 4.2/04 installs the development-only five-Action reference that
makes all five admitted pairs exercisable by curl without weakening this issue's
strict two-Action registry shape.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.1-incarnation-keyed-field-and-input-contract/issues/03-reserved-wire-protocol-and-parsed-handler-input.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.1-incarnation-keyed-field-and-input-contract/issues/06-transitional-two-action-shape-and-builder-emission.md

## Implementation notes

- The capability route now catches every HTTP method and applies one complete
  allow-list: `GET read`, `GET search`, `POST create`, `POST update`, and `POST delete`.
  A wrong pair or unknown Action returns the existing warm 404 before a
  registry lookup, item-renderer load, or Handler load.
- The method matrix and capability advertisement stay separate. A route must pass
  the fixed matrix and the row's declared `tools`; prompt-built two-Action rows
  therefore continue to refuse `update`, `delete`, and `search` before generated
  code loads.
- Request parsing is Action-specific and closed. Search admits only optional
  scalar `q`; read/delete admit no ordinary values; create/update admit only
  presence-marked active fields. Presence and record-target markers are stripped,
  update/delete require exactly one nonblank target, and every other Action rejects
  a target.
- `create`, `update`, and `delete` all pass through short record-write admission;
  read/search remain concurrent. Update/delete target authority remains
  intentionally unbound until 4.2/05, but their validated target is already kept
  outside Handler input and their Handler cannot see reserved marker keys.
- Route tests inject the coming five-Action advertisement only at the registry
  lookup seam, proving all five route pairs without prematurely admitting or
  persisting issue 4.2/04's second authored shape. The real registry remains exact
  two-Action during this issue.
- No homepage chrome changed: the current create/read demo continues to use the
  same URLs and Handler contracts. The live integration change is the deterministic
  boundary beneath those routes plus warm rejection for every other pair.

## Verification

- Focused router and wire-protocol tests: 20 pass, 0 fail
- `bun test` — 441 pass, 0 fail, 2 snapshots
- `bun run typecheck`
- `bun run lint`
- `git diff --check`
- Existing `localhost:3030` server: `GET /capability/field_lifecycle_demo/read`
  returned HTTP 200; admitted `POST create`
  with an empty required Tags value reached the structured HTTP 422 validation
  boundary and wrote no record; `GET create`, `POST read`, `PUT unknown`, and the
  correctly-methoded but unadvertised `POST update`, `POST delete`, and `GET
  search` calls all returned the same warm, internals-free HTTP 404.

## HITL test instructions

1. Reuse the app server on port 3030, or run `bun run dev`, then open
   `http://localhost:3030/` and choose **Field lifecycle**.
2. Open **New Field lifecycle**, enter a real event and at least one Tag, then
   select **Add**. Confirm the item appears and the ordinary create/read homepage
   flow is unchanged.
3. Run `curl -i http://localhost:3030/capability/field_lifecycle_demo/read` and
   confirm HTTP 200 with record markup.
4. Run `curl -i http://localhost:3030/capability/field_lifecycle_demo/create` and
   `curl -i -X POST http://localhost:3030/capability/field_lifecycle_demo/read`.
   Confirm both return HTTP 404 with “I can't find that here,” never framework or
   generated-code details.
5. Run the update, delete, and search probes:

   ```sh
   curl -i -X POST http://localhost:3030/capability/field_lifecycle_demo/update --data-urlencode '__aluna_record_id=record-1'
   curl -i -X POST http://localhost:3030/capability/field_lifecycle_demo/delete --data-urlencode '__aluna_record_id=record-1'
   curl -i 'http://localhost:3030/capability/field_lifecycle_demo/search?q=field'
   ```

   Confirm all three return the same warm HTTP 404 without loading generated code:
   this capability still advertises only create/read until issue 4.2/04 installs
   the five-Action reference.
