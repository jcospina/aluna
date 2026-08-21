# Re-derive the design-lint rung against High Meadow, and ban font family, radius and shadow

Status: ready-for-agent

## Epic

Module 5 — The Desk · Epic 5.1 — The token layer, and the corpus it invalidates
(PLAN decision 10 (three closed axes plus three of the four bans; the `border`
ban lands in 5.2/02 once the ink system covers generated boundaries):
`modules/05-the-desk/PLAN.md`)

## What to build

The design-lint rung's approved-value list re-derives against High Meadow names,
and three of ADR-0005's four new bans land with it. Until this issue is done no
capability can be built at all, because the rung still demands the token
vocabulary 5.1/01 deleted — which is why it comes second and nothing comes
between them.

Three axes stay closed and are picked from a list:

| Property | Rule |
|---|---|
| colour | only `var(--<token>)` from the High Meadow palette |
| type size | only from the High Meadow size set |
| spacing | only from the High Meadow spacing set |

Three properties are never declared at all:

| Property | Why |
|---|---|
| font family | inherited from the surface it sits on |
| `border-radius` | no radius tokens exist; a square corner is the absence of a declaration |
| `box-shadow` | nothing inside a window casts, and the shadow tokens are bare `<x> <y> <alpha>` numbers, so `var(--shadow-*)` produces an invalid value that fails silently |

Radius and shadow are absences in High Meadow rather than shorter lists, so
inventing token sets for them would contradict the design. The shadow ban is the
only thing that catches the shadow case at all, because it fails silently rather
than visibly.

ADR-0005's fourth closed axis, border weight, gets no successor list — but its
ban waits for 5.2/02, because a generated card with neither a border nor a drawn
boundary is invisible.

## Acceptance criteria

- [ ] The rung rejects a raw value on each of the three closed axes and names the
      High Meadow token set in the refusal
- [ ] The rung rejects any declaration of font family, `border-radius` or
      `box-shadow`, including the silently-invalid `box-shadow: var(--shadow-md)`
- [ ] The rung accepts every High Meadow token on each closed axis, including the
      renamed ones, with no residual reference to the retired vocabulary
- [ ] A capability built from the prompt bar clears the gate and renders its
      records in High Meadow — the first build on the new token layer
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Type a prompt into the prompt bar and watch a capability build green on the new
token layer, then browse its records. This is the slice that makes the corpus
deletion in 5.1/01 recoverable, so it is the first end-to-end proof that High
Meadow ships.

## Blocked by

- modules/05-the-desk/5.1-token-layer-and-corpus-invalidation/issues/01-ship-design-styles-as-the-token-layer.md
