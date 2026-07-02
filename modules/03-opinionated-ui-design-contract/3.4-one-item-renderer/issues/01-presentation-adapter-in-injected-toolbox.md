# Capability-scoped presentation adapter in the injected toolbox

Status: ready-for-agent

## Epic

Module 3 — Opinionated Capability UI · Epic 3.4 — One item renderer, shared by
every action (`docs/modules.md` §3.4, ADR-0005 §2 & §3, amends ADR-0004,
PLAN decisions 2 & 3: `modules/03-opinionated-ui-design-contract/PLAN.md`)

## What to build

The capability-scoped **presentation adapter** the router adds to each **Handler**'s
injected toolbox: it turns one record into safe, wrapped item HTML by composing
the **item renderer**'s inner markup with the runtime enforcer (3.1/02) and the
accessible item wrapper (3.2/02) — accessible trigger, escaped `data-item`
payload, click-to-open. Handlers **call** it; they never import the renderer or
carry their own row markup (ADR-0004 unchanged — Handlers still import nothing).

- Adapter shape: record → safe wrapped item HTML, capability-scoped, supplied
  through the injected toolbox to `create.ts`/`read.ts` (and later `search.ts`).
- Applies the enforcer on every rendered record (ADR-0005 §3) and wraps via the
  platform item wrapper.
- Deterministic; covered by platform tests (invariants the model cannot get wrong,
  ADR-0005 §4). Verifiable now with a hand-written item renderer as the composition
  input, before generation lands (3.4/02).

## Acceptance criteria

- [ ] The router injects a capability-scoped presentation adapter into the Handler
      toolbox; Handlers call it and import nothing
- [ ] The adapter composes item-renderer markup → enforcer (3.1/02) → accessible
      wrapper (3.2/02) with escaped `data-item` payload and click-to-open
- [ ] The enforcer runs on every rendered record; a hostile field value cannot
      escape it through the adapter
- [ ] Platform tests pin the adapter's wrapping/payload/enforcement invariants,
      driven by a hand-written renderer
- [ ] AFK — a deterministic seam covered by tests; its visual result is exercised
      once generation lands (3.4/02)

## Blocked by

- modules/03-opinionated-ui-design-contract/3.1-closed-value-contract-and-primitives/issues/02-runtime-allow-list-enforcer.md
- modules/03-opinionated-ui-design-contract/3.2-platform-presentation-modules/issues/02-list-scaffolding-container-and-item-wrapper.md
