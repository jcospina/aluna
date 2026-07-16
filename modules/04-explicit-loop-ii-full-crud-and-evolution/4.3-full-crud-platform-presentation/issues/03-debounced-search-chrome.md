# Debounced platform search chrome

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.3 — Full CRUD
platform presentation
(PLAN decisions 19 and 20 (query boundary):
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`; ADR-0005)

## What to build

Platform-owned search chrome above every capability View's collection;
matching/ranking stays generated (the reference capability's hand-written
`search` for now).

- A debounced search field calls committed `GET /capability/:id/search?q=...`,
  replaces the records region, and renders results through the one item
  renderer.
- Platform chrome owns the loading, clear, and no-matches states. Clear
  restores read by calling `read` directly; a missing, empty, or
  whitespace-only `q` is the canonical-read boundary (decision 20).
- Search is local and ephemeral: no resolver call, registry row, version,
  cache, or build. Reads/search never touch the mutation coordinator.

## Acceptance criteria

- [x] Every complete five-Action capability View shows the search field above the collection;
      typing debounces and replaces the records region with `search?q` results
      rendered through the shared item renderer. The approved 4.2–4.3
      two-Action transition omits unavailable search until 4.4 makes five Actions
      universal.
- [x] Loading, a single centered no-match state, and clear states are
      platform-rendered; Clear (and whitespace-only input) restores the exact
      `read` collection
- [x] Search is case- and Latin-accent-insensitive through the one platform normalizer;
      `cafe`, `CAFE`, `CaFe`, `Café`, `Cáfé`, and decomposed equivalents share a
      match set
- [x] No resolver/build/registry write happens on any search interaction
      (pinned by test or instrumentation assertion)
- [x] Results open the same detail modal as read results
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean
- [x] **Human sign-off**: search interaction validated on the running app
      against the reference capability (case/Latin-accent variants plus scalar and
      `string[]` matches)

## Living demo

Type into the search field on the reference capability's View: results narrow
live across scalar and list text fields independent of case/Latin accents, the one
no-match message is centered across the collection, and Clear restores the full
collection.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.2-mutation-coordinator-split-tools-and-routing-actions/issues/06-read-dependencies-rehydration-and-search-normalization.md

## Implementation notes

- The platform collection renderer now emits one accessible search form for every
  committed row that declares `search`, above the shared records region. The
  temporary create/read shape remains honest by omitting unavailable chrome; the
  4.4 cutover makes the five-Action shape universal.
- A focused browser controller owns the 300 ms debounce, immediate Enter/Clear,
  Unicode-whitespace read restoration, loading/no-match/error announcements,
  request cancellation, and generation-based stale-response suppression. The
  first interaction also uses HTMX's public abort trigger and removes the View's
  one-shot read attributes, so a late initial read cannot overwrite newer
  results. No-match copy has one visible/live source, and a failed search cannot
  reveal the canonical empty-collection prompt. The controller only calls the
  committed `read` and `search` URLs embedded by platform chrome.
- The one live feedback row is a collection-level sibling below the shared
  search/New header, so no-match copy centers across the whole content area. The
  controller mirrors search state onto the collection; empty-prompt suppression
  no longer depends on incidental sibling placement inside the header.
- The canonical normalizer uses compatibility decomposition, locale-independent
  lowercase, Latin-base combining-diacritic folding, and final recomposition.
  `cafe`, `CAFE`, `CaFe`, `Café`, and `Cáfé` share one match set while non-Latin
  voicing, vowel, and tone marks remain meaningful.
- Search responses replace the complete records region and are reprocessed by
  HTMX. Because the generated Handler still calls the injected `present`, results
  use the one item renderer and retain the same accessible detail-modal hooks as
  canonical read results.
- The reference Handler now treats nullable text as a non-match instead of letting
  SQL three-valued logic admit unrelated rows, so the platform no-match state can
  be reached honestly.
- Integration assertions snapshot the registry and mutation coordinator across
  search, hold an active build lease while read/search continue, and inject a
  provider that would fail if search reached resolver/build work.

## Verification

- `bun test` — 509 passing, 0 failing, 2 snapshots, 2382 expectations
- `bun run typecheck`
- `bun run lint` — 186 files checked, no fixes
- `git diff --check`
- Focused search-data/presentation/router/demo/app run — 100 passing, 0 failing
- In-app browser on the existing `http://localhost:3030` server: confirmed the
  immediate loading/`aria-busy` state, scalar **CAFÉ** narrowing, `string[]`
  **Doe** narrowing, distinct no-match copy, Clear and Unicode-whitespace
  restoration to all three canonical rows, and the searched result opening the
  same read-detail modal. At 390 px wide the control, Clear target, and document
  had no horizontal overflow.
- Regression recheck after the header-row layout change: the centered search
  no-match message is the only empty feedback, and the canonical empty prompt stays
  hidden. After the explicit Latin-accent-insensitive contract change, bare **cafe** and
  accented **CAFÉ** both return the expected record. Browser geometry reported a
  `0px` delta between feedback and collection centers, with the canonical empty
  prompt computed as `display: none`.
- Human sign-off received on 2026-07-16.

## HITL test instructions

1. Ensure an extension-capable SQLite is available (`brew install sqlite` on
   macOS). Reuse the app server on port 3030, or run `bun run dev` if it is not
   already running, then run `bun run demo:five-action-reference`.
2. Open `http://localhost:3030`, choose **Journal entry**, and confirm a labelled
   search field appears above the records.
3. Type **cafe**. Confirm **Searching…** appears briefly and only **Ready to
   remove — CAFÉ ÅNGSTRÖM** remains. Open it and confirm the ordinary shared
   read-detail modal appears.
4. Spot-check **CAFE**, **CaFe**, **Café**, and **Cáfé** and confirm the same record
   remains for every spelling. Close the modal and type **Doe**. Confirm the result narrows to **A quiet
   beginning** even though Doe is stored in the `string[]` **Other names** field.
5. Type **definitely-missing** and confirm the distinct **I couldn’t find a match.
   Try another word.** state. Choose **Clear** and confirm all three records return.
6. Enter only spaces (or Unicode whitespace) and confirm the same full canonical
   read collection returns. These steps were signed off on 2026-07-16.
