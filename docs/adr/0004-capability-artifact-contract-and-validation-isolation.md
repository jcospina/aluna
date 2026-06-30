# 0004 — Capability artifact contract & validation isolation (seeds Module 2)

Status: accepted

> Module 2 contract. [ADR-0005](0005-opinionated-capability-ui-design-contract-and-gate.md)
> amends the View and injected-toolbox parts in Module 3: structural View chrome
> becomes platform-rendered, and one generated item renderer is supplied to
> handlers through a capability-scoped presentation adapter. Scratch-database
> isolation remains unchanged.

## Decision

Settled in the Module 2 grilling session (2026-06-12). Three interlocking choices
define what a generated capability artifact *is* and how the gate may touch it.
Implementation lands with epics 2.2/2.3/2.5; exact type names and context fields
remain implementation detail.

1. **Views are data-free scaffolding.** A capability's compiled `.html` views
   contain **zero user data** — only chrome, forms, and HTMX hooks that load
   dynamic regions through the capability's own `read` action. This is what makes
   "cached, version-keyed HTML" (ARCH §6.3, §9.1) honest: the cache can never go
   stale, because data never enters it. Toolbar clicks can serve the cached view
   as-is.

2. **Handlers follow the injected-toolbox contract and return HTML.** Every
   generated handler file exports **one async function** that receives a single
   platform-built context — the parsed input (form/query; generated code never
   touches raw HTTP) and a **data tool already scoped to that capability** (its
   `insert`/`select` physically cannot address another capability's table —
   scoping by construction, not convention). The function returns an **HTML
   fragment string**; the platform owns the HTTP response, headers, status, and
   routing. HTML-over-the-wire all the way down: every action's output is a
   fragment the shell can swap (Q1 ↔ HTMX idiom, ARCH §4). Per ARCH §7,
   incidental I/O inside a handler stays the handler's business — only canonical
   state must go through the injected tool.

3. **Gate execution is isolated by construction.** The smoke rung (and the
   behavioral rung when that tier is on) executes handlers against a **scratch
   in-memory SQLite database**, created on the spot by applying the build's own
   generated DDL, and discarded after the run. The handler can't tell the
   difference (same SQLite, same schema, same SQL); the user's real data is
   **physically unreachable** during validation. This is decisive for Module 4:
   rebuild-time smoke runs happen when the real table holds real user data.

## Context / why

The handler skeleton is the most-rewritten code in the system — the AI authors it
fresh on every build — and four parties pull on the one contract:

- **The AI writes it**: every convention (import paths, HTTP parsing, table
  names) is a fresh way for a build to fail. The contract must be nearly
  unflubbable.
- **The gate asserts it** (epic 2.5 "assert action signatures"): only a concrete
  skeleton — one default-exported function — is cheaply assertable.
- **The smoke test runs it**: injection lets the platform hand the same function
  a *practice* toolbox pointed at the scratch db.
- **Safety must hold under model confusion**: a Notes handler must be unable to
  write to Recipes even when the generated code is wrong.

This extends the project's winning pattern — safety **by construction, not by
trust or cleanup** — from the read path (read-only connection, ARCH §7) to
handler scope and to validation.

**Rejected, with reasons:**

- **JSON handlers + platform templating** — requires a platform-owned rendering
  engine; edges into the forbidden platform business logic (ARCH §1).
- **Handler-interpolated views** (handler imports its `.html` as a private
  template) — makes "cached HTML" unservable as-is and un-cacheable honestly.
- **Direct platform imports in generated code** ("key to the house") — couples
  every generated file to repo layout, makes scoping trust-based (table name as
  a string), and defeats practice-toolbox substitution during the gate.
- **Handlers returning raw `Response`** — power nothing in M2 needs; every
  header/status decision is new surface for subtle generation bugs.
- **Smoke against the real table with cleanup** — ghost records on crashed
  gates; come M4, synthetic writes interleave with real user data mid-build.
- **Mocked toolbox (no db)** — proves the handler *calls* things, not that the
  SQL and schema actually round-trip; defeats the smoke rung's purpose.

## Consequences

- The router (epic 2.3) parses requests, builds the scoped context, and wraps
  returned fragments in HTTP responses — generated code never does.
- The builder (epic 2.5) generates handlers to this skeleton; the gate asserts
  the export shape and injects the practice toolbox.
- The build pipeline must be able to apply its generated DDL to an arbitrary
  connection (real db and scratch db alike) — good hygiene it would want anyway.
- If a future capability genuinely needs response-level control (redirects,
  downloads), the contract is extended **deliberately** — amend or supersede
  this ADR rather than letting generated code grow ad-hoc power.
