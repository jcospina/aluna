# Prompt bar wiring & courtesy busy state

Status: done

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

- [x] Submitting posts the prompt, swaps in the subscriber fragment, and
      narration streams into the content area via HTMX (not the M1 raw
      `EventSource` path)
- [x] The prompt bar shows its busy state during an active stream and wakes on
      `done`, success or failure
- [x] The server's busy refusal renders in the transient notice spot; the
      running narration is untouched
- [x] No logic beyond presentation state lives in the shell
- [x] All visible copy is product voice (CONTEXT.md), including the existing
      placeholder

## Blocked by

- modules/02-explicit-loop-i-build-your-first-capability/2.5-capability-builder-and-build-queue/issues/01-build-job-single-flight-queue-and-busy-refusal.md
- modules/02-explicit-loop-i-build-your-first-capability/2.6-shell-render-and-commit-swap/issues/01-htmx-sse-extension-and-event-vocabulary.md

## Implementation notes

- Wired the homepage prompt bar as an HTMX form: `hx-post="/prompt"` targets the
  content-area output, so an accepted prompt swaps in the server-rendered
  per-build subscriber fragment immediately.
- Removed the old browser-owned `fetch("/prompt")` + raw `EventSource` prompt
  path from `public/app.js`. HTMX now owns prompt submission and the
  `htmx-ext-sse` stream. The remaining browser glue only mirrors HTMX/SSE
  lifecycle into Alpine's `promptBusy` presentation state and renders
  developer-preview payloads as plain text in the developer panel.
- Follow-up browser fix: the first pass used camel-case Alpine listener
  attributes for `htmx:sseOpen`/`htmx:sseClose`, but the browser lowercases
  HTML attribute names before Alpine sees them. The exact HTMX event listeners
  now live in `public/app.js`, where their case is preserved; the in-app browser
  confirms the button changes to `Making it` during the stream and wakes on
  `done`.
- Expanded the subscriber fragment to listen for `narration`, `fragment`, and
  the developer preview events through HTMX SSE. Accepted prompts also clear the
  transient notice and stale developer previews out of band.
- Kept server busy refusal placement unchanged: `/prompt` still retargets
  `#prompt-notice` with `HX-Retarget`/`HX-Reswap`, leaving the active content
  narration untouched. The shell disables the controls only as courtesy
  presentation while the stream is open; the server remains the single-flight
  authority.
- Removed the cold-start prefilled prompt value so the product-voice placeholder
  is the visible prompt guidance. Busy copy now reads "Making it"; the existing
  busy notice stays product voice.

## Verification

- `bun test src/app.test.ts`
- `bun run typecheck`
- `bun test`
- `bunx biome check public/index.html public/app.js public/css/prompt.css src/web/fragments.ts src/app.test.ts`
- `git diff --check`
- Browser plugin live check on `http://localhost:3030/`: submitting a prompt
  made the form `aria-busy="true"`, disabled the prompt controls, changed the
  button to `Making it`, streamed narration into the content area, then returned
  to `Make it` with controls enabled after `done`.

## HITL test instructions

1. Run `bun run dev` and open `http://localhost:3030/`. If 3030 is already in
   use, run `PORT=3031 bun run dev` and open `http://localhost:3031/`.
2. Type `I want to keep track of my notes` in the prompt bar and submit with
   **Make it**.
3. Confirm the prompt bar changes to its busy presentation (`Making it`,
   controls disabled) while the stream is active, then wakes when the stream
   sends `done`.
4. Confirm product-voice narration appears in the content area through the HTMX
   subscriber. Open the developer panel with `</>` to see the raw preview blocks
   update as the build progresses.
5. Optional busy-refusal check: while a build is active, send a second
   `POST /prompt` from DevTools or curl. The "one moment" notice should appear
   under the prompt bar in `#prompt-notice`, and the running narration in the
   content area should remain unchanged.
