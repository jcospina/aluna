# The desk-load sweep retries a faceless capability, to a hard cap of three attempts

Status: ready-for-agent

## Epic

Module 5 — The Desk · Epic 5.5 — The capability logo
(PLAN decision 38; [ADR-0007](../../../../docs/adr/0007-capability-logo-contract.md):
`modules/05-the-desk/PLAN.md`)

## What to build

Loading the desk retries every faceless capability once. After the third attempt
the capability stops asking for good and its placeholder tile is permanent.

This is self-healing with no scheduler to build: the sweep rides on a page load
that was going to happen anyway. **The attempt cap rather than a spend ceiling is
the guard that matters** — at roughly $0.08 a call the expensive failure mode is a
retry loop, not a few extra attempts.

- On desk load, every `absent` tile emits the one incarnation-bound POST defined
  in 5.5/02 and is offered one attempt through the same atomic claim used after v1
  activation. Concurrent loads race the claim; exactly one wins and spends the
  attempt. Claim losers observe the in-progress state with a bounded wait and
  return the current tile; they neither start a second provider call nor create an
  unbounded client polling loop. Attempt responses are inert even when the state
  returns to `absent`, so an HTMX swap cannot recursively consume attempts two and
  three during the same desk load.
- A capability whose state is `abandoned` is never attempted again, on any load.
- The attempt count is durable, so a reload does not reset it.
- A capability being swept is usable throughout; the sweep never blocks the desk
  from rendering or a capability from opening.
- Recovery resolves an interrupted `generating` claim before serving: if the
  no-overwrite logo file is complete it marks `present`; otherwise it returns to
  `absent` or `abandoned` according to the already-consumed attempt. Attempt temp
  names are incarnation/attempt-scoped, so this recovery also removes any stale
  temp left by a process crash before it changes the state. It never decrements
  the count, deletes a final file or blindly spends a fourth call.
- A `present` row whose accepted file has later gone missing is reconciled to
  `abandoned` and the permanent placeholder. L7 forbids manufacturing a second
  accepted artwork after loss; the sweep does not spend another call.

## Acceptance criteria

- [ ] A desk load attempts exactly one generation per `absent` capability
- [ ] The sweep is one load-triggered POST per absent tile, never a mutating GET,
      scheduler or unbounded poll; each response is `no-store`, tile-scoped and
      cannot retrigger itself
- [ ] Concurrent desk loads cannot claim the same attempt or exceed three total
      provider calls for one incarnation
- [ ] After the third failed attempt the state becomes `abandoned` and no
      subsequent load attempts it again
- [ ] The attempt count survives a reload and a restart
- [ ] Recovery deterministically reconciles an interrupted `generating` claim
      from the final file plus the durable count, and removes the interrupted
      attempt's stale temp without touching an accepted final file
- [ ] A `present` state with a missing file becomes `abandoned`/placeholder and
      never regenerates or emits an immutable 404
- [ ] Deletion racing a sweep cancels the attempt through the exact incarnation
      read gate; post-token finalization revalidates the active row and cannot
      recreate or mark present a tombstoned incarnation
- [ ] A successful sweep attempt fills the tile without a further reload
- [ ] A concurrent claim loser can return the winner's resulting tile after a
      bounded observation without spending or blocking initial desk rendering
- [ ] The desk renders and capabilities open normally while a sweep is running
- [ ] No automated test calls the live service
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Grow a capability with the network to the logo service unavailable, confirm it is
finished, usable and placeholdered. Restore the network, reload the desk, and
confirm the sweep fills the face. Then fail one three times and confirm the fourth
load stops asking.

## Blocked by

- modules/05-the-desk/5.5-capability-logo/issues/03-the-logo-route-immutable-picture-only-and-compressed.md
