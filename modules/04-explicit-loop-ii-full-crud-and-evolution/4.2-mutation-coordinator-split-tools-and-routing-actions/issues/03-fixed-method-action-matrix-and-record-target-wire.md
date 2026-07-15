# Fixed method/Action matrix and the record-target wire

Status: ready-for-agent

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

- [ ] The full matrix is pinned by tests: the five admitted pairs route; every
      other combination (wrong method, unknown action) is rejected warm before
      generated code loads
- [ ] Missing, duplicate, or unexpected record-target markers fail before
      generated code; create rejects a target; read/search reject mutation-form
      markers
- [ ] A two-Action capability's `update`/`delete`/`search` routes fail closed
      without loading anything
- [ ] Rejections use warm, internals-free product voice (existing error
      boundary conventions)
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

A curl matrix against a live capability shows each accepted route and each
warm rejection; the homepage keeps using `create`/`read` unchanged.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.1-incarnation-keyed-field-and-input-contract/issues/03-reserved-wire-protocol-and-parsed-handler-input.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.1-incarnation-keyed-field-and-input-contract/issues/06-transitional-two-action-shape-and-builder-emission.md
