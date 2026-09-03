# One question, one whole-catalog read scope: the complete token set or nothing

Status: ready-for-agent

## Epic

Module 6 — Reads Set Free · Epic 6.2 — The ephemeral whole-catalog read
(PLAN decisions 2, 11; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

The main-thread scope that hands Aluna the whole active catalog for the length of
one question and takes it back afterwards.

**The complete per-incarnation read-token set is acquired atomically against one
catalog snapshot, or not at all**, and released in `finally` — the existing
contract in `src/runtime/concurrency/read-gates.ts`, used unchanged. One
immutable active-registry view is captured before any query work begins, and the
scope owns every incarnation in it or owns none of them. A question that half-owns
the catalog would read one capability across a deletion of another, which is the
race the gate exists to make impossible.

**Ownership never enters the worker** (decision 11). The scope lives beside the
gate on the main thread; 6.2/01's worker is only where SQL executes, and it is
handed statements, not authority.

**Disposable by nature, not by policy** (decision 2). The scope creates no
registry row, no logo, no version, no artifact, no cache, no persisted read
dependency and no conversation thread. The same question asked twice opens two
scopes and runs twice. This is the module's single exception to *everything is
cached*, and it is an exception in the direction of less state — a test sweeps the
platform stores before and after a scope and proves nothing was added.

**Release is unconditional.** The scope releases in `finally`, so a failed
statement, a thrown error and a cancelled question all leave the gate with no
readers rather than with a leaked token that would later fail somebody's
deletion.

## Acceptance criteria

- [ ] A query scope acquires the complete per-incarnation token set for one
      captured catalog snapshot, or acquires nothing and fails
- [ ] The snapshot is captured once, before any query work, and the scope reads
      no capability outside it
- [ ] Tokens are released in `finally` on every exit — success, throw and cancel
- [ ] The worker never receives a token, an incarnation id or the catalog
- [ ] No registry, version, artifact, cache, `read_dependencies` row or
      conversation state exists after a scope closes, proved by a store sweep
- [ ] The same question opened twice acquires and releases twice, with nothing
      reused between them
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Headless; the module is still invisible until 6.5. Exercise it by running this
issue's tests, in particular the store sweep — it is the deterministic form of the
plan's *no registry row, version, artifact, cache or read dependency was created
by any of it*, and it is cheaper to run here than to check by eye at the end.

## Blocked by

- modules/06-reads-set-free/6.2-the-ephemeral-whole-catalog-read/issues/01-the-query-worker-and-its-own-read-only-connection.md
