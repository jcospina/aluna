# Registry store & capability spec shape

Status: ready-for-agent

## Epic

Module 2 — Explicit Loop I: Build Your First Capability · Epic 2.1 — Capability
Registry (`docs/modules.md` §2.1, ARCH §6.3 "Capability Registry", PLAN decision 8:
`modules/02-explicit-loop-i-build-your-first-capability/PLAN.md`)

## What to build

The capability registry — the source of truth for everything Aluna has become —
and the validated spec shape every other Module 2 piece consumes.

Two deliverables:

1. **The registry store.** An additive platform migration (through the existing
   migrations runner) creating the registry table: one row per capability —
   `id, label, version, schema, ui_intent, behavior, tools, artifacts_path,
   prompt_context`. The row stays lean (spec + version + pointer): the intent
   resolver scans every row on every classification, so nothing bulky lives here.
   Plus a read/write access module: insert a capability row, get one by id, list
   all (toolbar rehydration and resolver context both need the list). Writes ride
   the read-write connection; reads follow the read path convention.

2. **The capability spec shape**, Zod-validated — the structured object the AI
   authors and the platform derives everything from (ARCH §2 "The generated
   artifacts"). Per PLAN decision 8, the M2 pantry is deliberately tiny:
   - Field type enum: `string | number | boolean | datetime`, each with
     `required`. Nothing else validates — no list types (M3), no `file`/`file[]`
     (M5), no relations (never — no foreign keys).
   - `ui_intent` covers M2's two views (`list`, `create`); `behavior` is free
     text (the behavioral tier generates tests from it); `tools` in M2 is
     `create` + `read`.
   - The platform trio (`id`, `created_at`, `extra`) is **platform-owned, not
     spec fields** — the deviation from ARCH §6.3's example (`created_at` with
     `auto`) is deliberate and recorded in the PLAN; there is no `auto` concept
     in M2.

The spec is the only artifact that cannot be reconstructed from something else
(ARCH §2); handlers, views, and tests are version-keyed caches derived from it.

## Acceptance criteria

- [ ] An additive platform migration creates the registry table via the existing
      migrations runner; a second boot is a clean no-op
- [ ] The spec shape is Zod-validated: exactly the four field types, each with
      `required`; specs containing list/file/relation shapes fail validation loudly
- [ ] A valid spec written through the access module reads back deep-equal, with
      `version` and `artifacts_path` intact
- [ ] Access module exposes create / get-by-id / list-all; the row stays lean per
      ARCH §6.3
- [ ] Tests cover both the validation rejections and the round-trip

## Blocked by

None - can start immediately
