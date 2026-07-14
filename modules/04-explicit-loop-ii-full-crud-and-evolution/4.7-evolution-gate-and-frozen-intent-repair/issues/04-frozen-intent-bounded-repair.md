# Frozen-intent bounded repair

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.7 — Evolution Gate
and frozen-intent repair
(PLAN decisions 23 (repair) and 22:
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`; ADR-0003 bounded
per-unit repair)

## What to build

Repair that answers to frozen tests, never the other way around.

- A failing behavioral assertion repairs **only the implicated Handler** when
  attribution is total; otherwise the conservative Handler set (decision 22's
  fallback for runtime failure attribution that cannot be narrowed without
  weakening a frozen test). It always reruns the **same frozen test**.
- Repair cannot edit, regenerate, weaken, or skip tests in response to code.
- Bounded per-unit retries per ADR-0003; exhaustion fails the build: product
  changes roll back, metrics finalize failed with a typed outcome, the
  presenter restores the canonical View via `fragment`.
- Exercise the whole Gate under evolution: pass/failure over **existing
  records**, every Gate rung (structural, smoke, design lint when `item`
  regenerates, behavioral), bounded retries, rollback, failure metrics, and
  recovery of interrupted `running` metrics.

## Acceptance criteria

- [ ] Total attribution repairs exactly one Handler and reruns the same frozen
      bytes; non-narrowable attribution repairs the conservative set
- [ ] No code path can modify a frozen test during repair (pinned by digest
      verification at publication)
- [ ] Retry bound respected; exhaustion → rollback + `failed` metrics + warm
      `fragment` restoration; prior version stays live and routable
- [ ] Gate runs prove behavior over existing records (a repair cannot pass by
      ignoring historical `null`s)
- [ ] Interrupted mid-repair build reconciles to `interrupted` at boot
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

A deliberately hard evolution (dev fixture forcing a first-pass behavioral
failure) shows the repair story in the foreground stream: failing rung, bounded
repair, then either the View swap or the warm failure with the prior View
restored.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.7-evolution-gate-and-frozen-intent-repair/issues/02-test-copy-run-selection-and-fallback.md
