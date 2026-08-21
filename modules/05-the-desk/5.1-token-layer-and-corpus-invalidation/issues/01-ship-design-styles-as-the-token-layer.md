# Ship `design/styles/` as the product token layer, and delete the corpus it invalidates

Status: done

## Epic

Module 5 — The Desk · Epic 5.1 — The token layer, and the corpus it invalidates
(PLAN decisions 7, 8, 29 (the reset-bounded detail-key cleanup), 43 (the C12
swap), 49 (the `window-frame.js` fill and the two PROPOSED labels):
`modules/05-the-desk/PLAN.md`)

## What to build

`design/styles/` stops being a reference mockup and becomes the stylesheet the
product loads. There is one copy of every value and no second token layer that
can drift against it. Paper & Ink is superseded and deleted along with the
capabilities that speak its vocabulary.

- The shipped page loads the High Meadow manifest rather than the Paper & Ink
  token layer, and the retired token file is removed rather than left orphaned.
  Fonts and the wallpaper asset come with it.
- The surviving shell chrome — the prompt area, the content area, the build
  narration — is ported onto High Meadow names so the app is usable end to end.
  Chrome this module deletes later (the capability toolbar, the sidebar, the
  detail modal) may look plain in the interim; it must stay *functional*, and
  the interim is bounded by epics 5.4 and 5.7.
- The 13 capabilities under `capabilities/` are deleted, not regenerated. They
  have no logo and never went through the build that ends in one, so nothing
  survives that speaks the old token names. This is the same greenfield move
  Module 3 made at the M2→M3 artifact shape and Module 4 made at each cutover:
  change the system, `bun run reset`, rebuild fresh. No preservation cutover, no
  dual-serving, no contract marker.
- The same reset-bounded cut removes `ui_intent.detail.shows` from the authored
  spec, validation, canonicalization and generation prompt before any High Meadow
  capability is built. The temporary detail modal renders active form fields in
  schema order until 5.7/01 deletes it; no new snapshot is born with a key for the
  read-only surface Module 5 removes. Deferring this cleanup to the form epic
  would either invalidate paid-logo capabilities mid-module or force choice
  support into a branch that is immediately deleted.
- C12's measured failure is resolved at the palette while the palette is being
  laid down, so no known AA failure ever ships: the two greens change places.
  Primary becomes `--shade` (5.18, dark enough to need a light label rather than
  to break the ink-unless-too-dark rule) and secondary becomes `--leaf` (4.54
  under ink, like every other light anchor). The full-pair audit is 5.11's work;
  only the swap lands here.
- `--focus-ring` and `--control-h` lose their PROPOSED labels — the first settled
  by plan decision 45, the second by decision 31.
- The last hard-coded colour below the token layer becomes a token, per
  `index.css`'s own rule that nothing below the token layer hard-codes a colour.
- Every document still pointing at the retired token file or handbook location
  is repointed at `design/styles/` and
  `design/design-system.md`. The handbook itself is already rewritten against
  High Meadow and already lives under `design/`; only the inbound references are
  outstanding. ADR-0001's *visual* half is marked superseded — its warm
  first-person product voice, the Aluna name and the pet's deferral survive
  untouched, and the styled wordmark does not survive, because it went with the
  header row that carried it and the desk puts none anywhere else.

## Acceptance criteria

- [x] The app loads High Meadow from `design/styles/`; no second token layer
      exists anywhere in the repo, and nothing under `public/css/` declares a
      colour, type size, spacing step or shadow of its own
- [x] `capabilities/` holds no capability; `bun run reset` leaves a clean runtime
      and the app starts on an empty corpus without error
- [x] `ui_intent.detail.shows` is absent from the authored/registry schemas,
      validation, canonical equality and generator prompt before the first rebuilt
      capability; the temporary modal uses active form-field order without it
- [x] Primary resolves to `--shade` under a light label and secondary to `--leaf`
      under ink; both pairs are pinned by a contrast assertion
- [x] No `PROPOSED` label survives on `--focus-ring` or `--control-h`, and no
      product CSS/JS component style below the token layer declares a literal
      colour (stored/generated artwork and test fixtures are not token consumers)
- [x] ADR-0001 records that its visual half is superseded by High Meadow and that
      its voice half stands; the wordmark is gone from the codebase, not hidden
- [x] No document points at either retired design-system location
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Implementation notes

- The shell now loads `design/styles/index.css` first and serves the High Meadow
  stylesheet, Fraunces/Outfit fonts and wallpaper through `/design/*`. The retired
  public token/font copies and styled wordmark are deleted.
- Surviving shell CSS consumes High Meadow values without owning another colour,
  type-size, spacing or shadow scale. The two button contrast pairs and the absence
  of component-level literal colours are regression-tested.
- `ui_intent.detail.shows` is removed from the registry contract, prompts, diff facts,
  router projection and fixtures. The temporary detail view now reads active schema
  fields in schema order.
- Reset now clears all current platform metrics, the retired standalone tombstone
  table, generated capability tables, artifacts and blobs. The final corpus contains
  only the tracked `capabilities/README.md` and `storage/README.md` placeholders.
- The standalone architecture documents and GitHub Pages packaging consume the same
  High Meadow styles/assets. The few-shot developer preview is deliberately
  unregistered until 5.1/02 re-derives the design gate; it cannot show a misleading
  partly-sanitized preview during the cutover.
- Follow-up: the homepage prompt composer is now 48px tall with a 30px lower gutter,
  without changing shared inputs. Splitting an invalid nested `:has()` selector into
  valid empty, pending and visible-stream rules keeps the empty Desk within one
  viewport instead of stacking two full-height content regions.
- Follow-up: persistent prompt feedback no longer uses faint `--ink-3` directly on
  the wallpaper. It shares High Meadow's desk-label treatment with capability names:
  surface-coloured Outfit 600 over the one canonical three-pass ink shadow. The
  prompt notice keeps its own measure and placement rather than becoming a logo tile.

## Verification

- `bun run reset` — clean; five platform data tables cleared, no generated paths or
  generated capability tables remain.
- `bun run test` — 1,148 passed, 0 failed.
- `bun run typecheck` — clean.
- `bun run lint` — clean.
- `git diff --check` — clean.
- Independent quality and adversarial reviews completed; every reported finding was
  repaired and the final adversarial review reported no actionable findings.
- Browser check at `http://localhost:3030/` — High Meadow wallpaper and Outfit load,
  the prompt and narration-panel controls work, the corpus renders empty, and the
  browser reports no errors or warnings.
- Follow-up browser check at 1280×720 — the prompt composer measures 48px, its lower
  gutter measures 30px (formerly 12px), and both the Desk content and document report
  equal client/scroll heights with no scrollbar.
- Prompt-feedback browser check — the rejection notice computes to `--surface`, Outfit
  600 and `--shadow-desk-label`; it stays within one viewport at 1280×720 and wraps to
  two lines without horizontal or vertical overflow at 390×844.

## HITL test instructions

1. Run `bun run reset`, then `bun run dev` if the project is not already listening on
   its normal port.
2. Open `http://localhost:3030/`.
3. Confirm the meadow illustration fills the Desk, the bottom prompt rail reads
   “What would you like to keep track of?”, and no capability window or toolbar item
   appears.
4. Toggle the `</>` developer control once, confirm the “Generation process” panel
   opens, then close it and confirm the empty Desk remains usable.
5. Focus the prompt to confirm the control is interactive, but do **not** submit a
   capability yet. Successful High Meadow generation remains blocked until 5.1/02
   re-derives the design gate.

## Living demo

The homepage loads on High Meadow: the meadow ground, the Fraunces/Outfit
pairing, and the new spacing. The corpus is empty, so the page is the prompt
surface alone — which is the state the desk is designed to read correctly in.
Building a capability is blocked until 5.1/02 re-derives the gate; that
sequencing is deliberate and is called out in that issue.

## Blocked by

- None — can start immediately
