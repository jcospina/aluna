# The pet — deferred component spec

**Status: specified, not built.** This is the durable home for the pet's design so
a future issue (under Epic 1.2, or a later module) can implement it cold. It
carries no business logic and was deliberately deferred: the thesis is the
self-building app, and the pet is a delight layer to build after the spine works.
Nothing about it ships in the base shell — no greeting copy, no cold-start hero
animation, no reserved DOM slot. The cold-start layout changes when the pet lands,
not before. (Supersedes the original "animated orb" concept.)

> **Read this as guidance of its vintage, not as a contract (noted 2026-09-03).**
> This file is as old as the repo and predates the desk, the drawn line, High Meadow
> and the logo contract. Two statements are already stale: messages rendering "into
> the content area", against a desk whose own markup says it "no longer ships a
> content area at all"; and "supports walking" in the hard-constraint list, which is a
> claim about a design that has not been made. **The pet's form, anatomy, hue,
> technique and motion are the user's to decide**, and nothing here or elsewhere
> anticipates them. `design/research/the-spark.md` explored a starburst direction with
> no face, contradicting this file's own "anthropomorphic, with eyes"; it was judged
> bad and deleted rather than folded into a page. When the pet is designed, its
> contract becomes a page under `design/`, as the logo's did, and this file retires.
>
> **Nothing depends on the pet, by design (2026-09-03).** Module 6 was briefly planned
> around a speech surface the pet would later inhabit; it now answers in its own window
> instead (ADR-0008), which needs no pet and reuses the window machinery that already
> exists. The pet is a delight feature that may never be built, and no plan should be
> written that waits on it.

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

Reduce Motion quiets travel, not life (PLAN decision 44). The pet keeps breathing,
blinking and reacting where it stands; what stops is everything that takes it
somewhere — no walk along the prompt bar, no float, and no arrival from off-screen.
It states its distances and their durations through the travel axis (`--travel` in
`design/styles/tokens.css`) like the rest of the surface, so it needs no reduced-motion
branch of its own.

## Voice

Speaks in the [product voice](../CONTEXT.md#product-voice).

## Name

TBD. It must be an authentic Kogi word related to Aluna: a spark, a little one, a
messenger, a seed of thought. Do not invent one. Verify the word against a real
source before committing it.
