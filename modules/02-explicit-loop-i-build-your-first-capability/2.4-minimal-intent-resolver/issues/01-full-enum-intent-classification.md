# Full-enum intent classification

Status: done

## Epic

Module 2 — Explicit Loop I: Build Your First Capability · Epic 2.4 — Minimal
intent resolver (`docs/modules.md` §2.4, ARCH §6.2 "Intent Resolver", PLAN
decision 6: `modules/02-explicit-loop-i-build-your-first-capability/PLAN.md`)

## What to build

The resolver's classification call: prompt + registry context → a structured,
Zod-validated intent through the provider contract. Per PLAN decision 6, the
intent schema **speaks the complete language from the first build** —
`new_capability | extend_capability | ui_change | data_query` plus a reject
bucket — while M2 *acts* only on `new_capability`. M3/M4 then change no
contract, and intent-distribution data accrues from day one.

- **Context assembly.** The call sees the whole registry (every capability's
  `prompt_context`) and the active capability — that is what makes overlap
  classification possible. Duplicates fall out free: "track my notes" when
  Notes exists classifies as `extend_capability` — no collision logic, no
  auto-suffixed ids.
- **The shape** carries `confidence`, `target_capability`, `proposed_action`,
  and `user_facing_label` — the one warm product-voice sentence emitted in the
  *same* call (no separate copy-generation call, ARCH §6.2) that threads through
  narration and deflection. `requires_confirmation` exists in the shape but is
  always `false` in M2 (confirmations are reserved: capability delete in M3,
  proposals in M6).
- **Scope line.** Classification only — what the job *does* with the intent
  (proceed or deflect) is the deflection issue's business.

Per repo convention (Module 1, epic 1.5): no test calls a real provider; the
classification is asserted through a fake provider behind the existing contract.

## Acceptance criteria

- [x] The intent schema carries the full enum + reject bucket, is Zod-validated,
      and includes `requires_confirmation` (always `false` in M2)
- [x] The classification call assembles registry context from every row's
      `prompt_context` plus the active capability
- [x] With a faked provider: "track my notes" while Notes exists classifies as
      `extend_capability` (the duplicate falls out as overlap, not collision)
- [x] `user_facing_label` arrives from the same call — no second AI call for copy
- [x] No test calls a real provider

## Blocked by

- modules/02-explicit-loop-i-build-your-first-capability/2.1-capability-registry/issues/01-registry-store-and-capability-spec-shape.md

## Comments

**2026-06-23 - implemented.** Added the classification-only Intent Resolver
surface in [`src/intent-resolver/`](../../../../src/intent-resolver/), leaving
job wiring and deflection behavior to issue 02 as planned.

- [`schema.ts`](../../../../src/intent-resolver/schema.ts) defines the full M2+
  intent language (`new_capability | extend_capability | ui_change |
  data_query | reject`) with Zod validation, `confidence`,
  `target_capability`, `proposed_action`, `user_facing_label`, and a literal
  `requires_confirmation: false` for M2.
- [`resolver.ts`](../../../../src/intent-resolver/resolver.ts) lists the whole
  registry, assembles every row's `prompt_context`, includes the active
  capability, and makes one provider `generate(prompt, schema)` call. The prompt
  explicitly treats duplicate-looking asks as overlap (`extend_capability`) and
  forbids suffixed duplicate ids.
- [`resolver.test.ts`](../../../../src/intent-resolver/resolver.test.ts) uses a
  fake provider only. It covers the full enum, the M2 confirmation invariant,
  registry-context assembly, same-call `user_facing_label`, the "track my notes"
  overlap case, and Zod rejection of non-conforming provider output.

**Verification:** `bun test src/intent-resolver/resolver.test.ts`, `bun test`,
`bun run typecheck`, `bun run lint`, and `git diff --check` all passed.
