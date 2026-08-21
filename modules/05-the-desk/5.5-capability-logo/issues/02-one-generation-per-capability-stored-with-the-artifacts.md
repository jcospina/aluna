# One claimed generation attempt after v1 activation, stored once under the incarnation root

Status: ready-for-agent

Type: HITL — this slice spends real credits and needs a human to look at the
artwork. Implementation is fully specified and agent-ready; sign-off is the gate.

## Epic

Module 5 — The Desk · Epic 5.5 — The capability logo
(PLAN decisions 37, 41; [ADR-0007](../../../../docs/adr/0007-capability-logo-contract.md):
`modules/05-the-desk/PLAN.md`)

## What to build

The first generation attempt is a **post-build follow-up to a successful v1**,
through the same claim operation and platform route the desk-load sweep will use.
The activated `absent` tile carries one load-triggered, same-origin POST to
`/capability/:id/:incarnation_id/logo-attempt`; this is a paid mutation and is
never a GET. The response replaces only that tile with its then-current
registry-backed rendering and is `no-store`; even if the attempt returns to
`absent`, that response is inert and does not carry another load trigger. Only a
fresh desk render or newly activated tile may arm one attempt. The activation
transaction first commits seed plus `absent/0`; the presenter reaches its terminal
path and the long build lease releases; only then may the follow-up acquire a
short coordinator claim (a request arriving earlier waits in ordinary FIFO order).
The build SSE need not stay open to carry the artwork. The Gate, snapshot publication and SQLite activation
have already succeeded, so no refused or never-activated build pays for artwork,
there is no nested coordinator acquisition, and provider failure cannot change
`success/activated` into failure. Evolution never enters this path. A crash in
the gap is harmless: the next desk load sees `absent/0` and offers the same claim.

- One request per **claimed attempt** to the hosted vector service, at roughly
  $0.08 a call, and at most one accepted artwork per incarnation. Model, style and substyle, size, response format and `controls.no_text`
  are held constant for every capability and no caller may vary them. What varies
  is short: the capability's ground first plus its deterministic companion from
  5.5/01's closed lookup, the background colour pinned to that same first colour,
  the stored `random_seed`, and the prompt block with its subject slot filled.
  The ground is named twice — once in the control and once in words inside the
  prompt — because naming it in only one of the two places does not work.
- **The artwork is `capabilities/<id>/<incarnation_id>/logo.svg`, beside the
  immutable `vN/` directories rather than inside one.** Retry is therefore able
  to create the file after activation without mutating a published snapshot or
  falsifying `snapshot.json`'s exact inventory. Capability deletion already owns
  the whole incarnation tree, so no second cleanup path is introduced.
- The claim atomically moves `absent → generating` and increments `attempts`
  before the call, through a short coordinator write bound to the exact active
  incarnation. Provider I/O then holds that incarnation's read token and observes
  its cancellation signal. Successful bytes are written to a same-filesystem
  temporary file and installed with no overwrite while the token is still held.
  The token releases before a second short coordinator write revalidates the
  active incarnation and marks `present` — never await a queued coordinator
  acquisition inside the read-token scope. If deletion closes the gate, the call
  aborts and no late response can recreate the tombstoned artifact tree.
- **A failed call does not fail the build.** It returns `generating → absent`
  unless the third claimed attempt has failed, in which case it becomes
  `abandoned`. The capability remains finished, usable and placeholdered; the
  sweep in 5.5/04 is what tries again.
- Each attempt has a bounded timeout and validates the provider envelope, base64
  decoding and an SVG document root before installation. Validation does not
  strip or rewrite accepted SVG bytes. Timeout, cancellation, malformed output or
  install failure counts as a failed claimed attempt, removes its temporary file
  in `finally`, and leaves no untracked staging artifact.
- **The prompt block may be edited freely and owes no versioning.** The worry that
  editing it breaks retry-determinism does not survive L7: a logo is made once and
  never remade, so a retry is always for a capability that has no picture at all,
  and there is nothing for it to be inconsistent with. Nothing requires two
  capabilities to look like they came from the same era either.

The credit budget is a hard ceiling, not a target. Agree the number of live
generations with the human before spending any, and drive the automated tests off
stored specimens rather than the live service.

## Acceptance criteria

- [ ] A successfully activated v1 commits `absent/0`, finishes presentation and
      releases the build lease before the first claim; evolution and every
      non-activated terminal make none
- [ ] Only an `absent` registry-backed tile emits the incarnation-bound
      load-triggered POST; the paid operation is never GET/cacheable and its
      response replaces only that tile without recursively arming another attempt
- [ ] The constant fields are not caller-variable; the two-colour request is
      exactly the authored ground followed by its closed-lookup companion, with
      the background pin, seed and filled subject slot as specified
- [ ] The ground is named both in the control and in the prompt text
- [ ] The artwork lands atomically at the incarnation-root logo path, outside all
      immutable `vN/` inventories, and the logo state becomes `present`
- [ ] A publication or activation failure spends no logo call; a post-activation
      logo failure cannot relabel the activated build or its metrics
- [ ] Claim and finalization are short coordinator writes; provider/install work
      holds the exact read token, responds to cancellation, releases it before
      reacquiring mutation ownership, and cannot resurrect files after deletion
- [ ] A failed or unavailable service leaves a finished, usable, placeholdered
      capability — the build does not fail
- [ ] No automated test calls the live service
- [ ] Timeout/malformed/cancel/install-failure paths consume the claimed attempt,
      remove temporary bytes, preserve any prior final file, and never leave
      `generating` without a deterministic recovery outcome
- [ ] **Sign-off gate:** the human has looked at the generated artwork on the desk
      and accepted it
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Build a capability from the prompt bar and watch its placeholder tile become real
artwork through the tile follow-up after v1 activates, even though the build
stream has already ended. Then build a second one with the network
to the service unavailable and confirm the capability is finished, usable and
still placeholdered.

## Blocked by

- modules/05-the-desk/5.5-capability-logo/issues/01-spec-and-registry-carry-the-logos-inputs-and-state.md
