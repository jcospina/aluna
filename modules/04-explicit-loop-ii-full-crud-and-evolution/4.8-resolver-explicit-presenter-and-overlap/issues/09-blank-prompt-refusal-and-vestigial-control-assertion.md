# Refuse a blank prompt before the resolver, and retire a vestigial control assertion

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.8 — Resolver,
explicit presenter, active context, and overlap
(PLAN decision 28 — resolution admission:
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`)

## What to build

Two loose ends that 4.8/04 exposed and deliberately deferred rather than widen
its own scope (`issues/04-remove-evolution-demo-surface.md`, *Deferred,
deliberately*). They are unrelated to each other and can land in either order;
they are one issue because each is too small to be worth its own.

### 1. `/prompt` refuses a blank prompt before it spends a resolver call

Deleting `/demo/evolution/*` removed the platform's only blank-input guard. That
route trimmed the typed intent and answered a warm 422 —
*"Tell me what you'd like to change first."* — before admitting anything.
`POST /prompt` has no equivalent:

- `readPromptSubmission` (`src/web/prompt-request.ts:33`) trims and returns `""`.
- The route (`src/app/app.ts`) creates the job unconditionally and hands back the
  subscriber fragment.
- `duplicateIntentForPrompt("")` produces no tokens and short-circuits nothing,
  so `runPromptJob` reaches `classifyIntentWithUsage` and **spends a real
  provider call classifying an empty string**.

4.8/04 added `required` to `#spec-build-prompt` (`public/index.html`), which is
the same browser-level guard the demo form had. That is the first line of
defence and it stays — but it does not cover a whitespace-only string, which
passes HTML5 validation, nor any non-browser POST.

**The refusal shape is the part worth specifying, because a naive 422 would
regress the page.** HTMX does not swap a non-2xx response by default, so a bare
422 would make a blank submit look like nothing happened at all. Use the
vocabulary the deflection path already speaks: answer **200** with only the
out-of-band prompt-notice fragment and create **no job**, i.e. the same
`<div id="prompt-notice" hx-swap-oob="innerHTML">…</div>` shape
`terminal-presentation.ts` emits for every warm terminal (see
`FAILED_BUILD_NOTICE`, `CANDIDATE_REJECTED_NOTICE`, `STALE_BUILD_NOTICE`). The
existing `htmx:beforeRequest` handler (`public/app.js`) already clears
`#prompt-notice` before each submission, so the line lands and then retires by
itself on the next real prompt.

Because no subscriber fragment is returned, no SSE stream opens, so `promptBusy`
never flips and the prompt bar stays live and focused — confirm that rather than
assuming it.

**Copy — needs product sign-off before this ships (see *Sign-off* below).**
Proposed: `Tell me what you'd like me to make first.` It is the demo route's line
re-pointed from "change" to "make", because `/prompt` is the entrance for new
capabilities as well as evolutions.

**Signed off 2026-08-03:** the shipped line is `What would you like me to make?` —
the proposed instruction was replaced with a question that mirrors the prompt
field's own placeholder voice ("What would you like to keep track of?").

### 2. Retire the vestigial `developer-evolution-control` assertion

`src/builder/artifacts/activation.test.ts:184` reads:

```ts
expect(
  renderCachedCapabilityCommitSwap(commit.row, commit.previousLabel).split(
    '<div id="developer-evolution-control"',
  )[0],
).not.toContain("hx-swap-oob");
```

`developer-evolution-control` exists nowhere in `src/` or `public/`, and did not
at `HEAD` before 4.8/04 either — it is the last surviving reference to an
evolution control removed long before this epic. `String.split` on an absent
separator returns the whole string, so `[0]` is the entire swap and the split
does nothing. The assertion therefore passes for a reason its code does not
state: the test's row label and `previousLabel` are both `"Notes"`, so the label
is unchanged, so **no toolbar sidecar is emitted at all** and there is no
`hx-swap-oob` anywhere to isolate.

Delete the `.split(...)` and assert against the whole swap directly. While there,
make the test say what it is actually proving — an unchanged label emits no
toolbar sidecar — rather than leaving a reader to infer it from a no-op string
operation. `src/web/fragments.test.ts` already pins the same property through
`inspectToolbarOob`; consider reusing that helper or referencing it, but do not
delete the assertion: this file proves it downstream of a *real* activation,
which `fragments.test.ts` does not.

## Acceptance criteria

- [x] `POST /prompt` with an empty or whitespace-only `prompt` creates no build
      job, opens no SSE stream, and makes **zero** provider calls — asserted with
      a fake provider whose call count is checked, not merely with a status code
- [x] That refusal answers 200 carrying only the
      `id="prompt-notice" hx-swap-oob="innerHTML"` fragment, so HTMX swaps it and
      the person sees a warm line
- [x] The refusal is proven for all three body encodings `readPromptSubmission`
      accepts (JSON, urlencoded/multipart form, raw text), since the guard must
      not live in one branch of the parser
- [x] A non-blank prompt is completely unaffected: the existing `/prompt` →
      `/build/:id/stream` batteries stay green with no changes to their
      expectations
- [x] `required` on `#spec-build-prompt` is still present — the server guard is
      defence in depth, not a replacement for it
- [x] `activation.test.ts` no longer references `developer-evolution-control`,
      and the surviving assertion states the property it proves
- [x] `grep -rn "developer-evolution-control" src/ public/` returns nothing
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Pressing **Make it** on an empty prompt bar answers in Aluna's voice instead of
opening a build that had nothing to build — and costs nothing to say so.

## Sign-off gate (HITL)

The notice copy is product voice, so it is the user's call, not the agent's.
Implement the proposed line, then show it in place and confirm the wording before
marking this done. Everything else in the issue is decided.

## What shipped

**1. Blank-prompt refusal at admission.**

- `src/web/fragments.ts` — `BLANK_PROMPT_NOTICE` plus `renderPromptNotice(notice)`,
  the single source of the `<div id="prompt-notice" hx-swap-oob="innerHTML">…</div>`
  shape. Exported through `src/web/index.ts`.
- `src/app/app.ts` — `POST /prompt` returns 200 with *only* that fragment when the
  trimmed prompt is empty, before `captureRestorationDescriptor` and before
  `buildJobs.create`. `runPromptJob` is untouched: a blank prompt never enters the
  pipeline rather than being filtered inside it.
- `src/pipeline/streaming/terminal-presentation.ts` and
  `src/pipeline/jobs/restoration.ts` — their five inline copies of that literal now
  call `renderPromptNotice`, so the id and swap mode cannot drift between the paths
  that emit it. Byte-identical output; no test expectation changed.
- The guard sits above the parser's content-type branch. `readPromptSubmission`
  already trims every encoding to one string, so one check covers JSON,
  urlencoded, multipart, and raw text alike.

**2. Vestigial assertion retired.**

- `src/builder/artifacts/activation.test.ts` — the no-op
  `.split('<div id="developer-evolution-control"')[0]` is gone. The test now
  asserts the whole commit swap directly and names the property it proves: an
  unchanged label emits no toolbar sidecar, downstream of a real activation.
- `src/app/app.evolution.test.ts` — dropped the last dead reference to the id.

## Verification

- `bun run test` — 1046 passed, 0 failed, 63.1s across 8 shards, on an idle machine.
  Later runs on a loaded one (load average ~25) reported `TimeoutError`s and nothing
  else — zero `AssertionError`s — with individual tests taking 70–110s against 7s
  idle. The twelve files that timed out were rerun directly: 68 tests, 0 failed, in
  48s. The 30s per-test bound in `scripts/test.ts` is a hang guard, not a
  performance assertion, and it does not survive that much external load.
- `bun run typecheck`, `bun run lint` — clean.
- `grep -rn "developer-evolution-control" src/ public/` — no matches.
- New per-encoding battery in `src/app/app.prompt-admission.test.ts`
  (`blank-prompt refusal`): five blank bodies — JSON whitespace, JSON with no
  `prompt` field, urlencoded, multipart, raw text. Each asserts status 200, body
  exactly equal to the notice fragment, no `data-build-job-id`, no `sse-connect`,
  **zero** issued job ids (counting `createId`), **zero** provider `generate` calls
  (a provider that throws if reached), no resolution metrics row, and an untouched
  mutation coordinator. A sibling test proves a typed prompt still gets its
  subscriber fragment.
- `promptBusy` confirmed rather than assumed: `public/app.js` flips it only on
  `htmx:sseOpen`. No subscriber fragment means no `sse-connect`, so no stream
  opens, so the flag never flips and the prompt bar stays live and focused.
- Live against the running dev server on :3030 — urlencoded, JSON, multipart, and
  raw-text blank bodies all answer `200` + the notice alone, as do a JSON array
  body, malformed JSON, an empty body with no content-type, and a non-string
  `prompt`.

### Adversarial pass

Ran before sign-off. **No blockers**: 21 probed request shapes (absent
content-type, JSON array/string/malformed bodies, `prompt` as number/array/File,
duplicate keys in both form encodings, charset-suffixed JSON) all refused with no
job and no provider call; `buildJobs.create` has exactly one call site; the
`renderPromptNotice` dedup is byte-identical at all five sites; no import cycle
(`restoration.ts` already reached `fragments.ts` through `cached-view.ts`, and both
new imports target the file rather than the `web/index.ts` barrel, which is what
*would* have closed one); deleting the guard fails four assertions in all five
encodings, so the battery is not tautological.

Three findings were fixed here:

- **The escaping had no coverage.** `renderPromptNotice` became the only place
  `#prompt-notice` text is escaped, and the deflection path feeds it the provider's
  `user_facing_label`. Deleting `escapeHtml` from it left the whole suite green.
  `src/web/fragments.test.ts` now pins the escaped output exactly.
- **The signed-off copy was not pinned.** Comparing the response body to
  `renderPromptNotice(BLANK_PROMPT_NOTICE)` compares the implementation to itself.
  The literal is now asserted in both `fragments.test.ts` and the route battery.
- **The provider-call assertion was vacuous.** The provider is only reached from
  `/build/:id/stream`, which the battery never opened, so the count read zero with
  or without the guard. Each case now opens the stream for the id the queue *would*
  have issued and asserts `done: missing` plus a zero call count, making it
  load-bearing. `required` on `#spec-build-prompt` is pinned by a test too.

Two findings are real but outside this issue's scope and are filed separately: a
prompt of only zero-width/control characters passes `String.trim()` and still
spends a call, and a malformed multipart body 500s out of `c.req.parseBody()`
(pre-existing) into an HTMX response that is silently dropped.

Both deferred findings were repaired by the Epic 4.8 release-readiness review in
`issues/10-release-readiness-review-and-hardening.md`. That follow-up also
strengthened media-type parsing and overlap-identity validation discovered by
the wider architecture/adversarial pass.

## HITL

1. `bun run dev`, open `http://localhost:3030`.
2. Press **Make it** with the prompt bar empty — the browser's own `required`
   blocks it. That guard is intact and is still the first line of defence.
3. Type a single space (or a tab) and press **Make it**. HTML5 validation passes,
   the server refuses.
4. Confirms the work: the line *"What would you like me to make?"*
   appears under the prompt bar, no build stream opens, the **Make it** button
   never reads "Making it", the field stays enabled, and the developer panel's
   preview panes stay empty — nothing was generated and no provider call was
   spent. Type a real prompt and the line clears on submit.

Note on focus: the field stays *live* by construction (`promptBusy` only flips on
`htmx:sseOpen`, and no subscriber fragment means no stream), so submitting with
Enter leaves the caret where it was. Submitting by clicking **Make it** with the
mouse leaves focus on the button — nothing refocuses the field after a refusal.
That is ordinary browser behaviour on an enabled field and was left alone; adding
a refocus is a UI decision this issue does not make.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.8-resolver-explicit-presenter-and-overlap/issues/04-remove-evolution-demo-surface.md

## Notes

Item 2 is pure test hygiene with no runtime effect and is safe to land first as a
warm-up. Item 1 touches the one route every other epic in this module depends on,
so keep its change surface to the admission check and leave `runPromptJob`
untouched — a blank prompt should never reach the pipeline at all, rather than be
filtered somewhere inside it.

Deliberately **not** in scope: the second deferred item from 4.8/04,
`src/pipeline/demo/spec-build-demo.ts`, which belongs to
`issues/08-remove-spec-build-demo-and-pre-resolver-standins.md`.
