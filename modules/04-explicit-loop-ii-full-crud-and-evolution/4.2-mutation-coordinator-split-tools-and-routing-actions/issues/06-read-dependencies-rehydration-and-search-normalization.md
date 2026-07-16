# Per-Action read dependencies, id→canonical-row rehydration, and the search normalization function

Status: done

Follow-up (2026-07-16): issue 4.3/03 widened the platform search contract from
canonical-equivalence-plus-lowercase to case- and Latin-accent-insensitive matching. The
original 4.2 contract and verification evidence below are preserved as closure
history; current normative semantics live in PLAN decision 20 and ADR-0006.

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.2 — Mutation
coordinator, split tools, and complete routing Actions
(PLAN decisions 12, 13, and 20 (function):
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`; ADR-0006)

## What to build

The lifecycle-aware read side, closing epic 4.2 with its full tracer.

- **`read_dependencies` enforcement.** One key per Action, each a
  canonical-order unique array of strict `{ capability_id, incarnation_id }`
  pairs; each pair must resolve to one active registry row; self-dependency is
  implicit and rejected if listed. The query adapter permits arbitrary SQL over
  that committed catalog and rejects access outside it. The Gate observes the
  same catalog against scratch tables. Build the reverse-dependency index
  (deletion refusal consumes it in 4.9). Additive execution ABI: a committed
  Handler may keep reading an externally soft-hidden field (columns are never
  dropped by soft-hide), while **new** generation contexts see only the
  dependency's active projection; live and scratch adapters retain full
  physical columns for copied code.
- **Rehydration.** Generated `read`/`search` SQL may join other tables but
  returns ordered unique **target record ids**. On the same read-only
  snapshot, the query adapter re-fetches each id with a platform-owned full
  target-row projection and restores Handler order; missing, duplicate, or
  foreign ids fail. Handlers receive only the Action-safe active-field
  projection, declared query-result values, and an opaque record handle;
  canonical-row inactive fields and `extra` never cross the interface or enter
  the DOM. The presentation adapter narrows again to `item.shows` plus the
  actives needed for detail/edit and `created_at`.
- **Normalization function.** The one platform-owned SQL function used by all
  search matching: JavaScript `normalize("NFKC").toLocaleLowerCase("und")`
  over both query terms and stored values, registered on the connection.
  The reference capability's hand-written `search` uses it (the full
  adversarial baseline fixture lands in 4.4).

## Acceptance criteria

- [x] A declared cross-capability read succeeds; an undeclared one is rejected;
      a listed self-dependency is rejected; pairs must resolve to active rows
- [x] Dependency compatibility (plan acceptance): an old declared reader still
      executes after an external field is soft-hidden, while new model contexts
      omit that field
- [x] Rehydration: order restored; missing/duplicate/foreign ids fail; an old
      explicit projection cannot omit a newly added column; inactive/`extra`
      never reach Handler input or the DOM (pinned by tests)
- [x] The normalization function matches composed vs decomposed non-ASCII text
      and non-ASCII case where SQLite `NOCASE`/`lower()` would not
- [x] Epic tracer on the reference capability: create → read → partial update →
      search → delete; a read-port write fails physically; the paused-build
      race from 4.2/01 passes against the full route set
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

A second dev capability declares a read dependency on the reference capability
and renders joined data on its View; the reference capability's search route
returns normalized matches via curl.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.2-mutation-coordinator-split-tools-and-routing-actions/issues/01-atomic-mutation-coordinator.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.2-mutation-coordinator-split-tools-and-routing-actions/issues/05-record-targeted-merge-update-and-delete.md

## Implementation notes

- The registry validates strict, canonical, unique per-Action dependency pairs,
  rejects self-dependencies, resolves exact active incarnations at commit and
  routing time, and exposes the reverse lookup reserved for deletion refusal.
- The scoped read port admits only the target plus that Action's resolved
  dependency tables. Gate scratch execution builds the same catalog, while
  generation context exposes only active dependency fields; committed copied SQL
  can still read physically retained soft-hidden columns.
- `query.records` accepts ordered unique target ids plus declared result aliases,
  then selects the complete canonical target rows in the same explicit read-only
  snapshot. Handler input contains only active fields, `created_at`, declared
  values, and an opaque handle; presentation uses the handle inside platform code
  and narrows again before HTML.
- Bun 1.3 does not expose SQLite scalar-function registration. The platform owns
  a small loadable SQLite bridge that is compiled into the OS temp directory,
  registered per query connection, and calls the single JavaScript
  `normalize("NFKC").toLocaleLowerCase("und")` implementation. macOS selects an
  extension-capable Homebrew SQLite before opening the first connection; the
  setup and `OMNI_CRUD_SQLITE_LIBRARY` override are documented in `data/README.md`.
- The five-Action Journal reference uses the SQL function over both stored values
  and terms. A committed **Journal links** capability declares the exact Journal
  incarnation, joins it in read/search, passes both Gate rungs against copied
  scratch tables, and appears beside Journal entry in the homepage toolbar.
- The Epic 4.2 quality pass hardened the generated-code boundary: query ports are
  always Action-scoped, plain query projections cannot enter presentation,
  mutation and record-query results carry opaque platform-owned record handles,
  protected target/schema columns fail closed, and field names such as `fields`
  and `handle` remain ordinary user data. The demo installer now admits work only
  through the running server coordinator, and the data/demo module cycles were
  removed.

## Verification

- `bun test` — 472 passing, 0 failing, 2 snapshots, 2125 expectations
- `bun run typecheck`
- `bun run lint`
- `git diff --check`
- Focused query-port and living-demo run — 25 passing, 0 failing
- Live `localhost:3030` probes after `bun run demo:five-action-reference`:
  declared joined read rendered its Journal value, and decomposed lowercase
  search matched the composed uppercase **CAFÉ ÅNGSTRÖM** seed.

## HITL test instructions

1. Ensure an extension-capable SQLite is available (`brew install sqlite` on
   macOS). Reuse the app server on port 3030, or run `bun run dev` if it is not
   already running, then run `bun run demo:five-action-reference`.
2. Open `http://localhost:3030`, choose **Journal links**, and confirm the View
   shows **A quiet beginning** above **Seen through a declared dependency**.
3. Run:

   ```sh
   curl -s 'http://localhost:3030/capability/field_lifecycle_demo/search?q=Cafe%CC%81%20a%CC%8Angstro%CC%88m'
   ```

   Confirm the response includes **Ready to remove — CAFÉ ÅNGSTRÖM** even though
   the query uses decomposed lowercase Unicode.
4. Run `bun test`, `bun run typecheck`, and `bun run lint`; all must finish cleanly.
