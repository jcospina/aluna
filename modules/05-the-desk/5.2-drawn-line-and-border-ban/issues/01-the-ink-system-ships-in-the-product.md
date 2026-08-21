# The ink system ships in the product and draws the shell's own regions

Status: ready-for-agent

## Epic

Module 5 — The Desk · Epic 5.2 — The drawn line, and the border ban
(PLAN decision 9 (platform half); design D10, D11:
`modules/05-the-desk/PLAN.md`)

## What to build

Every visible boundary on the surface deviates from true, is inked twice and is
mitred, at one 2px weight with the hierarchy carried in the amplitude rather than
in the weight. The ink system already draws that way under `design/`; this issue
carries it into the shipped app and puts it in charge of the platform's own
regions.

- The ink runtime and its stylesheet load with the product, and the seam holds:
  the drawn line takes over from the CSS border that every component above it
  declares, so it has to win. That ordering is already recorded in the
  stylesheet manifest and must survive the port.
- The platform chrome the app has today — the prompt surface, the content region,
  buttons and inputs — takes its boundary from the ink system rather than from a
  CSS border.
- Hierarchy rides on the three hands (frame, fine, close) rather than on line
  weight, because the weight ladder is deleted and there is no softer setting to
  fall back on.
- Resize is observed once per container rather than once per drawn element. The
  children of a container resize together, so per-element observation buys
  nothing and costs on long lists.

Generated content is **not** in scope here — record cards, rows and tables are
5.2/02, which also carries the `border` ban. This issue is the platform half, so
that the ink system is proven on chrome the repo controls before it reaches
markup a model wrote.

## Acceptance criteria

- [ ] Every platform region, control and input on the shipped surface carries a
      drawn boundary; no platform chrome declares a CSS border
- [ ] The three hands are distinguishable and are the only hierarchy signal —
      one weight throughout
- [ ] Resize redraws correctly with one observer per container, not one per
      element
- [ ] A drawn boundary survives a re-render without the hand changing
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The homepage's prompt surface, content region and controls are drawn rather than
ruled. Resize the window and watch the lines redraw at the new size while keeping
their character.

## Blocked by

- modules/05-the-desk/5.1-token-layer-and-corpus-invalidation/issues/04-layout-and-type-go-to-rem.md
