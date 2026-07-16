# Always-on smoke: full CRUD cycle and the adversarial search fixture

Status: ready-for-agent

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

- [ ] The adversarial fixture proves: scalar and list inclusion; all exclusions
      (inactive, `extra`, platform columns, non-text); AND semantics across
      fields; literal `%`, `_`, and quotes; Latin-accented vs unaccented and composed
      vs decomposed non-ASCII text; preservation of non-Latin voicing/vowel/tone
      marks; case; repeated Unicode whitespace; complete target rows
      (rehydration); empty/whitespace-`q` ≡ read; no duplicates; stable default
      ordering — not merely “a field other than title participates”
- [ ] Smoke executes a full CRUD cycle (create → read → update-merge → search →
      delete) against scratch adapters on every candidate snapshot
- [ ] A generated `search` using `NOCASE`/`lower()` instead of the platform
      function fails the fixture
- [ ] Smoke failures repair per-unit within the bounded loop; the fixture
      itself is platform-owned and never weakened
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Module-acceptance data on a generated capability: create records containing
literal `%`, `_`, quotes, mixed case, Latin-accented/unaccented and composed/
decomposed text, non-Latin marks, and repeated
whitespace, then search them from the homepage chrome and watch the baseline
semantics hold live.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.4-generate-and-gate-full-crud-v1/issues/01-generate-five-handlers-and-item-renderer.md
