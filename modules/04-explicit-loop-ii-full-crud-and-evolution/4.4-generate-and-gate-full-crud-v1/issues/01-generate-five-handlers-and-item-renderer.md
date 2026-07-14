# Generate all five Handlers and item.ts with Action-specific projected contexts

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.4 — Generate and
Gate full-CRUD v1 capabilities
(PLAN decisions 1, 4 (final), 13, and epic boundary:
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`; ADR-0003 coding
harness; ADR-0005 item renderer)

## What to build

The prompt Builder generates complete five-Action v1 capabilities — the first
real, fully CRUD-capable generated capability.

- The Builder emits the complete five-Action authored candidate shape:
  canonical `tools: [create, read, update, delete, search]`,
  `read_dependencies` with exactly all five keys, Action-owned
  `behavioral_errors` including **both** `create` and `update`
  `missing_required_fields` cases whenever active required fields exist, plus
  label/lifecycle-complete fields, `ui_intent`, `behavior`, and
  `prompt_context`. The AI never authors lifecycle metadata (incarnation,
  version, build id, snapshot, `artifacts_path`).
- Each generated unit receives its Action-specific projected context: only the
  Action-safe active-field projection, its declared dependencies' active
  projections, and its Action's error cases — never inactive definitions,
  `extra`, or another Action's context.
- Every final registry row validates against the complete five-Action
  inventory (five Handlers + `item.ts`) before it can be routed. The
  transitional two-Action allowance and the reference fixture remain admissible
  until 4.4/05 removes them.

## Acceptance criteria

- [ ] A prompt-built capability produces all five Handler files plus `item.ts`
      and the complete five-Action spec shape; the registry validates the full
      inventory before routing
- [ ] Both required-field error cases are present exactly when active required
      fields exist and cover exactly those fields
- [ ] Per-Action context projection pinned by tests: a unit's generation
      context never contains inactive fields, `extra`, or undeclared
      dependency data
- [ ] Full CRUD works through the 4.3 chrome on a freshly prompt-built
      capability (create, read, edit-save, inline delete, search)
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean
- [ ] **Human sign-off**: prompt-build a Notes-style capability and exercise
      full CRUD on the running app

## Living demo

Prompt-build “notes with a title, tags and a done flag” and drive every CRUD
surface on the homepage — the module's headline moment.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.2-mutation-coordinator-split-tools-and-routing-actions/issues/06-read-dependencies-rehydration-and-search-normalization.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.3-full-crud-platform-presentation/issues/04-post-mutation-records-region-refresh.md
