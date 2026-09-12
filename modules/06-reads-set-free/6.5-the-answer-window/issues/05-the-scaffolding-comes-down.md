# The scaffolding comes down

Status: done

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

**Two things look like the exercise's and are not.**
`src/runtime/query/question.test-support.ts` is shared with `question-turn.test.ts`
and `data-query.test.ts`, which are permanent; and `QUESTION_TURN_PROMPT_PREFIX` is
exported so a fake provider can tell a turn's call from the resolver's by its
prompt rather than by queue position — the real path wants that seam exactly as
much as the exercise did. Neither goes.

**The prose stops promising it too.** 6.3/01 says "it is deleted when 6.5 makes the
real path visible, and the issue that deletes it says so" — that forward reference
resolves to this file. The plan's note in `## Approved epic build order and
boundaries` is updated to match. Nothing in the repo should still describe the
exercise as present once this lands.

## Acceptance criteria

- [x] The developer-gated one-turn exercise, its route, handler, registration and
      any markup or fixture existing solely for it are gone
      (`src/server/routes/query/demo-question.ts` and its
      `app.demo-question.test.ts`, and the `registerDemoQuestionRoutes` call in
      `src/server/app.ts`)
- [x] `developerSurfacesEnabled()` and the developer panel are untouched
- [x] Every assertion that ran through the exercise now runs against the loop
      directly or through the real query path; none is deleted
- [x] `grep -rn "developerSurfacesEnabled" src/` returns only pre-existing platform
      uses, none of them Module 6's
- [x] No file in `src/`, `public/`, `scripts/`, `modules/06-reads-set-free/` or
      `docs/` still describes the exercise as present
- [x] The bundle's worker-thread copy **stays**; only its justification is
      rewritten. `scripts/build.ts` and `scripts/build.test.ts` name
      `/demo/question` as what first made the server reach the query worker, and
      that sentence becomes 6.5/03's real path — but the copy itself is what keeps
      `bun run start` able to open a worker at all, and deleting it with the
      exercise breaks production silently, in the one place `bun run test` does
      not look
- [ ] The living demo in the plan passes end to end with the exercise absent — steps 1
      and 2 driven here; 3 to 11 are the sign-off
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Run `bun run reset`, start Aluna on `:3030` and navigate to `/demo/question` — the
exercise is a bare URL, never a link from the developer panel, so 404 is what
confirms it. Then run the plan's living-demo steps 2
through 8 and confirm every one still passes through the real path — the surface
the user actually uses is the only way in, which is what "the demo stays alive"
meant all along.

## Blocked by

- modules/06-reads-set-free/6.5-the-answer-window/issues/03-a-question-is-narrated-and-answered-in-the-window.md

Last issue of epic 6.5. Nothing after 6.5/03 depends on the exercise, so this may
land alongside 6.5/04 rather than after it — but it must not land before 6.5/03,
which is what makes the exercise redundant in the first place.

## What landed

- **Gone**: `src/server/routes/query/demo-question.ts` and `app.demo-question.test.ts`
  (858 lines), the `registerDemoQuestionRoutes` import and call in `src/server/app.ts`, and
  the now-empty `src/server/routes/query/`. Nothing else imported either file.
- **Pinned gone**: `src/server/app.test.ts`'s `describe("the retired /demo surfaces are gone")`
  grew a fourth test asserting `GET` and `POST /demo/question` are 404 in both environments
  while `/` stays 200. Deleting a route without pinning it leaves a revert free to ship it
  again under a green suite, which is why every retired `/demo` surface before it is pinned.
- **Re-homed**: `app.endings-the-model-never-writes.test.ts` — the three endings that stop
  before the answer generation (nothing matched, nowhere for it, reads spent), each now proved
  through `POST /prompt` and the job stream rather than through the exercise's form. The gap
  ending keeps its whole-frame assertion and its no-control sweep (decision 20).
- **Re-homed**: the "never a grid" sweep moved into `KEEPABLE` in
  `app.question-answered-in-the-window.test.ts`, which gained `<tr`, `chart` and `csv` and now
  matches case-insensitively.
- **Shared**: `answer-window.test-support.ts` holds the two readers both route-level question
  suites use; `staged-question.test-support.ts` gained `gap` and `neverStops`, so the real
  path's fake model can reach the two endings only the exercise could drive.
- **Prose**: `dev-surfaces.ts`, `scripts/build.ts`, `scripts/build.test.ts` and the plan's
  issue-conversion note no longer name the exercise; every 6.2 to 6.5 issue that references it
  now says at the top that it came down here.

## Findings

- **Nothing pinned the route as gone.** The first cut deleted the registration and stopped
  there. `src/server/app.test.ts` already holds the house convention for this — three tests
  pinning twelve retired `/demo` paths at 404 — and its own header still forward-referenced
  this issue as pending work. Both fixed.
- **The question was never proved escaped.** `renderAnswerWindowOpening` interpolates the
  person's own sentence into `data-answer-window="…"`, and the three tests that assert that
  attribute all use a benign question, for which `escapeHtml` is the identity function:
  deleting the escape left the whole suite green. Two tests now post a question carrying a
  quote and a handler, and a long one that the 120-character title bound cuts. Confirmed by
  mutation — removing `escapeHtml` at `src/server/http/fragments.ts:291` reddens them.
- **`POST /prompt` had no cross-site guard, and the only implementation of one in the repo
  was inside the deleted page.** A prompt spends provider tokens and can commit a capability,
  and a urlencoded POST crosses origins with no preflight, so a page the user merely visited
  could build on their behalf. `isCrossSitePrompt` now lives in
  `src/server/http/prompt-request.ts` and guards the route before the body is read, with
  `app.a-prompt-from-somewhere-else.test.ts` holding both halves of the claim. This is the one
  change beyond this issue's letter; it is two lines in `app.ts` plus the predicate.
- **A fixture could have spent the suite's stack.** `neverStops` with an empty `reads` recursed
  unboundedly inside the fake provider; `makeQuestionProvider` now refuses that at construction.
- **Two new assertions were vacuous.** The no-control sweep and the nothing-found ending both
  asserted only absences, and would have passed on an empty stream or on a question that ended
  somewhere else entirely. Both now assert the ending they are about before sweeping.

## Verification

- `bun run test`, `bun run typecheck`, `bun run lint` clean.
- `bun run build` still emits `dist/index.js` **and** `dist/query-worker-thread.ts`; the copy's
  justification in `scripts/build.ts` now names the real prompt-bar path, which is verifiably
  what reaches the worker with the exercise gone.
- Live on `:3030`: `/demo/question` answers 404 in the browser; the desk loads with no console
  error; the developer panel opens and still carries its lifecycle payload; two real questions
  asked at the prompt bar opened the answer window and were answered in a sentence; a
  cross-site `POST /prompt` answers 403 while the desk's own submission still returns the
  subscriber fragment.
