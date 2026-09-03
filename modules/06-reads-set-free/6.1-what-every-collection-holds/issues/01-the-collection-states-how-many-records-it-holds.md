# Every collection states how many records it holds

Status: ready-for-agent

Type: HITL — the number is new furniture on the collection, and decision 32
deliberately leaves where it is rendered and how it looks unsettled.
Implementation is fully specified and agent-ready; a human sees where it lands
and reads how it says it before sign-off.

## Epic

Module 6 — Reads Set Free · Epic 6.1 — What every collection holds
(PLAN decision 32; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

A capability's collection states how many records it holds. This is the module's
first visible day and it answers the most common question in it before anyone has
to ask — a person who can read the number never has to ask Aluna for it.

**It is platform-owned scaffolding.** No generated artifact changes: the same
Handler, the same item renderer and the same generated tests serve a capability
that was built before this issue, and no spec, registry or `ui_intent` field is
added for it. The count belongs to the platform's collection chrome
(`src/presentation/records/list-container.ts`), beside the search chrome and the
records region, not to anything a model wrote.

**It is a `count` against the read connection**, so it is free — the same
physically read-only path (`dbReadonly` in `src/platform/persistence/db.ts`) that
every other read on the desk already uses. It writes nothing and creates no
registry, version, artifact, cache or `read_dependencies` state.

**The number is true, or it is not there.** It equals the records the capability
holds, and it agrees with what the collection renders. It stays true across a
create, an update and a delete, following the same refresh the records region
already takes rather than a second mechanism that can drift from it.

**A collection with no records already speaks.** The platform empty state is what
a bare collection says, and this issue must not leave two statements of the same
fact standing next to each other.

Where the number is drawn, and in what words, is not settled by the plan and is
not settled here. This issue states the behaviour; the human signs off on the
rendering.

## Acceptance criteria

- [ ] A capability's collection states how many records it holds, and the number
      equals the records rendered in that collection
- [ ] The number is read through the read-only connection; no write, no new
      table, no spec or registry field, no second source of truth
- [ ] No generated artifact changes — a capability built before this issue shows
      its count without being rebuilt
- [ ] The number stays true across create, update and delete without a reload,
      through the existing records refresh rather than a parallel one
- [ ] An empty collection keeps its platform empty state and does not state the
      same fact twice
- [ ] The count creates no registry, version, artifact, cache or read-dependency
      state
- [ ] **Sign-off gate:** the human has seen where the number lands, on a
      populated and on an empty collection, and read how it says it
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Run `bun run reset`, start Aluna on `:3030` and build Notes from the prompt bar.
Add a few notes and open Notes from its logo: the collection says how many notes
there are. Add another and watch the number move without a reload; delete one and
watch it move back. Open a capability with nothing in it and confirm the empty
state still reads as one statement, not two.
