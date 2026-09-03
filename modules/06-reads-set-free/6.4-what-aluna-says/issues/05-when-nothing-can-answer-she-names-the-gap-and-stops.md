# When nothing can answer, she names the gap and stops — and offers no button

Status: ready-for-agent

Type: HITL — the gap sentence is authored product voice and it is the one place
this module comes closest to a proposal without becoming one. Implementation is
fully specified and agent-ready; a human reads the words before sign-off.

## Epic

Module 6 — Reads Set Free · Epic 6.4 — What Aluna says
(PLAN decision 20; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

A question about something the user tracks nowhere ends with Aluna naming the gap:
*"You don't have anywhere for hiking trips yet — you can ask me to make one."*
Then she stops.

**No button, no confirmation control, no yes.** An offer-with-a-yes is a
**proposal**, and the proposal surface belongs to Module 8:
`src/pipeline/intent/schema.ts` presently admits only `requires_confirmation:
z.literal(false)`, and its own comment reserves confirmations for M4 deletion and
M8 proposals. Nothing in this issue may add a control that accepts an offer, and
nothing may set that flag.

**The information still arrives, and that is the whole point.** The action is one
ordinary sentence away in the box already under the cursor, which is where every
other thing the user asks for starts. This is the first place M8 should wire its
proposal surface when it has one, and the issue should say so where the code makes
the choice.

**She reaches this ending by looking, not by guessing.** Decision 30 — the loop's
first step is *where would this live* — is epic 6.6's, and 6.6/02 proves the
check. This issue owns the ending itself; it must not be reachable by a model
declining to look.

## Acceptance criteria

- [ ] A question about a subject no capability covers ends by naming the gap and
      saying the user can ask for it to be made
- [ ] The ending renders no button, link or confirmation control of any kind
- [ ] `requires_confirmation` is untouched and still admits only `false`
- [ ] The sentence names the subject in the user's words and no capability, table
      or column
- [ ] The ending cannot be produced without the loop having looked first
- [ ] A comment where the ending is produced records that this is M8's first
      proposal-surface site
- [ ] **Sign-off gate:** the human has read the sentence and confirms it informs
      without offering
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Headless; exercise through 6.3/01's developer-gated turn. Ask about something you
do not track at all — hiking trips against a desk holding Notes and Expenses — and
read what comes back. The plan's living-demo step 6 is this behaviour on a real
surface, and it says explicitly: no button appears.

## Blocked by

- modules/06-reads-set-free/6.4-what-aluna-says/issues/04-zero-rows-is-never-a-statement-about-the-users-life.md
