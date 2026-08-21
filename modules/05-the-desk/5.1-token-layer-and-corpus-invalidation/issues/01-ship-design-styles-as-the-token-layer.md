# Ship `design/styles/` as the product token layer, and delete the corpus it invalidates

Status: ready-for-agent

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
  token layer, and `public/css/tokens.css` is removed rather than left orphaned.
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
- Every document still pointing at the retired token file or at
  `docs/design-system.md` is repointed at `design/styles/` and
  `design/design-system.md`. The handbook itself is already rewritten against
  High Meadow and already lives under `design/`; only the inbound references are
  outstanding. ADR-0001's *visual* half is marked superseded — its warm
  first-person product voice, the Aluna name and the pet's deferral survive
  untouched, and the styled wordmark does not survive, because it went with the
  header row that carried it and the desk puts none anywhere else.

## Acceptance criteria

- [ ] The app loads High Meadow from `design/styles/`; no second token layer
      exists anywhere in the repo, and nothing under `public/css/` declares a
      colour, type size, spacing step or shadow of its own
- [ ] `capabilities/` holds no capability; `bun run reset` leaves a clean runtime
      and the app starts on an empty corpus without error
- [ ] `ui_intent.detail.shows` is absent from the authored/registry schemas,
      validation, canonical equality and generator prompt before the first rebuilt
      capability; the temporary modal uses active form-field order without it
- [ ] Primary resolves to `--shade` under a light label and secondary to `--leaf`
      under ink; both pairs are pinned by a contrast assertion
- [ ] No `PROPOSED` label survives on `--focus-ring` or `--control-h`, and no
      product CSS/JS component style below the token layer declares a literal
      colour (stored/generated artwork and test fixtures are not token consumers)
- [ ] ADR-0001 records that its visual half is superseded by High Meadow and that
      its voice half stands; the wordmark is gone from the codebase, not hidden
- [ ] No document references `docs/design-system.md` or the retired token file
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The homepage loads on High Meadow: the meadow ground, the Fraunces/Outfit
pairing, and the new spacing. The corpus is empty, so the page is the prompt
surface alone — which is the state the desk is designed to read correctly in.
Building a capability is blocked until 5.1/02 re-derives the gate; that
sequencing is deliberate and is called out in that issue.

## Blocked by

- None — can start immediately
