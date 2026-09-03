# The content-free metrics row gains step count and duration

Status: ready-for-agent

## Epic

Module 6 — Reads Set Free · Epic 6.6 — Context and refusal
(PLAN decision 33, which measures what decision 8 — epic 6.3's — guessed at;
ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

`data_query` already writes a best-effort row to `intent_resolution_metrics`
(`src/platform/metrics/intent-resolution-store.ts`, ARCH §6.3) carrying no
content. It gains two fields: **turns taken** and **wall-clock elapsed**.

**It stays content-free.** No prompt, no SQL, no results, no capability names, no
column names — nothing about the user's data. Two integers. The row is the same
kind of row it already is, and a test proves the added fields cannot carry text.

**It answers the one question decision 8 guessed at.** Ten steps was chosen as a
budget a real question never approaches, on a PoC whose capabilities and questions
are simple. This measurement is what will say whether ten was generous or tight,
and it is the only way anyone will ever know.

**Latency is explicitly part of this PoC's thesis, and Module 9 is the customer.**
The elapsed number is wall-clock across the whole question — the thing the user
waited through — not a sum of step times.

**Best-effort stays best-effort.** Completion never waits for this write, and
losing it in a crash implies nothing about the answer the user received.

## Acceptance criteria

- [ ] The `data_query` metrics row carries turns taken and wall-clock elapsed
- [ ] Both are numeric, and no free text, SQL, prompt, result or capability name
      can reach the row — proved by a test over the stored shape
- [ ] Elapsed is measured across the whole question, not summed per step
- [ ] A cancelled and a budget-exhausted question each write a row saying what
      they cost
- [ ] The write stays best-effort: an answer is delivered whether or not it lands
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Ask two questions on `:3030` — a quick one and one that takes several steps — then
read the rows back from `intent_resolution_metrics`. The step counts differ, the
durations differ, and neither row says anything about what was asked or found.
That last part is the one to check by eye.

## Blocked by

- modules/06-reads-set-free/6.6-context-and-refusal/issues/03-refusal-reuses-the-resolvers-reject-bucket.md
