# Capability router & the hand-written tracer

Status: done

## Epic

Module 2 — Explicit Loop I: Build Your First Capability · Epic 2.3 — Deterministic
router (`docs/modules.md` §2.3, ARCH §6.2 router, ADR-0004 consequences, PLAN
build order: `modules/02-explicit-loop-i-build-your-first-capability/PLAN.md`)

## What to build

The deterministic router at `/capability/:id/:action` — the fixed convention the
generated UI targets. **Routing is never an AI concern** (ARCH §6.2).

For each request the router:

1. Looks up the registry row and **validates the action against the row's
   declared `tools`** — unknown capability or undeclared action fails cleanly
   (and in product voice if it ever reaches the user; no internals leak).
2. Loads the handler for that action from the version directory the registry
   row's `artifacts_path` points to.
3. Builds the platform context per ADR-0004: parsed input (form/query —
   generated code never touches raw HTTP) plus the data tool **already scoped**
   to this capability.
4. Invokes the handler's single default-exported async function and wraps the
   returned HTML fragment in the HTTP response — the platform owns headers,
   status, and routing.

**The tracer bullet (this issue's proof):** a *hand-written* fixture capability —
spec, registry row, and handler files written by hand to the ADR-0004 contract —
round-trips `create` + `read` end to end **before any AI exists** (PLAN build
order). This pins the whole runtime contract: registry → router → injected
toolbox → data table → HTML fragment back.

## Acceptance criteria

- [x] Actions are validated against the registry row's `tools` before any code
      is loaded; mismatches and unknown capabilities fail cleanly
- [x] The handler receives only the platform-built context (parsed input +
      scoped data tool) and returns a fragment; the platform wraps the response
- [x] Hand-written fixture capability: POST to `create` persists through the
      data tool; GET to `read` returns an HTML fragment containing the record
- [x] The fixture handler needs no imports, no raw HTTP, and no table names —
      the contract is honored end to end
- [x] A handler that throws surfaces a friendly failure response, never a stack
      trace or internals

## Blocked by

- modules/02-explicit-loop-i-build-your-first-capability/2.1-capability-registry/issues/01-registry-store-and-capability-spec-shape.md
- modules/02-explicit-loop-i-build-your-first-capability/2.2-constrained-data-tool-and-additive-ddl/issues/02-capability-scoped-data-tool.md

## Comments

**Implemented.** The deterministic router landed in `src/router/`:

- `contract.ts` — the ADR-0004 handler contract (`CapabilityContext` = parsed
  `input` + scoped `data` tool; `CapabilityHandler` = one default-exported async
  function returning an HTML fragment). This is the shape 2.5's gate will assert.
- `router.ts` — `registerCapabilityRoutes` on `/capability/:id/:action`. It looks
  up the registry row and validates `:action` against the row's `tools` **before**
  loading any code (an injected spy loader proves nothing loads on a miss), loads
  the version-keyed handler from `artifacts_path`, builds the scoped context, and
  wraps the returned fragment via `c.html` — the platform owns status/headers.
  Unknown capability / undeclared action → friendly 404; a throwing handler →
  friendly 500 with the precise cause logged server-side, never leaked.
- Wired into the one route file (`src/app.ts`, `createApp`); db pair + handler
  loader are injectable for tests, defaulting to the platform singletons + the real
  file loader.

The tracer bullet is a hand-written fixture capability under
`src/router/__fixtures__/notes/v1/` (`create.ts`, `read.ts`) — no imports, no raw
HTTP, no table names — excluded from the platform `tsc` (mirroring how generated
artifacts are checked only by the gate, in isolation).

Verified: `bun test` (75 pass, incl. the create→persist→read round-trip,
validation-before-load, the throwing-handler friendly path, and a meta-test
enforcing the no-imports/no-HTTP/no-table-names contract on the fixture sources);
`tsc` and `biome check` clean; and a live boot confirms the default production app
returns the product-voice 404 for an unknown capability.
