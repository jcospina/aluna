# Few-shot design gallery + injection harness

Status: ready-for-agent

> **HITL — human visual sign-off required.** The exemplars steer every generated
> UI; their taste and the resulting variety must be judged by a human eye. A
> human confirms that two different capabilities come out visibly different and
> on-brand on the running app before this issue is done.

## Epic

Module 3 — Opinionated Capability UI · Epic 3.5 — Few-shot design gallery
(`docs/modules.md` §3.5, ADR-0005 §5, PLAN decision 6:
`modules/03-opinionated-ui-design-contract/PLAN.md`)

## What to build

A curated, **repo-only** few-shot gallery of 2–3 deliberately different
**item renderer** exemplars, each pairing an item composition with the collection
layout it suits (e.g. text-forward cards in a `feed`, media tiles in a `grid`,
compact metadata rows in a `feed`), all obeying the closed-value contract while
composing differently — plus the injection harness that feeds the contract +
gallery + the capability's chosen `collection.layout` into the item-renderer
prompt with explicit *"vary, don't copy"* framing. **LLM-facing only — never
rendered to the user.** No runtime "read the design system" tool (ADR-0005 §5).

- Author 2–3 exemplars against the 3.1/01 vocabulary; each is a valid item
  renderer that would clear the contract and the design-lint rung. At least one
  exemplar demonstrates the token-disciplined inline-`style` escape hatch
  (ADR-0005 §4 as amended 2026-07-01), so the model learns the hatch exists and
  what disciplined use looks like.
- Injection harness: assemble contract + gallery + chosen `collection.layout` into
  the item-renderer generation prompt (3.4/02), framed "vary, don't copy".

## Acceptance criteria

- [x] 2–3 repo-only exemplars authored, each pairing an item composition with a
      suited `feed`/`grid` layout and obeying the closed-value contract; at
      least one exercises the token-disciplined inline-`style` escape hatch
- [x] The injection harness feeds contract + gallery + the capability's
      `collection.layout` into the item-renderer prompt with "vary, don't copy"
      framing
- [x] Exemplars are LLM-facing only and never rendered to the user
- [ ] Building two different capabilities yields visibly different item
      compositions (variety, not copying)
- [ ] Demo: the injected prompt is dev-previewable and generated capabilities show
      varied on-brand output; human visually confirms variety/quality before done

## Blocked by

- modules/03-opinionated-ui-design-contract/3.1-closed-value-contract-and-primitives/issues/01-closed-value-class-vocabulary-and-css.md
- modules/03-opinionated-ui-design-contract/3.4-one-item-renderer/issues/02-recut-unit-generation-item-renderer.md

## Implementation notes

Code complete 2026-07-09. Automated verification is green; human visual sign-off
is still pending.

- `src/builder/few-shot-gallery.ts` adds three repo-only item-renderer exemplars:
  a text-forward `feed`, a media-forward `grid`, and a compact metadata `feed`.
  The compact metadata example demonstrates the inline `style` escape hatch while
  keeping gap, padding, color, border width, and border color on tokens.
- 2026-07-09 visual iteration after HITL feedback: the text-forward example now
  gives source/tag metadata color-backed chips, the media-forward grid tile uses
  a larger square media frame with accent border/shadow and stronger captioning,
  and the compact metadata row gives its priority chip a warmer token treatment.
- Follow-up Browser refinement: the media frame now zeroes the native `figure`
  margin so it stays inside the card, and the compact metadata row uses a compact
  info-topic chip plus a warmer accent-token `later` chip instead of the dark blue
  secondary treatment.
- 2026-07-09 richness iteration: each exemplar now renders two preview records,
  so the media-forward example shows a real two-item grid and the feed examples
  show multiple rows without changing the LLM-facing renderer source shape.
- `src/builder/unit-prompts.ts` now routes item-renderer generation through the
  gallery injection harness. The prompt includes the closed primitive class list,
  inline-style discipline, the chosen `collection.layout`, and explicit
  "Vary, don't copy" framing before the capability spec JSON.
- `src/builder/few-shot-gallery-preview.ts` adds the deterministic developer
  preview served at `/demo/few-shot-gallery`. It renders the same sample
  exemplars through the real presentation adapter, runtime enforcer, item
  wrapper, collection container, detail templates, and shared modal. It also
  shows the exact feed/grid prompt injection sections.
- The examples are not mounted in the product shell and are not fetched from a
  runtime design-system tool. They are repo-owned generation context plus a
  `/demo/*` developer preview for HITL inspection.

## Verification

- `bun test src/builder/units.test.ts` — 12 pass / 0 fail.
- `bun test src/app.test.ts` — 35 pass / 0 fail.
- `bun run typecheck` — clean.
- `bunx biome check src/app.ts src/app.test.ts src/builder/few-shot-gallery.ts src/builder/few-shot-gallery-preview.ts src/builder/unit-prompts.ts src/builder/units.test.ts` — clean.
- `bun test` — 343 pass / 0 fail.
- `git diff --check` — clean.
- Existing server on `:3030`: `GET http://localhost:3030/demo/few-shot-gallery`
  returned `200` and included all three exemplars, feed/grid collection output,
  the "Vary, don't copy" prompt preview, and the shared detail modal.
- In-app browser render check: opened `/demo/few-shot-gallery`, confirmed the
  three example headings and `feed/grid/feed` layout classes, clicked the
  research-note item, and verified the shared modal opened with title
  `Research notes` and the sample record details.
- HITL feedback iteration check: reran `bun test src/builder/units.test.ts`,
  `bun test src/app.test.ts`, `bun run typecheck`,
  `bunx biome check src/app.ts src/app.test.ts src/builder/few-shot-gallery.ts src/builder/few-shot-gallery-preview.ts src/builder/unit-prompts.ts src/builder/units.test.ts`,
  and `git diff --check`; all passed.
- Browser visual check after the feedback iteration: reloaded
  `http://localhost:3030/demo/few-shot-gallery`, confirmed the source/tag chips
  render with token color fills, the media frame no longer overflows its card
  (`mediaOverflowsItem: false`, 17px inset on each side at the current viewport),
  the compact topic chip no longer stretches across the row, and the `later` chip
  uses the warmer accent-token fill/shadow instead of the dark blue secondary
  treatment.
- Two-sample richness iteration check: reran `bun test src/builder/units.test.ts`,
  `bun test src/app.test.ts`, `bun run typecheck`,
  `bunx biome check src/app.ts src/app.test.ts src/builder/few-shot-gallery.ts src/builder/few-shot-gallery-preview.ts src/builder/unit-prompts.ts src/builder/units.test.ts`,
  `git diff --check`, and `GET http://localhost:3030/demo/few-shot-gallery`; all
  passed, and the route now renders six wrapped preview items.
- Browser check after the two-sample iteration: the preview renders two
  research-note items, two photo-grid items, and two saved-link items; both photo
  frames remain contained (`mediaOverflow: [false, false]`), and the second photo
  sample opens the shared detail dialog with its own record details.

## HITL test instructions

1. Start or reuse the app: `bun run dev` (the existing `:3030` Bun server is fine).
2. Open `http://localhost:3030/demo/few-shot-gallery`.
3. Inspect the three examples: text-forward feed, media-forward grid, and compact
   metadata feed. Click each rendered item and confirm the shared read-only modal
   opens with the sample record details.
4. Inspect the feed/grid prompt preview blocks and confirm the injected contract
   includes the class vocabulary, inline-style discipline, selected
   `collection.layout`, and "Vary, don't copy" framing.
5. For final visual sign-off, run `bun run reset`, build two different
   capabilities from `/` (for example notes/links and a visual collection), add
   records to each, and confirm the generated item compositions are visibly
   different while staying on-brand. Leave this issue pending until that human
   sign-off is complete.
