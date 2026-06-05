# The pet — deferred component spec

**Status: specified, not built.** This is the durable home for the pet's design so
a future issue (under Epic 1.2, or a later module) can implement it cold. It
carries **no business logic** and was deliberately deferred: the thesis is the
self-building app; the pet is a delight layer to build *after* the spine works.
Nothing about it ships in the base shell — no greeting copy, no cold-start hero
animation, no reserved DOM slot. When the pet lands, the cold-start layout
switches then. (Supersedes the original "animated orb" concept.)

## Concept

An **anthropomorphic spark of Aluna** — a small luminous companion with eyes/face
that feels alive. *Related to* Aluna (the realm of thought made visible) but **not
Aluna herself**. A first-class delight feature.

## Placement

Lives **on/above the prompt bar** — it walks along the bar and **talks from
there**. Its messages render into the content area, **bottom-placed and emphatic**
(not centered). A persistent-companion model.

It **inherits the orb's old double-duty**: cold-start presence + the *"something is
being built"* indicator that Module 2's narration drives over SSE. It does **not**
shrink into a corner spinner — it stays itself.

## State vocabulary

Named now; Module 2 wires the live ones.

- **`idle`** — resting + alive (breathe, blink, occasional glance; walks the
  prompt bar). *Default.*
- **`thinking`** — "something is being built" (M2, via SSE).
- **`speaking`** — delivering a message; a modifier over `idle`/`thinking`, not a
  standalone state (M2).
- **`done`** — brief success reaction (M2).
- **`trouble`** — "something went sideways", in product voice, never technical (M2).

## Rendering constraints

Technique is **deliberately open, decided when built**. Candidates: inline SVG, a
committed spritesheet (APNG / CSS `steps()`), or a vendored real-time tool (e.g.
Rive: runtime under `public/vendor/`, a static `.riv` asset).

Hard constraints (non-negotiable):

- **No build step.** Assets committed and served from `/static`.
- Anthropomorphic, **with eyes**.
- Supports **walking + talking** and the full state vocabulary above.
- Authored shell JS lives in `public/app.js` today; the pet's logic would go in a
  sibling `public/pet.js` (plain JS, `// @ts-check` + JSDoc — same no-build rule
  as `app.js`).

## Reduced motion

A single **calm static pose** (eyes open, no walk/float) under
`prefers-reduced-motion: reduce`.

## Voice

Speaks in the [product voice](../CONTEXT.md#product-voice).

## Name

**TBD.** Must be an **authentic Kogi word** related to Aluna (a spark / little one
/ messenger / seed-of-thought). **Do not invent one** — verify against a real
source before committing.
