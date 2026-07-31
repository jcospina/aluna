# Remove the Module 1 `/stream` greeting liveness route

Status: ready-for-agent

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

- [ ] No route, module, stylesheet, or test under `src/` or `public/`
      references `/stream`, `streamGreeting`, `handleStreamError`, or
      `intro__invitation`
- [ ] `GET /stream` returns 404; `GET /` and the prompt bar are unchanged
- [ ] `src/app/greeting.ts` is deleted and nothing imports it
- [ ] A missing provider key still produces a warm, jargon-free apology with no
      internals leaking into product copy, proved on the `/prompt` path
- [ ] `src/app/app.build-jobs.test.ts` still passes unchanged
- [ ] ADR-0002 records the removal
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

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
