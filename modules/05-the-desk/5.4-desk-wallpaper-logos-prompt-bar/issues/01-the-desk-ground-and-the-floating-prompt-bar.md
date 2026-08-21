# The desk ground: wallpaper, a floating prompt bar, and the clearance no window may enter

Status: ready-for-agent

## Epic

Module 5 — The Desk · Epic 5.4 — The desk: wallpaper, logo layer, prompt bar
(PLAN decisions 1 (the page's three layers), 5; design D5:
`modules/05-the-desk/PLAN.md`)

## What to build

A wallpaper, a logo layer and a prompt bar are what the page ships. This issue
lays the ground and the bar; the logo layer is 5.4/02.

- The desk ground fills the viewport. The header row that carried the styled
  wordmark is deleted, and the wordmark is placed nowhere else — only the Aluna
  name is left.
- The prompt bar floats clear of all four edges and is never full width.
- **The stylesheet owns the clearance number and JavaScript reads it back.**
  `--prompt-clearance` lives in the token layer, and the desk's geometry script
  reads the token at load rather than restating the number, keeping the literal
  only as a fallback for a stylesheet that has not applied. This is the seam that
  makes the floor in 5.6/02 correct by construction rather than by two files
  agreeing.
- Nothing may be dragged or resized into that strip. Maximise already respects
  the clearance under `design/`; the shipped shell reserves no strip at all, so
  this issue carries the token and the reserved strip over, and 5.6/02 carries
  the drag and resize floors once windows exist.

The point of the reservation is concrete: the tail of a records list is exactly
where a user scrolls, and it must never be hidden under the bar or unclickable.

## Acceptance criteria

- [ ] The page is a wallpaper and a floating prompt bar; no header row and no
      wordmark survive in the codebase
- [ ] The prompt bar clears all four edges and is not full width at any viewport
      the desk supports
- [ ] The clearance is declared once, in the token layer, and read back from it
      at load; the JavaScript literal exists only as a fallback
- [ ] Content bounded by the clearance stops above the bar rather than under it
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Open the homepage: the meadow ground with the prompt bar floating over it, clear
of every edge. Type a prompt and confirm the build still runs and narrates.

## Blocked by

- modules/05-the-desk/5.3-content-region-lifecycle/issues/02-every-swap-target-fails-loudly.md
