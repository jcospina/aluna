# Vendor the htmx SSE extension & finalize the event vocabulary

Status: ready-for-agent

## Epic

Module 2 — Explicit Loop I: Build Your First Capability · Epic 2.6 — Shell render
+ commit swap (`docs/modules.md` §2.6 note, ADR-0002 open questions + M2 update,
PLAN decision 4: `modules/02-explicit-loop-i-build-your-first-capability/PLAN.md`)

## What to build

The flagged spike: prove the client wire the product actually uses, **before**
anything relies on it. Module 1 proved SSE consumption via raw `EventSource` +
manual DOM only; the HTMX-driven swap path is affirmed but unproven (ADR-0002).

- **Vendor the htmx SSE extension** locally alongside the existing vendored
  statics (no CDN), loaded by the shell.
- **Prove the swap path**: against a small proving stream, demonstrate that a
  named SSE event drives a targeted swap into one shell region, and that
  `hx-swap-oob` over SSE updates a second region (the capability toolbar) out of
  band from the same response — the exact mechanism the commit swap needs.
- **Finalize the production event vocabulary.** Start from the seed (`narration`,
  `fragment`, `done`) plus whatever the commit swap needs; record the final
  vocabulary in ADR-0002 (update or supersede, per that ADR's own consequences).
  **Flag the ADR change explicitly for the owner's review** — this is the one
  durable design decision in the epic; the proving scaffold itself is disposable
  (the 1.3 pattern: the decision record outlives the demo).

## Acceptance criteria

- [ ] The htmx SSE extension is vendored locally and loaded by the shell
- [ ] Proven: an SSE event drives a targeted HTMX swap into a region, and
      `hx-swap-oob` over SSE updates the sidebar out-of-band in the same response
- [ ] The production event vocabulary is finalized and recorded in ADR-0002, and
      the ADR diff is explicitly flagged for owner review in the issue comment
- [ ] New client work rides HTMX; the raw `EventSource` path stays confined to
      Module 1's greeting stream
- [ ] Any proving scaffold is clearly marked disposable or already removed

## Blocked by

None - can start immediately
