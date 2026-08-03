# Refuse a blank prompt before the resolver, and retire a vestigial control assertion

Status: ready-for-agent

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

- [ ] `POST /prompt` with an empty or whitespace-only `prompt` creates no build
      job, opens no SSE stream, and makes **zero** provider calls — asserted with
      a fake provider whose call count is checked, not merely with a status code
- [ ] That refusal answers 200 carrying only the
      `id="prompt-notice" hx-swap-oob="innerHTML"` fragment, so HTMX swaps it and
      the person sees a warm line
- [ ] The refusal is proven for all three body encodings `readPromptSubmission`
      accepts (JSON, urlencoded/multipart form, raw text), since the guard must
      not live in one branch of the parser
- [ ] A non-blank prompt is completely unaffected: the existing `/prompt` →
      `/build/:id/stream` batteries stay green with no changes to their
      expectations
- [ ] `required` on `#spec-build-prompt` is still present — the server guard is
      defence in depth, not a replacement for it
- [ ] `activation.test.ts` no longer references `developer-evolution-control`,
      and the surviving assertion states the property it proves
- [ ] `grep -rn "developer-evolution-control" src/ public/` returns nothing
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Pressing **Make it** on an empty prompt bar answers in Aluna's voice instead of
opening a build that had nothing to build — and costs nothing to say so.

## Sign-off gate (HITL)

The notice copy is product voice, so it is the user's call, not the agent's.
Implement the proposed line, then show it in place and confirm the wording before
marking this done. Everything else in the issue is decided.

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
