# Registry store & capability spec shape

Status: done

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
     `required`. Nothing else validates — no list types (M4), no `file`/`file[]`
     (M6), no relations (never — no foreign keys).
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

- [x] An additive platform migration creates the registry table via the existing
      migrations runner; a second boot is a clean no-op
- [x] The spec shape is Zod-validated: exactly the four field types, each with
      `required`; specs containing list/file/relation shapes fail validation loudly
- [x] A valid spec written through the access module reads back deep-equal, with
      `version` and `artifacts_path` intact
- [x] Access module exposes create / get-by-id / list-all; the row stays lean per
      ARCH §6.3
- [x] Tests cover both the validation rejections and the round-trip

## Blocked by

None - can start immediately

## Comments

**2026-06-12 — implemented.** The registry lives in
[`src/registry/`](../../../../src/registry/), mirroring the provider subsystem's
layout: the shape in [`spec.ts`](../../../../src/registry/spec.ts), the access
module in [`store.ts`](../../../../src/registry/store.ts), the public surface in
[`index.ts`](../../../../src/registry/index.ts).

- **Migration `0002_capability_registry`** appended to the existing runner
  ([`src/migrations.ts`](../../../../src/migrations.ts)): a STRICT table with
  exactly the nine lean columns (`id, label, version, schema, ui_intent,
  behavior, tools, artifacts_path, prompt_context`); `schema`/`ui_intent`/`tools`
  are JSON text, (de)serialized only by the store. Idempotency rides the
  runner's existing ledger mechanics — the runner tests' re-run case now covers
  0002, and the boot test proves boot-time application. The Module 1 "ledger
  only" assertion in `migrations.test.ts` was updated: the invariant is now
  *platform stores only, never `cap_<id>` data tables*.
- **The spec shape** ([`spec.ts`](../../../../src/registry/spec.ts)) is two Zod
  strict objects sharing one shape: `capabilitySpecSchema` (what the AI authors:
  `id`, `label`, `schema`, `ui_intent`, `behavior`, `tools`, `prompt_context`)
  and `capabilityRowSchema` (the spec plus platform-assigned `version` +
  `artifacts_path`). The M2 pantry is enforced exactly per PLAN decision 8:
  the four-type field enum each with `required`; views `list|create`; tools
  `create|read`; `behavior` free text. List/file/relation shapes fail loudly —
  the enum rejects the types, strictness rejects smuggled keys (`references`,
  and `auto`, the recorded ARCH §6.3 deviation). The platform trio is exported
  as `PLATFORM_COLUMNS` for the 2.2 mapper and is rejected as spec field names;
  ids and field names are confined to safe SQL identifiers since they become
  `cap_<id>` and column names.
- **The store** validates in *both* directions — `insertCapability` parses
  before writing (an invalid row throws and writes nothing), and reads re-parse
  on the way out, so a non-conforming row can neither enter nor leave the
  registry unnoticed. Writes ride `db`; `getCapability`/`listCapabilities`
  default to `dbReadonly` per the read-path convention. `listCapabilities`
  orders by `id` so toolbar rehydration and resolver context see one stable
  order. Duplicate ids throw the PK violation — duplicates are the resolver's
  to deflect (PLAN decision 6), not the store's to suffix.

**Tests** ([`spec.test.ts`](../../../../src/registry/spec.test.ts),
[`store.test.ts`](../../../../src/registry/store.test.ts)): 20 cases covering
the four accepted types (each with `required` both ways), the loud rejections
(list/file/relation, `auto`, platform-trio names, duplicate/blank/unknown
shapes), the deep-equal round-trip with `version` and `artifacts_path` intact
read back through the read-only connection, list-all ordering, and the
nine-column lean-row pin. Full suite: `bun test` 56 pass, `bun run typecheck`
and `biome check` green.
