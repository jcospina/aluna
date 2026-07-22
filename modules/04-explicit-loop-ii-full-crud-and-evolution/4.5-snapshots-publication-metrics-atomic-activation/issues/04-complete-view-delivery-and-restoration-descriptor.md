# Complete-View delivery and the restoration descriptor

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.5 — Incarnated
snapshots, publication, metrics, and atomic activation
(PLAN decision 29: `modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`;
ADR-0002 SSE conventions)

## What to build

One bounded complete-View delivery contract for every terminal build path.

- Before placing foreground generation in the content area, explicit work
  records a **data-free restoration descriptor** for the pre-build content
  (active capability id/incarnation, or the neutral empty surface).
- Activation sends one `commit` event containing the complete data-free View
  for the new spec; records reload through committed `read`. A new/separate
  capability appends a toolbar entry; evolution replaces it only when its
  label changes. `commit` remains reserved for real pointer activation and is
  attempted only after the success transaction commits.
- Every non-activating terminal path — `no_change`, stale/collision,
  cancellation, or failure — resolves the descriptor against the then-current
  registry and re-renders its canonical live View plus `read` result (or the
  neutral surface if it no longer resolves) through ADR-0002's existing
  `fragment` event, with no toolbar sidecar, then sends `done` with the
  appropriate outcome. Restoration clears search and closes any modal;
  ephemeral query/edit state is not preserved across foreground generation.
- A deterministic duplicate caught before narration or provider work may consume
  that same `fragment` as a true browser no-op only when the descriptor still
  matches an already-canonical View (idle search, closed create/modal state).
  Otherwise it follows the normal restoration path above.
- Terminal presenter work is bounded and cannot hold mutation ownership
  indefinitely: the active lease releases through `finally` whether delivery
  succeeds or fails. After activation, a missed/failed `commit` delivery
  leaves `success/activated` intact; normal shell/toolbar rehydration resolves
  the live pointer and recovers the UI. Before activation, terminal delivery
  failure is a presentation/transport failure on the non-activating path — not
  permission to publish.

## Acceptance criteria

- [x] Descriptor recorded before generation occupies the content area; failure
      paths restore the canonical committed View + `read` via `fragment` with
      search cleared and modal closed (plan acceptance)
- [x] `commit` only after the activation commit; non-activating paths never
      send `commit`
- [x] Plan acceptance: a disconnect/timeout after SQLite activation preserves
      the new pointer and `success/activated`, releases the lease, and a
      reload rehydrates the activated View from the registry
- [x] Toolbar behavior: append for new capability; replace only on label
      change
- [x] Presenter teardown bounded; lease release in `finally` on every path
- [x] `bun test` (headless SSE via fetch+ReadableStream), `bun run typecheck`,
      `bun run lint` clean

## Living demo

Start a build while viewing a capability, watch the foreground story, then see
either the one-shot complete View swap (success) or the canonical prior View
restored with search cleared (failure/cancel) — both live on the homepage.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.5-snapshots-publication-metrics-atomic-activation/issues/03-atomic-cross-store-activation-and-reconciliation.md

## Implementation notes

- Prompt admission captures only the validated active capability id/incarnation,
  or a neutral descriptor, before the build subscriber joins the content area.
  The subscriber stays dormant until narration proves foreground work has begun,
  so a deterministic no-op never displaces the active View. Other restoration
  paths still re-resolve that identity and reload through canonical `read`.
- Admission permits only one appended subscriber, clears the prior prompt notice,
  and keeps a truly neutral surface visually neutral while the stream is dormant.
  Empty terminal streams are removed; narration-only recovery keeps its wrapper.
- One bounded terminal presenter now owns metrics preview, developer evidence,
  narration, complete `commit`/`fragment`, and ADR-0002 `done` delivery. Its
  closing send gate prevents a timed-out write from unlocking later terminal
  events, and mutation ownership releases in the coordinator's `finally` path.
- The homepage subscriber offers an explicit connected **Cancel** action. A job
  owns its cancellation controller from enqueue time, so even Cancel-before-SSE
  preserves the restoration descriptor and completes through `fragment` then
  `done=error` rather than degrading to `missing`.
- On `done`, browser glue promotes a delivered complete View out of the build
  subscriber into the content area, or leaves the neutral surface genuinely
  empty. Search/edit state is replaced, the shared modal closes and resets, and
  narration-only post-activation recovery remains visible.
- Activation delivery is prepared only after the SQLite point of no return.
  Post-activation serialization, rendering, disconnect, and timeout failures use
  recovery without restoring the old View or relabelling lifecycle success.
- New capabilities append their canonical toolbar entry. Activation carries the
  prior label for evolution, so an unchanged label emits no sidecar and a changed
  label replaces exactly its existing entry.
- Non-activating resolver outcomes now leave one escaped, durable explanation in
  the prompt notice instead of flashing the same copy through two live regions.
  The deterministic Notes overlap says the place already exists, performs no
  provider work, and preserves the exact active View node without a redundant
  record read when that View is already canonical. Active search, create, or
  modal state still takes the normal clear-and-reload restoration path. The
  browser compares id, incarnation, and registry version before preserving, so a
  concurrent same-incarnation evolution cannot strand stale View markup.
- Connected cancellation sends the finalized `failed/cancelled` metrics snapshot
  before restoration, so the developer panel reflects the durable row rather
  than the earlier running preview. Its Cancel action is aligned to the right of
  the foreground build story.

## Verification record

Verified 2026-07-22 (America/Bogota):

- `bun test`: 652 passed, 0 failed; 2 snapshots and 3,007 expectations across
  65 files.
- `bun run typecheck`: passed.
- `bun run lint`: passed across 221 files.
- `bun run build`: passed; 304 modules bundled.
- `git diff --check`: passed.
- Focused complete-View, cancellation, terminal-presentation, activation,
  toolbar, and app checks passed. They include failure restoration through
  canonical `read`, connected and pre-stream cancellation, ADR-0002 outcome
  mapping, late-send suppression, and prior-label propagation.
- A production SSE disconnect immediately after `commit` leaves the registry
  pointer and lifecycle `success/activated`, releases that same build lease, and
  reloads the activated View from the registry. A separate post-activation
  payload-preparation fault stays on the recovery path with the same guarantees.
- Independent adversarial spec and standards reviews found and retested the
  pending-cancel race, terminal DOM promotion, wire vocabulary, bounded-send,
  post-activation, and toolbar seams; the final re-review reported no actionable
  findings.
- Regression trace against the existing `http://localhost:3030` captured the
  original fault: Notes became absent while the subscriber was present, then was
  rebuilt 26 ms later. After the fix, canonical Notes stays continuously visible,
  keeps the committed record, leaves no subscriber/restoration wrapper behind,
  and shows the explanation once. A non-idle View still restores canonically.
- Follow-up live check on the same server: `track my notes` left the manifest-backed
  record visible and showed `You already have Notes, so I didn't create another
  one.` exactly once. A distinct Reading list build showed Cancel at the right
  edge; after Cancel, Notes and its record returned and **Lifecycle & committed
  versions** showed `lifecycleStatus: failed` and `outcome: cancelled`.
- Independent adversarial follow-up exercised hostile stored labels, double live
  announcements, slow `fragment`/`done` spacing, canonical-read/search ownership,
  abort rejection handling, queued sibling admission, stale same-incarnation
  revisions, neutral/narration/commit-only surfaces, and empty terminal cleanup.
  The final standards and adversarial re-reviews found no actionable findings.

## HITL

1. Run `bun test src/app.complete-view-restoration.test.ts src/pipeline/terminal-presentation.test.ts src/builder/activation.test.ts`. The focused restoration, cancellation, timeout, point-of-no-return, and reload cases should all pass.
2. Keep the existing dev server on port 3030. If none is running, run
   `bun run dev` from the repository root; do not start a second port.
3. Open `http://localhost:3030`, choose **Notes**, and enter `track my notes` in
   the prompt bar. Notes should remain usable with its committed records visible,
   and the prompt bar should show `You already have Notes, so I didn't create
   another one.` once—without a flicker or a second live announcement.
4. With provider credentials configured, enter a distinct prompt such as
   `I want to track book loans`, then confirm **Cancel** is at the right edge and
   click it as soon as the foreground story appears. The prior complete View
   should replace the story with its records reloaded. Open the developer panel:
   **Lifecycle & committed versions** should show `lifecycleStatus: failed` and
   `outcome: cancelled`, not `running`.
5. Refresh after a successful build. The same activated capability and toolbar
   entry should rehydrate from the registry even though the developer preview is
   transient and may be empty.
