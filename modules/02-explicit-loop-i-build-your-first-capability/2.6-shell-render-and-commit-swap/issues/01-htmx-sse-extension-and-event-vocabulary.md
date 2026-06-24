# Vendor the htmx SSE extension & finalize the event vocabulary

Status: ready-for-human

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

- [x] The htmx SSE extension is vendored locally and loaded by the shell
- [x] Proven: an SSE event drives a targeted HTMX swap into a region, and
      `hx-swap-oob` over SSE updates the sidebar out-of-band in the same response
      — proven at the **wire** by automated tests, and at the **DOM** in a real
      browser during 2.6a (verified working; the proving scaffold has since been
      removed — see notes)
- [x] The production event vocabulary is finalized and recorded in ADR-0002, and
      the ADR diff is explicitly flagged for owner review in the issue comment
      (see **Comments** below)
- [x] New client work rides HTMX; the raw `EventSource` path stays confined to
      Module 1's greeting stream (the `/demo/spec-build` EventSource demo is
      pre-existing 2.5b scaffolding, slated for removal in 2.6b/2.6c — noted, not
      expanded)
- [x] Any proving scaffold is clearly marked disposable or already removed

## Blocked by

None - can start immediately

## Implementation notes

- **Vendored:** `htmx-ext-sse` 2.2.4 (htmx-2.x line; peer `htmx.org ^2.0.2`,
  matching the vendored htmx 2.0.10) at `public/vendor/htmx-ext-sse.min.js`. The
  npm tarball's published sha512 integrity was verified before extracting
  `dist/sse.min.js`. Loaded by the shell right after `htmx.min.js`
  (`public/index.html`) — order matters: the extension calls
  `htmx.defineExtension` at load.
- **Proving scaffold (now removed):** a disposable scaffold proved the wire in a
  real browser, then was deleted once the proof held and the vocabulary was
  recorded (the 1.3 pattern; ADR-0002 consequences). It was: `/demo/swap-proof/*`
  routes + `renderSwapProof*` (`src/app.ts`), a `.swap-proof` `<section>`
  (`public/index.html`) + CSS block (`public/app.css`), and two wire tests. The
  `commit` event carried the targeted content fragment **and** an `hx-swap-oob`
  toolbar sidecar in one response; the live commit swap is re-exercised by the
  real flow in 2.6c.
- **Finalized vocabulary → ADR-0002** ("Update (Epic 2.6a …)"): `narration`,
  `fragment`, **`commit`** (new), `done`; `heartbeat` stays transport-only.
- **Finding fixed in the production wire (durable):** `htmx-ext-sse` wraps a
  native `EventSource` that auto-reconnects on a server-closed stream, so the
  per-build subscriber needs `sse-close="done"` or the build re-runs.
  `renderBuildSubscriber` (`src/app.ts`) sets it; covered by an assertion in
  `src/app.test.ts`.

What stays in the codebase from 2.6a: the vendored extension + its `<script>`
load, and the `sse-close="done"` fix. The scaffold is gone.

Verification commands:

```
bun run typecheck
bunx biome check public/index.html public/app.css src/app.ts src/app.test.ts
bun test src/app.test.ts      # 17 pass
bun test                      # full suite: 123 pass
```

## HITL test instructions

The browser swap proof was performed and verified working during 2.6a; its
scaffold has since been removed, so there is no longer a button to click. What
remains re-runnable today:

1. `bun test` — full suite green (123), incl. the `sse-close="done"` assertion on
   the production subscriber fragment.
2. Start the app (`bun run dev`) and open `http://localhost:3030/`; view source /
   DevTools → Network and confirm `/static/vendor/htmx-ext-sse.min.js` loads
   (200, after `htmx.min.js`). The homepage shows the existing spec-build demo
   only — the swap-proof panel is intentionally gone.

The end-to-end commit swap (content + toolbar from one SSE response, in the live
shell) is re-exercised by the real prompt → build flow that 2.6b/2.6c assemble.

## Comments

**⚠️ ADR-0002 change flagged for owner review.** This issue finalizes the
production SSE event vocabulary — the one durable decision in epic 2.6 — and
records it in `docs/adr/0002-sse-transport-conventions.md` under
"Update (Epic 2.6a — event vocabulary finalized; htmx swap path proven)". Please
review before 2.6c builds the real commit swap on it. The diff is small and
deliberate:

- **One new event name: `commit`** — the terminal success swap (targeted content
  swap + `hx-swap-oob` toolbar update, one response). The seed names `narration`
  and `fragment` are kept; `fragment` is reserved for M3's per-unit diff
  streaming. Considered and rejected: overloading `fragment` for the commit —
  rejected because the view region (`innerHTML`) and the narration region
  (`beforeend`) need distinct `sse-swap` names anyway, so a dedicated `commit` is
  clearer and free.
- **`done` client contract sharpened:** under htmx the subscriber must carry
  `sse-close="done"` (the native-EventSource reconnect finding). No event added;
  the client binding is now explicit.
- **No dedicated error event** — failures ride `narration` + `done`(`error`),
  matching `build-jobs.ts`.

If you'd prefer a different name for `commit`, or want failures to carry their own
event, it's a small change to make now (one route + the ADR table) versus after
2.6c depends on it.
