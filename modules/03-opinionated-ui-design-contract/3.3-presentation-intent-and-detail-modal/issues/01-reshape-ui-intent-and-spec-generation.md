# Reshape ui_intent + spec generation authors it

Status: done

## Epic

Module 3 — Opinionated Capability UI · Epic 3.3 — Presentation intent + detail
modal (read-only) (`docs/modules.md` §3.3, ARCH §6.3 "Capability Registry",
ADR-0005 §6, PLAN decisions 5 & 7:
`modules/03-opinionated-ui-design-contract/PLAN.md`)

## What to build

Reshape the capability spec's `ui_intent` to record only the capability-specific
presentation choices that survive Module 3, and update spec generation to author
the new shape. The field-type pantry gained a `date` type (2026-07-06, ADR-0005
amendment) but is otherwise unchanged here (`file` stays M6).

- Retire `ui_intent.views: ["list", "create"]`.
- Add: `item` (free-text design direction), `collection.layout` (closed enum
  `feed | grid`; an unknown value fails the build closed, symmetric with an
  unknown field type), and `detail.shows` (fields/order the detail surface shows).
  `modal: true` is **not** stored — the shared modal is a platform invariant.
- Change the spec Zod schema in `src/registry/spec.ts` accordingly. Spec
  generation authors the reshaped `ui_intent` alongside `schema` + `behavior`,
  Zod-validated to the new shape; product-voice narration is unchanged.

## Acceptance criteria

- [x] `ui_intent.views` is removed; `item`, `collection.layout` (closed
      `feed | grid`), and `detail.shows` are added and Zod-validated
- [x] An unknown `collection.layout` fails validation loudly (build fails closed)
- [x] `modal` is not a stored field; the M2 field-type pantry is unchanged
- [x] Spec generation authors the reshaped `ui_intent`; a fake-provider test
      asserts the generated spec validates to the new shape (no real provider call)
- [x] Demo: the `/demo/spec-build` spec preview shows the reshaped `ui_intent`
      (dev-only JSON). AFK — this schema/data change has no visual UI surface of
      its own and is verified by Zod + spec-gen tests

## Blocked by

None - can start immediately

## Implementation notes

- `src/registry/spec.ts` now validates `ui_intent` as `{ item, collection:
  { layout }, detail: { shows } }`; `collection.layout` is the closed
  `feed | grid` enum, `detail.shows` must reference real schema fields, and strict
  object validation rejects the retired `views` shape and any stored `modal` flag.
- `src/builder/spec-gen.ts` now prompts the provider to author the reshaped
  presentation intent alongside schema/behavior while keeping the existing
  product-voice narration unchanged.
- `src/web/cached-view.ts` reads the validated `ui_intent.collection.layout` when
  rendering the platform list container; a route-level app test covers `grid`.
- The temporary M2 unit generator still emits `list.html`/`create.html` until the
  later 3.4/3.7 artifact-shape issues replace them, but it no longer depends on
  `ui_intent.views`.
- Demo/fake-provider coverage asserts the streamed spec preview includes
  `ui_intent.item`, `collection.layout`, and `detail.shows`, and excludes `views`
  and `modal`.

## Verification

- `bun test src/registry/spec.test.ts src/builder/spec-gen.test.ts src/app.test.ts src/capability-data/ddl.test.ts src/builder/migration.test.ts src/builder/gate.test.ts src/router/router.test.ts src/capability-data/tool.test.ts src/intent-resolver/resolver.test.ts src/registry/store.test.ts src/builder/units.test.ts src/builder/commit.test.ts`
- `bun test`
- `bun run typecheck`
- `bunx biome check src/registry/spec.ts src/registry/index.ts src/builder/spec-gen.ts src/builder/units.ts src/web/cached-view.ts src/presentation/detail-modal.ts src/presentation/field-renderer.ts src/registry/spec.test.ts src/builder/spec-gen.test.ts src/app.test.ts src/router/router.test.ts src/builder/units.test.ts src/builder/commit.test.ts src/builder/migration.test.ts src/builder/gate.test.ts src/registry/store.test.ts src/intent-resolver/resolver.test.ts src/capability-data/tool.test.ts src/capability-data/ddl.test.ts src/presentation/detail-modal.test.ts`
- `git diff --check`

## HITL test instructions

1. Run `bun run reset` if your local data has pre-M3 capabilities, then run
   `bun run dev`.
2. Open `http://localhost:3030/` and open the developer panel with the `</>` button.
3. Enter `I want to keep track of my notes` in the prompt bar and click `Make it`.
4. Confirm the developer-only spec preview JSON shows `ui_intent.item`,
   `ui_intent.collection.layout` (`feed` or `grid`), and `ui_intent.detail.shows`,
   and does not show `ui_intent.views` or `modal`.
5. For the raw demo stream, open
   `http://localhost:3030/demo/spec-build?prompt=I%20want%20to%20keep%20track%20of%20my%20notes`
   and confirm its `spec-preview` event contains the same reshaped `ui_intent`.

## Comments

- 2026-07-09 — HITL follow-up: a real provider run generated the reshaped spec
  successfully, then failed closed during `read.ts` unit generation because the
  generated handler returned a regex capture (`m[1]`) without narrowing under the
  isolated checker's `noUncheckedIndexedAccess` setting. Hardened the handler
  prompt and retry feedback to explicitly call out strict unchecked-index/regex
  capture failures, with a focused regression in `src/builder/units.test.ts`.
