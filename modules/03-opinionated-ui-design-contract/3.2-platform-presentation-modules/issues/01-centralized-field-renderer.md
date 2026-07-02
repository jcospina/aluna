# Centralized create/detail field renderer

Status: ready-for-agent

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
Centralized and **exhaustive over the M2 field-type pantry**
(`string | number | boolean | datetime`, each `required`) so Module 4's list
types and Module 6's file types extend exactly one place (ADR-0005 §1).
Presentation only — no capability rule, no canonical state.

- Dispatch on field type to the right control (create) and the right display
  (detail); exhaustive over the pantry with a total switch so an unhandled type
  cannot ship silently.
- HTMX wiring + close-on-success for the create form is platform-owned
  (ADR-0005 §1), not generated.
- No user data cached in the module — live values arrive at render time, so the
  **View** stays data-free (ADR-0004 as amended by ADR-0005).

## Acceptance criteria

- [ ] Field rendering is centralized in one platform module and is exhaustive over
      the M2 pantry (string/number/boolean/datetime, each required); adding a type
      is a single-location change
- [ ] The same module renders both create controls and read-only detail display
      from the spec
- [ ] Create-form HTMX wiring + close-on-success is platform-owned
- [ ] Unit tests cover every pantry type in both create and detail modes from a
      spec fixture
- [ ] Demo: a dev preview renders create + detail fields for a sample spec; human
      visually confirms the fields are on-brand and complete before done

## Blocked by

None - can start immediately
