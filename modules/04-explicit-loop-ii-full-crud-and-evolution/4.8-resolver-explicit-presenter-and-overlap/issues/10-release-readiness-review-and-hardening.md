# Review Epic 4.8 end to end and harden its admission and overlap boundaries

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.8 — Resolver,
explicit presenter, active context, and overlap
(PLAN decision 28 — resolution admission:
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`)

## Review scope

Audit the complete user-supplied range from
`0d9957ab1afc5d0c9a0574c7386944730b298cde` through the current Epic 4.8 head,
including the late Epic 4.7 commits that precede the first resolver commit in
that range. Reconcile implementation, tests, issue records, PLAN, architecture,
ADRs, production composition, and the living application before declaring the
epic safe to build on.

The review preserves the architectural boundary established by 4.8:

- `POST /prompt` admits only an ephemeral job; resolver work begins only when
  `GET /build/:id/stream` is opened.
- Reject and data-query outcomes never enter Builder or reserve mutation
  ownership.
- Only a resolved new-capability path may reserve mutation ownership, and it
  must revalidate the resolver's catalog snapshot before construction.
- Overlap naming is resolver-owned. Builder validates that identity instead of
  silently manufacturing a suffix.
- The prompt bar is the sole mutation entrance; retired demo/control routes do
  not survive in production.

## Findings repaired

### Prompt admission

- A prompt made only from zero-width, default-ignorable, or control characters
  could pass `String.trim()` and spend a resolver call. Admission now uses a
  Unicode-aware meaningful-content predicate while preserving the exact
  user-authored prompt bytes for every accepted request.
- A malformed multipart body could throw out of Hono's parser and become a 500
  response that HTMX silently discarded. Parser failure now takes the existing
  warm blank-refusal path: 200, notice fragment only, no job, no stream, and no
  provider call.
- Content-type handling was case-sensitive and used a substring match. It now
  normalizes and compares the exact media type, so mixed-case JSON works and a
  parameter containing `application/json` cannot misclassify a non-JSON body.

### Resolver-owned overlap identity

- Built labels were accepted after case folding and trimming even though the
  contract requires the exact resolver-owned id and label. Validation now
  requires byte-exact equality for both.
- The deterministic mechanical-suffix guard rejected every identity ending in
  a number, including unrelated meaningful names such as `Studio 54`. It now
  rejects a numeric/version suffix only when the stripped base still overlaps
  an active capability identity, while retaining the `contacts_2`, `contacts2`,
  `contacts_v2`, and `Work contacts 2` protections.
- Two Unicode-only labels could become empty ASCII token sets and falsely
  collide. Empty token sets no longer count as an identity match.

### Living documentation

- The still-active Epic 4.7 frozen-intent HITL instructions referenced the
  retired evolution form and guided-repair checkbox. They now use the prompt bar
  for live progress and the deterministic frozen-repair battery for the repair
  story, without claiming human sign-off that has not occurred.

## Acceptance criteria

- [x] The entire supplied commit range was reviewed against architecture,
      PLAN, ADRs, issue contracts, tests, and production composition.
- [x] Invisible/control-only prompts and malformed multipart bodies create no
      job and spend no provider call.
- [x] Accepted prompts retain their original bytes, including joined emoji.
- [x] Prompt media-type parsing is exact and case-insensitive.
- [x] Builder accepts only the exact resolver-owned overlap id and label.
- [x] Mechanical overlap suffixes fail closed without rejecting unrelated
      meaningful numeric names.
- [x] Full tests, focused tests, typecheck, lint, build, and diff checks pass.
- [x] The living app confirms the warm refusal path without opening a build.
- [x] Production does not serve retired Epic 4.8 demo/control routes.

## Verification

- `bun run test --shards=1` — **1055 passed, 0 failed**, 109 files.
- `bun test src/app/app.prompt-admission.test.ts
  src/pipeline/build/overlap-identity.test.ts` — **28 passed, 0 failed**, 141
  assertions.
- `bun run typecheck` — clean.
- `bun run lint` — clean across 287 files.
- `bun run build` — clean, 329 modules transformed.
- `git diff --check` — clean.
- Production server on `:3030`: `/` answered 200; `/demo/few-shot-gallery`,
  `/demo/spec-build`, `POST /demo/evolution/contacts`, and `/stream` answered
  404. Invisible JSON and malformed multipart submissions each answered 200
  with only `What would you like me to make?` in the OOB notice fragment.
- Browser pass on the development server: a single-space submission showed the
  notice, kept the button at **Make it**, and remained on `/`; the development
  few-shot gallery rendered normally.
- No real provider call was initiated by this review. Admission behavior is
  pinned with throwing/counting fake providers, and the live check stops before
  any stream can open.

## HITL

1. Keep the existing server on port 3030, or start it with `bun run dev`, then
   open `http://localhost:3030/`.
2. Enter one space in the prompt bar and press **Make it**.
3. Confirm *What would you like me to make?* appears, the button never changes
   to **Making it**, and no new build appears in the developer panel.
4. Optionally paste a joined emoji such as `Family 👨‍👩‍👧‍👦 moments` and run a real
   user-initiated build. Confirm the resolver receives the visible prompt as
   authored and the normal build stream begins.
5. For a provider-free repeatable check, run:

   ```bash
   bun test src/app/app.prompt-admission.test.ts src/pipeline/build/overlap-identity.test.ts
   ```

## Blocked by

- None.
