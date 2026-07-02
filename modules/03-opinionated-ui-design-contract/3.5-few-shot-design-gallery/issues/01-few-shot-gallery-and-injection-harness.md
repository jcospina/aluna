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

- [ ] 2–3 repo-only exemplars authored, each pairing an item composition with a
      suited `feed`/`grid` layout and obeying the closed-value contract; at
      least one exercises the token-disciplined inline-`style` escape hatch
- [ ] The injection harness feeds contract + gallery + the capability's
      `collection.layout` into the item-renderer prompt with "vary, don't copy"
      framing
- [ ] Exemplars are LLM-facing only and never rendered to the user
- [ ] Building two different capabilities yields visibly different item
      compositions (variety, not copying)
- [ ] Demo: the injected prompt is dev-previewable and generated capabilities show
      varied on-brand output; human visually confirms variety/quality before done

## Blocked by

- modules/03-opinionated-ui-design-contract/3.1-closed-value-contract-and-primitives/issues/01-closed-value-class-vocabulary-and-css.md
- modules/03-opinionated-ui-design-contract/3.4-one-item-renderer/issues/02-recut-unit-generation-item-renderer.md
