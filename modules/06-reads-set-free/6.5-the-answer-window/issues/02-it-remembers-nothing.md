# It remembers nothing

Status: ready-for-agent

## Epic

Module 6 — Reads Set Free · Epic 6.5 — The answer window
(PLAN decisions 21, 26; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

The answer window is the one window with no memory of any kind. Everything below follows
from that single rule, and the rule is what makes "disposable" true at the surface rather
than only in the storage layer.

- **No logo, no tile, no address.** A capability window can be put away because its logo
  is the way back; the developer panel has its own tile. An answer window has neither, so
  there is no route to an answer that is not on screen. Nothing about it appears in the
  logo layer, and no address names it.
- **Dismissing it destroys the answer.** It uses `dismissWindow`, never `putAway` — the
  vocabulary difference is real and should be honoured in code and in any copy. Put away
  means retrievable; this is not.
- **A reload restores nothing of it** — not the answer, not the narration, and not its
  box. No answer window stands after a reload, whatever was on screen before. Note this
  is not in tension with 6.5/01: the frame keeps its place *across questions* because it
  never closes, not because anything was written down.
- **Nothing reaches storage.** No answer text, narration line, query, or result is written
  to the server, `localStorage`, the address, or a presentation record. The store's two
  existing keyed records — the capability window's and the developer panel's — are
  untouched, and no third key is added.
- **Future persistence is explicitly out of scope.** No history of past answers, no
  reopen, no "recent questions", and no groundwork laid for them. If persistence is ever
  wanted it earns its own decision; this issue must not half-build it.
- **The capability window and the developer panel keep their own persistence exactly as
  they have it.** This issue changes nothing about either.

## Acceptance criteria

- [ ] No logo, tile, or address for the answer window exists anywhere on the desk
- [ ] The window is dismissed via `dismissWindow`; `putAway` is never called for it
- [ ] Dismissing leaves no route back to the answer, by any surface or address
- [ ] A reload restores no answer window, no answer, and no box for it
- [ ] No answer text, narration, query, or result reaches the server, `localStorage` or
      the address — proved by a test, not by inspection
- [ ] The presentation store still holds exactly two keyed records, unchanged
- [ ] Opening and putting away a capability leaves the answer window untouched
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Ask a question and get an answer. Look at the desk: no new logo, nothing in the logo
layer, no address you could bookmark. Dismiss the window and confirm there is no way to
bring that answer back. Ask another question, then reload — the desk returns with no
answer window at all. Open Notes and put it away throughout; the answer window is never
disturbed by either.

## Blocked by

- modules/06-reads-set-free/6.5-the-answer-window/issues/01-the-answer-window-opens-beside-what-is-standing.md
