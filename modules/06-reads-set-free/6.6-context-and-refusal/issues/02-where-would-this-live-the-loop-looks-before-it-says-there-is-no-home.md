# Where would this live: the loop looks before it says there is nowhere

Status: ready-for-agent

## Epic

Module 6 — Reads Set Free · Epic 6.6 — Context and refusal
(PLAN decision 30; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

A question about something with no obvious home is answered by looking, not by
guessing.

**Because a `data_query` holds the whole catalog, the loop's first step *is*
"where would this live".** It checks whether a capability for the subject exists
and whether the open one could answer — the same shape of check the resolver makes
for evolution — and only when neither can does it reach 6.4/05's gap answer.

**The point is that the gap answer becomes earned.** A model that shrugs at an
unfamiliar word and declares a gap would be wrong most of the time: the subject
may be a value inside a capability rather than a capability of its own, and
6.4/01's vocabulary step is exactly how it finds that out. This issue is what
stands between a real gap and a lazy one.

**No new classifier, no new resolver pass.** The check is a step in the loop, on
the catalog the scope already holds.

## Acceptance criteria

- [ ] The loop's first step establishes where the subject would live, against the
      catalog the scope already holds
- [ ] A subject that is a value inside an existing capability is found there and
      answered, not reported as a gap
- [ ] A subject the open capability could answer is answered from it
- [ ] The gap answer is reachable only after the check has run and found nothing
- [ ] No additional classifier or resolver pass is introduced
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The plan's living-demo step 6, and the case that makes it honest. With Notes and
Expenses on the desk, ask about a category that lives inside Expenses under
another name and confirm she finds it rather than telling you there is nowhere for
it. Then ask about hiking trips and confirm she names the gap only after she has
looked.

## Blocked by

- modules/06-reads-set-free/6.6-context-and-refusal/issues/01-the-open-capability-is-context-never-a-filter.md
