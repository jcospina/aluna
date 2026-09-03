# Every step carries a label from a closed vocabulary, and the platform owns the sentence

Status: ready-for-agent

Type: HITL — the narration is authored product voice, one sentence per label, and
these are the words Aluna says while she works. Implementation is fully specified
and agent-ready; a human reads every sentence before sign-off.

## Epic

Module 6 — Reads Set Free · Epic 6.3 — The loop
(PLAN decision 14; decision 15's never-machinery rule belongs to epic 6.5 and is
honoured here at the source, where the sentences are written; ADR-0001's product
voice: `modules/06-reads-set-free/PLAN.md`)

## What to build

The tool call gains a second field beside its SQL: a **label drawn from a closed
vocabulary**, and the platform owns the sentence for each label.

**The closed set is decision 14's**: looking at what things are called, counting,
totalling, listing, checking dates, and a generic fallback. This is the house
pattern — closed token defaults with a disciplined escape hatch — already used for
the field vocabulary and the logo prompt, and the fallback is the escape hatch. A
label outside the set is rejected the way any out-of-vocabulary token is; the
model does not get to extend it by writing something new.

**The model picks the kind of step. It never writes the words.** It cannot invent
progress, cannot report a number it has not computed, and cannot narrate in words
that are not Aluna's.

**The narration is product voice, never machinery** (decision 15). She says
*"seeing what you call things"*. No SQL, no table name, no column, no error
string, no step count, no percentage, no *step 3 of 10* — the moment SQL appears
on screen Aluna is an engineering tool, and §9.7 says she is never one. Prove it
with a sweep, not with care: a test that drives the loop through every label,
through a failed statement and through an over-size refusal, and asserts nothing
resembling machinery is emitted on any of those paths.

**The narration is produced here and rendered in 6.5.** This issue emits the
sentences and pins them; 6.5/03 streams them into the answer window over the existing
per-job stream (ADR-0002).

## Acceptance criteria

- [ ] Every tool call carries a label, and the loop rejects a call whose label is
      outside the closed set
- [ ] Each label has exactly one platform-authored sentence, and the model
      supplies none of the text
- [ ] The closed set covers decision 14's kinds of step and a generic fallback
- [ ] A sweep across every label, a failed statement, an over-size refusal and a
      spent budget emits no SQL, table name, column, error string or step count
- [ ] No sentence reports a number that no step computed
- [ ] Every sentence is in Aluna's voice per ADR-0001, and reads as speech rather
      than status
- [ ] **Sign-off gate:** the human has read every sentence in the vocabulary,
      including the fallback and the spent-budget ending
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Headless; the sentences reach a surface in 6.5/03. Exercise them through 6.3/01's
developer-gated turn, which should now show the narration a real question would
produce, so the words can be read before there is an answer window to read them in.

## Blocked by

- modules/06-reads-set-free/6.3-the-loop/issues/03-the-size-cap-refuses-and-the-loop-narrows.md
