# The model is shown the vocabulary of the data, and no semantic index is built

Status: ready-for-agent

## Epic

Module 6 — Reads Set Free · Epic 6.4 — What Aluna says
(PLAN decisions 18, 19; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

The loop is given the vocabulary of the user's data — what their values are
actually called — so it can write SQL that matches them. This is what lets *"how
much did I spend on groceries?"* find categories called food, cheese and
vegetables.

**`choice` fields declare their options in the registry already**
(`src/registry/fields/choice.ts`), so that vocabulary costs nothing and is
supplied as part of what the loop knows about the catalog before its first step.

**Small categorical string fields are enumerated by a bounded distinct read**,
which is one of the loop's ordinary steps rather than a new mechanism — the
`looking at what things are called` label 6.3/04 ships exists for exactly this
step. Bounded is the operative word: it is subject to 6.3/03's size cap like any
other step, and a field whose distinct set is not small refuses and the model
narrows.

**This is one person's app.** An expenses capability has perhaps fifteen
categories, ever, and the entire vocabulary of the user's data fits in a few
hundred tokens.

**Semantic storage is declined** (decision 19), and the decline is the deliverable
half of it. No embeddings, no vector index, no full-text index — the model already
knows "mother", "mum" and "mom" are one idea, and free reads exist so it can put
that knowledge into the query. An embedding would make this a write feature
wearing a read costume: computed on every save, recomputed on every edit, deleted
on every delete, rebuilt on evolution and swept on capability deletion through the
incarnation and tombstone machinery — a fourth derived artifact beside the
Handler, the renderer and the tests, with its own version key, its own lifecycle
recovery, its own coordinator traffic, and an AI call on the write path where the
speed thesis lives. If the cheap version proves insufficient in use, semantic
storage earns its own ADR and its own module; it does not arrive as an
implementation detail of this issue.

## Acceptance criteria

- [ ] The loop knows the active catalog's shape and its `choice` fields' declared
      options before its first step, read from the registry rather than by query
- [ ] A small categorical string field's values can be enumerated as an ordinary
      bounded loop step, under the same size cap as any other step
- [ ] A question whose wording does not match the stored values can still be
      answered by looking first — proved by a fixture where the asked word appears
      in no record
- [ ] Nothing is precomputed, stored or cached to support this: no embedding
      column, no vector or full-text index, no derived artifact, no write path
      touched
- [ ] A test proves the write path gained no AI call and the artifact set gained
      no member
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Headless; exercise through 6.3/01's developer-gated turn. Build Expenses, give the
records categories that do not literally read "groceries" — food, cheese,
vegetables — and drive a question about groceries. Watch the loop look at what
things are called before it totals anything. This is the plan's living-demo step 3
arriving early, without a surface.

## Blocked by

- modules/06-reads-set-free/6.3-the-loop/issues/04-every-step-carries-a-label-and-the-platform-owns-the-sentence.md
