# Spec generation

Status: ready-for-agent

## Epic

Module 2 — Explicit Loop I: Build Your First Capability · Epic 2.5 — Capability
builder + global serial build queue (`docs/modules.md` §2.5, ARCH §6.2 "Capability
Builder" step 1, PLAN decision 8 & flow step 3:
`modules/02-explicit-loop-i-build-your-first-capability/PLAN.md`)

## What to build

The first real stage of the build job's pipeline: prompt + resolved intent → the
capability **spec** (`schema + ui_intent + behavior`) through the provider
contract, validated against the registry's Zod spec shape. The spec is the
diffable source of truth everything downstream derives from (ARCH §9.1).

- **Validation is the gate into the pipeline.** A non-conforming model output
  surfaces as a failed-build path — never a silently accepted malformed spec
  flowing downstream. (The provider contract already rejects non-conforming
  objects; this stage maps that rejection onto the build's failure path.)
- **M2 bounds baked in**: `tools` is `create` + `read`; views are `list` +
  `create`; field types stay inside the M2 enum — the spec shape enforces all of
  it.
- **Identity.** Derive the capability's engineering `id` and user-facing `label`
  (CONTEXT.md: engineering names never face the user).
- **Narration.** Product-voice narration streams over the job's stream while the
  spec generates, driven by the intent's `user_facing_label` — never internals
  (no "spec", no "schema" in anything user-visible).
- **Measurement.** Spec-gen duration and token usage are captured for the
  build's metrics row.

Until the resolver is wired in front (epic 2.4), the stage runs from a hardcoded
`new_capability` intent — the PLAN's build order is explicit about this.

## Acceptance criteria

- [ ] The stage consumes prompt + intent and yields a Zod-valid spec, or fails
      the build cleanly — a malformed spec can never continue downstream
- [ ] Generated specs respect the M2 pantry: create+read tools, list+create
      views, the four field types
- [ ] Narration streams in product voice during generation; no internals leak
- [ ] Spec-gen duration and token usage are captured for metrics
- [ ] Tests with a fake provider cover the happy path and the non-conforming
      output path; no test calls a real provider

## Blocked by

- modules/02-explicit-loop-i-build-your-first-capability/2.1-capability-registry/issues/01-registry-store-and-capability-spec-shape.md
- modules/02-explicit-loop-i-build-your-first-capability/2.5-capability-builder-and-build-queue/issues/01-build-job-single-flight-queue-and-busy-refusal.md
