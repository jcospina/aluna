# A filtered count says how many matched and how many there are

Status: ready-for-agent

## Epic

Module 6 — Reads Set Free · Epic 6.1 — What every collection holds
(PLAN decision 32, and the honesty rule it shares with decision 17;
ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

With a search active, the collection states the matched count **and** the total.
A filtered number presented alone is a number that reads as the whole truth and
is not — the same honesty rule decision 17 applies to a spoken answer, applied
here to a rendered one. Clearing the search returns the plain count 6.1/01
already ships.

**Generated code is still untouched.** A capability's `search` Handler owns its
own filter and the platform cannot re-derive it without re-running generated SQL
it does not own, so the matched number is what the platform actually rendered
into the records region for that search. The total stays the `count` from 6.1/01
against the read connection. Two numbers, one of them already free and the other
already on screen.

**A search that matches nothing is the case this decision exists for.** Zero
matched is stated as zero matched, beside a total that is not zero, so the
collection never implies the capability is empty when it is only filtered.

The shape signed off in 6.1/01 governs the rendering; this issue adds the second
number to it and settles no new placement or styling of its own.

## Acceptance criteria

- [ ] With a search active the collection states both the matched count and the
      total, and neither stands alone
- [ ] Matched equals the records rendered in that collection; the total equals every record
      the capability holds
- [ ] Clearing or emptying the search returns to 6.1/01's plain count
- [ ] A search matching nothing states zero matched beside the real total, and
      never renders as an empty capability
- [ ] The matched number is not obtained by the platform re-running a
      capability's own filter, and no generated artifact changes
- [ ] Still one `count` on the read connection; no write, no new state
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Open Notes with a handful of records. Type a term into the search that matches a
few and read both numbers — how many matched, and how many notes there are.
Search for something that matches nothing and confirm the collection says none
matched rather than implying you have no notes. Clear the search and watch the
plain count come back.

## Blocked by

- modules/06-reads-set-free/6.1-what-every-collection-holds/issues/01-the-collection-states-how-many-records-it-holds.md
