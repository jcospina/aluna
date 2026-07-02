# Reshape ui_intent + spec generation authors it

Status: ready-for-agent

## Epic

Module 3 — Opinionated Capability UI · Epic 3.3 — Presentation intent + detail
modal (read-only) (`docs/modules.md` §3.3, ARCH §6.3 "Capability Registry",
ADR-0005 §6, PLAN decisions 5 & 7:
`modules/03-opinionated-ui-design-contract/PLAN.md`)

## What to build

Reshape the capability spec's `ui_intent` to record only the capability-specific
presentation choices that survive Module 3, and update spec generation to author
the new shape. The M2 field-type pantry is untouched (`file` stays M6).

- Retire `ui_intent.views: ["list", "create"]`.
- Add: `item` (free-text design direction), `collection.layout` (closed enum
  `feed | grid`; an unknown value fails the build closed, symmetric with an
  unknown field type), and `detail.shows` (fields/order the detail surface shows).
  `modal: true` is **not** stored — the shared modal is a platform invariant.
- Change the spec Zod schema in `src/registry/spec.ts` accordingly. Spec
  generation authors the reshaped `ui_intent` alongside `schema` + `behavior`,
  Zod-validated to the new shape; product-voice narration is unchanged.

## Acceptance criteria

- [ ] `ui_intent.views` is removed; `item`, `collection.layout` (closed
      `feed | grid`), and `detail.shows` are added and Zod-validated
- [ ] An unknown `collection.layout` fails validation loudly (build fails closed)
- [ ] `modal` is not a stored field; the M2 field-type pantry is unchanged
- [ ] Spec generation authors the reshaped `ui_intent`; a fake-provider test
      asserts the generated spec validates to the new shape (no real provider call)
- [ ] Demo: the `/demo/spec-build` spec preview shows the reshaped `ui_intent`
      (dev-only JSON). AFK — this schema/data change has no visual UI surface of
      its own and is verified by Zod + spec-gen tests

## Blocked by

None - can start immediately
