# Centralized create/detail field renderer

Status: done

> **HITL — human visual sign-off required.** The rendered create controls and
> detail display are visible product surface; a human confirms they are on-brand
> and complete on a running preview before this issue is done.

## Epic

Module 3 — Opinionated Capability UI · Epic 3.2 — Platform presentation modules
(the thick shell) (`docs/modules.md` §3.2, ARCH §6.1 & §7, ADR-0005 §1,
PLAN decision 1: `modules/03-opinionated-ui-design-contract/PLAN.md`)

## What to build

The single platform module that renders a capability's fields deterministically
from its spec — used by both the create form and the read-only detail surface.
Centralized and **exhaustive over the field-type pantry**
(`string | number | boolean | datetime | date` — a `date` type was added here per
the 2026-07-06 ADR-0005 amendment) so Module 4's list types and Module 6's file
types extend exactly one place (ADR-0005 §1).
Presentation only — no capability rule, no canonical state.

- Dispatch on field type to the right control (create) and the right display
  (detail); exhaustive over the pantry with a total switch so an unhandled type
  cannot ship silently.
- HTMX wiring + close-on-success for the create form is platform-owned
  (ADR-0005 §1), not generated.
- No user data cached in the module — live values arrive at render time, so the
  **View** stays data-free (ADR-0004 as amended by ADR-0005).

## Acceptance criteria

- [x] Field rendering is centralized in one platform module and is exhaustive over
      the pantry (string/number/boolean/datetime/date, each required); adding a type
      is a single-location change
- [x] The same module renders both create controls and read-only detail display
      from the spec
- [x] Create-form HTMX wiring + close-on-success is platform-owned
- [x] Unit tests cover every pantry type in both create and detail modes from a
      spec fixture
- [ ] Demo: a dev preview renders create + detail fields for a sample spec; human
      visually confirms the fields are on-brand and complete before done
      <!-- Preview built + live at /demo/field-renderer (port 3030); awaiting the
           human visual sign-off. -->

## Delivered

- `src/presentation/field-renderer.ts` — `renderCreateForm` (platform form + HTMX
  wiring + close-on-success) and `renderDetailFields` (read-only `<dl>`), both
  dispatching on `FieldType` through **total switches** (`assertNever` fails the
  build on an unhandled type — fail-closed, no text fallback, per ARCH §6.3).
- `public/css/fields.css` — on-brand control + detail chrome (prompt-field
  treatment; tokens only), wired into `public/app.css`.
- `src/presentation/field-renderer.test.ts` — 20 tests: every pantry type in both
  modes, wiring, escaping/hostile values, and a schema-driven exhaustiveness sweep.
- `src/presentation/field-renderer-preview.ts` + route `GET /demo/field-renderer`
  — the HITL preview, rendering the **live** module output for a sample spec.
- `docs/design-system.md` — new "Capability field chrome (Module 3 · epic 3.2)"
  section (type → control/display table, close-on-success contract).

Verified: `bun run typecheck` clean · `bun run lint` clean · `bun test` 255 pass /
0 fail · route returns HTTP 200 with the live create form + detail on the running
server.

## Blocked by

None - can start immediately
