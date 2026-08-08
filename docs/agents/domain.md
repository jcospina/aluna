# Domain docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- `CONTEXT.md` at the repo root, or
- `CONTEXT-MAP.md` at the repo root if it exists — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- `docs/adr/` — read the ADRs that touch the area you are about to work in. In multi-context repos, also check `src/<context>/docs/adr/` for context-scoped decisions.

If any of these files don't exist, proceed silently. Do not flag the absence, and do not suggest creating them upfront. The producer skill (`/grill-with-docs`) creates them lazily, when a term or a decision actually gets resolved.

## File structure

Single-context repo:

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as `CONTEXT.md` defines it. Never reach for a synonym the glossary lists under `_Avoid_`.

A concept missing from the glossary is a signal. Either you are inventing language the project does not use, in which case reconsider, or there is a real gap, in which case note it for `/grill-with-docs`.

## Flag ADR conflicts

If your output contradicts an existing ADR, say so explicitly instead of silently overriding it:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
