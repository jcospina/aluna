# Aluna says what she looked at before she says what she found

Status: ready-for-agent

Type: HITL — the answer is authored product voice and it is the sentence the whole
module exists to produce. Implementation is fully specified and agent-ready; a
human reads real answers before sign-off.

## Epic

Module 6 — Reads Set Free · Epic 6.4 — What Aluna says
(PLAN decision 16; decision 3's no-table rule belongs to epic 6.5 and constrains
the shape of the answer built here; ADR-0001's product voice:
`modules/06-reads-set-free/PLAN.md`)

## What to build

The answer states what she looked at before it states what she found — not the
SQL, its meaning: *"looking at your expenses from last month, under groceries…"*.

**This is the receipt.** Deleting the table (decision 3) deleted the user's way of
checking her work, and the restatement is the honest replacement — a better one,
because it shows what she **decided** rather than what she retrieved. A user who
reads "under groceries" and calls those Food catches the mistake instantly, and
correcting her costs nothing, because the whole answer is disposable and the same
question asked again runs again.

**It carries the scope at no extra cost.** Decision 29 asks for scope in ordinary
English rather than as a chip or a badge, and a sentence that already says what
she looked at has said it. 6.6/01 proves that case; this issue is what makes it
free.

**The answer is prose in Aluna's voice, with bullets where a sentence would be a
list** (decision 3). There is no table, no chart, no export and no column header
anywhere on this path — a one-cell table with a `count(*)` header is a spreadsheet
apologising for itself, and §9.7's *friendly app, never an engineering tool*
forbids it.

**The restatement is meaning, never machinery.** It names the capability and the
values in the user's own words. It never contains a table name, a column, an
operator or a step count — the same rule 6.3/04 holds the narration to, held here
for the answer.

## Acceptance criteria

- [ ] Every answer states what was looked at — which capability and which values —
      before it states what was found
- [ ] The restatement uses the user's words for their data, and contains no table
      name, column, SQL fragment, operator or step count
- [ ] The answer renders as prose, with bullets only where a sentence would be a
      list; no table, chart, export or column header exists on this path
- [ ] A wrong restatement is visible in the sentence itself — proved by a fixture
      where the model picks the wrong categories and the answer says which it used
- [ ] Asking the same question twice produces two answers and reuses nothing
- [ ] **Sign-off gate:** the human has read real answers to at least a count, a
      total and a cross-capability question, and confirms they read as speech
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Headless; exercise through 6.3/01's developer-gated turn until 6.5 gives it a
surface. Ask *"how much did I spend on groceries?"* against expenses whose
categories are food, cheese and vegetables, and read the answer: it should say
which categories it counted before it says the number. Then correct it and ask
again.

## Blocked by

- modules/06-reads-set-free/6.4-what-aluna-says/issues/02-sql-computes-and-the-model-only-finds-the-words.md
