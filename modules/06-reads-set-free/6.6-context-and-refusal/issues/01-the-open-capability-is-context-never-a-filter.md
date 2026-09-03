# The open capability is context, never a filter, and the scope rides in the sentence

Status: ready-for-agent

## Epic

Module 6 — Reads Set Free · Epic 6.6 — Context and refusal
(PLAN decisions 28, 29; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

The capability in the window resolves vague references and nothing else.

**It is context** (decision 28). *"these"*, *"ones"*, *"how many did I add"* —
the open capability is what those words point at, exactly as it already does for
evolution in `src/pipeline/intent/resolver.ts`. `data_query` already permits a
non-null `target_capability` in `src/pipeline/intent/schema.ts`, so this is mostly
letting existing, tested machinery through rather than building new machinery.

**It is never a filter.** A question about expenses asked with Recipes open is
answered about expenses. The open window narrows what a pronoun means; it never
narrows what may be searched, and a question that names its own subject ignores it
entirely.

**Scope is stated in the answer, not shown as a control** (decision 29). No scope
chip, badge or pill appears on the prompt bar or anywhere else. *"Of your recipes,
six use butter"* carries the scope in ordinary English, so a mis-scoped answer is
visible at once and a correctly scoped one reads as speech. 6.4/03 already
requires the sentence to say what she looked at, so this costs nothing extra —
what this issue owes is the proof, and the absence of the control.

## Acceptance criteria

- [ ] A vague question asked with a capability open resolves against that
      capability and says so in the answer
- [ ] The same question asked with nothing open is answered across the catalog
- [ ] A question naming a different subject is answered about that subject, with
      the open capability ignored — proved by asking about expenses with Recipes
      open
- [ ] No scope chip, badge, pill or any other control appears on the prompt bar or
      the answer window
- [ ] The resolver is not extended for this; `target_capability` on a `data_query`
      is consumed as it already exists
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The plan's living-demo step 5. Open Recipes (or Notes) and ask *"how many did I
add this month?"* — she scopes to the open capability and says so in the sentence.
With that window still open, ask about expenses; she answers about expenses, not
about what is on screen. Confirm nothing on the prompt bar shows a scope.

## Blocked by

- modules/06-reads-set-free/6.5-the-answer-window/issues/04-a-query-does-not-lock-the-prompt-bar.md
