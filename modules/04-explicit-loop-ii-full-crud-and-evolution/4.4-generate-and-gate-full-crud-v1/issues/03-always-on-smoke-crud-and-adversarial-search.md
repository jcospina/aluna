# Always-on smoke: full CRUD cycle and the adversarial search fixture

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.4 — Generate and
Gate full-CRUD v1 capabilities
(PLAN decision 20 + epic text:
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`; ADR-0004 smoke)

## What to build

The always-on Gate smoke for five-Action capabilities: a full CRUD cycle plus
the complete deterministic-search-baseline fixture, run against every candidate
snapshot regardless of which units regenerated.

The search baseline (decision 20) is complete and always-on:

- Terms are Unicode-whitespace-delimited literal substrings; every normalized
  term must match somewhere (AND semantics), including across different
  fields/list elements.
- Case- and Latin-accent-insensitive normalization through the one platform-owned
  SQL function (NFKD, locale-independent lowercase, Latin-base combining-
  diacritic folding, then NFKC);
  generated SQL cannot
  substitute SQLite's ASCII-only `NOCASE`/`lower()`.
- Matching includes every active `string` and each active `string[]` element;
  excludes inactive fields, `extra`, platform columns, and non-text types.
- SQL wildcard/quote characters are literal and parameterized. Missing, empty,
  or whitespace-only `q` returns exactly the canonical `read` rows in default
  read order. No duplicates; default order `created_at DESC, id DESC` for a
  behavior-neutral spec; capability behavior may deterministically rerank the
  same baseline match set.

## Acceptance criteria

- [x] The adversarial fixture proves: scalar and list inclusion; all exclusions
      (inactive, `extra`, platform columns, non-text); AND semantics across
      fields; literal `%`, `_`, and quotes; Latin-accented vs unaccented and composed
      vs decomposed non-ASCII text; preservation of non-Latin voicing/vowel/tone
      marks; case; repeated Unicode whitespace; complete target rows
      (rehydration); empty/whitespace-`q` ≡ read; no duplicates; stable default
      ranking-neutral tie fallback — not merely “a field other than title
      participates”
- [x] Smoke executes a full CRUD cycle (create → read → update-merge → search →
      delete) against scratch adapters on every candidate snapshot
- [x] A generated `search` using `NOCASE`/`lower()` instead of the platform
      function fails the fixture
- [x] Smoke failures repair per-unit within the bounded loop; the fixture
      itself is platform-owned and never weakened
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Module-acceptance data on a generated capability: create records containing
literal `%`, `_`, quotes, mixed case, Latin-accented/unaccented and composed/
decomposed text, non-Latin marks, and repeated
whitespace, then search them from the homepage chrome and watch the baseline
semantics hold live.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.4-generate-and-gate-full-crud-v1/issues/01-generate-five-handlers-and-item-renderer.md

## Implementation notes

- The always-on smoke now executes the complete five-Action lifecycle against a
  fresh scratch catalog: create, canonical read, target-bound merge update,
  adversarial search, then delete. The real capability database is snapshotted
  around the run and must remain unchanged.
- Create and update must return the complete sequence of fragments produced by
  `present`; calling the adapter and discarding or replacing its bytes fails.
  Update runs one isolated patch per active field and proves both persistence
  and preservation of every omitted field, including unchecked-to-checked
  boolean transitions.
- The platform-owned search fixture adapts to the candidate schema while keeping
  its verdicts fixed. It exercises every active string field and both early and
  later elements of every active string-list field, all non-text/inactive/platform
  exclusions, cross-field AND matching, literal metacharacters and quotes, Latin
  normalization, non-Latin marks, broad Unicode whitespace, duplicate suppression,
  full rehydration, empty-query equivalence, and a deterministic id fallback
  across equal active values and equal creation timestamps. This smoke proof is
  deliberately ranking-neutral; authored primary ordering belongs to the
  behavioral rung.
- Search results must return every fragment produced by `present` in order; merely
  querying or calling `present` and then discarding the visible HTML now fails.
  Canonical-read failures inside the multi-row baseline are attributed to `read`,
  so the bounded repair loop regenerates the responsible Action.
- Smoke repair uses the existing unit-fix budget. It regenerates only the
  attributed Handler, statically validates it, and reruns the unchanged fixture
  from fresh scratch. A structurally invalid regeneration consumes one attempt
  and feeds the next bounded turn instead of aborting early.
- Gate-repaired Handler bytes, attempts, duration, and usage are folded back into
  the final unit preview, generation metrics, and committed artifacts. The
  existing five-Action reference search was updated to the same multi-term,
  all-active-target-field contract so its living-demo installer continues to pass
  the strengthened Gate.

## Verification

- `bun test` — 577 passing, 0 failing, 2 snapshots, 2,678 expectations
- `bun run typecheck` — clean
- `bun run lint` — 201 files checked, no fixes
- `bun run build` — clean
- `git diff --check` — clean
- Focused Gate, repair, reference-demo, and build-preview/metrics suite — 25
  passing, 0 failing, 361 expectations
- Independent verification passed the focused smoke/app suite, 65 related
  structural/behavioral/unit regressions, typecheck, targeted formatting, and
  whitespace checks.
- Independent quality and adversarial audits mutation-tested omitted active list
  fields/elements, per-field `lower()`, active dates, narrow whitespace splitting,
  discarded search HTML, wrong read attribution, and invalid first repairs. Each
  reproduced blind spot now has implementation coverage and a regression test.
- Browser verification reused the existing `http://localhost:3030` server and
  generated **Notes** capability without reset. Three module-acceptance records
  were intentionally left in place: one rich adversarial record plus
  `crossalpha only` and `crossbeta` controls. Repeated Unicode-whitespace AND
  search returned only the rich record; literal `%`, `_`, apostrophe and double
  quote terms did the same; `cafe angstrom` matched composed/decomposed accented
  values; `ば कि ก่า` preserved non-Latin marks; Clear restored all three in
  newest-first order. The browser console reported no errors.

## HITL test instructions

1. Keep the existing app on port 3030 running; if it is not running, start it
   with `bun run dev`. Do not reset or start a fallback port.
2. Run
   `bun test src/builder/gate.smoke.test.ts src/builder/gate.smoke-search.test.ts`.
   Confirm all smoke, frozen-fixture, attribution, visible-fragment, and bounded-
   repair tests pass.
3. Open `http://localhost:3030/capability/reading_log`. Search **Juramentada**
   and confirm the stored book remains visible with “I updated the results.”
4. Search **coffee** and confirm the centered no-match message appears. Choose
   **Clear** and confirm **Juramentada** returns with no search-error message.
