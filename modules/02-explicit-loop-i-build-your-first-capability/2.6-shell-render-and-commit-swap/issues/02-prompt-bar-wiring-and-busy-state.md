# Prompt bar wiring & courtesy busy state

Status: ready-for-agent

## Epic

Module 2 — Explicit Loop I: Build Your First Capability · Epic 2.6 — Shell render
+ commit swap (`docs/modules.md` §2.6, PLAN decisions 4 & 7 + flow step 1:
`modules/02-explicit-loop-i-build-your-first-capability/PLAN.md`, CONTEXT.md
"Prompt bar", "Shell")

## What to build

Make the inert prompt bar real — the moment typed intent starts reaching the
orchestrator.

- **Submit → job → stream.** Submitting the prompt bar posts the prompt; the
  returned subscriber fragment is swapped in via the proven htmx SSE mechanism,
  and the shell follows the job's stream — narration renders into the content
  area as it arrives, in product voice ("watch the UI build itself").
- **Courtesy busy state** (PLAN decision 7): while a stream is active the prompt
  bar shows a busy presentation state, and wakes on `done` (both outcomes).
  This is Alpine presentation state **only** — the shell stays dumb: no
  client-side queueing, no thresholds, no retry logic. The server remains the
  single-flight enforcer.
- **Busy refusal placement.** When the server refuses a second prompt with its
  "one moment" notice, that notice renders in the transient notice spot — never
  the content area, so the running build's narration stays intact.

## Acceptance criteria

- [ ] Submitting posts the prompt, swaps in the subscriber fragment, and
      narration streams into the content area via HTMX (not the M1 raw
      `EventSource` path)
- [ ] The prompt bar shows its busy state during an active stream and wakes on
      `done`, success or failure
- [ ] The server's busy refusal renders in the transient notice spot; the
      running narration is untouched
- [ ] No logic beyond presentation state lives in the shell
- [ ] All visible copy is product voice (CONTEXT.md), including the existing
      placeholder

## Blocked by

- modules/02-explicit-loop-i-build-your-first-capability/2.5-capability-builder-and-build-queue/issues/01-build-job-single-flight-queue-and-busy-refusal.md
- modules/02-explicit-loop-i-build-your-first-capability/2.6-shell-render-and-commit-swap/issues/01-htmx-sse-extension-and-event-vocabulary.md
