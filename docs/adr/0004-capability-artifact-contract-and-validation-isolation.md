# 0004 — Capability artifact contract & validation isolation (seeds Module 2)

Status: accepted

> Module 2 contract. [ADR-0005](0005-opinionated-capability-ui-design-contract-and-gate.md)
> amends the View and injected-toolbox parts in Module 3: structural View chrome
> becomes platform-rendered, and one generated item renderer is supplied to
> handlers through a capability-scoped presentation adapter. The scratch-adapter
> contract remains; its non-sandbox containment scope is clarified below.

**Amended 2026-07-10 for Module 4.** The original M2 `insert` + scoped `select`
tool was a deliberately small first slice, not the end-state read contract. M4
splits it into a capability-bound mutation interface and a free SQL query
interface backed by a physically read-only connection. It also preserves repeated
request values and adds record-targeted update/delete. The mutation guarantee
remains scoping by construction; read freedom is reconciled with permanent
capability deletion through the declared dependency contract in ADR-0006.

**Amended 2026-07-11 for the deferred sandbox.** Generated execution remains
in-process and is not a security containment seam. Supplied adapters, the scratch
database, structural checks, and static rejection of direct imports/known bypasses
protect against accidental generated output that conforms to or is caught by the
contract. They do not contain deliberately adversarial code or unknown ambient
Bun/OS access. A true untrusted-code threat model requires the process sandbox
still deferred by ADR-0003.

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

2. **Handlers follow one parsed-input and injected-toolbox contract and return
   HTML.** Every generated Handler file exports one async function receiving a
   platform-built context; generated code never touches raw HTTP, routing, a
   read-write database, or a filesystem path. Parsed values preserve
   multiplicity (`string | readonly string[]`) and carry a validated submitted-
   field set. Spec names cannot use the reserved `__aluna_` prefix; platform forms
   emit repeated `__aluna_present` markers and update/delete emit exactly one
   nonblank `__aluna_record_id`. The router validates and strips that namespace,
   rejecting missing/duplicate/unexpected targets before generated code. Record
   identity is passed separately, never as a writable field; update therefore
   distinguishes preserve from explicit null/false/empty-list.

   The toolbox has separate interfaces:

   - **Mutations are capability/target-bound.** Create authority is bound to the
     capability; update/delete authority is additionally bound to the one
     router-validated record target before generated code runs. The adapters expose
     no table/capability/record selector. The interface owns
     active-field allow-listing, platform-column protection, normalization,
     logical requiredness, lifecycle rules, update merge, and resulting-record
     validation. Cross-capability mutation and record-target substitution are
     unrepresentable through the supplied interface.
   - **Reads are free SQL.** Every Action may use arbitrary parameterized
     `SELECT`/joins through a connection opened physically read-only; `read` and
     `search` necessarily do. Persistent external reads are limited by that
     Action's committed dependency catalog (ADR-0006). Record-producing queries
     return ordered target ids, and the platform rehydrates full canonical target
     rows on the same read snapshot, so copied code cannot omit future columns.
     Canonical rows stay platform-internal; generated code receives only
     Action-safe active projections/opaque handles.
     Every query also declares a closed ordered result alias/type descriptor; the
     adapter projects only it and fails missing/duplicate/type-invalid declared
     values, preventing additive columns from leaking through `SELECT *`.
     Mutation SQL through this interface fails at the SQLite seam.

   The function returns an HTML fragment string; the platform owns the response,
   headers, status, and route. Generated Handlers retain capability behavior and
   may perform incidental I/O, but canonical state always goes through mutations.

3. **Gate data access is isolated through supplied adapters, not process
   containment.** The smoke rung (and the
   behavioral rung when that tier is on) executes Handlers against scratch
   SQLite. The target uses the candidate DDL; declared read dependencies use
   complete physical compatibility-schema copies, all seeded only with synthetic
   data, while model generation receives only active-field projections. Scratch exposes
   separate read-write mutation and physically read-only query adapters satisfying
   the live interfaces. Those adapters expose only synthetic scratch data, and
   known direct-import/bypass shapes fail structural/static validation. Because
   execution is still in-process, this is not a claim that deliberately
   adversarial generated code cannot reach ambient runtime authority. This
   distinction supports Module 4 rebuilds over real records without pretending
   the deferred sandbox already exists.

## Context / why

The Handler skeleton is the most-rewritten code in the system—the AI authors it
on v1 and selectively rewrites affected units during evolution—and four parties
pull on the one contract:

- **The AI writes and later selectively rewrites it**: every convention (import
  paths, HTTP parsing, table names) is a fresh way for an affected build unit to
  fail. The contract must be nearly unflubbable; M4 may copy a positively proven
  unaffected Handler byte-for-byte.
- **The gate asserts it** (epic 2.5 "assert action signatures"): only a concrete
  skeleton — one default-exported function — is cheaply assertable.
- **The smoke test runs it**: injection lets the platform hand the same function
  a *practice* toolbox pointed at the scratch db.
- **The supplied interface must fail safely under ordinary model confusion**: a
  Notes Handler using its admitted context cannot write to Recipes, and known
  bypass attempts fail structural/static checks.

This extends adapter/interface protection from the read path (read-only
connection, ARCH §7) to Handler scope and validation. It closes accidental
cross-capability mutation through the supplied interface; it is not a hostile-code
security boundary.

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

- The router parses requests without losing repeated values, extracts record
  targets for update/delete, builds the action-appropriate context, and wraps
  returned fragments in responses — generated code never does.
- The builder (epic 2.5) generates handlers to this skeleton; the gate asserts
  the export shape and injects scratch adapters.
- The build pipeline must be able to apply its generated DDL to an arbitrary
  connection (real db and scratch db alike) — good hygiene it would want anyway.
- M4 unit checks remain Action-sensitive: no Handler may carry raw mutation
  SQL/table selection, while every Action may use only its declared read-only
  query catalog.
- The M2 `CapabilityDataTool` name and scoped `select()` shape are superseded by
  the split interfaces when M4 lands; they are not a second authority to retain.
- If a future capability genuinely needs response-level control (redirects,
  downloads), the contract is extended **deliberately** — amend or supersede
  this ADR rather than letting generated code grow ad-hoc power.
