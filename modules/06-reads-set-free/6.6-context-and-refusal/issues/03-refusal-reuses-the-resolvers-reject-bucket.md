# A refusal reuses the resolver's `reject` bucket and speaks in the answer window

Status: ready-for-agent

## Epic

Module 6 — Reads Set Free · Epic 6.6 — Context and refusal
(PLAN decision 31; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

*"Delete everything"* already classifies as `reject`, and
`src/pipeline/build/admission/deflection.ts` already writes a warm line for it.
This issue routes that line into the answer window and proves the behaviour.

**No second classifier is built.** `docs/modules.md` is emphatic that this path
*is never the safety seam* — decision 6 is, and it lives at the SQLite connection
epic 6.2 opened. A second classifier would be a second thing to drift from the
resolver's own judgment, and it would invite the belief that refusing is what
keeps the user safe. Nothing added here may sit between a question and the loop as
a gate.

**The refusal is warm, and it is Aluna's** (ADR-0001). The existing `reject`
sentence is reused unchanged; this issue moves where it lands, not what it says.

**It behaves like every other answer window message.** One replaceable message, the
prompt preserved, focus kept, cleared on edit — 6.5/01's contract, applied to a
refusal that now arrives from the query path.

## Acceptance criteria

- [ ] A `reject`-classified prompt speaks its existing warm line in the answer window
- [ ] The sentence itself is unchanged from what `deflection.ts` writes today
- [ ] No new classifier, filter or rule sits between a question and the loop
- [ ] A refusal preserves the typed prompt and focus, and clears on edit
- [ ] A refused prompt opens no query scope, starts no worker and writes no
      metrics beyond the resolver row that already exists
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The plan's living-demo step 7. Type *"delete everything."* and read a friendly
refusal in the answer window. Confirm the prompt is still there to edit and that nothing
opened, ran or was written.

## Blocked by

- modules/06-reads-set-free/6.6-context-and-refusal/issues/02-where-would-this-live-the-loop-looks-before-it-says-there-is-no-home.md
