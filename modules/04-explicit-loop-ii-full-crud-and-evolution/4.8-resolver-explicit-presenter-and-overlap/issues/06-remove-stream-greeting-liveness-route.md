# Remove the Module 1 `/stream` greeting liveness route

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.8 — Resolver,
explicit presenter, active context, and overlap
(ADR-0002 (route namespacing; the Epic 1.5 paragraph that introduced this route);
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`)

## What to build

`GET /stream` is the Module 1 provider round-trip: a warm greeting streamed as
it builds, plus a schema-validated invitation, proving both halves of
`generate(prompt, schema)` on the running app instead of in a money-burning
test. It was reached from the shell's **Meet Aluna** button.

Epic 2.6 replaced that button with the prompt bar. `src/app/app.test.ts`
asserts its absence outright ("uses the prompt bar for the build-job flow and
removes the old greeting button"). The route has had no entry point in the
product since — it is reachable only by hand.

The round-trip it proves is now proved by the thing the product actually does.
A real prompt exercises `partialStream` through the Builder's spec generation
and the schema-validated result through every generated unit, against the same
configured provider, on the same page the user is already on. Keeping a second,
buttonless liveness path means maintaining provider wiring that no product
surface depends on.

Delete the route and its content module.

- **Remove the route.** `app.get("/stream", …)` in
  `registerShellAndLivenessRoutes` (`src/app/app.ts`), and update that
  function's doc comment and the file header, both of which still describe
  `/stream` as a registered endpoint.
- **Remove the greeting module.** `src/app/greeting.ts` in full —
  `streamGreeting`, `handleStreamError`, `GreetingSchema`, and
  `GREETING_PROMPT`. `handleStreamError` has exactly one caller and it is the
  route above; nothing else imports this file.
- **Remove the greeting's stylesheet remnant.** The `.intro__output
  .intro__invitation` rule in `public/css/demo.css`, whose only producer was
  `streamGreeting`'s fragment. Leave `.intro` and `.intro__output` alone: the
  shell's `#spec-build-output` still uses them for the build stream.
- **Delete the route's tests — this one needs no re-pointing.** The three tests
  under `GET /stream (provider liveness, fake provider)` and `GET /stream
  (failure surfaces clearly, not silently)` in `src/app/app.rehydration.test.ts`,
  plus the `collectNarration` helper at the top of that file if nothing else
  uses it. The warm-apology-on-missing-key behavior they assert is already
  covered on the production path by `src/app/app.spec-build-failures.test.ts`
  ("a missing key streams a warm apology, not a crash") and by
  `src/app/app.resolver-pipeline.test.ts` ("a failed production build presents
  one terminal error before releasing ownership"). Verify that before deleting;
  if the product-voice assertion that no internals leak into the copy
  (`OMNI_API_KEY|api key|provider`) has no equivalent on a `/prompt` test, move
  that one assertion rather than dropping it.
- **Keep `makeFakeProvider`, but note what it becomes.**
  `src/app/app.test-support.ts` still exports it and
  `src/app/app.build-jobs.test.ts` uses it four times as a generic provider stub
  (passing `"unused", "unused"`). Its greeting/invitation shape now serves no
  caller that cares about the values. Leave it working; simplifying its
  signature is optional and must not turn into a sweep of `app.build-jobs.test.ts`.
- **Leave the historical record alone.** ADR-0002's Epic 1.5 paragraph and the
  Module 1 issue files describe `/stream` in the past tense as the state at the
  end of Module 1. That text is history and stays unchanged. Do add a short
  update to ADR-0002 recording this removal, in the same shape as the
  `/demo/swap-proof/*` note — the route's removal takes no decision with it.

## Acceptance criteria

- [x] No route, module, stylesheet, or test under `src/` or `public/`
      references `/stream`, `streamGreeting`, `handleStreamError`, or
      `intro__invitation`
- [x] `GET /stream` returns 404; `GET /` and the prompt bar are unchanged
- [x] `src/app/greeting.ts` is deleted and nothing imports it
- [x] A missing provider key still produces a warm, jargon-free apology with no
      internals leaking into product copy, proved on the `/prompt` path
- [x] `src/app/app.build-jobs.test.ts` still passes unchanged
- [x] ADR-0002 records the removal
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Nothing visible changes — the button this route served was removed in 2.6. The
provider round-trip is confirmed the way the product confirms it: type a prompt
and watch the spec stream in.

## Notes

Independent of 05, 07, and 08.

Live provider verification after this lands is a real build from the prompt bar
on the running app (`bun run dev`, port 3030), not a dedicated liveness route.
No test calls the real API, so that manual build remains the only place the
configured provider is exercised for real — say so in the completion notes so
the change of habit is recorded, not just implied.

## Implementation notes

- Deleted `src/app/greeting.ts` (68 lines) in full and removed
  `app.get("/stream", …)` from `src/app/app.ts`. With `/stream` gone, that route
  group registers only `/` and no longer touches the provider or the SSE
  heartbeat, so it was renamed `registerShellAndLivenessRoutes` →
  `registerShellRoute` and its doc comment and destructure shrank to match. The
  file header and the two other comments naming `/stream` were updated. Issue 08
  pointed a future agent at the old name (and at the wrong function for
  `/demo/spec-build`); that reference was corrected in place.
- Removed the `.intro__output .intro__invitation` rule from
  `public/css/demo.css`. `.intro` and `.intro__output` stay — `#spec-build-output`
  still uses them for the build stream — and the two comments calling that
  surface the "intro stream" (`demo.css` header, the `@import` label in
  `public/app.css`) now say "build stream".
- **Change of habit, recorded:** the real streamed + schema-validated provider
  round-trip is now exercised only by typing a prompt into the prompt bar on the
  running app. No test calls the real API, so that manual build is the single
  place the configured provider is proven for real. The two comments that told a
  reader otherwise — `src/provider/spine.test.ts`'s header ("the shell's *Meet
  Aluna* trigger … `/stream`") and `src/app/app.test-support.ts`'s — now point at
  `POST /prompt` → `GET /build/:id/stream`. `docs/modules.md`'s Module 1 "Verify
  by running it" box is history, so it was left as written with a note above it
  saying it is no longer runnable and where the round-trip is proven instead.
- **Deleted tests, and what covers them now.** The three `/stream` tests and the
  `collectNarration` helper are gone from `src/app/app.rehydration.test.ts`
  (which is now purely the Epic 2.1 rehydration file), along with the
  `makeFakeProvider`/`throwingProvider` imports they were the last users of.
  Two assertions did *not* have a production-path equivalent, so they moved
  rather than dropped, into a new case in `src/app/app.resolver-pipeline.test.ts`
  ("a missing provider key streams a warm apology, with no internals in the
  copy"): the missing-key product-voice guarantee, and the SSE `cache-control:
  no-cache` header, whose only assertion anywhere was the deleted "responds with
  SSE headers". `app.build-jobs.test.ts` is untouched, as required.
- `makeFakeProvider` is kept and working. Its doc comment now says what it has
  become — a generic `Provider` stub whose greeting/invitation values no
  surviving caller reads — so the next reader does not mistake the leftover
  shape for meaningful content. Its signature was deliberately *not* simplified;
  that would have swept `app.build-jobs.test.ts`.
- ADR-0002 records the removal in a new "Update (Epic 4.8 …)" section placed
  above the Epic 1.5 historical paragraph, in the same shape as the
  `/demo/swap-proof/*` note: the removal took no decision with it, and the event
  vocabulary is unchanged because `/stream` was a consumer of
  `narration`/`fragment`/`done`, never a source of them. The Epic 1.5 paragraph
  itself is untouched history.
- A 404 regression test guards the removal in `src/app/app.test.ts`, in its own
  `describe` so the shell test stays under the 100-line lint cap.

## Adversarial review

A SOTA adversarial pass checked every acceptance criterion against the working
tree and mutation-tested the moved assertion (deleting the terminal narration in
`src/pipeline/streaming/terminal-presentation.ts` turns the new test red, so it
is not vacuous). It confirmed no greeting identifier survives anywhere under
`src/`, `public/`, `scripts/`, or `capabilities/`, and that `.intro`/
`.intro__output` are still consumed by `#spec-build-output`. Five findings were
raised and all five are fixed above:

1. The moved product-voice assertion was **weaker than the one it replaced** —
   it checked only the last narration event, where the deleted test checked the
   whole payload. It now checks every `narration` *and* `fragment` event
   (including the persistent `#prompt-notice` copy that survives View
   restoration), while leaving the developer-facing `build-error-preview`, which
   carries the raw message on purpose, out of scope.
2. `escapeHtml`'s re-export from `src/web/index.ts` was **dead**: the deleted
   `greeting.ts` was the barrel's only consumer, and all ten surviving callers
   import from `./html.ts` directly. Unused re-exports are a blind spot for both
   `noUnusedLocals` and biome, so nothing would have caught it. Removed.
3. SSE `cache-control: no-cache` lost its only assertion — re-pointed (above).
4. `public/app.css`'s `@import` label still said "intro stream" — fixed.
5. `makeFakeProvider`'s doc comment still read as greeting machinery — fixed.

## Verification

- `bun run test` — 1043 pass, 0 fail (8 shards, 68s). One earlier run had a
  single timeout under machine load; it passed on re-run and in isolation.
- `bun run typecheck` — clean (both `tsconfig.json` and `tsconfig.browser.json`)
- `bun run lint` — 288 files clean
- Live on the running `http://localhost:3030`: `GET /stream` → **404**; `GET /`
  → 200 with `id="spec-build-prompt"` present and zero "Meet Aluna" matches;
  `/static/css/demo.css` has zero `intro__invitation` matches.
- **Live real-provider round-trip** (the verification that replaces the route):
  `POST /prompt` with "I want to keep track of my reading list", then reading
  `GET /build/<id>/stream` to completion against the configured provider —
  217 `spec-preview` chunks (the streamed partial), 48 `units-preview` events
  off the schema-validated spec, one `gate-preview`, one `commit`, and
  `done: ok`. The built "Reading list" capability then appears in the toolbar on
  reload. Both halves of `generate(prompt, schema)` are proven on the product
  path, no liveness route involved.

## HITL test instructions

1. Keep the existing `http://localhost:3030` server, or start it with
   `bun run dev`.
2. Confirm the route is gone:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3030/stream
   ```

   Expected: `404`.
3. Confirm nothing visible changed: open `http://localhost:3030`. The shell,
   the capability toolbar, and the prompt bar render exactly as before. There is
   no *Meet Aluna* button — there has not been one since 2.6.
4. Confirm the provider round-trip on the product path: type
   *"I want to keep track of my reading list"* into the prompt bar and press
   **Make it**.
5. Expected: the spec streams in character by character (the streamed partial),
   the stage previews in the developer panel fill in from the validated spec,
   and the finished capability swaps into the content area and joins the
   toolbar. That single build is now the only place the configured provider is
   exercised for real — no test calls the API.
