# Re-cut unit generation: one item renderer + adapter-receiving handlers

Status: ready-for-agent — code complete + automated verification green; **pending
human visual sign-off** (the HITL gate below).

> **HITL — human visual sign-off required.** The generated item renderer is the
> builder's creative surface — the whole point of the module. A human must
> eyeball the generated, styled output on the running app before this issue is
> done; tests cannot judge whether it looks good.

## Epic

Module 3 — Opinionated Capability UI · Epic 3.4 — One item renderer, shared by
every action (`docs/modules.md` §3.4, ADR-0005 §2, ADR-0003 bounded fix loop,
ADR-0004 amended, PLAN decision 2 & flow steps 4 & 7:
`modules/03-opinionated-ui-design-contract/PLAN.md`)

## What to build

Re-cut unit generation (`src/builder/units.ts`) so a capability's generated
artifacts are **one item renderer + `create` + `read` Handlers** instead of M2's
four units (`handler:create`, `handler:read`, `view:list`, `view:create`). The
item renderer turns one record into capability-specific inner markup, generated
**knowing** the chosen `collection.layout`; the Handlers receive the presentation
adapter (3.4/01) and call it instead of emitting their own markup. This kills
create/read drift by construction.

- Generate the item renderer through the existing bounded type-check fix loop
  (`DEFAULT_UNIT_FIX_ATTEMPTS`, default 2 — reused, not new).
- Generate `create`/`read` Handlers to the ADR-0004 skeleton that call the
  injected adapter; no imports, no row markup.
- Retire the `list`/`create` **View** generation and their checks
  (`checkListView`/`checkCreateView`).
- Metrics: presentation-gen now measures **item-renderer** generation (the
  semantic successor to M2's html-gen) plus fix-loop attempts (ADR-0005 "metrics
  retain semantic continuity"; flow step 7). No `artifact_contract` marker in M3.

## Acceptance criteria

- [x] Unit generation produces one item renderer + `create`/`read` Handlers; the
      four M2 units and their View checks are gone
- [x] The item renderer is generated knowing `collection.layout` and runs through
      the bounded fix loop (default 2); exhaustion fails the build cleanly
- [x] Handlers call the injected presentation adapter and import nothing; create
      and read render identical item markup by construction
- [x] Metrics record item-renderer generation + fix-loop attempts as the
      presentation-gen stage
- [x] Tests with a fake provider cover clean generation, fail-once-then-fix, and
      cap exhaustion; no test calls a real provider
- [ ] Demo: building a capability through `/demo/spec-build` shows the generated
      item renderer producing styled output through the adapter; human visually
      confirms the generated UI before done — **awaiting human sign-off (HITL
      below)**

## Delivered

- `src/builder/units.ts` — re-cut. `generateCapabilityUnits` now produces three
  units in fixed order — **item renderer first** (`kind: "item-renderer"`,
  `item.ts` = `ITEM_RENDERER_FILE`), then the `create`/`read` handlers — each
  through the reused bounded fix loop (`DEFAULT_UNIT_FIX_ATTEMPTS`, default 2). The
  result exposes `{ units, handlers, itemRenderer }` (the `views` map is gone). The
  `GeneratedUnit`/`UnitDescriptor` union drops the `view` variant for
  `item-renderer`.
- `src/builder/unit-prompts.ts` — the **item-renderer prompt** injects the closed
  primitive class vocabulary (sourced from `presentation/vocabulary.ts`, one source
  of truth), the token-discipline escape-hatch rules, and the capability's chosen
  `collection.layout` with feed-vs-grid composition guidance, so the item is
  generated *knowing* how the collection arranges it. The **handler prompt** now
  tells the model to render every record through the injected `present(record)`
  adapter and emit no row markup of its own. (The `list`/`create` View prompts are
  gone.) The few-shot gallery + "vary, don't copy" harness stays 3.5.
- `src/builder/unit-checks.ts` — item-renderer static check (one **synchronous**
  `export default function`, one param, no imports, type-checked against
  `ItemRenderer`); the handler contract's `CapabilityContext` gains `present`.
  `checkListView`/`checkCreateView` retired.
- Gate (`gate.ts` + `gate-structural.ts` + `gate-smoke.ts` + `gate-behavioral.ts` +
  `gate-internal.ts`) — `CapabilityGateInput` gains `itemRenderer`. The structural
  rung type-checks it (and asserts its sync export shape) alongside the handlers;
  the smoke and behavioral rungs build the **real** `present` adapter from the
  generated renderer (`buildGatePresent`) and run handlers through it — so the
  throw-on-call `GATE_PRACTICE_PRESENT` (3.4/01's placeholder) is gone and the smoke
  rung proves create + read render identical item markup by construction.
- `src/pipeline/build-run.ts` passes `itemRenderer` into the gate;
  `metrics-recorder.ts` + `metrics/store.ts` measure item-renderer generation as the
  **presentation-gen** leg (`htmlGenMs`/`html_gen_ms` kept as the presentation-gen
  slot for semantic continuity; `unitAttempts.kind` enum is now
  `handler | item-renderer`); `previews.ts` maps the item-renderer preview to
  `item.ts`; `commit.ts` writes `item.ts` beside the handlers. No `artifact_contract`
  marker (decision 8).
- **HITL reload follow-up** — the generated Reading Diary record did persist, but
  the address bar stayed on `/` after HTMX swapped the active capability into the
  shell. Reloading `/` intentionally rehydrates the toolbar only, so the item looked
  lost until the toolbar entry was clicked again. Toolbar entries now carry
  `hx-push-url="/capability/<id>"`, and the browser glue replaces the URL when a
  commit swap lands an active capability surface, so refresh re-enters
  `/capability/<id>` and the live read region reloads persisted rows.

## Verification

- `bun test` — **340 pass / 0 fail** across 27 files (rewrote `units.test.ts`,
  `gate.test.ts`, `commit.test.ts`, and the `app.test.ts` build flow to the
  three-unit shape; all fakes, no real provider call).
  - `units.test.ts` covers: clean generation of item renderer + create/read;
    fail-once-then-fix on **both** the item renderer and a handler; cap exhaustion
    on the item renderer *and* on a handler; item-renderer rejection of imports /
    async; the layout-aware item-renderer prompt; handlers instructed to call
    `present`.
  - `gate.test.ts` covers: the structural rung type-checking the renderer and
    rejecting an async one; smoke rendering create + read through the real adapter.
- `bun run typecheck` — clean (`tsc` strict, both configs).
- `bun run lint` — clean (`biome check .`, 124 files). `git diff --check` clean.
- Live, against the running dev server on :3030 (no API call): `GET
  /demo/detail-interaction` (the **real** presentation adapter + a hand-written
  renderer) renders styled, wrapped items (`class="capability-item"`,
  `class="stack"`, `line-clamp-2 text-sm text-subtle`, per-record detail templates)
  — proof the adapter→enforcer→wrapper→container path a *generated* `item.ts` flows
  through is live and produces styled output.
- Follow-up diagnosis for the Reading Diary HITL reload symptom:
  `POST /capability/reading_diary/create` persisted a row in `cap_reading_diary`;
  `/capability/reading_diary/read` returned that row; Browser-plugin verification
  then proved the toolbar click updates the URL to `/capability/reading_diary` and
  a reload keeps the persisted row visible. Focused checks plus full `bun test` are
  green after the URL-state fix.

## HITL test instructions

The generated item renderer needs a real provider call, so this is the human
visual sign-off (validate, don't code):

1. Clear the pre-M3 capability on disk (`capabilities/reading_log/v1/` still has the
   old four-unit shape): `bun run reset`, then `bun run dev` (or use the server
   already on :3030 after a reset).
2. Open `http://localhost:3030/` and open the developer panel with the `</>` button.
3. Enter a prompt with visually-distinct data, e.g. `I want to track books I've read
   with a title, author, and a 1–5 rating`, and click `Make it`.
4. Watch the dev preview: the **units** panel now shows one `item.ts` (the item
   renderer) plus `create.ts` and `read.ts` — no `list.html`/`create.html`. Confirm
   `item.ts` is a synchronous `export default function renderItem(...)`.
5. When it commits, the capability view opens. Click **New …** and add a couple of
   records.
6. **Sign-off:** each record renders through the *generated* item renderer — styled
   with the primitive vocabulary (readable hierarchy, not raw unstyled text), and
   laid out per the chosen `collection.layout`. Clicking a record opens the shared
   read-only detail modal, prefilled. Create and read show the **same** item markup.
   Confirm it looks good.
7. Reload the page after adding a record. The address bar should now be
   `/capability/<generated-id>` (for example `/capability/reading_diary`), and the
   saved record should reappear through the live read region after reload. If you
   start at `/`, clicking the toolbar entry should also show the same persisted
   record without another AI call.
8. (Optional) For the raw stream, open
   `http://localhost:3030/demo/spec-build?prompt=I%20want%20to%20track%20books%20I%27ve%20read%20with%20a%20title%2C%20author%2C%20and%20a%201-5%20rating`
   and confirm the `units-preview` events carry `item-renderer:item:item.ts`,
   `handler:create:create.ts`, `handler:read:read.ts`.

## Blocked by

- modules/03-opinionated-ui-design-contract/3.3-presentation-intent-and-detail-modal/issues/01-reshape-ui-intent-and-spec-generation.md
- modules/03-opinionated-ui-design-contract/3.4-one-item-renderer/issues/01-presentation-adapter-in-injected-toolbox.md
