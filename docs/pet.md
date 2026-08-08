# The pet — deferred component spec

**Status: specified, not built.** This is the durable home for the pet's design so
a future issue (under Epic 1.2, or a later module) can implement it cold. It
carries no business logic and was deliberately deferred: the thesis is the
self-building app, and the pet is a delight layer to build after the spine works.
Nothing about it ships in the base shell — no greeting copy, no cold-start hero
animation, no reserved DOM slot. The cold-start layout changes when the pet lands,
not before. (Supersedes the original "animated orb" concept.)

## Concept

An anthropomorphic spark of Aluna: a small luminous companion with eyes and a face
that feels alive. It is related to Aluna, the realm of thought made visible, but it
is not Aluna herself. A first-class delight feature.

## Placement

The pet lives on or above the prompt bar. It walks along the bar and talks from
there, and its messages render into the content area, bottom-placed and emphatic
rather than centered. It is a persistent companion, present the whole time.

It inherits the orb's old double duty: cold-start presence, and the "something is
being built" indicator that Module 2's narration drives over SSE. It never shrinks
into a corner spinner — it stays itself.

## State vocabulary

Named now; Module 2 wires the live ones.

- `idle` — resting and alive: breathe, blink, occasional glance, walks the prompt
  bar. The default.
- `thinking` — "something is being built" (M2, via SSE).
- `speaking` — delivering a message; a modifier over `idle`/`thinking`, not a
  standalone state (M2).
- `done` — brief success reaction (M2).
- `trouble` — "something went sideways", in product voice, never technical (M2).

## Rendering constraints

The technique is deliberately open: whoever builds the pet decides it. Candidates:
inline SVG, a committed spritesheet (APNG or CSS `steps()`), or a vendored
real-time tool such as Rive, whose runtime would sit under `public/vendor/`
alongside a static `.riv` asset.

Hard constraints:

- No build step. Assets are committed and served from `/static`.
- Anthropomorphic, with eyes.
- Supports walking, talking, and the full state vocabulary above.
- Authored shell JS lives in `public/app.js` today; the pet's logic would go in a
  sibling `public/pet.js` (plain JS, `// @ts-check` + JSDoc — same no-build rule
  as `app.js`).

## Reduced motion

Under `prefers-reduced-motion: reduce`, a single calm static pose: eyes open, no
walk, no float.

## Voice

Speaks in the [product voice](../CONTEXT.md#product-voice).

## Name

TBD. It must be an authentic Kogi word related to Aluna: a spark, a little one, a
messenger, a seed of thought. Do not invent one. Verify the word against a real
source before committing it.
