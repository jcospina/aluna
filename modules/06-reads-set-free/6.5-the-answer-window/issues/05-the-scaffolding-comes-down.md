# The scaffolding comes down

Status: ready-for-agent

## Epic

Module 6 — Reads Set Free · Epic 6.5 — The answer window
(PLAN decision 21 — the real surface is the surface; the temporary developer-gated
exercise 6.3/01 stood up exists only until this issue; ADR-0008:
`modules/06-reads-set-free/PLAN.md`)

## What to build

Epics 6.2 to 6.4 are headless, so 6.3/01 wired a developer-gated exercise of one
loop turn behind `developerSurfacesEnabled()`
(`src/server/dev-surfaces/dev-surfaces.ts`) rather than leave the integration
invisible for eight consecutive issues, and 6.4 read Aluna's sentences through it
before there was anywhere to read them. **6.5/03 made the real path visible, so the
exercise is now dead weight that still ships.** This issue removes it.

It is a separate issue on purpose. The removal was promised in 6.3/01's own prose
and in the plan, and a deletion that lives as a clause inside a larger issue is a
deletion that does not happen — the plan's amendment history is not the place to
discover that a demo surface outlived its module.

**The exercise goes, the gate stays.** `developerSurfacesEnabled()` and the
developer panel are pre-existing platform infrastructure that this module borrowed;
they are not ours to remove. What goes is the route, handler, registration, markup
and any fixture that exists solely to drive one loop turn from that surface.

**Every real assertion is re-homed, never deleted.** Any test that reached the loop
*through* the exercise is rewritten to reach the loop directly, or through the real
path 6.5/03 built. A test that proved something true about the loop keeps proving
it; only its entry point changes. Coverage must not fall because scaffolding came
down — if a behaviour was only ever proved through the exercise, it needs a
permanent home before the exercise goes, not after.

**The prose stops promising it too.** 6.3/01 says "it is deleted when 6.5 makes the
real path visible, and the issue that deletes it says so" — that forward reference
resolves to this file. The plan's note in `## Approved epic build order and
boundaries` is updated to match. Nothing in the repo should still describe the
exercise as present once this lands.

## Acceptance criteria

- [ ] The developer-gated one-turn exercise, its route, handler, registration and
      any markup or fixture existing solely for it are gone
- [ ] `developerSurfacesEnabled()` and the developer panel are untouched
- [ ] Every assertion that ran through the exercise now runs against the loop
      directly or through the real query path; none is deleted
- [ ] `grep -rn "developerSurfacesEnabled" src/` returns only pre-existing platform
      uses, none of them Module 6's
- [ ] No file in `src/`, `public/`, `modules/06-reads-set-free/` or `docs/` still
      describes the exercise as present
- [ ] The living demo in the plan passes end to end with the exercise absent
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Run `bun run reset`, start Aluna on `:3030`, open the developer panel, and confirm
the one-turn exercise is no longer there. Then run the plan's living-demo steps 2
through 8 and confirm every one still passes through the real path — the surface
the user actually uses is the only way in, which is what "the demo stays alive"
meant all along.

## Blocked by

- modules/06-reads-set-free/6.5-the-answer-window/issues/03-a-question-is-narrated-and-answered-in-the-window.md

Last issue of epic 6.5. Nothing after 6.5/03 depends on the exercise, so this may
land alongside 6.5/04 rather than after it — but it must not land before 6.5/03,
which is what makes the exercise redundant in the first place.
