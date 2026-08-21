# Every swap target fails loudly, and the client guarantees the named target exists

Status: ready-for-agent

## Epic

Module 5 — The Desk · Epic 5.3 — Content-region lifecycle and loud swap targets
(PLAN decision 16; ADR-0002: `modules/05-the-desk/PLAN.md`)

## What to build

ADR-0002's transport contract survives intact: `commit` and `fragment` keep
addressing a stable id, and the client guarantees that id is present whenever a
swap can be in flight. What changes is that a missing target stops being silent.

- Page assembly composes every full page by replacing literal strings in the
  shipped HTML. Three of those replacements throw when their anchor is missing.
  The fourth — the `class="shell"` swap — fails silently, leaving a page that
  looks assembled and is not. It throws like the other three.
- A `commit` or `fragment` arriving mid-teardown either finds its named target or
  fails loudly. Silence is the one outcome that is not allowed, because a swap
  that lands nowhere is indistinguishable from a build that produced nothing.
- 5.3/01 supplies the other half of the promise: content that goes away cancels
  what it started, so nothing can arrive at a destroyed region in the first
  place. This issue makes the residual case audible rather than assuming it away.

## Acceptance criteria

- [ ] The `class="shell"` swap throws on a missing anchor, like the other three
      replacements
- [ ] A `commit` or `fragment` arriving mid-teardown finds its named target or
      raises; neither path can complete silently
- [ ] Each of the four page-assembly anchors has a test that removes it and
      asserts the throw
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Not user-visible on its own. A developer preview forces each missing-anchor case
and shows the raised error rather than a half-assembled page, which is what the
window's teardown path will rely on from 5.6 onward.

## Blocked by

- modules/05-the-desk/5.3-content-region-lifecycle/issues/01-the-content-region-owns-cleanup.md
