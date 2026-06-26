# 0005 — Opinionated capability UI: platform components, closed-value design contract & the design gate (amends 0004, seeds Module 3)

Status: accepted

Amends [ADR-0004](0004-capability-artifact-contract-and-validation-isolation.md).
Settled in the Module 3 grilling session (2026-06-26). Exact class names, token
names, component APIs, and the exemplar set remain implementation detail, decided
inside Module 3.

## Problem

A capability is born usable but **ugly**. The unit-generation prompts hand the
model a *structural* contract (routes, data-free views, no scripts) and the spec,
but **no design guidance** — no tokens, no components, no example. With nothing to
imitate, the model reproduces the same bare *[title][empty state][form]* scaffold
every build. Aluna is a self-evolving platform: generation is **hidden from the
user, one-shot, and re-run on every version bump**, with no developer reviewing
the output before it ships. So consistency cannot be hoped for per build — it must
be **structural**.

The field has converged on a three-legged answer (v0/shadcn, the
design-system-for-LLM writeups, and the *impeccable* design skill's detector
rules): a **closed token + component vocabulary**, **spec/example context** fed to
the model, and **automated auditing that rejects violations**. Aluna already owns
two of the three legs — a closed-ish token layer (`public/css/tokens.css`,
`docs/design-system.md`) and a layered, fail-closed gate. This ADR puts all three
to work.

## Decision

Six interlocking choices. The governing line, inherited from ADR-0004 and ARCH §1,
is unchanged: **the platform may own *presentation*, never *business logic*.** ARCH
§7's platform-owned `data_query` auto-table is the standing precedent that
presentational platform code is allowed.

1. **Thick shell, thin generation: structural chrome is platform-owned and
   presentational.** The **modal** (open/close/prefill — the single component every
   capability reuses), the **list scaffolding** (container, empty state, the
   "New X" button), and the **create/edit form** (one labeled control per field,
   rendered deterministically from the spec, with the HTMX wiring and
   close-on-success) become fixed platform components. They hold **no user data**
   (the form is an empty scaffold; in edit mode it is populated client-side, see
   §3) and **no business logic**. Consequently `list.html` and `create.html`
   **cease to be generated units**.

2. **The list item is the one generated creative surface.** `read.ts` renders the
   per-item **row** — the only place per-capability visual variation lives — and
   `create.ts` renders an **identical** row so a just-created item matches the
   listed ones. Because generated handlers cannot import (ADR-0004), each carries
   its **own copy** of an identical row helper; the gate checks both. The row is
   where the builder is free — and *encouraged* — to vary composition (grid, feed,
   cards, compact rows) to fit the data.

3. **Each row embeds its full record for prefill (no new route).** The row root
   carries the item's full record as an escaped `data-item` payload (`file` fields
   as references, never bytes — ARCH §7). The platform modal reads it to open
   **prefilled** with full content even when the row visually truncates — so the
   fixed `create + read` route convention is **unchanged** (no read-single route).
   The cost is that the list response materializes the dataset; the **escape
   hatch**, if large-text capabilities ever make that a problem, is to move prefill
   to read-single-on-open behind the modal's `open(item)` — a localized change (the
   per-item route arrives with M4's `update`; the row payload shrinks to an id; the
   gate rung follows), **not** a rewrite, and touching no committed capability's
   look.

4. **A closed-value design contract, enforced by a new gate rung.** Generated
   markup targets the **design tokens and a small primitive vocabulary only** —
   raw color/space/font values, fabricated tokens, and unknown classes are
   forbidden. A new **fail-closed design-lint rung** in the layered gate rejects
   those, plus any row missing a parseable `data-item` or a click-to-open hook,
   feeding the failure back through the **same bounded fix loop** as the existing
   checks. *Closed values, open composition*: the gate constrains the *value layer
   and primitives*, never the *arrangement*.

5. **The builder is steered by injection, not a runtime tool.** Unit generation is
   one-shot structured output — agentic only *within* a unit's write→check→fix
   loop, never a roaming agent (ADR-0003). So design guidance reaches the model by
   **injection** (the contract plus a curated, **repo-only** few-shot gallery of
   2–3 deliberately different exemplars, with *"vary, don't copy"* framing) and is
   **enforced** by the gate rung (§4). No live "read the design system" tool is
   added; that would fight the deterministic-across-units discipline and add
   measured build latency (a thesis metric). The exemplars are LLM-facing only —
   **never rendered to the user**.

6. **`ui_intent` grows to the architected shape.** `ui_intent` gains `detail`
   (which fields the modal surfaces) and `modal: true`, implementing the shape ARCH
   §6.3 already drew. Module 3 ships the detail modal **read-only**; M4's `update`
   adds the Save button — the modal flips from read-only to editable with no new
   component.

## Consequences

- **ADR-0004 §1 is amended.** "Views are data-free scaffolding, *generated*"
  becomes "the scaffolding is *platform-rendered*; the data-free principle holds —
  platform views carry no user data, and live record data rides in **handler**
  output (the row's `data-item` and rendered fields) exactly as before." ADR-0004
  §2 (handlers return HTML over the injected toolbox) and §3 (gate runs on a
  scratch db) are **unchanged**.
- **The gate gains a rung and the unit checks shift.** The `list`/`create` *view*
  checks (`checkListView`/`checkCreateView`) retire with those generated units; new
  checks assert the row's `data-item` + click hook on both handlers, and the
  design-lint rung enforces the closed-value contract.
- **The Diff Engine (M4) drops `list.html`/`create.html` as units.** The
  read/create row-helper duplication is a tracked coupling the diff and the gate
  must keep in sync.
- **The spec schema expands.** `ui_intent` gains `detail` + `modal`; validation
  follows. The M2 field-type pantry is untouched (`file` is still M6).
- **`design-system.md` gains a section** for the platform components, the primitive
  vocabulary, and the closed-value contract — authored during Module 3.

## Rejected, with reasons

- **Better prompt only, fully model-generated UI (no platform components).**
  Re-rolls consistency on every build *and* every version bump; fights the
  shared-modal requirement; offers no structural guarantee — the exact failure mode
  for a hidden, unreviewed, self-evolving generator.
- **A single gold example.** LLMs anchor hard on one example and reproduce its
  layout, trading "sameness from no guidance" for "sameness from one sample." A
  small *diverse* gallery teaches the contract's range, not a single shape.
- **A tight, fixed component menu (close the composition too).** Maximal
  consistency, but every capability converges on the same layout — the boredom the
  module exists to kill. Hence *closed values, open composition*.
- **A runtime "read the design system" tool / agentic design loop.** Fights
  ADR-0003's deterministic-across-units discipline and adds latency the experiment
  measures; injection + gate achieves the same result deterministically.
- **A read-single route for prefill, up front.** Expands the fixed `create + read`
  route contract and adds a generated handler to feed a modal that is *read-only*
  until M4 — premature for single-user PoC list sizes. Deferred behind the modal
  abstraction as the documented escape hatch (§3).
- **Fully declarative SDUI (model emits JSON, platform renders the view).** Already
  rejected in ADR-0004 as platform business logic; that line is **kept**. The
  platform owns presentation *chrome*; the model still authors the **row HTML** and
  the **handlers**.
